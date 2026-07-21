import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function PanelSectionTitle({ children }: { children: ReactNode }) {
  return (
    <div className="text-xs font-semibold text-zinc-400 flex items-center gap-1">
      {children}
    </div>
  );
}

export function PanelInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`w-full text-[11px] bg-zinc-800 text-zinc-200 px-2 py-1.5 rounded outline-none placeholder-zinc-600 ${props.className ?? ""}`}
    />
  );
}

export function PanelButton({
  active,
  className = "",
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      className={`text-[10px] px-2 py-1 rounded transition-colors disabled:opacity-40 ${
        active
          ? "bg-zinc-700 text-zinc-200"
          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
      } ${className}`}
    >
      {children}
    </button>
  );
}

export function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`text-[11px] px-2.5 py-1 rounded transition-colors font-medium ${
        active
          ? "bg-zinc-700 text-zinc-200"
          : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
      }`}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 flex items-center justify-center px-3">
      <p className="text-[11px] text-zinc-600 text-center leading-relaxed">{children}</p>
    </div>
  );
}

export function ResultBanner({ result }: { result: string | null }) {
  if (!result) return null;
  const isError = result.startsWith("Error");
  return (
    <div
      className={`text-[10px] break-all ${isError ? "text-red-500" : "text-emerald-500"}`}
    >
      {result}
    </div>
  );
}

export function MiniAction({
  active,
  children,
  onClick,
  title,
}: {
  active?: boolean;
  children: ReactNode;
  onClick: (e: React.MouseEvent) => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      className={`text-[9px] px-1.5 py-0.5 rounded transition-colors ${
        active
          ? "bg-amber-800 text-amber-300"
          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
      }`}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
    >
      {children}
    </button>
  );
}
