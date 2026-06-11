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

function SourceCards({ sources }) {
  const [open, setOpen] = useState(false);
  if (!sources || sources.length === 0) return null;

  return (
    <div className="mt-2">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-xs text-blue-500 hover:text-blue-400 transition-colors font-medium"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
          <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
        </svg>
        {open ? "Hide" : "Show"} {sources.length} source{sources.length > 1 ? "s" : ""}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`}
        >
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div className="mt-2 flex flex-col gap-2">
          {sources.map((src, i) => (
            <div
              key={i}
              className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-xs text-gray-700 leading-relaxed"
            >
              <div className="flex items-center gap-1.5 mb-1.5">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-blue-400 shrink-0">
                  <path d="M3 3.5A1.5 1.5 0 014.5 2h6.879a1.5 1.5 0 011.06.44l4.122 4.12A1.5 1.5 0 0117 7.622V16.5a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 013 16.5v-13z" />
                </svg>
                <span className="font-semibold text-blue-600">Page {src.page}</span>
                <span className="ml-auto text-gray-400">
                  relevance {(1 - Math.min(src.score / 2, 1)).toFixed(0) === "1"
                    ? "high"
                    : src.score < 0.8 ? "high" : src.score < 1.2 ? "medium" : "low"}
                </span>
              </div>
              <p className="line-clamp-4 text-gray-600">{src.text}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function NoticeMessage({ msg }) {
  return (
    <div className="flex justify-center my-3">
      <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 text-amber-700 text-xs px-3 py-2 rounded-full max-w-[85%] text-center">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 shrink-0">
          <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
        </svg>
        {msg.content}
      </div>
    </div>
  );
}

function UserMessage({ msg }) {
  return (
    <div className="flex justify-end mb-3">
      <div className="max-w-[75%] px-3 py-2 rounded-2xl rounded-br-sm text-sm leading-relaxed bg-blue-600 text-white">
        {msg.content}
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
    <div className="flex justify-start mb-3">
      <div className="max-w-[80%]">
        <div className="px-3 py-2 rounded-2xl rounded-bl-sm text-sm leading-relaxed bg-gray-100 text-gray-800 whitespace-pre-wrap">
          {displayed}
          {(isStreaming || isRevealing) && (
            <span className="inline-block w-0.5 h-3.5 bg-gray-500 ml-0.5 align-middle animate-pulse" />
          )}
        </div>
        {!isStreaming && !isRevealing && (
          <SourceCards sources={msg.sources} />
        )}
      </div>
    </div>
  );
}

export default function ChatWidget({ isOpen, onToggle, messages, isLoading, onSend, useRag, uploadedDoc }) {
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

  const showTypingDots = isLoading && lastMsg?.role === "assistant" && !lastMsg.content;

  return (
    <div className="fixed bottom-6 right-6 flex flex-col items-end gap-3 z-50">
      {isOpen && (
        <div className="w-[520px] h-[640px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="bg-gray-900 text-white px-4 py-3 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">Chat</span>
              {useRag && uploadedDoc && (
                <span className="flex items-center gap-1 bg-blue-600/30 border border-blue-500/40 text-blue-300 text-xs px-2 py-0.5 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                  {uploadedDoc.filename.length > 20
                    ? uploadedDoc.filename.slice(0, 20) + "…"
                    : uploadedDoc.filename}
                </span>
              )}
            </div>
            <button
              onClick={onToggle}
              className="text-gray-400 hover:text-white transition-colors text-lg leading-none"
              aria-label="Close chat"
            >
              ×
            </button>
          </div>

          {/* RAG hint banner */}
          {useRag && uploadedDoc && messages.length === 0 && (
            <div className="bg-blue-50 border-b border-blue-100 px-4 py-2.5 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-blue-500 shrink-0">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
              </svg>
              <p className="text-xs text-blue-700">
                Ask anything about <span className="font-semibold">{uploadedDoc.filename}</span>. Answers will cite the source pages.
              </p>
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3">
            {messages.length === 0 && !isLoading && (
              <p className="text-center text-gray-400 text-xs mt-8">
                {useRag ? "Ask a question about your document" : "Send a message to get started"}
              </p>
            )}
            {messages.map((msg, i) => {
              if (msg.role === "notice") return <NoticeMessage key={i} msg={msg} />;
              if (msg.role === "user") return <UserMessage key={i} msg={msg} />;

              const isLastAssistant = i === lastIndex && msg.role === "assistant";
              return (
                <AssistantMessage
                  key={i}
                  msg={msg}
                  isStreaming={isLastAssistant && isLoading}
                  onUpdate={scrollToBottom}
                />
              );
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

          {/* Input */}
          <div className="border-t border-gray-100 p-3 flex gap-2 shrink-0">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={useRag ? "Ask about the document…" : "Type a message…"}
              disabled={isLoading}
              className="flex-1 text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
            />
            <button
              onClick={handleSend}
              disabled={isLoading || !input.trim()}
              className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl px-3 py-2 transition-colors"
              aria-label="Send"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
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
