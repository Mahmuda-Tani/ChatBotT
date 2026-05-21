import { useState, useRef, useEffect, useCallback } from "react";
import { useSmoothReveal } from "../hooks/useSmoothReveal";

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-3 py-2">
      <span className="w-2 h-2 rounded-full bg-gray-400 dot-1" />
      <span className="w-2 h-2 rounded-full bg-gray-400 dot-2" />
      <span className="w-2 h-2 rounded-full bg-gray-400 dot-3" />
    </div>
  );
}

function Message({ msg, showCursor = false }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-2`}>
      <div
        className={`max-w-[75%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
          isUser
            ? "bg-blue-600 text-white rounded-br-sm"
            : "bg-gray-100 text-gray-800 rounded-bl-sm"
        }`}
      >
        {msg.content}
        {showCursor && (
          <span className="inline-block w-0.5 h-3.5 bg-gray-500 ml-0.5 align-middle animate-pulse" />
        )}
      </div>
    </div>
  );
}

function AssistantMessage({ msg, isStreaming, onUpdate }) {
  const displayed = useSmoothReveal(msg.content, isStreaming);
  const isRevealing = displayed.length < msg.content.length;

  useEffect(() => {
    onUpdate?.();
  }, [displayed, onUpdate]);

  return (
    <Message
      msg={{ ...msg, content: displayed }}
      showCursor={isStreaming || isRevealing}
    />
  );
}

export default function ChatWidget({ isOpen, onToggle, messages, isLoading, onSend }) {
  const [input, setInput] = useState("");
  const bottomRef = useRef(null);

  const lastIndex = messages.length - 1;
  const lastMsg = messages[lastIndex];

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    if (isOpen) scrollToBottom();
  }, [messages, isLoading, isOpen]);

  function handleSend() {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput("");
    onSend(text);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  const showTypingDots =
    isLoading &&
    lastMsg?.role === "assistant" &&
    !lastMsg.content;

  return (
    <div className="fixed bottom-6 right-6 flex flex-col items-end gap-3 z-50">
      {isOpen && (
        <div className="w-[500px] h-[600px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
          <div className="bg-gray-900 text-white px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-semibold">Chat</span>
            <button
              onClick={onToggle}
              className="text-gray-400 hover:text-white transition-colors text-lg leading-none"
              aria-label="Close chat"
            >
              ×
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {messages.length === 0 && !isLoading && (
              <p className="text-center text-gray-400 text-xs mt-8">
                Send a message to get started
              </p>
            )}
            {messages.map((msg, i) => {
              const isLastAssistant =
                i === lastIndex && msg.role === "assistant";

              if (isLastAssistant) {
                return (
                  <AssistantMessage
                    key={i}
                    msg={msg}
                    isStreaming={isLoading}
                    onUpdate={scrollToBottom}
                  />
                );
              }

              return <Message key={i} msg={msg} />;
            })}
            {showTypingDots && (
              <div className="flex justify-start mb-2">
                <div className="bg-gray-100 rounded-2xl rounded-bl-sm">
                  <TypingDots />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="border-t border-gray-100 p-3 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message…"
              disabled={isLoading}
              className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl px-3 py-2 transition-colors"
              aria-label="Send"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-4 h-4"
              >
                <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
              </svg>
            </button>
          </div>
        </div>
      )}

      <button
        onClick={onToggle}
        className="w-14 h-14 rounded-full bg-gray-900 hover:bg-gray-700 text-white shadow-lg flex items-center justify-center transition-colors"
        aria-label="Toggle chat"
      >
        {isOpen ? (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
            <path fillRule="evenodd" d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
            <path fillRule="evenodd" d="M4.848 2.771A49.144 49.144 0 0112 2.25c2.43 0 4.817.178 7.152.52 1.978.292 3.348 2.024 3.348 3.97v6.02c0 1.946-1.37 3.678-3.348 3.97a48.901 48.901 0 01-3.476.383.39.39 0 00-.297.17l-2.755 4.133a.75.75 0 01-1.248 0l-2.755-4.133a.39.39 0 00-.297-.17 48.9 48.9 0 01-3.476-.384c-1.978-.29-3.348-2.024-3.348-3.97V6.741c0-1.946 1.37-3.68 3.348-3.97z" clipRule="evenodd" />
          </svg>
        )}
      </button>
    </div>
  );
}
