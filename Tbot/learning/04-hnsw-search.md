# HNSW Search — Hierarchical Navigable Small World

## What Problem Does HNSW Solve?

When you store 1 million document chunks in a vector database, finding the most similar
chunk to a query requires comparing the query vector against every stored vector.

```
Brute force: 1,000,000 dot products per query → too slow for real-time apps
```

HNSW solves this by building a **smart graph** during indexing so that at query time you
can find the nearest neighbor in O(log n) comparisons instead of O(n).

This is what ChromaDB uses internally in this project to power `similarity_search()`.

---

## The Intuition: A Highway System

Imagine you want to navigate from your house to a restaurant you've never been to.

- **Layer 2 (Motorway):** Few exits, but you cover 100km in one step
- **Layer 1 (A-Road):** More turns, but you cover 10km per step
- **Layer 0 (Local streets):** Every house is reachable, short hops

You don't check every street. You take the motorway until you're roughly in the right
city, then drop to A-roads for the suburb, then walk the last 200m.

HNSW does exactly this with vectors in high-dimensional space.

---

## Structure of the Graph

### Nodes
Each document chunk (vector) is a node.

### Layers
- **Layer 0:** Contains every node. Dense connections.
- **Layer 1:** Contains ~1/e of nodes (randomly selected). Sparser.
- **Layer 2:** Contains ~1/e² of nodes. Even sparser.
- And so on...

Each node in layer k also exists in all layers below k (layer k-1, k-2, ..., 0).

```
Layer 2:   [A] ──────────────────────── [E]
            |                            |
Layer 1:   [A] ──── [C] ──── [E] ──── [G]
            |        |        |
Layer 0:   [A]-[B]-[C]-[D]-[E]-[F]-[G]-[H]   ← ALL nodes here
```

---

## Building the Index (Insert Phase)

When a new vector `V` is inserted:

1. Randomly assign it a **max layer** (using exponential probability — most nodes get
   layer 0 only, few get layer 1, very few get layer 2)
2. Starting from the top layer, greedily find the nearest neighbor to `V`
3. Drop down one layer, repeat from the nearest neighbor found above
4. At each layer, connect `V` to its `M` nearest neighbors (M is a hyperparameter)

```
Insert vector V:
  Assigned max_layer = 1 (so V exists in layers 0 and 1)

  Layer 1: Entry point A → move to E (closer to V) → insert V, connect V↔E
  Layer 0: Start from E → move to F (closer to V) → insert V, connect V↔F, V↔G
```

---

## Searching the Index (Query Phase)

Given query vector `Q`, find the `k` nearest neighbors:

```
Step 1: Enter graph at the highest layer, at the fixed entry point node.

Step 2: At current layer, look at neighbors of current node.
        Move to whichever neighbor is closer to Q.
        Keep moving until no neighbor is closer (local minimum).

Step 3: Drop down one layer. Start again from the node found above.

Step 4: Repeat until Layer 0.

Step 5: At Layer 0, do a broader local search (controlled by ef parameter).
        Return the top-k closest nodes found.
```

### Concrete Example

Vectors in 1D (simplified):
```
Positions: A=1, B=2, C=3, D=4, E=7, F=8, G=9, H=10
Query Q = 7.5  (we want to find F or E, whichever is closest)
```

```
Layer 2: Entry at A(1). Neighbor: E(7). |7-7.5| < |1-7.5|, move to E.
          No further neighbors at this layer. Stop.

Layer 1: Start at E(7). Neighbors: C(3), G(9).
          |9-7.5| < |3-7.5|, move to G.
          G's neighbors: E(7), H(10). E: |7-7.5|=0.5, H: |10-7.5|=2.5
          Move to E. Back at E — already visited. Stop.

Layer 0: Start at E(7). Neighbors: D(4), F(8).
          |8-7.5| < |4-7.5|, move to F.
          F's neighbors: E(7), G(9).
          |7-7.5|=0.5, |9-7.5|=1.5. E is closer. Move to E.
          E already visited. Stop.

Result: F(8) is the nearest neighbor to Q(7.5). ✓
```

Total comparisons: ~8 (vs 8 brute-force in this tiny example, but in 1M vectors
the savings are enormous)

---

## Key Hyperparameters

### M (connections per node)
- Number of bidirectional edges each node has in the graph
- Higher M → better recall (less chance of missing the true nearest neighbor)
- Higher M → more memory, slower build
- Typical values: **16–64**. Default in most libraries: 16.

```python
# ChromaDB HNSW settings (in collection metadata):
collection = client.create_collection(
    name="my_docs",
    metadata={"hnsw:M": 32}  # default is 16
)
```

