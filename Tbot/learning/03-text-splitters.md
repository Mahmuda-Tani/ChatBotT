# Text Splitting: Problems with RecursiveCharacterTextSplitter & Better Alternatives

## What is RecursiveCharacterTextSplitter?

`RecursiveCharacterTextSplitter` is LangChain's default text splitter. It tries to split text
by a hierarchy of separators in order: `["\n\n", "\n", " ", ""]`. When a chunk exceeds
`chunk_size`, it falls to the next separator. It also supports `chunk_overlap` to avoid
losing context at chunk boundaries.

**In this project** (`ragImplementation.py`, line 90):
```python
splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=100)
```

It looks simple — and it works. But it has real problems at production scale.

---

## Problems with RecursiveCharacterTextSplitter

### Problem 1: Splits on Characters, Not Tokens

The `chunk_size=800` means 800 **characters**, not tokens. But LLMs and embedding models
think in tokens. A token is roughly 3-4 characters, so:

- 800 characters ≈ 200-270 tokens
- A chunk that is 800 chars might be 150 tokens or 350 tokens depending on content
- This causes **inconsistent chunk sizes** going into the embedding model

```
"Hello world" → 2 tokens, 11 characters  (5.5 chars/token)
"electroencephalography" → ~6 tokens, 22 characters  (3.6 chars/token)
```

**Impact:** Embedding quality becomes unpredictable. Some chunks are too small (lose
semantic density), some too big (exceed model limits silently).

---

### Problem 2: Semantic Context is Broken Mid-Sentence

The splitter does not understand meaning. It only counts characters. A sentence like:

```
"The patient must NOT take aspirin if they have a history of..."
[CHUNK BOUNDARY HERE]
"...gastrointestinal bleeding."
```

This split destroys the medical instruction. The first chunk says "must NOT take aspirin"
but the reason (the critical condition) is in the next chunk. Retrieval may return only
the first chunk, giving the LLM incomplete and potentially dangerous information.

**This is the most serious production problem.**

---

### Problem 3: No Document Structure Awareness

PDFs have:
- Headings (`# Introduction`)
- Tables
- Code blocks
- Lists
- Footnotes

`RecursiveCharacterTextSplitter` treats all of this as flat text. A table gets split
across chunks. A heading gets separated from the paragraph it belongs to. Code blocks
get cut mid-function.

Example from this project — a PDF page like:

```
Key Findings
──────────────────────────────
Metric        | Q1   | Q2
Revenue       | $10M | $15M
Growth        | 12%  | 50%
```

Could be split into chunks where the table header is in chunk A and the data rows
are in chunks B and C. No single chunk answers "what was Q2 revenue?"

---

### Problem 4: Fixed Chunk Size is a Blunt Instrument

`chunk_size=800` was chosen arbitrarily. Different content needs different sizes:
- A dense technical paragraph: needs bigger chunks for context
- A bullet-point list: each bullet is its own unit, should be a small chunk
- A legal contract clause: must not be broken across chunks

One fixed size fits none of these well.

---

### Problem 5: Overlap Does Not Guarantee Context Continuity

`chunk_overlap=100` repeats 100 characters between consecutive chunks. This is a
band-aid. It increases the total data stored and retrieved, inflates embedding costs,
and still doesn't guarantee that the overlapped content is meaningful (you might
overlap mid-word or mid-sentence).

---

### Problem 6: No Metadata About Where in the Document

`RecursiveCharacterTextSplitter` has no idea if it's splitting a title, body, or footer.
All chunks look identical in the vector store. This makes filtering and ranking harder.

In this project, page metadata is added manually by wrapping chunks in `LCDocument` —
but heading context, section names, and paragraph type are lost.

---

## Solutions & Alternatives

### Option A: TokenTextSplitter (Drop-in Fix)

Split by **tokens** instead of characters. This fixes Problem 1 immediately.

```python
from langchain_text_splitters import TokenTextSplitter

splitter = TokenTextSplitter(chunk_size=256, chunk_overlap=32)
```

