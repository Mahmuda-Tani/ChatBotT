import io

from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
from langchain_core.documents import Document as LCDocument
from langchain_huggingface import HuggingFaceEmbeddings
from pypdf import PdfReader

_vector_store: FAISS | None = None
_doc_info: dict | None = None


def get_embeddings():
    return HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")


def process_pdf(file_bytes: bytes, filename: str) -> dict:
    """Parse a PDF, chunk it, embed it, and store in FAISS. Returns doc metadata."""
    global _vector_store, _doc_info

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

    _vector_store = FAISS.from_documents(lc_docs, get_embeddings())
    _doc_info = {
        "filename": filename,
        "page_count": page_count,
        "chunk_count": len(lc_docs),
    }
    return _doc_info


def retrieve_context(query: str, k: int = 4) -> tuple[str, list[dict]]:
    """Retrieve relevant chunks for a query. Returns (context_string, sources_list)."""
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

    context = "\n\n---\n\n".join(context_parts)
    return context, sources


def get_doc_info() -> dict | None:
    return _doc_info


def clear_document():
    global _vector_store, _doc_info
    _vector_store = None
    _doc_info = None
