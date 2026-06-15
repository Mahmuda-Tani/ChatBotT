# Similarity Search — How It Works From First Principles

---

## The Core Question This Solves

When a user asks a question, how does the system find the right chunks from a document
that may have hundreds of pages?

The answer is NOT keyword matching. It is **similarity search** — finding chunks whose
*meaning* is mathematically closest to the meaning of the question.


---

## 1. The Setup: What's Already in the Index

Imagine you uploaded a small contract PDF. After chunking, your FAISS index holds 5 chunks:

```
Chunk 0 (Page 1): "This agreement is made between ABC Corp and XYZ Ltd on January 1, 2024."
Chunk 1 (Page 2): "Payment of $5,000 shall be made within 30 days of invoice receipt."
Chunk 2 (Page 2): "Late payments will incur a penalty of 2% per month on the outstanding amount."
Chunk 3 (Page 3): "Either party may terminate this contract with 30 days written notice."
Chunk 4 (Page 3): "All disputes shall be resolved through arbitration in New York."
```

Each chunk was converted to a 384-dimensional vector when the PDF was uploaded.
To make this visual, let's simplify to 2 dimensions:

```
Chunk 0 (agreement/parties)  → [0.2,  0.9]
Chunk 1 (payment amount)     → [0.8,  0.7]
Chunk 2 (late payment)       → [0.9,  0.6]
Chunk 3 (termination)        → [0.1,  0.2]
Chunk 4 (disputes)           → [0.15, 0.25]
```

Plotted on a 2D map:

```
  1.0 |
      |  · C0
  0.9 |
      |        · C1
  0.8 |
      |           · C2
  0.7 |
      |
  ...
  0.3 |
      |                      · C4
  0.2 |                   · C3
  0.1 |
      └─────────────────────────────
        0.1  0.3  0.5  0.7  0.9
```

Notice:
- C1 and C2 (both about payment) are CLOSE to each other
- C3 and C4 (legal clauses) cluster together
- C0 (parties/introduction) is alone

This is semantic clustering happening automatically — no rules were written for this.
The embedding model learned to group similar meanings together.


---

## 2. A User Asks a Question

```
User: "What happens if I pay late?"
```

### Step 1: Question → Vector

The SAME embedding model that processed the PDF now converts this question to a vector.
This is critical — both the chunks and the query must use the same model so the vectors
live in the same mathematical space and can be compared.

```
"What happens if I pay late?"  →  [0.85, 0.65]
```

Mark this on the map as ★:

```
  1.0 |
      |  · C0
  0.9 |
      |        · C1
  0.8 |
      |           · C2
  0.7 |              ★  ← query vector [0.85, 0.65]
      |
  ...
  0.2 |                   · C3
  0.1 |                      · C4
      └─────────────────────────────
```

The query vector landed near C1 and C2 — the payment-related chunks. This is already
telling us the answer before we even calculate distances.


---

## 3. Step 2: Calculate Distance to Every Chunk

FAISS calculates the L2 (Euclidean) distance from the query vector to EVERY stored chunk.

### The L2 Distance Formula

For two points (a₁, a₂) and (b₁, b₂) in 2D:

```
distance = √( (a₁ - b₁)² + (a₂ - b₂)² )
```

In 384 dimensions (real case):

```
distance = √( (a₁-b₁)² + (a₂-b₂)² + (a₃-b₃)² + ... + (a₃₈₄-b₃₈₄)² )
```

Same formula, just more terms. FAISS handles this efficiently using optimized CPU/GPU math.

### Calculating Each Distance

```
Query ★ = [0.85, 0.65]

vs C0 [0.2,  0.9 ]: √((0.85-0.2)²  + (0.65-0.9)²)  = √(0.4225 + 0.0625) = 0.697
vs C1 [0.8,  0.7 ]: √((0.85-0.8)²  + (0.65-0.7)²)  = √(0.0025 + 0.0025) = 0.071 ← closest
vs C2 [0.9,  0.6 ]: √((0.85-0.9)²  + (0.65-0.6)²)  = √(0.0025 + 0.0025) = 0.071 ← tied
vs C3 [0.1,  0.2 ]: √((0.85-0.1)²  + (0.65-0.2)²)  = √(0.5625 + 0.2025) = 0.875
vs C4 [0.15, 0.25]: √((0.85-0.15)² + (0.65-0.25)²) = √(0.4900 + 0.1600) = 0.806
```

### Ranked by Distance (LOWER = MORE SIMILAR)

```
Rank 1 → C1: 0.071  "Payment of $5,000 shall be made within 30 days..."
Rank 2 → C2: 0.071  "Late payments will incur a penalty of 2% per month..."  ← exact answer
Rank 3 → C4: 0.806  "All disputes shall be resolved through arbitration..."
Rank 4 → C3: 0.875  "Either party may terminate this contract..."
Rank 5 → C0: 0.697  "This agreement is made between ABC Corp..."
```

