import type { Components } from "react-markdown";

/** Shared element overrides for chat markdown (assistant messages). */
export const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="mt-4 mb-2 text-lg font-semibold text-zinc-100 first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-3 mb-1.5 text-base font-semibold text-zinc-100 first:mt-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-3 mb-1 text-sm font-semibold text-zinc-200 first:mt-0">{children}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mt-2 mb-1 text-sm font-medium text-zinc-200 first:mt-0">{children}</h4>
  ),
  p: ({ children }) => (
    <p data-testid="assistant-text" className="my-2 text-sm leading-relaxed text-zinc-300 first:mt-0 last:mb-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="my-2 list-disc space-y-1 pl-5 text-sm text-zinc-300">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5 text-sm text-zinc-300">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed marker:text-zinc-500">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-zinc-100">{children}</strong>,
  em: ({ children }) => <em className="italic text-zinc-300">{children}</em>,
  a: ({ href, children, ...props }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-400 underline underline-offset-2 hover:text-blue-300"
      {...props}
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-zinc-600 pl-3 text-sm text-zinc-400 italic">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-3 border-zinc-700" />,
  code: ({ className, children, ...props }) => {
    const isBlock = Boolean(className?.includes("language-")) || String(children).includes("\n");
    if (isBlock) {
      return (
        <code className={`${className ?? ""} font-mono text-[12px] text-zinc-200`} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded bg-zinc-900 px-1 py-0.5 font-mono text-[12px] text-amber-200/90"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-md border border-zinc-700 bg-zinc-950 p-3 text-[12px] leading-relaxed">
      {children}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs text-zinc-300">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-zinc-700 text-zinc-200">{children}</thead>,
  th: ({ children }) => <th className="px-2 py-1.5 font-medium">{children}</th>,
  td: ({ children }) => (
    <td className="border-t border-zinc-800 px-2 py-1.5 align-top">{children}</td>
  ),
};
