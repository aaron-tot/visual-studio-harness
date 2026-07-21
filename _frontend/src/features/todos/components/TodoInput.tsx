import { useState } from "react";

interface Props {
  onAdd: (content: string) => void;
  placeholder?: string;
}

export function TodoInput({ onAdd, placeholder = "Add a task…" }: Props) {
  const [text, setText] = useState("");

  const submit = () => {
    const v = text.trim();
    if (!v) return;
    onAdd(v);
    setText("");
  };

  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={placeholder}
        className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
      />
      <button
        type="button"
        onClick={submit}
        className="shrink-0 rounded-md bg-zinc-100 px-2.5 py-1.5 text-xs font-medium text-zinc-900 hover:bg-white"
      >
        Add
      </button>
    </div>
  );
}
