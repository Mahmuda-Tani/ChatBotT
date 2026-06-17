import { useRef, useState, useEffect } from "react";
import Sidebar from "./components/Sidebar";
import ChatWidget from "./components/ChatWidget";
import IndexViewer from "./components/IndexViewer";

export default function App() {
  // thread_id identifies this conversation to the LangGraph backend.
  // Generated once per session; never changes, so useRef (not useState).
  const threadIdRef = useRef(crypto.randomUUID());

  const [messages, setMessages] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [uploadedDoc, setUploadedDoc] = useState(null);
  const [useRag, setUseRag] = useState(false);
  const [isIndexViewerOpen, setIsIndexViewerOpen] = useState(false);

  // On page load: ask the backend if a document is already in ChromaDB.
  // Restores the sidebar document card after a browser refresh.
  useEffect(() => {
    fetch("http://localhost:8000/document")
      .then((r) => r.json())
      .then((data) => {
        if (data?.filename) {
          setUploadedDoc(data);
          setUseRag(true);
        }
      })
      .catch(() => {});
  }, []);

  const streamBufferRef = useRef("");
  const flushRafRef = useRef(null);

  function flushStreamBuffer() {
    const content = streamBufferRef.current;
    setMessages((prev) => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last?.role !== "assistant") return prev;
      updated[updated.length - 1] = { ...last, content };
      return updated;
    });
    flushRafRef.current = null;
  }

  function appendToLastAssistant(chunk) {
    streamBufferRef.current += chunk;
    if (!flushRafRef.current) {
      flushRafRef.current = requestAnimationFrame(flushStreamBuffer);
    }
  }

  function setLastAssistantSources(sources) {
    setMessages((prev) => {
      const updated = [...prev];
      const last = updated[updated.length - 1];
      if (last?.role !== "assistant") return prev;
      updated[updated.length - 1] = { ...last, sources };
      return updated;
    });
  }

  async function sendMessage(text) {
    streamBufferRef.current = "";
    setMessages((prev) => [
      ...prev,
      { role: "user", content: text },
      { role: "assistant", content: "", sources: [] },
    ]);
    setIsLoading(true);

    try {
      const res = await fetch("http://localhost:8000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          thread_id: threadIdRef.current,
          message: text,
          use_rag: useRag,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;

          const payload = line.slice(6);
          if (payload === "[DONE]") continue;

          const parsed = JSON.parse(payload);

          if (parsed?.type === "sources") {
            setLastAssistantSources(parsed.sources);
          } else if (parsed?.type === "text" && parsed.text) {
            appendToLastAssistant(parsed.text);
          } else if (parsed?.type === "error") {
            throw new Error(parsed.error);
          }
        }
      }

      if (flushRafRef.current) {
        cancelAnimationFrame(flushRafRef.current);
        flushRafRef.current = null;
      }
      flushStreamBuffer();
    } catch (err) {
      if (flushRafRef.current) {
        cancelAnimationFrame(flushRafRef.current);
        flushRafRef.current = null;
      }
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last?.role === "assistant" && last.content === "") {
          updated[updated.length - 1] = {
            role: "assistant",
            content: `Error: ${err.message}`,
            sources: [],
          };
        } else {
          updated.push({ role: "assistant", content: `Error: ${err.message}`, sources: [] });
        }
        return updated;
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function handleDocumentUpload(file) {
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("http://localhost:8000/upload", {
      method: "POST",
      body: formData,
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.detail || "Upload failed");
    }
    const data = await res.json();
    setUploadedDoc(data);
    setUseRag(true);
    setMessages((prev) => [
      ...prev,
      {
        role: "notice",
        content: `"${data.filename}" uploaded (${data.page_count} pages). RAG is now active — answers will be based on this document.`,
      },
    ]);
  }

  async function handleDocumentRemove() {
    const filename = uploadedDoc?.filename;
    await fetch("http://localhost:8000/document", { method: "DELETE" });
    setUploadedDoc(null);
    setUseRag(false);
    setMessages((prev) => [
      ...prev,
      {
        role: "notice",
        content: `"${filename}" was removed. The AI no longer has access to the document. Previous messages are still visible above.`,
      },
    ]);
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar
        uploadedDoc={uploadedDoc}
        useRag={useRag}
        onUseRagChange={setUseRag}
        onDocumentUpload={handleDocumentUpload}
        onDocumentRemove={handleDocumentRemove}
        onViewIndex={() => setIsIndexViewerOpen(true)}
      />
      <main className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        {uploadedDoc
          ? `Chatting with "${uploadedDoc.filename}" — open the widget to ask questions`
          : "Open the chat widget →"}
      </main>
      <IndexViewer
        isOpen={isIndexViewerOpen}
        onClose={() => setIsIndexViewerOpen(false)}
        uploadedDoc={uploadedDoc}
      />
      <ChatWidget
        isOpen={isOpen}
        onToggle={() => setIsOpen((o) => !o)}
        messages={messages}
        isLoading={isLoading}
        onSend={sendMessage}
        useRag={useRag}
        uploadedDoc={uploadedDoc}
      />
    </div>
  );
}
