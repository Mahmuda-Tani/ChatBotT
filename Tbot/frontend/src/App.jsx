import { useRef, useState } from "react";
import Sidebar from "./components/Sidebar";
import ChatWidget from "./components/ChatWidget";

export default function App() {
  const [provider, setProvider] = useState("anthropic");
  const [messages, setMessages] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
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

  async function sendMessage(text) {
    const userMsg = { role: "user", content: text };
    const updatedMessages = [...messages, userMsg];
    streamBufferRef.current = "";
    setMessages([...updatedMessages, { role: "assistant", content: "" }]);
    setIsLoading(true);

    try {
      const res = await fetch("http://localhost:8000/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: updatedMessages, provider }),
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
          if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
            throw new Error(parsed.error);
          }
          if (typeof parsed === "string" && parsed) {
            appendToLastAssistant(parsed);
          }
        }
      }

      // Ensure final buffer is applied before reveal finishes.
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
          };
        } else {
          updated.push({ role: "assistant", content: `Error: ${err.message}` });
        }
        return updated;
      });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex h-screen bg-gray-50">
      <Sidebar provider={provider} onProviderChange={setProvider} />
      <main className="flex-1 flex items-center justify-center text-gray-400 text-sm">
        Open the chat widget →
      </main>
      <ChatWidget
        isOpen={isOpen}
        onToggle={() => setIsOpen((o) => !o)}
        messages={messages}
        isLoading={isLoading}
        onSend={sendMessage}
      />
    </div>
  );
}
