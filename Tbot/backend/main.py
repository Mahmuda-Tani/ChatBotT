import json
import os

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_google_genai import ChatGoogleGenerativeAI
from pydantic import BaseModel

from ragImplementation import (
    clear_document,
    get_all_chunks,
    get_doc_info,
    get_vectors_2d,
    process_pdf,
    retrieve_context,
)

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Models ----------

class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[Message]
    provider: str
    use_rag: bool = False


# ---------- Helpers ----------

def get_llm(provider: str):
    if provider == "gemini":
        if not GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY is not set in .env")
        return ChatGoogleGenerativeAI(model="gemini-1.5-flash", google_api_key=GEMINI_API_KEY)
    if provider == "anthropic":
        if not ANTHROPIC_API_KEY:
            raise ValueError("ANTHROPIC_API_KEY is not set in .env")
        return ChatAnthropic(model="claude-sonnet-4-6", anthropic_api_key=ANTHROPIC_API_KEY)
    raise ValueError(f"Unknown provider: {provider}")


def to_langchain_messages(messages: list[Message]):
    role_map = {"user": HumanMessage, "assistant": AIMessage, "system": SystemMessage}
    result = []
    for msg in messages:
        cls = role_map.get(msg.role)
        if cls is None:
            raise ValueError(f"Unknown role: {msg.role}")
        result.append(cls(content=msg.content))
    return result


def extract_text(chunk) -> str:
    content = chunk.content
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            b if isinstance(b, str) else b.get("text", "")
            for b in content
            if isinstance(b, (str, dict))
        )
    return str(content) if content else ""


# ---------- Routes ----------

@app.post("/upload")
async def upload_document(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
    try:
        contents = await file.read()
        doc_info = process_pdf(contents, file.filename)
        return doc_info
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/document")
async def get_document():
    return get_doc_info()


@app.delete("/document")
async def delete_document():
    clear_document()
    return {"ok": True}


# ---------- Debug / Inspection Routes ----------
# These endpoints expose the internals of the ChromaDB index.
# They are read-only — they never modify the stored data.
# Use them to inspect chunk quality, spot bad splits, and understand
# what the LLM will search through when a question is asked.

@app.get("/debug/chunks")
async def debug_chunks():
    """
    Returns every chunk stored in ChromaDB with its text, page number,
    and position in the index. Use this to verify chunking quality.
    """
    chunks = get_all_chunks()
    return {
        "total": len(chunks),
        "chunks": chunks,
    }


@app.get("/debug/vectors")
async def debug_vectors():
    """
    Pulls all stored embeddings from ChromaDB, compresses them from
    384 dimensions to 2 using t-SNE, and returns (x, y) coordinates
    for each chunk so the frontend can render a scatter plot.

    Note: t-SNE is non-trivial to compute. For large documents (500+ chunks)
    this endpoint may take several seconds to respond.
    """
    try:
        points = get_vectors_2d()
        return {
            "total": len(points),
            "points": points,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/chat")
async def chat(req: ChatRequest):
    try:
        if not req.messages:
            raise ValueError("messages cannot be empty")

        llm = get_llm(req.provider)
        lc_messages = to_langchain_messages(req.messages)
        sources = []

        if req.use_rag:
            query = req.messages[-1].content
            context, sources = retrieve_context(query)
            system_msg = SystemMessage(
                content=(
                    "You are a helpful assistant. Answer using ONLY the document context below. "
                    "If the answer is not in the context, say so clearly.\n\n"
                    f"DOCUMENT CONTEXT:\n{context}"
                )
            )
            lc_messages = [system_msg] + lc_messages

        def generate():
            try:
                if sources:
                    yield f"data: {json.dumps({'type': 'sources', 'sources': sources})}\n\n"
                for chunk in llm.stream(lc_messages):
                    text = extract_text(chunk)
                    if text:
                        yield f"data: {json.dumps({'type': 'text', 'text': text})}\n\n"
                yield "data: [DONE]\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
        )

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
