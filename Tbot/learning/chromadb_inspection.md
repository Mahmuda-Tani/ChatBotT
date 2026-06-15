# Inspecting a ChromaDB Index — Four Ways

---

## Why This Matters

One of the biggest advantages ChromaDB has over FAISS for learning and debugging is
transparency. ChromaDB lets you reach inside and pull out everything that was stored —
the chunk text, the metadata, and the raw vectors.

FAISS makes this extremely difficult. ChromaDB makes it first-class.

Once you can see inside the index, you can answer real debugging questions:
- Did a chunk get cut in the middle of a sentence? → Fix chunk size
- Are two very different topics clustering together? → Embedding model issue
- Is one page producing 40 chunks and another producing 2? → PDF extraction problem

Without visibility into the index, you are flying blind when RAG gives bad answers.


---

## How ChromaDB Stores Data (Quick Recap)

After processing a PDF, ChromaDB writes to a folder on disk (e.g. ./chroma_db/):

```
./chroma_db/
├── chroma.sqlite3              ← chunk text, metadata, collection info (readable)
└── [collection-uuid]/
    └── data_level0.bin         ← HNSW graph + raw vectors (binary, not human-readable)
```

The text content and metadata live in SQLite — readable by any SQLite browser.
The vectors live in the binary HNSW index file — not directly human-readable,
but extractable via the ChromaDB Python API.


---

## Way 1: Python API — Direct Inspection

ChromaDB gives you methods to query the collection itself, completely separate from
the similarity search. These are inspection methods, not search methods.

```python
collection = chroma_client.get_collection("my_document")

# ── How many chunks are stored? ──────────────────────────────────
collection.count()
# → 47

# ── Peek at the first 5 entries ──────────────────────────────────
collection.peek(5)
# → {
#     "ids":        ["chunk_0", "chunk_1", "chunk_2", "chunk_3", "chunk_4"],
#     "documents":  ["Payment of $5,000...", "Late payments will...", ...],
#     "metadatas":  [{"page": 2}, {"page": 2}, {"page": 3}, ...],
#     "embeddings": [[0.21, -0.54, 0.83, ...], [0.67, 0.12, ...], ...]
#   }

# ── Get EVERYTHING ───────────────────────────────────────────────
all_data = collection.get(include=["documents", "metadatas", "embeddings"])
# all_data["documents"]  → list of all chunk texts
# all_data["metadatas"]  → list of all metadata dicts (page, filename)
# all_data["embeddings"] → list of all vectors (each is 384 numbers)

# ── Filter by metadata ───────────────────────────────────────────
page_3_chunks = collection.get(
    where={"page": 3},
    include=["documents", "metadatas"]
)
# Returns only chunks from page 3
```

This is the key difference from FAISS. In FAISS, there is no built-in way to retrieve
stored vectors or filter by metadata. In ChromaDB, it is first-class functionality.


---

## Way 2: Open the SQLite File Directly (No Code)

After processing a PDF, navigate to the ./chroma_db/ folder and open chroma.sqlite3
with any SQLite viewer. The text content and metadata are fully readable.

Recommended tool: DB Browser for SQLite — free, open source, works on Linux/Mac/Windows.
Download: https://sqlitebrowser.org/

What you will see inside the SQLite file:

```
Tables in chroma.sqlite3:
┌──────────────────────────────────────────────────────────────────┐
│  collections         → collection names, ids, metadata           │
│  embeddings          → chunk ids, document text content          │
│  embedding_metadata  → key-value pairs (page: 2, source: doc.pdf)│
│  segments            → internal HNSW index references            │
└──────────────────────────────────────────────────────────────────┘
```

Note: The actual 384-dimensional vector numbers are stored in the binary .bin file,
NOT in SQLite. But all text and metadata IS in SQLite and fully browsable.


---

## Way 3: A /debug/chunks API Endpoint

Add an endpoint to the FastAPI backend that calls collection.get() and returns all
stored chunks as JSON. View in browser, Postman, or any HTTP client.