With k=4, FAISS returns the top 4 chunks: C1, C2, C4, C3.


---

## 4. Step 3: Build the Context and Send to LLM

retrieve_context() in our ragImplementation.py takes those 4 chunks and assembles:

```
[Page 2]
Payment of $5,000 shall be made within 30 days of invoice receipt.

---

[Page 2]
Late payments will incur a penalty of 2% per month on the outstanding amount.

---

[Page 3]
All disputes shall be resolved through arbitration in New York.

---

[Page 3]
Either party may terminate this contract with 30 days written notice.
```

This becomes the system message sent to the LLM in main.py:

```
"You are a helpful assistant. Answer using ONLY the document context below.

DOCUMENT CONTEXT:
[Page 2]
Payment of $5,000 shall be made within 30 days...
[Page 2]
Late payments will incur a penalty of 2% per month...
..."
```


---

## 5. Step 4: LLM Reads and Answers

The LLM never searched the document. It never saw the PDF.
It only reads the 4 chunks you handed it and reasons over them:

```
"According to the contract, late payments incur a penalty of 2% per month
on the outstanding amount (Page 2)."
```

The LLM's job in RAG is to READ and REASON — not to remember.


---

## 6. The Critical Insight: Vector Search vs Keyword Search

```
Traditional keyword search:
  query  = "late payment"
  method = look for documents containing the exact words "late" and "payment"
  misses = "delayed remittance", "overdue invoice", "payment not received on time"

Vector / semantic search:
  query  = "late payment"
  method = find chunks whose MEANING is mathematically close to the query meaning
  finds  = "delayed remittance will attract a surcharge" ← same meaning, different words
```

This is why RAG produces better answers than simple keyword search.
The embedding model understands language — not just characters.


---

## 7. The score Value in Our Code

In retrieve_context() we return:

```python
sources.append({
    "text": text,
    "page": doc.metadata["page"],
    "score": round(float(score), 3),   # this is the L2 distance
})
```

This score is the L2 distance calculated above.

IMPORTANT: Lower score = better match. Higher score = worse match.

```
score: 0.071  → very relevant  (query and chunk are semantically close)
score: 0.875  → less relevant  (query and chunk are semantically far)
```

Known bug in our frontend: the relevance label ("high", "medium", "low") currently
treats higher score as better. This is inverted and needs to be fixed.


---

## 8. What k Controls

In our code: similarity_search_with_score(query, k=4)

k is how many chunks to retrieve. Choosing k involves a trade-off:

```
k too small (e.g. k=1):
  ✓ Focused, less noise in context
  ✗ May miss relevant information that is in other chunks

k too large (e.g. k=20):
  ✓ Captures more potentially relevant content
  ✗ Fills LLM context with irrelevant chunks, degrades answer quality
  ✗ More tokens = higher API cost + slower response

k=4 is a reasonable default for most documents.
Optimal k depends on document size, chunk size, and the type of questions asked.
```


---

## 9. The Full Flow — One Diagram

```
                        ┌─────────────────────────────┐
                        │         USER QUESTION        │
                        │  "What happens if I pay late?"│
                        └──────────────┬──────────────┘
                                       │
                                       ▼
                        ┌─────────────────────────────┐
                        │      EMBEDDING MODEL         │
                        │   (all-MiniLM-L6-v2)         │
                        │  question → [0.85, 0.65, ...]│
                        └──────────────┬──────────────┘
                                       │  query vector
                                       ▼
                        ┌─────────────────────────────┐
                        │        FAISS INDEX           │
                        │  calculates L2 distance to   │
                        │  every stored chunk vector   │
                        │  returns top k=4 matches     │
                        └──────────────┬──────────────┘
                                       │  4 chunk texts + page numbers
                                       ▼
                        ┌─────────────────────────────┐
                        │      CONTEXT ASSEMBLY        │
                        │  [Page 2] Payment of $5,000  │
                        │  [Page 2] Late payments...   │
                        │  [Page 3] Disputes...        │
                        │  [Page 3] Termination...     │
                        └──────────────┬──────────────┘
                                       │  context + question
                                       ▼
                        ┌─────────────────────────────┐
                        │           LLM                │
                        │  (Claude / Gemini)           │
                        │  reads context, reasons,     │
                        │  generates answer            │
                        └──────────────┬──────────────┘
                                       │
                                       ▼
                   "Late payments incur a 2% monthly penalty (Page 2)."
```


---

## 10. Key Numbers in Our Implementation

| Parameter | Value | File |
|-----------|-------|------|
| Embedding model | all-MiniLM-L6-v2 | ragImplementation.py |
| Vector dimensions | 384 | fixed by the model |
| Chunk size | 800 characters | ragImplementation.py |
| Chunk overlap | 100 characters | ragImplementation.py |
| k (chunks retrieved) | 4 | ragImplementation.py |
| Distance metric | L2 (Euclidean) | FAISS default |
| Vector store | FAISS (in-memory) | ragImplementation.py |
