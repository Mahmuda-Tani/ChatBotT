# 01 — What Is RAG (Retrieval-Augmented Generation)?

## The Problem RAG Solves

Large Language Models (LLMs) like Claude or Gemini are trained on massive amounts of internet
text up to a certain date. This gives them general knowledge but creates two hard limitations:

1. **Knowledge cutoff** — They do not know about anything that happened after training ended.
2. **No private data** — They have never seen your company's contracts, internal docs, or PDFs.

If you ask an LLM "What does clause 7 of my uploaded contract say?", it cannot answer — it has
never seen your contract.

**RAG is the solution.** Instead of asking the LLM to remember, you retrieve the relevant
information first, then hand it to the LLM as context.


## The Core Idea (First Principles)

Think of it like an open-book exam vs a closed-book exam.

- **Without RAG:** The LLM is a student doing a closed-book exam — it can only use what it
  memorized during training.
- **With RAG:** The LLM is a student doing an open-book exam — you hand it the relevant pages
  of the textbook, and it reads and reasons over them to answer.

The LLM's job in RAG is NOT to remember. Its job is to READ and REASON.


## The Three Stages of RAG

### Stage 1: Ingestion (Done Once, When Document Is Uploaded)

```
PDF / Document
    → Extract raw text
    → Split into chunks (smaller pieces)
    → Convert each chunk into a vector (embedding)
    → Store vectors + original text in a Vector Store
```

### Stage 2: Retrieval (Done on Every User Question)

```
User question
    → Convert question into a vector (same embedding model)
    → Search vector store for the most similar chunk vectors
    → Return the top-k matching chunks (the "context")
```

### Stage 3: Generation (Done on Every User Question)

```
Retrieved chunks + User question
    → Combine into a single prompt:
      "Using ONLY this context: [chunks], answer: [question]"
    → Send to LLM
    → LLM reads the context and generates an answer
    → Return answer + source citations to user
```


## Why Not Just Send the Whole Document to the LLM?

This is a common beginner question. The answer has several layers:

1. **Token limits** — LLMs have a maximum input size (context window). A 200-page PDF may
   contain 150,000 tokens. Most models accept 8,000–200,000. Large docs simply do not fit.

2. **Cost** — LLM APIs charge per token. Sending 150,000 tokens per question is extremely
   expensive at scale.

3. **Performance degradation** — Research shows LLMs perform worse ("lose focus") as the
   context grows very long. Shorter, targeted context produces better answers.

4. **Latency** — More tokens = slower response. Users notice.

RAG solves all four: it sends only the 3-5 most relevant chunks, not the whole document.


## What RAG Is NOT

- It is not fine-tuning (which permanently changes the model's weights).
- It is not a database query (it finds semantic similarity, not exact matches).
- It is not guaranteed to be accurate — the retrieval step can fail to find the right chunk,
  and the LLM can still hallucinate if the context is ambiguous.


## How This Project Implements RAG

```
User uploads PDF
    → ragImplementation.process_pdf()
        → pypdf extracts text page by page
        → RecursiveCharacterTextSplitter splits into 800-char chunks
        → HuggingFaceEmbeddings (all-MiniLM-L6-v2) converts each chunk to a 384-dim vector
        → FAISS stores all vectors in memory

User asks a question
    → ragImplementation.retrieve_context()
        → Question → vector
        → FAISS similarity_search_with_score(k=4) finds top 4 closest chunks
        → Returns context string + source list with page numbers

main.py /chat endpoint
    → Injects context as a SystemMessage before user messages
    → Streams LLM response back to frontend
    → Frontend renders answer + collapsible source cards
```


## Key Terms to Remember

| Term | Meaning |
|------|---------|
| Embedding | A list of numbers that captures the meaning of a piece of text |
| Chunk | A small piece of a document (e.g. 800 characters) |
| Vector Store | A database optimized to find similar vectors quickly |
| Retrieval | Finding the chunks most relevant to a query |
| Context | The chunks handed to the LLM to help it answer |
| k | How many top chunks to retrieve (we use k=4) |
