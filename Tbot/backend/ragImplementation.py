import io

import chromadb
import numpy as np
from langchain_chroma import Chroma
from langchain_core.documents import Document as LCDocument
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pypdf import PdfReader
from sklearn.manifold import TSNE

# ── Embedding model — loaded ONCE at startup, reused on every request ─────────
# Previously this was inside get_embeddings() which reloaded the model each call.
# Loading a HuggingFace model from disk takes 1-3 seconds.
# By loading it here (module level), it loads once when uvicorn starts, then stays
# in memory and is reused for every upload and every search.
_embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

# ── ChromaDB persistent client ────────────────────────────────────────────────
# PersistentClient writes all data to the ./chroma_db/ folder on disk.
# This means the index survives server restarts, crashes, and redeployments.
# Unlike FAISS which lived only in RAM.
_chroma_client = chromadb.PersistentClient(path="./chroma_db")
COLLECTION_NAME = "active_document"

_vector_store: Chroma | None = None
_doc_info: dict | None = None


# ── Startup restoration ───────────────────────────────────────────────────────
# This runs automatically when the module is imported (i.e. when uvicorn starts).
# If a collection already exists on disk from a previous run, we reconnect to it
# so the user can continue chatting without re-uploading their document.
def _restore_on_startup():
    global _vector_store, _doc_info
    try:
        collection = _chroma_client.get_collection(COLLECTION_NAME)
        count = collection.count()
        if count == 0:
            return

        # Recover filename and page range from stored chunk metadata
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
        pass  # No existing collection — fresh start is fine


_restore_on_startup()


# ── Core RAG functions ────────────────────────────────────────────────────────

def process_pdf(file_bytes: bytes, filename: str) -> dict:
    """Parse PDF → chunk → embed → store in ChromaDB. Returns doc metadata."""
    global _vector_store, _doc_info

    # Delete the previous collection so each upload starts fresh.
    # In production with multiple users, you would keep all collections and
    # identify them by session_id instead of deleting.
    try:
        _chroma_client.delete_collection(COLLECTION_NAME)
    except Exception:
        pass

    reader = PdfReader(io.BytesIO(file_bytes))
    page_count = len(reader.pages)

    raw_pages = []
    for i, page in enumerate(reader.pages):
        text = page.extract_text() or ""
        if text.strip():
            raw_pages.append({"text": text, "page": i + 1})

    if not raw_pages:
        raise ValueError("Could not extract text from PDF")

    splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=100)
    lc_docs = []
    for page in raw_pages:
        for chunk in splitter.split_text(page["text"]):
            lc_docs.append(
                LCDocument(
                    page_content=chunk,
                    metadata={"page": page["page"], "source": filename},
                )
            )

    # Chroma.from_documents() handles:
    # 1. Creating the collection in ChromaDB
    # 2. Embedding each chunk via _embeddings
    # 3. Writing vectors + text + metadata to disk
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

    raw_embeddings = result.get("embeddings")  # may be None or a list of arrays

    chunks = []
    for i in range(len(result["ids"])):
        embedding = raw_embeddings[i] if raw_embeddings is not None else []
        chunks.append({
            "id": result["ids"][i],
            "text": result["documents"][i],
            "page": result["metadatas"][i].get("page", "?"),
            "source": result["metadatas"][i].get("source", ""),
            "metadata": result["metadatas"][i],
            # Send only first 16 values — showing all 384 per chunk in JSON is too large
            "embedding_preview": [round(float(v), 4) for v in embedding[:16]],
            "embedding_dims": len(embedding),
        })

    chunks.sort(key=lambda c: (c["page"], c["id"]))
    return chunks


def get_vectors_2d() -> list[dict]:
    """
    Pull all stored embeddings from ChromaDB, compress from 384 dimensions to 2
    using t-SNE, and return plottable (x, y) coordinates with chunk metadata.
    """
    if _vector_store is None:
        return []

    collection = _chroma_client.get_collection(COLLECTION_NAME)
    result = collection.get(include=["embeddings", "documents", "metadatas"])

    embeddings = result.get("embeddings")
    if embeddings is None or len(embeddings) < 2:
        return []

    vectors = np.array(embeddings)
    n_samples = len(vectors)

    # t-SNE requires perplexity < number of samples.
    # Default perplexity is 30 — reduce it for small documents.
    perplexity = min(30, n_samples - 1)

    tsne = TSNE(n_components=2, perplexity=perplexity, random_state=42, max_iter=1000)
    coords = tsne.fit_transform(vectors)

    return [
        {
            "x": round(float(coords[i][0]), 4),
            "y": round(float(coords[i][1]), 4),
            "text": result["documents"][i][:200],
            "page": result["metadatas"][i].get("page", 0),
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