- Uses `tiktoken` under the hood (OpenAI's tokenizer, also works for other models)
- `chunk_size=256` tokens ≈ 800-1000 characters (consistent)
- Embedding models like `all-MiniLM-L6-v2` max out at 512 tokens — staying at 256
  leaves room for the query in the context window

**Pros:** Easy swap, reliable chunk sizes, no external dependencies beyond `tiktoken`  
**Cons:** Still doesn't understand document structure or semantics

---

### Option B: MarkdownTextSplitter / HTMLHeaderTextSplitter (Structure-Aware)

For documents with known structure, use structure-aware splitters.

```python
from langchain_text_splitters import MarkdownHeaderTextSplitter

headers_to_split_on = [
    ("#", "h1"),
    ("##", "h2"),
    ("###", "h3"),
]
splitter = MarkdownHeaderTextSplitter(headers_to_split_on=headers_to_split_on)
chunks = splitter.split_text(markdown_content)
# Each chunk now carries {'h1': 'Introduction', 'h2': 'Methods'} in metadata
```

**Pros:** Chunks align to document sections, metadata carries heading context  
**Cons:** Only works if document is in Markdown/HTML — PDFs need conversion first

---

### Option C: Semantic Chunking (Fixes Problem 2 — the hardest one)

Split based on **semantic similarity between sentences**, not character counts.
Two consecutive sentences with high cosine similarity stay in the same chunk.
When similarity drops sharply, that's the split point.

```python
from langchain_experimental.text_splitter import SemanticChunker
from langchain_huggingface import HuggingFaceEmbeddings

embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
splitter = SemanticChunker(embeddings, breakpoint_threshold_type="percentile")
chunks = splitter.split_text(text)
```

How it works internally:
1. Split text into individual sentences
2. Embed each sentence
3. Compute cosine similarity between consecutive sentences
4. When similarity drops below a threshold → insert a chunk boundary

**Pros:** Chunks are semantically coherent, no broken ideas  
**Cons:** Slow (must embed every sentence during indexing), higher cost, chunk sizes vary

---

### Option D: Docling / Unstructured (Best for PDFs — Fixes Problems 3 & 6)

Libraries like `unstructured` or `docling` parse PDFs into structured elements:
- Title, NarrativeText, Table, ListItem, Header, Footer

```python
from unstructured.partition.pdf import partition_pdf
from unstructured.chunking.title import chunk_by_title

elements = partition_pdf("document.pdf", strategy="hi_res")
chunks = chunk_by_title(elements, max_characters=800)

for chunk in chunks:
    print(chunk.category)   # "Title", "NarrativeText", "Table"
    print(chunk.text)
    print(chunk.metadata.page_number)
```

Tables stay intact. Headings are attached to their sections. Page numbers, section
names, and element types all become queryable metadata.

**Pros:** True structure understanding, best retrieval quality for real PDFs  
**Cons:** Heavy dependency, slower parsing, `hi_res` strategy requires OCR model

---

### Option E: Hybrid — Token Split + Semantic Post-Process (Practical Balance)

A pragmatic production pattern:

```python
from langchain_text_splitters import TokenTextSplitter
from langchain_experimental.text_splitter import SemanticChunker

# Step 1: Token-aware pre-split into roughly equal pieces
token_splitter = TokenTextSplitter(chunk_size=512, chunk_overlap=64)
rough_chunks = token_splitter.split_text(text)

# Step 2: Semantic re-merge adjacent chunks that belong together
# (custom logic: merge if cosine similarity > threshold)
```

This avoids the cost of embedding every sentence (Option C) while still being
token-accurate (Option A) and partially semantics-aware.

---

## Comparison Table

| Splitter                        | Token-Aware | Structure-Aware | Semantic | Speed  | Production-Ready |
|---------------------------------|-------------|-----------------|----------|--------|-----------------|
| RecursiveCharacterTextSplitter  | No          | No              | No       | Fast   | Prototype only  |
| TokenTextSplitter               | Yes         | No              | No       | Fast   | Yes             |
| MarkdownHeaderTextSplitter      | No          | Yes (MD/HTML)   | No       | Fast   | Yes (for MD)    |
| SemanticChunker                 | No          | No              | Yes      | Slow   | Yes (if budget) |
| Unstructured / Docling          | Yes         | Yes (any PDF)   | No       | Slow   | Yes (best)      |
| Hybrid (Token + Semantic)       | Yes         | No              | Partial  | Medium | Yes             |

---

## Best Option for Production

### Winner: Unstructured + TokenTextSplitter (Two-Stage Pipeline)

```
PDF → Unstructured (parse structure) → TokenTextSplitter (normalize sizes) → ChromaDB
```

**Why this wins:**

1. `unstructured` gives you real PDF structure — tables don't get broken, headings
   stay with their paragraphs, and element types are metadata
2. `TokenTextSplitter` ensures each chunk fits cleanly in the embedding model's
   token window
3. Rich metadata (page, section, element type) enables filtered retrieval —
   e.g., "search only in tables" or "search only in the Methods section"
4. This is what enterprise RAG systems (LlamaIndex cloud, Vertex AI Search) use

**For this project specifically**, the quick win is:

```python
# Replace line 90 in ragImplementation.py:

# BEFORE (character-based, no token awareness):
splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=100)

# AFTER (token-aware, matches all-MiniLM-L6-v2's 512-token limit):
from langchain_text_splitters import TokenTextSplitter
splitter = TokenTextSplitter(chunk_size=256, chunk_overlap=32)
```

This single change gives consistent, embedding-model-aligned chunks with minimal effort.
The longer-term upgrade is `unstructured` for proper PDF structure parsing.

---

## Summary

`RecursiveCharacterTextSplitter` is a good **learning tool and prototype splitter**,
but it has fundamental problems for production:

- Character counting ≠ token counting (embedding models care about tokens)
- No semantic awareness (breaks ideas mid-thought)
- No document structure awareness (destroys tables, headings)
- Fixed size is too blunt for varied content

For production RAG, move to a **two-stage pipeline**: structure parsing (Unstructured/Docling)
followed by token-aware splitting (TokenTextSplitter). If you need semantic coherence on top
of that, add SemanticChunker as a third stage — but only if your pipeline can absorb the
extra latency and embedding cost.
