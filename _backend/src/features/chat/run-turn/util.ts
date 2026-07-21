import { randomUUID } from "node:crypto";

export function generateId(): string {
  const now = new Date();
  const date = now.toISOString().split("T")[0];
  const time = now.toTimeString().split(" ")[0].replace(/:/g, "-");
  return `${date}_${time}_${randomUUID().slice(0, 6)}`;
}

export function autoTitle(content: string): string {
  return content.slice(0, 60).replace(/[^\w\s-]/g, "").trim() || "New Chat";
}

export function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String((err as { name?: string }).name) : "";
  return name === "AbortError";
}
