# LangGraph Basics — How Our `graph.py` Works

## The Big Idea

Before LangGraph, our backend was a simple pipeline:

```
User message → retrieve context → build prompt → call LLM → return response
```

Data flowed in one direction, top to bottom, like water through a pipe.

LangGraph changes the model. Instead of a pipe, it gives us an **assembly line** — a directed graph where:

- **Nodes** are stations on the line (each does one job)
- **Edges** are the paths between stations (can be conditional — "go here if X, go there if Y")
- **State** is the shared whiteboard every station reads from and writes to
- **Checkpointer** is the filing cabinet that remembers past conversations

---

## Why This Matters

Our old backend was **stateless**. The frontend had to send the entire chat history on every single message. If you refreshed the page, history was gone.

With LangGraph + a checkpointer, the **backend owns the conversation state**. The frontend only sends the new message and a `thread_id`. The backend remembers everything else.

```
Before:  Frontend → [msg1, msg2, msg3, NEW_MSG]  →  Backend (forgets everything after)
After:   Frontend → [NEW_MSG + thread_id]         →  Backend (remembers msg1, msg2, msg3)
```

---

## The Four Building Blocks

### 1. State — the shared whiteboard

```python
class State(TypedDict):
    messages: Annotated[list, add_messages]
    use_rag: bool
    sources: list[dict]
```

`State` is a typed dictionary that travels through every node. Think of it as a whiteboard that all stations can read and update.

| Field | Type | What it holds |
|---|---|---|
| `messages` | list | Full conversation history — user messages + AI replies |
| `use_rag` | bool | Should we search the PDF before answering? Yes or No |
| `sources` | list | PDF chunks found during search (shown as source cards in the UI) |

**The `add_messages` reducer** is the most important detail here.

Normally, if you return `{"messages": [new_message]}` from a node, it would *replace* the entire list. That would destroy the conversation history.

`add_messages` changes this behaviour: instead of replacing, it **appends**. Like a WhatsApp chat that only grows — new messages are added to the bottom, old ones are never erased.

```python
# Without add_messages:  messages = [new_message]          ← history destroyed
# With add_messages:     messages = [msg1, msg2, new_message]  ← history preserved
```

---

### 2. Nodes — the stations on the assembly line

Nodes are just plain Python functions. Each one receives the full `State`, does exactly one job, and returns only the fields it changed (not the whole state).

**`retrieve_node` — the librarian**

```python
def retrieve_node(state: State) -> dict:
    query = state["messages"][-1].content   # grab the user's latest question
    context, sources = retrieve_context(query)  # search ChromaDB
    system = SystemMessage(content=f"...DOCUMENT CONTEXT:\n{context}")
    return {"messages": [system], "sources": sources}
```

What it does step by step:
1. Reads the last message from state (the user's question)
2. Searches ChromaDB for relevant PDF chunks
3. Wraps those chunks in a `SystemMessage` — instructions to the LLM: "answer from this context only"
4. Writes the `SystemMessage` back to state (via `add_messages`, so it prepends before the user message)
5. Also writes the raw sources so the UI can show source cards

**`generate_node` — the AI answerer**

```python
def generate_node(state: State, llm: ChatOpenAI) -> dict:
    response = llm.invoke(state["messages"])
    return {"messages": [response]}
```

What it does step by step:
1. Reads the entire `messages` list from state (which now includes the system message if RAG ran)
2. Calls the LLM (OpenRouter → Claude Haiku)
3. Appends the AI reply back to `messages`

This node is always the last to run, whether RAG was used or not.

---

### 3. Routing — the traffic controller

```python
def route(state: State) -> str:
    return "retrieve" if state.get("use_rag") else "generate"
```

This function sits at the very start of the graph. It reads the `use_rag` flag and answers one question: *"which station should we go to first?"*

- `use_rag = True`  → go to `retrieve_node` first, then `generate_node`
- `use_rag = False` → skip directly to `generate_node`

This is called a **conditional edge** in LangGraph. The path through the graph changes depending on the data.

---

### 4. Checkpointer — the filing cabinet

```python
checkpointer = MemorySaver()
return builder.compile(checkpointer=checkpointer)
```

After every graph run, LangGraph automatically saves the full `State` to the checkpointer, keyed by `thread_id`.

Next time the same `thread_id` comes in, LangGraph loads that saved state before running any node. This is how the LLM "remembers" past messages — they are already in `state["messages"]` when the node starts.

**`MemorySaver`** stores everything in RAM. It is fast and simple, but if the server restarts, all conversations are lost.

> **Next step (planned):** Replace `MemorySaver` with `SqliteSaver` — this writes state to a `.db` file on disk so conversations survive server restarts. The graph logic does not change at all; only the one line that creates the checkpointer changes.

---

## The Full Assembly Line

```
                    ┌─────────────┐
                    │  route()    │  ← reads use_rag flag
         START ────►│             │
                    └──────┬──────┘
                           │
              ┌────────────┴────────────┐
       "retrieve"                  "generate"
              │                         │
              ▼                         │
      ┌───────────────┐                 │
      │ retrieve_node │                 │
      │  (ChromaDB)   │                 │
      └───────┬───────┘                 │
              │                         │
              └────────────┬────────────┘
                           ▼
                   ┌───────────────┐
                   │ generate_node │
                   │  (OpenRouter) │
                   └───────┬───────┘
                           │
                          END
```

---

## How `thread_id` Connects Everything

The `thread_id` is a UUID (a unique random ID) generated once per browser session in `App.jsx`:

```js
const threadIdRef = useRef(crypto.randomUUID());
```

Every chat message the frontend sends includes this ID:

```json
{ "thread_id": "a3f7...", "message": "What is RAG?", "use_rag": true }
```

On the backend, LangGraph uses it to look up the right filing cabinet slot:

```python
config = {"configurable": {"thread_id": req.thread_id}}
_graph.astream_events(graph_input, config=config)
```

This is how two different browser tabs can have two completely separate conversations with the same server — each has a different `thread_id`.

---

## Key Terms at a Glance

| Term | Simple meaning |
|---|---|
| `StateGraph` | The assembly line itself |
| `State` | The whiteboard shared between all stations |
| `Node` | One station — a plain Python function |
| `Edge` | The path from one station to the next |
| `Conditional edge` | A path that forks depending on data |
| `add_messages` | A rule that says "append, don't replace" |
| `MemorySaver` | In-memory filing cabinet for conversation state |
| `SqliteSaver` | Disk-based filing cabinet (planned next step) |
| `thread_id` | The key that identifies which conversation's file to open |
| `astream_events` | LangGraph's async stream — emits tokens as they arrive from the LLM |
