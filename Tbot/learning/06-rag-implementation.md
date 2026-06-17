# RAG Implementation — How `ragImplementation.py` Works

## What This File Is Responsible For

This file has one job: take a PDF, break it into searchable pieces, store those pieces, and later find the most relevant ones when a user asks a question.

It knows **nothing** about the LLM or the chat. It is purely the "library" half of RAG — the part that stores and searches documents. The LLM half lives in `graph.py`.

---

## The Big Picture — Two Stages

When you upload a PDF, it goes through two stages before being stored:

```
PDF file
   │
   ▼
Stage 2 — unstructured  →  reads structure (titles, tables, paragraphs)
   │
   ▼
Stage 1 — TokenTextSplitter  →  cuts into 256-token chunks
   │
   ▼
ChromaDB  →  each chunk is converted to a vector and stored on disk
```

> The stages are numbered 2 then 1 because they are named from the perspective of the embedding pipeline, not execution order.

---

## Part 1 — Three Globals Loaded at Startup

```python
_embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
_token_splitter = TokenTextSplitter(chunk_size=256, chunk_overlap=32)
_chroma_client = chromadb.PersistentClient(path="./chroma_db")
```

These three objects are created **once** when the server starts and reused on every request. Loading a model takes seconds — you never want to do it per request.

| Object | What it is | Real-world analogy |
|---|---|---|
| `_embeddings` | A local AI model that converts text → a list of numbers (a vector) | A translator that converts words into map coordinates |
| `_token_splitter` | Cuts text into pieces of exactly 256 tokens | A guillotine with a ruler |
| `_chroma_client` | Connection to the ChromaDB database stored on disk | A filing cabinet handle |

### Why chunk_size=256 and chunk_overlap=32?

The embedding model (`all-MiniLM-L6-v2`) has a hard limit of 512 tokens per input. We use 256 — exactly half — to leave breathing room so the query vector doesn't compete with the chunk for space.

The overlap of 32 tokens means each chunk shares a little text with its neighbours. This prevents context from being lost at boundaries. Imagine cutting a paragraph exactly at a sentence boundary — the sentence before the cut and the one after belong together, but they end up in different chunks. Overlap keeps that relationship alive.

```
Chunk 1: [-------- 256 tokens --------]
Chunk 2:                      [-- 32 overlap --][------- new tokens -------]
```

---

## Part 2 — `_restore_on_startup()`

```python
def _restore_on_startup():
    collection = _chroma_client.get_collection(COLLECTION_NAME)
    count = collection.count()
    if count == 0:
        return
    # reconnect _vector_store and rebuild _doc_info from stored metadata
```

When the server restarts, RAM is wiped clean — but ChromaDB lives on disk. This function runs automatically at startup and asks: *"did someone upload a PDF before I restarted?"*

If yes, it reconnects to the existing data so the sidebar document card reappears without the user needing to re-upload. The chunks are already there — we just need to point Python at them again.

---

## Part 3 — `process_pdf()` — The Most Important Function

Called when you drag a PDF into the sidebar. Runs in three phases.

### Phase A — Write to a temporary file

```python
with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
    tmp.write(file_bytes)
    tmp_path = tmp.name
```

The browser sends the PDF as raw bytes over HTTP. The `unstructured` library needs a real file path on disk, not raw bytes. So we write the bytes to a temporary file, process it, then delete it immediately in the `finally` block.

### Phase B — Structure-aware parsing (Stage 2)

```python
elements = partition_pdf(tmp_path, strategy="fast")
section_chunks = chunk_by_title(elements, max_characters=1200)
```

`partition_pdf` reads the PDF intelligently. It does not treat it as one giant wall of text. Instead it returns **typed elements**:

| Element type | What it is |
|---|---|
| `Title` | A heading or section title |
| `NarrativeText` | A regular paragraph |
| `Table` | A table (kept together, never split) |
| `ListItem` | A bullet point |

`chunk_by_title` then groups elements that belong to the same section (under the same heading) into one block, up to 1200 characters. This means a chunk about "Revenue Growth" stays together — it doesn't bleed into the next section about "Employee Count".

### Phase C — Token splitting (Stage 1)

```python
if category == "Table":
    lc_docs.append(LCDocument(...))   # keep whole
else:
    for sub in _token_splitter.split_text(text):
        lc_docs.append(LCDocument(...))  # split into 256-token pieces
```

Tables are a special case. Splitting a table row mid-way destroys its meaning — you might get half a row with no headers. So tables are kept as single chunks, regardless of size.

Everything else gets cut into 256-token pieces. Each piece becomes a `LCDocument` with metadata attached:

```python
{"page": 3, "source": "report.pdf", "category": "NarrativeText"}
```

Finally, all chunks are stored in ChromaDB:

