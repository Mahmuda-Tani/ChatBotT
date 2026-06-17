import os
import tempfile

import chromadb
import numpy as np
from langchain_chroma import Chroma
from langchain_core.documents import Document as LCDocument
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_text_splitters import TokenTextSplitter
from sklearn.manifold import TSNE
from unstructured.chunking.title import chunk_by_title
from unstructured.partition.pdf import partition_pdf

# ── Embedding model — loaded ONCE at startup ──────────────────────────────────
_embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

# ── Stage 1: Token-aware splitter ─────────────────────────────────────────────
# chunk_size=256 tokens is deliberately half of all-MiniLM-L6-v2's 512-token
# limit, leaving headroom for the query vector during retrieval.
# chunk_overlap=32 tokens ≈ 100-130 characters of repeated context at boundaries.
_token_splitter = TokenTextSplitter(chunk_size=256, chunk_overlap=32)

# ── ChromaDB persistent client ────────────────────────────────────────────────
_chroma_client = chromadb.PersistentClient(path="./chroma_db")
COLLECTION_NAME = "active_document"

_vector_store: Chroma | None = None
_doc_info: dict | None = None


# ── Startup restoration ───────────────────────────────────────────────────────
def _restore_on_startup():
    global _vector_store, _doc_info
    try:
        collection = _chroma_client.get_collection(COLLECTION_NAME)
        count = collection.count()
        if count == 0:
            return
        all_meta = collection.get(include=["metadatas"])
        filename = all_meta["metadatas"][0].get("source", "Unknown") if all_meta["metadatas"] else "Unknown"
        pages = {m.get("page", 0) for m in all_meta["metadatas"]}
        _vector_store = Chroma(
            client=_chroma_client,
            collection_name=COLLECTION_NAME,
            embedding_function=_embeddings,
        )
        _doc_info = {
            "filename": filename,
            "page_count": max(pages) if pages else 0,
            "chunk_count": count,
        }
    except Exception:
        pass


_restore_on_startup()


# ── Core RAG functions ────────────────────────────────────────────────────────

def process_pdf(file_bytes: bytes, filename: str) -> dict:
    """
    Two-stage PDF pipeline:
      Stage 2 — unstructured: structure-aware parsing into typed elements
      Stage 1 — TokenTextSplitter: split to 256-token chunks aligned to model limit
    Tables are kept as single chunks (splitting a table destroys its meaning).
    """
    global _vector_store, _doc_info

    try:
        _chroma_client.delete_collection(COLLECTION_NAME)
    except Exception:
        pass

    # unstructured requires a file path, not raw bytes.
    # We write to a temp file, process it, then delete it.
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(file_bytes)
            tmp_path = tmp.name

        # ── Stage 2: Structure-aware PDF parsing ──────────────────────────────
        # strategy="fast" uses pdfminer — no system dependencies (poppler/tesseract).
        # Returns typed elements: Title, NarrativeText, Table, ListItem, etc.
        elements = partition_pdf(tmp_path, strategy="fast")

        if not elements:
            raise ValueError("Could not extract content from PDF")

        # Recover page count from element metadata
        page_numbers = [
            el.metadata.page_number
            for el in elements
            if el.metadata.page_number is not None
        ]
        page_count = max(page_numbers) if page_numbers else 0

        # Group elements by section/title boundary.
        # max_characters=1200 keeps related content together before token splitting.
        section_chunks = chunk_by_title(elements, max_characters=1200)

    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)

    # ── Stage 1: Token-aware splitting ───────────────────────────────────────
    lc_docs = []

    for section in section_chunks:
        text = (section.text or "").strip()
        if not text:
            continue

        page = getattr(section.metadata, "page_number", 1) or 1
        category = getattr(section.metadata, "category", "NarrativeText") or "NarrativeText"

        if category == "Table":
            # Tables must not be split — a partial table row is meaningless.
            lc_docs.append(LCDocument(
                page_content=text,
                metadata={"page": page, "source": filename, "category": category},
            ))
            continue

        # All other element types: split into token-aligned chunks
        for sub in _token_splitter.split_text(text):
            if sub.strip():
                lc_docs.append(LCDocument(
                    page_content=sub.strip(),
                    metadata={"page": page, "source": filename, "category": category},
                ))

    if not lc_docs:
        raise ValueError("No content could be extracted from this PDF")

    _vector_store = Chroma.from_documents(
        documents=lc_docs,
        embedding=_embeddings,
        client=_chroma_client,
        collection_name=COLLECTION_NAME,
    )

    _doc_info = {
        "filename": filename,
        "page_count": page_count,
        "chunk_count": len(lc_docs),
    }
    return _doc_info


def retrieve_context(query: str, k: int = 4) -> tuple[str, list[dict]]:
    """Search for relevant chunks. Returns (context_string, sources_list)."""
    if _vector_store is None:
        raise ValueError("No document uploaded. Please upload a PDF first.")

    results = _vector_store.similarity_search_with_score(query, k=k)

    context_parts = []
    sources = []
    seen = set()

    for doc, score in results:
        text = doc.page_content.strip()
        if text in seen:
            continue
        seen.add(text)
        context_parts.append(f"[Page {doc.metadata['page']}]\n{text}")
        sources.append({
            "text": text,
            "page": doc.metadata["page"],
            "score": round(float(score), 3),
        })

    return "\n\n---\n\n".join(context_parts), sources


def get_all_chunks() -> list[dict]:
    """Return every stored chunk with text, metadata, and an embedding preview."""
    if _vector_store is None:
        return []

    collection = _chroma_client.get_collection(COLLECTION_NAME)
    result = collection.get(include=["documents", "metadatas", "embeddings"])
    raw_embeddings = result.get("embeddings")

    chunks = []
    for i in range(len(result["ids"])):
        embedding = raw_embeddings[i] if raw_embeddings is not None else []
        chunks.append({
            "id": result["ids"][i],
            "text": result["documents"][i],
            "page": result["metadatas"][i].get("page", "?"),
            "source": result["metadatas"][i].get("source", ""),
            "metadata": result["metadatas"][i],
            "embedding_preview": [round(float(v), 4) for v in embedding[:16]],
            "embedding_dims": len(embedding),
        })

    chunks.sort(key=lambda c: (c["page"], c["id"]))
    return chunks


def get_vectors_2d() -> list[dict]:
    """Compress stored embeddings to 2D via t-SNE for scatter plot visualization."""
    if _vector_store is None:
        return []

    collection = _chroma_client.get_collection(COLLECTION_NAME)
    result = collection.get(include=["embeddings", "documents", "metadatas"])

    embeddings = result.get("embeddings")
    if embeddings is None or len(embeddings) < 2:
        return []

    vectors = np.array(embeddings)
    n_samples = len(vectors)
    perplexity = min(30, n_samples - 1)

    tsne = TSNE(n_components=2, perplexity=perplexity, random_state=42, max_iter=1000)
    coords = tsne.fit_transform(vectors)

    return [
        {
            "x": round(float(coords[i][0]), 4),
            "y": round(float(coords[i][1]), 4),
            "text": result["documents"][i][:200],
            "page": result["metadatas"][i].get("page", 0),
            "category": result["metadatas"][i].get("category", ""),
        }
        for i in range(n_samples)
    ]


def get_doc_info() -> dict | None:
    return _doc_info


def clear_document():
    global _vector_store, _doc_info
    try:
        _chroma_client.delete_collection(COLLECTION_NAME)
    except Exception:
        pass
    _vector_store = None
    _doc_info = None
