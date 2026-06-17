import json
import os

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from langchain_core.messages import HumanMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel

from graph import build_graph
from ragImplementation import (
    clear_document,
    get_all_chunks,
    get_doc_info,
    get_vectors_2d,
    process_pdf,
)

load_dotenv()

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "anthropic/claude-haiku-4-5")

if not OPENROUTER_API_KEY:
    raise RuntimeError("OPENROUTER_API_KEY is not set in .env")

_llm = ChatOpenAI(
    model=OPENROUTER_MODEL,
    api_key=OPENROUTER_API_KEY,
    base_url="https://openrouter.ai/api/v1",
)

# Compiled once at startup; reused across all requests.
_graph = build_graph(_llm)

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------- Models ----------

class ChatRequest(BaseModel):
    thread_id: str
    message: str
    use_rag: bool = False


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

@app.get("/debug/chunks")
async def debug_chunks():
    chunks = get_all_chunks()
    return {"total": len(chunks), "chunks": chunks}


@app.get("/debug/vectors")
async def debug_vectors():
    try:
        points = get_vectors_2d()
        return {"total": len(points), "points": points}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------- Chat ----------

@app.post("/chat")
async def chat(req: ChatRequest):
    config = {"configurable": {"thread_id": req.thread_id}}
    graph_input = {
        "messages": [HumanMessage(content=req.message)],
        "use_rag": req.use_rag,
        "sources": [],
    }

    async def generate():
        try:
            # Emit sources from the retrieve node before streaming text
            sources_sent = False

            async for event in _graph.astream_events(graph_input, config=config, version="v2"):
                kind = event["event"]

                # Capture sources emitted by retrieve_node
                if kind == "on_node_end" and event["name"] == "retrieve":
                    sources = event["data"]["output"].get("sources", [])
                    if sources and not sources_sent:
                        yield f"data: {json.dumps({'type': 'sources', 'sources': sources})}\n\n"
                        sources_sent = True

                # Stream LLM tokens from the generate node only
                if kind == "on_chat_model_stream" and event.get("metadata", {}).get("langgraph_node") == "generate":
                    token = event["data"]["chunk"].content
                    if token:
                        yield f"data: {json.dumps({'type': 'text', 'text': token})}\n\n"

            yield "data: [DONE]\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'error': str(e)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
