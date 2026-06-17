from typing import Annotated

from langchain_core.messages import SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from typing_extensions import TypedDict

from ragImplementation import retrieve_context


# ── State ─────────────────────────────────────────────────────────────────────
# Every node reads from and writes to this dict.
# `add_messages` is a reducer: instead of replacing the list, it appends.
# `use_rag` and `sources` are plain values — they replace on each write.

class State(TypedDict):
    messages: Annotated[list, add_messages]
    use_rag: bool
    sources: list[dict]


# ── Nodes ─────────────────────────────────────────────────────────────────────

def retrieve_node(state: State) -> dict:
    """Search ChromaDB and inject a SystemMessage with the retrieved context."""
    query = state["messages"][-1].content
    context, sources = retrieve_context(query)
    system = SystemMessage(
        content=(
            "You are a helpful assistant. Answer using ONLY the document context below. "
            "If the answer is not in the context, say so clearly.\n\n"
            f"DOCUMENT CONTEXT:\n{context}"
        )
    )
    # Prepend the system message so the LLM sees: [system, ...history..., user_query]
    return {"messages": [system], "sources": sources}


def generate_node(state: State, llm: ChatOpenAI) -> dict:
    """Call the LLM with the current message list and append its reply."""
    response = llm.invoke(state["messages"])
    return {"messages": [response]}


# ── Routing ───────────────────────────────────────────────────────────────────

def route(state: State) -> str:
    """Conditional edge: decide whether retrieval is needed before generation."""
    return "retrieve" if state.get("use_rag") else "generate"


# ── Graph factory ─────────────────────────────────────────────────────────────

def build_graph(llm: ChatOpenAI) -> StateGraph:
    """
    Compile and return the LangGraph graph.
    Called once at startup; the compiled graph is reused for every request.
    The MemorySaver checkpointer persists conversation state in memory,
    keyed by thread_id, so the graph remembers prior turns automatically.
    """
    # Bind the LLM into generate_node so the graph doesn't depend on a global.
    def _generate(state: State) -> dict:
        return generate_node(state, llm)

    builder = StateGraph(State)
    builder.add_node("retrieve", retrieve_node)
    builder.add_node("generate", _generate)

    # START → router → retrieve or generate directly
    builder.add_conditional_edges(START, route, {
        "retrieve": "retrieve",
        "generate": "generate",
    })
    builder.add_edge("retrieve", "generate")
    builder.add_edge("generate", END)

    # MemorySaver: in-memory persistence.
    # TODO: replace with SqliteSaver for persistence across server restarts.
    checkpointer = MemorySaver()
    return builder.compile(checkpointer=checkpointer)