### ef_construction (build-time search width)
- During index building, how many candidates to consider when connecting a new node
- Higher → better graph quality, slower indexing
- Typical values: **100–400**. Default: 100.

```python
metadata={"hnsw:construction_ef": 200}
```

### ef (query-time search width)
- How many candidates to track during search
- Higher → better recall (fewer missed neighbors), slower query
- Must be ≥ k (number of results you want)
- Typical values: **50–500**. Default: 10.

```python
metadata={"hnsw:search_ef": 100}
```

### Space (distance metric)
- `l2` (Euclidean distance) — good default
- `cosine` — best for text/embedding similarity (what this project uses)
- `ip` (inner product) — used when vectors are pre-normalized

```python
metadata={"hnsw:space": "cosine"}
```

---

## Recall vs Speed Tradeoff

HNSW is an **approximate** nearest neighbor algorithm. It does not guarantee finding the
exact nearest neighbor every time. The tradeoff is controlled by `ef`:

```
ef = 10  → very fast, may miss true nearest neighbor in dense regions
ef = 100 → balanced, recall ~99% on most datasets
ef = 500 → near-exact, slower
```

In practice, for RAG applications, recall of 95-99% is fine. The LLM can handle
slightly imperfect retrieval much better than it handles a 500ms query latency.

---

## How ChromaDB Uses HNSW in This Project

When this project calls:

```python
results = _vector_store.similarity_search_with_score(query, k=4)
```

Under the hood:
1. `query` text is embedded by `all-MiniLM-L6-v2` → 384-dimensional float vector
2. ChromaDB calls its HNSW index with that vector and `k=4`
3. HNSW navigates the graph (described above) and returns 4 chunk IDs
4. ChromaDB fetches those chunks from its storage layer
5. Results returned as `(Document, score)` tuples

The HNSW index is persisted in the `./chroma_db/` folder on disk. It survives
server restarts, which is why `_restore_on_startup()` can reconnect to it.

---

## HNSW vs Other ANN Algorithms

| Algorithm | Build Speed | Query Speed | Memory  | Recall  | Notes |
|-----------|-------------|-------------|---------|---------|-------|
| **HNSW**  | Medium      | Very Fast   | High    | High    | Best for low-latency production |
| FAISS IVF | Fast        | Fast        | Medium  | Medium  | Good for batch/offline workloads |
| Annoy     | Fast        | Medium      | Low     | Medium  | Read-only after build |
| ScaNN     | Slow        | Very Fast   | Medium  | High    | Google's; best throughput at scale |
| Brute Force | Instant   | Very Slow   | None    | Perfect | Only viable under ~10K vectors |

**HNSW wins for RAG** because:
- Queries are interactive (user is waiting) → low latency matters most
- Index is updated on every document upload → dynamic insertion needed
- Memory cost is acceptable at RAG scale (thousands, not billions of vectors)

---

## Memory Layout

HNSW is memory-hungry. Each node stores:
- The vector itself (384 floats × 4 bytes = 1.5KB for this project's model)
- M links per layer (pointers to neighbor node IDs)

Rough estimate for this project:
```
1000 chunks × (1.5KB vector + 16 links × 8 bytes × ~1.3 layers avg)
= 1000 × (1500 + 166) bytes
≈ 1.7 MB total
```

At 1 million chunks: ~1.7 GB just for the HNSW graph. This is why large-scale
systems (1B+ vectors) use FAISS with quantization instead of pure HNSW.

---

## Summary

HNSW is a layered graph where:
- **Top layers** = coarse navigation (few nodes, big jumps)
- **Bottom layer** = fine-grained search (all nodes, small hops)

Search navigates top-down, arriving at the approximate nearest neighbor in O(log n)
steps instead of O(n) brute force.

In this project, ChromaDB's HNSW index is what makes `similarity_search()` fast even
as the document grows. The key insight is the tradeoff: you sacrifice a tiny bit of
recall accuracy to gain orders-of-magnitude speedup — a trade that almost always makes
sense for real-time applications.

**Tuning for this project:** The default ChromaDB HNSW settings (`M=16`, `ef=10`) are
fine for small PDFs. For large documents (500+ pages), increase `ef` to 100 for better
retrieval recall:

```python
_chroma_client.create_collection(
    name=COLLECTION_NAME,
    metadata={
        "hnsw:space": "cosine",
        "hnsw:M": 16,
        "hnsw:construction_ef": 100,
        "hnsw:search_ef": 100,    # was 10 by default
    }
)
```
