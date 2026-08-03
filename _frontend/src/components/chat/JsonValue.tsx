export function JsonValue({ value, indent = 0 }: { value: unknown; indent?: number }) {
  if (value === null) return <span className="text-zinc-500">null</span>;
  if (value === undefined) return <span className="text-zinc-500">undefined</span>;
  if (typeof value === "string") return <span className="text-emerald-400">"{value}"</span>;
  if (typeof value === "number") return <span className="text-amber-400">{value}</span>;
  if (typeof value === "boolean") return <span className="text-purple-400">{String(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-zinc-500">[]</span>;
    const pad = "  ".repeat(indent + 1);
    const closePad = "  ".repeat(indent);
    return (
      <span>
        <span className="text-zinc-400">[</span>
        {"\n"}
        {value.map((item, i) => (
          <span key={i}>
            {pad}
            <JsonValue value={item} indent={indent + 1} />
            {i < value.length - 1 ? "," : ""}
            {"\n"}
          </span>
        ))}
        {closePad}
        <span className="text-zinc-400">]</span>
      </span>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-zinc-500">{"{}"}</span>;
    const pad = "  ".repeat(indent + 1);
    const closePad = "  ".repeat(indent);
    return (
      <span>
        <span className="text-zinc-400">{"{"}</span>
        {"\n"}
        {entries.map(([key, val], i) => (
          <span key={key}>
            {pad}
            <span className="text-blue-300">"{key}"</span>
            <span className="text-zinc-400">: </span>
            <JsonValue value={val} indent={indent + 1} />
            {i < entries.length - 1 ? "," : ""}
            {"\n"}
          </span>
        ))}
        {closePad}
        <span className="text-zinc-400">{"}"}</span>
      </span>
    );
  }
  return <span className="text-zinc-300">{String(value)}</span>;
}
