import { useState, useEffect, useRef } from "react";
import { useKnowledgeStore } from "./store";
import { EmptyState } from "../info-panel/components/ui";
import type { PlanScope } from "../info-panel/types";

export function KnowledgeTab({ scope }: { scope: PlanScope }) {
  const {
    documents,
    searchResults,
    loading,
    searching,
    uploading,
    error,
    fetchDocuments,
    search,
    deleteDocument,
    ingest,
    uploadFiles,
  } = useKnowledgeStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  useEffect(() => {
    fetchDocuments(scope);
  }, [fetchDocuments, scope]);

  const handleSearch = () => {
    if (!query.trim()) return;
    search(query.trim(), { scope });
    setShowSearch(true);
  };

  const handleClearSearch = () => {
    setQuery("");
    setShowSearch(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    uploadFiles(Array.from(files), scope);
    // Reset so same file can be picked again
    e.target.value = "";
  };

  const results = showSearch ? searchResults : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".md,.txt,.json,.yaml,.yml,.json5,.csv,.xml,.toml,.ini,.cfg,.conf,.env,.sh,.js,.ts,.jsx,.tsx,.css,.html,.py,.rb,.go,.rs,.java,.sql"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Search bar with add button */}
      <div className="p-3 border-b border-zinc-800/50 space-y-2">
        <div className="flex gap-1">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Search knowledge base..."
            className="flex-1 bg-zinc-800/50 border border-zinc-700/50 rounded px-2 py-1 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
          />
          <button
            onClick={handleSearch}
            disabled={searching || !query.trim()}
            className="px-2 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 rounded disabled:opacity-40 text-zinc-300"
          >
            {searching ? "..." : "Search"}
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="p-1 text-zinc-400 hover:text-zinc-200 disabled:opacity-40 hover:bg-zinc-700/50 rounded transition-colors"
            title={uploading ? "Uploading..." : "Add files to knowledge base"}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-4 h-4"
            >
              <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
            </svg>
          </button>
        </div>
        {showSearch && (
          <button
            onClick={handleClearSearch}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            &larr; Back to documents
          </button>
        )}
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="mx-3 mt-2 p-2 text-xs text-red-400 bg-red-900/20 rounded border border-red-800/30">
            {error}
          </div>
        )}

        {loading && (
          <div className="p-6 text-center text-sm text-zinc-500">Loading...</div>
        )}

        {!loading && !error && results !== null && results.length === 0 && (
          <EmptyState>No results found</EmptyState>
        )}

        {!loading && !error && results !== null && results.length > 0 && (
          <div className="p-3 space-y-2">
            <div className="text-xs text-zinc-500 mb-1">
              {results.length} result(s)
            </div>
            {results.map((r) => (
              <div
                key={r.chunkId}
                className="p-2 bg-zinc-800/30 rounded border border-zinc-700/30 text-xs"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-zinc-300 font-medium truncate">
                    {r.filename}
                  </span>
                  <span className="text-zinc-500 shrink-0">
                    [{r.score.toFixed(2)}]
                  </span>
                </div>
                {r.section && r.section !== "Document" && (
                  <div className="text-zinc-500 truncate mb-1">{r.section}</div>
                )}
                <div className="text-zinc-400 line-clamp-3">{r.content}</div>
              </div>
            ))}
          </div>
        )}

        {!loading && !error && results === null && documents.length === 0 && (
          <EmptyState>
            No documents yet. Add files to the knowledge sources directory or
            create a document.
          </EmptyState>
        )}

        {!loading && !error && results === null && documents.length > 0 && (
          <div className="p-3 space-y-1">
            {documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between p-2 bg-zinc-800/20 rounded text-xs hover:bg-zinc-800/40 group"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-zinc-300 truncate">{doc.filename}</div>
                  <div className="text-zinc-500 mt-0.5">
                    {doc.status}
                    {doc.tags.length > 0 && ` \u00b7 ${doc.tags.join(", ")}`}
                    {doc.chunkCount > 0 && ` \u00b7 ${doc.chunkCount} chunk(s)`}
                  </div>
                </div>
                <button
                  onClick={() => deleteDocument(doc.id, { scope })}
                  className="text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity ml-2 shrink-0"
                  title="Delete"
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bottom actions */}
      <div className="p-3 border-t border-zinc-800/50">
        <button
          onClick={() => ingest(scope)}
          disabled={loading}
          className="w-full px-3 py-1.5 text-xs bg-zinc-700 hover:bg-zinc-600 rounded disabled:opacity-40 text-zinc-300"
        >
          {loading ? "Re-indexing..." : "Re-index sources"}
        </button>
      </div>
    </div>
  );
}