```
GET http://localhost:8000/debug/chunks

Response:
{
  "total": 47,
  "chunks": [
    {
      "id": "chunk_0",
      "text": "Payment of $5,000 shall be made within 30 days of invoice receipt.",
      "page": 2,
      "source": "contract.pdf"
    },
    {
      "id": "chunk_1",
      "text": "Late payments will incur a penalty of 2% per month.",
      "page": 2,
      "source": "contract.pdf"
    },
    ...
  ]
}
```

This is the most practical inspection tool for day-to-day debugging. You can quickly
scan all stored chunks and spot problems like:
- Chunks cut in the middle of a sentence
- Empty or near-empty chunks
- Pages that produced too many or too few chunks


---

## Way 4: 2D Scatter Plot (Vector Visualization)

This is the most powerful inspection tool. It shows you the semantic structure of
your entire document at a glance.

### The Process

```
ChromaDB collection
    │
    │  collection.get(include=["embeddings", "documents", "metadatas"])
    ▼
All vectors (N chunks × 384 dimensions)
    │
    │  t-SNE or UMAP algorithm
    │  compresses 384 dimensions → 2 dimensions
    │  while preserving relative distances
    ▼
2D coordinates for each chunk:
[
  { x: 12.4,  y: -3.1, text: "Payment of $5,000...",   page: 2 },
  { x: 11.9,  y: -2.8, text: "Late payments will...",   page: 2 },  ← close together
  { x: -5.2,  y:  8.7, text: "Termination clause...",   page: 3 },
  { x: -4.8,  y:  9.1, text: "30 days written notice.", page: 3 },  ← close together
  ...
]
    │
    ▼
Scatter plot in browser:
  • Each dot = one chunk
  • Dot colour = page number
  • Hover a dot = see the full chunk text
  • Close dots = semantically similar chunks
```

### What the Plot Reveals

```
         ·  ·
    ·  ·    · ·
  ·  [PAYMENT TERMS]  ·       Chunks about payment cluster here
·                       ·
  ·                   ·
    ·  ·    · ·
         ·  ·

                  [LEGAL CLAUSES]
                      · · ·
                    ·       ·
                      · · ·

    [PARTY DETAILS]
        · ·
      ·     ·
        · ·
```

Good chunking → clear, tight clusters
Bad chunking → scattered, overlapping dots with no clear structure


---

## What Each Inspection Method Tells You

| Method | What It Shows | Best Used For |
|--------|--------------|---------------|
| `collection.count()` | Total chunk count | Quick sanity check |
| `collection.peek()` | First 5 chunks + vectors | Fast first look |
| `collection.get()` | Everything | Programmatic analysis |
| SQLite browser | Raw table data | Understanding storage internals |
| `/debug/chunks` endpoint | All chunks as JSON | Day-to-day debugging |
| 2D scatter plot | Semantic structure visually | Understanding chunk quality |


---

## t-SNE vs UMAP (The Two Reduction Algorithms)

Both compress high-dimensional vectors to 2D for plotting. They have different trade-offs:

| | t-SNE | UMAP |
|--|-------|------|
| Speed | Slow on large datasets | Faster |
| Small datasets (< 1000 chunks) | Works well | Works well |
| Large datasets (> 10,000 chunks) | Very slow | Better choice |
| Cluster preservation | Good local structure | Better global structure |
| Deterministic | No (random each run) | Can be made deterministic |
| Python package | scikit-learn (standard) | umap-learn (separate install) |

For our project (small PDFs, few hundred chunks), t-SNE from scikit-learn is the
simpler choice — no extra package needed beyond what data science stacks already have.


---

## Key Takeaway

```
FAISS:    "Here are your k nearest chunks." — that is all it tells you.

ChromaDB: "Here are your k nearest chunks."
          + "Here is every chunk stored, with text and metadata."
          + "Here are all the raw vectors."
          + "Here is what is on page 3 specifically."
          + "Here is how many chunks total."
          + "Here is a browsable SQLite file on your disk."
```

ChromaDB is not just a faster FAISS. It is a proper database that happens to do
vector search — and that distinction matters enormously when you need to understand,
debug, and improve your RAG system.
