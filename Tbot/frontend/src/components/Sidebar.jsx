import { useRef, useState } from "react";

function DocumentCard({ doc, onRemove, onViewIndex }) {
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="shrink-0 w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 text-red-400">
              <path d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V12.75A3.75 3.75 0 0016.5 9h-1.875a1.875 1.875 0 01-1.875-1.875V5.25A3.75 3.75 0 009 1.5H5.625z" />
              <path d="M12.971 1.816A5.23 5.23 0 0114.25 5.25v1.875c0 .207.168.375.375.375H16.5a5.23 5.23 0 013.434 1.279 9.768 9.768 0 00-6.963-6.963z" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-white truncate" title={doc.filename}>
              {doc.filename}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {doc.page_count} {doc.page_count === 1 ? "page" : "pages"} · {doc.chunk_count} chunks
            </p>
          </div>
        </div>
        <button
          onClick={onRemove}
          className="shrink-0 text-gray-600 hover:text-red-400 transition-colors mt-0.5"
          title="Remove document"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs text-green-400 font-medium">RAG active</span>
        </div>
        <button
          onClick={onViewIndex}
          className="text-xs text-gray-400 hover:text-blue-400 transition-colors flex items-center gap-1"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3">
            <path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
            <path fillRule="evenodd" d="M1.38 8a6.97 6.97 0 0 1 1.2-2.003 7 7 0 1 1 10.84 0A7 7 0 0 1 1.38 8ZM8 3a5 5 0 1 0 0 10A5 5 0 0 0 8 3Z" clipRule="evenodd" />
          </svg>
          View Index
        </button>
      </div>
    </div>
  );
}

function UploadZone({ onUpload, isUploading }) {
  const inputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);

  function handleFiles(files) {
    const pdf = Array.from(files).find((f) => f.type === "application/pdf");
    if (pdf) onUpload(pdf);
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFiles(e.dataTransfer.files); }}
      onClick={() => inputRef.current?.click()}
      className={`border-2 border-dashed rounded-xl p-4 flex flex-col items-center gap-2 cursor-pointer transition-colors select-none
        ${isDragging
          ? "border-blue-500 bg-blue-500/10"
          : "border-gray-700 hover:border-gray-500 hover:bg-gray-800/50"
        }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
      {isUploading ? (
        <svg className="w-6 h-6 text-blue-400 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
      ) : (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 text-gray-500">
          <path fillRule="evenodd" d="M11.47 2.47a.75.75 0 011.06 0l4.5 4.5a.75.75 0 01-1.06 1.06l-3.22-3.22V16.5a.75.75 0 01-1.5 0V4.81L8.03 8.03a.75.75 0 01-1.06-1.06l4.5-4.5zM3 15.75a.75.75 0 01.75.75v2.25a1.5 1.5 0 001.5 1.5h13.5a1.5 1.5 0 001.5-1.5V16.5a.75.75 0 011.5 0v2.25a3 3 0 01-3 3H5.25a3 3 0 01-3-3V16.5a.75.75 0 01.75-.75z" clipRule="evenodd" />
        </svg>
      )}
      <div className="text-center">
        <p className="text-xs text-gray-400 font-medium">
          {isUploading ? "Processing…" : "Drop PDF here"}
        </p>
        <p className="text-xs text-gray-600 mt-0.5">or click to browse</p>
      </div>
    </div>
  );
}

export default function Sidebar({
  uploadedDoc, useRag, onUseRagChange,
  onDocumentUpload, onDocumentRemove, onViewIndex,
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  async function handleUpload(file) {
    setIsUploading(true);
    setUploadError("");
    try {
      await onDocumentUpload(file);
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <aside className="w-64 bg-gray-900 text-white flex flex-col p-5 gap-6 shrink-0">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Tbot</h1>
        <p className="text-gray-400 text-xs mt-1">AI Chat Assistant</p>
      </div>

      {/* Divider */}
      <div className="border-t border-gray-800" />

      {/* RAG / Document section */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            Document Q&A
          </label>
          {uploadedDoc && (
            <button
              onClick={() => onUseRagChange(!useRag)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                useRag ? "bg-blue-600" : "bg-gray-700"
              }`}
              title={useRag ? "Disable RAG" : "Enable RAG"}
            >
              <span
                className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                  useRag ? "translate-x-4" : "translate-x-1"
                }`}
              />
            </button>
          )}
        </div>

        {uploadedDoc ? (
          <DocumentCard doc={uploadedDoc} onRemove={onDocumentRemove} onViewIndex={onViewIndex} />
        ) : (
          <>
            <p className="text-xs text-gray-500 leading-relaxed">
              Upload a PDF to chat with your document. The AI will answer using only the document's content.
            </p>
            <UploadZone onUpload={handleUpload} isUploading={isUploading} />
            {uploadError && (
              <p className="text-xs text-red-400">{uploadError}</p>
            )}
          </>
        )}
      </div>

      <div className="mt-auto text-xs text-gray-600">
        Powered by <code className="text-gray-500">OpenRouter</code>
      </div>
    </aside>
  );
}
