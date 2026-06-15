import { useState, useEffect } from "react";

// ── Colour palette — one colour per page number (cycles after 10 pages) ───────
const PAGE_COLORS = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#ec4899", "#14b8a6", "#f97316", "#6366f1", "#84cc16",
];
function pageColor(page) {
  return PAGE_COLORS[(page - 1) % PAGE_COLORS.length];
}

// ── SVG viewport dimensions ───────────────────────────────────────────────────
const SVG_W = 580;
const SVG_H = 380;
const PADDING = 45;

// Converts raw t-SNE (x, y) coordinates into SVG viewport coordinates.
// t-SNE output range is arbitrary — we normalise it to fit the SVG canvas.
function toSvgCoords(rawPoints) {
  if (!rawPoints.length) return [];
  const xs = rawPoints.map((p) => p.x);
  const ys = rawPoints.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  return rawPoints.map((p) => ({
    ...p,
    cx: PADDING + ((p.x - minX) / rangeX) * (SVG_W - 2 * PADDING),
    cy: PADDING + ((p.y - minY) / rangeY) * (SVG_H - 2 * PADDING),
  }));
}

// ── Shared UI states ──────────────────────────────────────────────────────────
function LoadingState({ label, sublabel }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <svg className="w-7 h-7 animate-spin text-blue-500" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
      </svg>
      <div className="text-center">
        <p className="text-sm font-medium text-gray-600">{label}</p>
        {sublabel && <p className="text-xs text-gray-400 mt-1 max-w-xs text-center">{sublabel}</p>}
      </div>
    </div>
  );
}

// ── Embedding bar chart ───────────────────────────────────────────────────────
// Renders the first N values of a 384-dim vector as coloured bars.
// Blue = positive value, Red = negative value. Height = magnitude.
function EmbeddingBars({ values, totalDims }) {
  const maxAbs = Math.max(...values.map(Math.abs), 0.001);
  return (
    <div>
      <div className="flex items-end gap-px h-8 mb-1">
        {values.map((val, i) => (
          <div
            key={i}
            className="flex-1 rounded-sm"
            style={{
              height: `${(Math.abs(val) / maxAbs) * 100}%`,
              minHeight: 2,
              background: val >= 0 ? "#3b82f6" : "#ef4444",
              opacity: 0.75,
            }}
            title={`dim[${i}]: ${val}`}
          />
        ))}
        <div className="flex-1 flex items-center justify-center">
          <span className="text-gray-300 text-xs">…</span>
        </div>
      </div>
      <p className="text-xs text-gray-400">
        Showing first {values.length} of{" "}
        <span className="font-medium text-gray-600">{totalDims}</span> dimensions
        &nbsp;·&nbsp;
        <span className="text-blue-500">■</span> positive
        &nbsp;
        <span className="text-red-400">■</span> negative
      </p>
    </div>
  );
}