```python
_vector_store = Chroma.from_documents(
    documents=lc_docs,
    embedding=_embeddings,   # converts each chunk to a vector
    ...
)
```

Under the hood, ChromaDB calls `_embeddings` on every chunk, gets back a list of 384 numbers (a vector), and stores both the text and the vector on disk.

---

## Part 4 — `retrieve_context()` — Called by the Graph

```python
def retrieve_context(query: str, k: int = 4) -> tuple[str, list[dict]]:
    results = _vector_store.similarity_search_with_score(query, k=k)
```

This is what `retrieve_node` in `graph.py` calls when the user asks a question. It runs in three steps:

1. **Embed the query** — the user's question is converted into a vector using the same `_embeddings` model
2. **Search ChromaDB** — find the 4 chunks whose vectors are closest to the query vector
3. **Return results** — as a formatted string for the LLM prompt, and a list of dicts for the UI source cards

### Why must the same embedding model be used for both storing and searching?

Vectors only make sense relative to each other within the same model's coordinate space. If you store chunks using model A and search using model B, the distance numbers are meaningless — like measuring distance in miles but reading the ruler in kilometres.

This is why `_embeddings` is a single shared object used in both `process_pdf()` (storing) and `retrieve_context()` (searching).

### What does "similarity" mean here?

Each chunk is a point in 384-dimensional space. The user's question is also a point in that same space. ChromaDB finds the 4 points (chunks) that are geometrically closest to the question point. "Close" means semantically similar — chunks about the same topic end up near each other.

---

## Part 5 — Debug and Utility Functions

### `get_all_chunks()`

Returns every chunk stored in ChromaDB with its text, page number, and the first 16 numbers of its embedding vector. Used by the Index Viewer in the UI to let you inspect what the LLM will search through.

### `get_vectors_2d()`

Takes all 384-dimensional embedding vectors and compresses them to 2 dimensions (x, y) using **t-SNE**. Returns coordinates for each chunk so the frontend can render a scatter plot.

**What is t-SNE?**
t-SNE (t-distributed Stochastic Neighbour Embedding) is a mathematical technique that squashes high-dimensional data into 2D while trying to keep similar items close together. In the scatter plot, chunks about the same topic cluster together visually — you can literally see the semantic structure of your document.

### `get_doc_info()`

Returns `{"filename": ..., "page_count": ..., "chunk_count": ...}`. Used by the sidebar to display the document card.

### `clear_document()`

Deletes the ChromaDB collection and resets `_vector_store` and `_doc_info` to `None`. Called when you click the X on the document card in the sidebar.

---

## How It Connects to the Rest of the App

```
User uploads PDF
       │
       ▼
main.py → /upload endpoint
       │
       ▼
ragImplementation.process_pdf()
       │    Stage 2: partition_pdf → chunk_by_title
       │    Stage 1: TokenTextSplitter
       │    Store vectors in ChromaDB
       ▼
ChromaDB (on disk)

──────────────────────────────

User sends a message (RAG on)
       │
       ▼
graph.py → retrieve_node()
       │
       ▼
ragImplementation.retrieve_context()
       │    Embed the query
       │    Search ChromaDB for top 4 chunks
       │    Return context string + sources
       ▼
graph.py → generate_node()
       │    Wrap context in SystemMessage
       │    Call LLM with full message history
       ▼
Streamed response → frontend
```

**The clean boundary:**
- `ragImplementation.py` never talks to the LLM
- `graph.py` never talks to ChromaDB directly
- They communicate through one function call: `retrieve_context(query)`

This separation is a SOLID principle in action — **Single Responsibility**. Each file has one reason to change:
- `ragImplementation.py` changes if the PDF processing or search strategy changes
- `graph.py` changes if the reasoning flow or LLM changes

---

## Key Terms at a Glance

| Term | Simple meaning |
|---|---|
| `HuggingFaceEmbeddings` | A local model that converts text into a list of numbers |
| Vector | A list of numbers (384 of them) that represents the meaning of a text chunk |
| `TokenTextSplitter` | Cuts text into chunks of exactly N tokens |
| `chunk_size=256` | Each chunk is at most 256 tokens — half the model's 512 limit |
| `chunk_overlap=32` | Each chunk shares 32 tokens with its neighbour to avoid losing boundary context |
| `partition_pdf` | Reads a PDF and returns typed elements (Title, Table, NarrativeText, etc.) |
| `chunk_by_title` | Groups elements under the same heading into one block |
| `ChromaDB` | A vector database that stores text + its vector representation on disk |
| `similarity_search` | Find the N chunks whose vectors are closest to the query vector |
| `t-SNE` | A maths technique that squashes 384-dimensional vectors into 2D for visualization |
| `LCDocument` | LangChain's document object — holds text + metadata (page, source, category) |
