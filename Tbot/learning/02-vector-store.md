# Vector Stores — From First Principles

---

## 1. Why Do We Need Vector Stores?

Computers cannot understand the *meaning* of text. A traditional database can tell you if two
strings are exactly equal, but it cannot tell you that:

    "The agreement ends in December"
    "The contract expires at year end"

...are talking about the same thing.

Vector stores solve this. They store text as mathematical representations of meaning, and let
you search by *semantic similarity* rather than exact keyword match.


---

## 2. What Is an Embedding? (The Foundation)

An **embedding** is what you get when you feed text into an embedding model. The model outputs
a list of numbers — called a **vector** — that represents the meaning of that text.

```
"The contract expires in December"
            ↓
    embedding model (all-MiniLM-L6-v2)
            ↓
[0.21, -0.54, 0.83, 0.12, 0.67, -0.31, ..., 0.09]
           ↑ 384 numbers total
```

This list of 384 numbers is the vector. Each number captures some dimension of meaning that
the model learned during training on billions of sentences.

### The Key Property of Embeddings

**Similar meaning → similar vectors (mathematically close to each other)**

```
"The contract expires in December"   → [0.21, -0.54, 0.83, ...]
"The agreement ends in December"     → [0.22, -0.51, 0.81, ...]  ← very close
"The cat sat on the mat"             → [0.91,  0.34, -0.22, ...]  ← very far
```

This is not keyword matching. The words "contract" and "agreement" are completely different
strings, but their vectors are close because the model learned they carry similar meaning.


---

## 3. How Chunks Are Stored in FAISS

In our project, after the PDF is split into chunks, this is what happens:

### Step-by-Step Storage Process

```
PDF text
  │
  ▼
Split into chunks (800 chars each)
  │
  ├── Chunk 1: "The contract was signed on..."   → vector₁ [0.21, -0.54, ...]
  ├── Chunk 2: "Payment terms are net 30..."      → vector₂ [0.67,  0.12, ...]
  ├── Chunk 3: "Either party may terminate..."    → vector₃ [-0.33, 0.88, ...]
  └── Chunk N: ...                                → vectorN [...]
              │
              ▼
        FAISS Index
        ┌─────────────────────────────────────────┐
        │  vector₁  →  "The contract was signed…" │
        │  vector₂  →  "Payment terms are net 30" │
        │  vector₃  →  "Either party may term…"   │
        │  ...                                     │
        └─────────────────────────────────────────┘
        (vectors organized for fast nearest-neighbor search)
```

Each entry in FAISS stores:
- The **vector** (384 numbers) — used for searching
- The **original text** — returned when a match is found
- The **metadata** (page number, filename) — returned alongside the text


---

## 4. How Similarity Search Works

When a user asks a question, this is the exact sequence:

```
User: "When does the contract expire?"
  │
  ▼
Same embedding model converts question to a vector:
query_vector = [0.20, -0.53, 0.82, ...]
  │
  ▼
FAISS compares query_vector against ALL stored chunk vectors
  │
  ▼
Finds the k=4 vectors with the smallest distance to query_vector
  │
  ▼
Returns the original text of those 4 chunks + their page numbers
```

### The Distance Metric: L2 (Euclidean Distance)

FAISS by default uses **L2 distance** — the straight-line geometric distance between two
points. Imagine two points on a map: the closer they are, the more similar their meaning.

```
distance = √( (a₁-b₁)² + (a₂-b₂)² + ... + (a₃₈₄-b₃₈₄)² )
```

**Lower distance = more similar meaning**

This is the `score` value you see in the source citation cards:
```python
sources.append({
    "text": text,
    "page": doc.metadata["page"],
    "score": round(float(score), 3),   # L2 distance — LOWER is better
})
```

### Important Bug Note

Our frontend currently labels relevance as "high/medium/low" using logic that assumes higher
score = better. But in L2 distance, lower = better. The relevance label logic is inverted and
needs to be fixed.


---

## 5. Visualizing the Vector Store

Your vectors are 384-dimensional. Humans can only perceive 3 dimensions. To visualize the
vector space, we use **dimensionality reduction** — compressing 384 numbers down to 2 or 3
while trying to preserve which points are close to each other.

### What You Would See

```
         ·  ·
    ·  ·    · ·          Each dot = one chunk from your PDF
  ·   [PAYMENT CLAUSES] ·
·                          Chunks about the same topic
  ·                      · cluster together naturally
    ·  ·    · ·
         ·  ·

                [TERMINATION CLAUSES]
                      · · ·
                    ·       ·
                      · · ·

                                  ★ ← your query vector lands here
                                    nearest dots = the 4 retrieved chunks
```

Chunks about payment cluster near each other. Chunks about termination cluster elsewhere.
Your query lands in the space and the 4 nearest neighbors are returned.

### Tools to Visualize

| Tool | Type | Best For |
|------|------|----------|
| **Nomic Atlas** | Web app, no code | Beautiful interactive exploration, easiest |
| **t-SNE + Matplotlib** | Python, local | Quick scatter plot in a notebook |
| **UMAP + Plotly** | Python, local | Better quality than t-SNE, interactive |
| **ChromaDB visualizer** | Built-in | If you switch from FAISS to ChromaDB |


---

## 6. FAISS vs Production Vector Databases

FAISS is what we currently use. It is a library created by Meta Research — excellent for
learning and small-scale use. But it has limitations.

| Feature | FAISS (current) | Qdrant / ChromaDB / Weaviate |
|---------|----------------|-------------------------------|
| Storage | RAM only | Disk (persistent) |
| Survives restart | No | Yes |
| Multiple users | Single shared index | Isolated collections per user |
| Multiple servers | Cannot share index | All servers share one DB |
| Filtering | Limited | Rich metadata filtering |
| Scalability | Single machine | Distributed, cloud-native |
| Setup | Zero (in-memory) | Runs as a separate service |

FAISS is the right tool for learning. For production, you would migrate to one of the
dedicated vector databases listed above.


---

## 7. The all-MiniLM-L6-v2 Model (What We Use)

- Created by: Microsoft / Sentence Transformers project
- Size: ~80MB (downloads on first use, cached after)
- Output: 384-dimensional vectors
- Speed: Fast (runs on CPU, no GPU needed)
- Quality: Good for semantic similarity, not state-of-the-art
- Language: English-focused

For production, better options include:
- `text-embedding-3-small` (OpenAI, API-based, higher quality)
- `bge-large-en-v1.5` (open source, higher quality than MiniLM)
- `text-embedding-004` (Google, what we originally tried to use)


---

## 8. Key Terms Summary

| Term | Definition |
|------|-----------|
| Vector | A list of numbers representing the meaning of a piece of text |
| Embedding | The process of converting text to a vector; also the vector itself |
| Embedding model | The neural network that produces vectors (we use all-MiniLM-L6-v2) |
| Dimensions | How many numbers in each vector (384 in our case) |
| Vector store | A database that stores vectors and supports similarity search |
| FAISS | Facebook AI Similarity Search — our current in-memory vector store |
| Similarity search | Finding vectors closest to a query vector |
| L2 distance | The distance metric FAISS uses — lower means more similar |
| k | How many nearest neighbors to return (we use k=4) |
| Dimensionality reduction | Compressing high-dimensional vectors to 2D/3D for visualization |
| t-SNE / UMAP | Algorithms used for dimensionality reduction |