// ── Metadata table ────────────────────────────────────────────────────────────
function MetadataTable({ metadata }) {
  return (
    <table className="w-full text-xs">
      <tbody>
        {Object.entries(metadata).map(([key, val]) => (
          <tr key={key} className="border-t border-gray-100 first:border-0">
            <td className="py-1 pr-3 font-medium text-gray-500 w-24">{key}</td>
            <td className="py-1 text-gray-700 font-mono">{String(val)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ── Tab 1: Chunks List ────────────────────────────────────────────────────────
function ChunksTab({ chunks, isLoading }) {
  const [expandedId, setExpandedId] = useState(null);

  if (isLoading) return <LoadingState label="Loading chunks…" />;
  if (!chunks.length) return (
    <div className="flex items-center justify-center h-full text-gray-400 text-sm">
      No chunks found. Upload a PDF first.
    </div>
  );

  const byPage = chunks.reduce((acc, chunk) => {
    const p = chunk.page ?? "?";
    if (!acc[p]) acc[p] = [];
    acc[p].push(chunk);
    return acc;
  }, {});

  const sortedPages = Object.keys(byPage).sort((a, b) => Number(a) - Number(b));

  return (
    <div className="overflow-y-auto h-full space-y-5 pr-1">
      {sortedPages.map((page) => (
        <div key={page}>
          {/* Page header */}
          <div className="flex items-center gap-2 mb-2 sticky top-0 bg-white py-1 z-10">
            <span
              className="text-xs font-bold text-white px-2.5 py-0.5 rounded-full"
              style={{ background: pageColor(Number(page)) }}
            >
              Page {page}
            </span>
            <span className="text-xs text-gray-400">
              {byPage[page].length} chunk{byPage[page].length > 1 ? "s" : ""}
            </span>
            <div className="flex-1 h-px bg-gray-100" />
          </div>

          {/* Chunk cards */}
          <div className="space-y-2">
            {byPage[page].map((chunk, i) => {
              const isExpanded = expandedId === chunk.id;
              return (
                <div
                  key={chunk.id}
                  className="border border-gray-200 rounded-xl overflow-hidden"
                >
                  {/* Chunk header + text */}
                  <div className="bg-gray-50 p-3">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 font-mono">chunk {i + 1}</span>
                        <span className="text-xs text-gray-300">·</span>
                        <span className="text-xs text-gray-400">{chunk.text.length} chars</span>
                      </div>
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : chunk.id)}
                        className="text-xs text-blue-500 hover:text-blue-700 transition-colors font-medium"
                      >
                        {isExpanded ? "Hide details" : "Show details"}
                      </button>
                    </div>
                    <p className="text-xs text-gray-700 leading-relaxed">{chunk.text}</p>
                  </div>

                  {/* Expandable details: metadata + embedding */}
                  {isExpanded && (
                    <div className="border-t border-gray-200 bg-white p-3 space-y-4">

                      {/* Metadata */}
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                          Metadata
                        </p>
                        <MetadataTable metadata={chunk.metadata} />
                      </div>

                      {/* Embedding */}
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                          Vector Embedding
                        </p>
                        <EmbeddingBars
                          values={chunk.embedding_preview}
                          totalDims={chunk.embedding_dims}
                        />
                        {/* Raw numbers */}
                        <div className="mt-2 bg-gray-50 rounded-lg p-2 font-mono text-xs text-gray-500 leading-relaxed break-all">
                          [{chunk.embedding_preview.join(", ")}, …]
                        </div>
                      </div>

                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Tab 2: Vector Map ─────────────────────────────────────────────────────────
// Renders a 2D SVG scatter plot of all chunk vectors after t-SNE reduction.
// Each dot = one chunk. Colour = page number. Hover = see chunk text below.
function VectorMapTab({ points, isLoading }) {
  const [hovered, setHovered] = useState(null);

  if (isLoading) {
    return (
      <LoadingState
        label="Computing t-SNE projection…"
        sublabel="Compressing 384-dimensional vectors to 2D. This may take a few seconds for large documents."
      />
    );
  }
  if (!points.length) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        No vectors to display. Upload a PDF first.
      </div>
    );
  }

  const normalized = toSvgCoords(points);
  const uniquePages = [...new Set(points.map((p) => p.page))].sort((a, b) => a - b);

  return (
    <div className="flex flex-col h-full gap-3">
      {/* Legend */}
      <div className="flex flex-wrap gap-x-4 gap-y-1 shrink-0">
        {uniquePages.map((page) => (
          <div key={page} className="flex items-center gap-1.5">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ background: pageColor(page) }}
            />
            <span className="text-xs text-gray-500">Page {page}</span>
          </div>
        ))}
        <span className="text-xs text-gray-400 ml-auto">{points.length} chunks</span>
      </div>

      {/* SVG scatter plot */}
      <div className="flex-1 bg-gray-50 rounded-xl border border-gray-200 overflow-hidden">
        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          className="w-full h-full"
          style={{ display: "block" }}
        >
          {/* Subtle grid */}
          {[0, 1, 2, 3, 4].map((i) => (
            <line
              key={`h${i}`}
              x1={PADDING} x2={SVG_W - PADDING}
              y1={PADDING + (i * (SVG_H - 2 * PADDING)) / 4}
              y2={PADDING + (i * (SVG_H - 2 * PADDING)) / 4}
              stroke="#e5e7eb" strokeWidth="1"
            />
          ))}
          {[0, 1, 2, 3, 4].map((i) => (
            <line
              key={`v${i}`}
              x1={PADDING + (i * (SVG_W - 2 * PADDING)) / 4}
              x2={PADDING + (i * (SVG_W - 2 * PADDING)) / 4}
              y1={PADDING} y2={SVG_H - PADDING}
              stroke="#e5e7eb" strokeWidth="1"
            />
          ))}

          {/* Chunk dots */}
          {normalized.map((p, i) => {
            const isHovered = hovered?.index === i;
            const isDimmed = hovered && !isHovered;
            return (
              <circle
                key={i}
                cx={p.cx}
                cy={p.cy}
                r={isHovered ? 8 : 5}
                fill={pageColor(p.page)}
                fillOpacity={isDimmed ? 0.2 : 0.8}
                stroke={isHovered ? "white" : "none"}
                strokeWidth={isHovered ? 2 : 0}
                className="cursor-pointer"
                style={{ transition: "r 0.1s, fill-opacity 0.1s" }}
                onMouseEnter={() => setHovered({ ...p, index: i })}
                onMouseLeave={() => setHovered(null)}
              />
            );
          })}
        </svg>
      </div>

      {/* Hover preview panel */}
      <div
        className={`shrink-0 rounded-xl border px-4 py-3 text-xs min-h-[64px] transition-colors duration-150 ${
          hovered
            ? "bg-blue-50 border-blue-200"
            : "bg-gray-50 border-gray-200"
        }`}
      >
        {hovered ? (
          <>
            <span
              className="inline-block text-white text-xs font-semibold px-2 py-0.5 rounded-full mb-2"
              style={{ background: pageColor(hovered.page) }}
            >
              Page {hovered.page}
            </span>
            <p className="text-gray-700 leading-relaxed line-clamp-2">{hovered.text}</p>
          </>
        ) : (
          <p className="text-gray-400 text-center pt-3">
            Hover a dot to read its chunk text
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function IndexViewer({ isOpen, onClose, uploadedDoc }) {
  const [activeTab, setActiveTab] = useState("chunks");
  const [chunks, setChunks] = useState([]);
  const [points, setPoints] = useState([]);
  const [isLoadingChunks, setIsLoadingChunks] = useState(false);
  const [isLoadingVectors, setIsLoadingVectors] = useState(false);

  // Fetch chunks lazily — only when the Chunks tab is active and not yet loaded
  useEffect(() => {
    if (!isOpen || activeTab !== "chunks" || chunks.length > 0) return;
    setIsLoadingChunks(true);
    fetch("http://localhost:8000/debug/chunks")
      .then((r) => r.json())
      .then((data) => setChunks(data.chunks ?? []))
      .catch(() => setChunks([]))
      .finally(() => setIsLoadingChunks(false));
  }, [isOpen, activeTab, chunks.length]);

  // Fetch vectors lazily — only when Vector Map tab is active and not yet loaded
  useEffect(() => {
    if (!isOpen || activeTab !== "vectors" || points.length > 0) return;
    setIsLoadingVectors(true);
    fetch("http://localhost:8000/debug/vectors")
      .then((r) => r.json())
      .then((data) => setPoints(data.points ?? []))
      .catch(() => setPoints([]))
      .finally(() => setIsLoadingVectors(false));
  }, [isOpen, activeTab, points.length]);

  // Reset cached data when the viewer is closed so the next open is fresh
  useEffect(() => {
    if (!isOpen) {
      setChunks([]);
      setPoints([]);
      setActiveTab("chunks");
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const TABS = [
    { id: "chunks", label: "Chunks" },
    { id: "vectors", label: "Vector Map" },
  ];

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Modal panel */}
      <div className="w-[740px] h-[620px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="bg-gray-900 text-white px-5 py-4 flex items-start justify-between shrink-0">
          <div>
            <h2 className="font-semibold text-sm tracking-tight">Index Viewer</h2>
            {uploadedDoc && (
              <p className="text-gray-400 text-xs mt-0.5">
                {uploadedDoc.filename}
                <span className="mx-1.5 text-gray-600">·</span>
                {uploadedDoc.chunk_count} chunks
                <span className="mx-1.5 text-gray-600">·</span>
                {uploadedDoc.page_count} pages
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors text-xl leading-none mt-0.5"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-gray-100 px-5 shrink-0 bg-white">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`py-3 px-1 mr-6 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-hidden p-5">
          {activeTab === "chunks" && (
            <ChunksTab chunks={chunks} isLoading={isLoadingChunks} />
          )}
          {activeTab === "vectors" && (
            <VectorMapTab points={points} isLoading={isLoadingVectors} />
          )}
        </div>
      </div>
    </div>
  );
}
