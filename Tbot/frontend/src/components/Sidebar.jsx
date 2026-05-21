const PROVIDER_COLORS = {
  gemini: "bg-blue-500",
  anthropic: "bg-orange-500",
};

export default function Sidebar({ provider, onProviderChange }) {
  return (
    <aside className="w-64 bg-gray-900 text-white flex flex-col p-5 gap-6 shrink-0">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Tbot</h1>
        <p className="text-gray-400 text-xs mt-1">AI Chat Assistant</p>
      </div>

      <div className="flex flex-col gap-2">
        <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          Provider
        </label>
        <select
          value={provider}
          onChange={(e) => onProviderChange(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
        >
          <option value="anthropic">Anthropic</option>
          <option value="gemini">Gemini</option>
        </select>

        <div className="flex items-center gap-2 mt-1">
          <span
            className={`w-2 h-2 rounded-full ${PROVIDER_COLORS[provider]}`}
          />
          <span className="text-xs text-gray-400">
            Using{" "}
            <span className="text-white font-medium capitalize">{provider}</span>
          </span>
        </div>
      </div>

      <div className="mt-auto text-xs text-gray-600">
        Keys loaded from <code className="text-gray-500">.env</code>
      </div>
    </aside>
  );
}
