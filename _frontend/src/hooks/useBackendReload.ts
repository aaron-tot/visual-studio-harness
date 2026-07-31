import { useEffect } from "react";

const STORAGE_KEY = "vsh-backend-started-at";

export function useBackendReload(): void {
  useEffect(() => {
    if (import.meta.env.PROD) return;

    let interval: ReturnType<typeof setInterval>;

    const checkReload = async () => {
      try {
        const res = await fetch("/api/reload-signal", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { startedAt?: number };
        if (typeof data.startedAt !== "number") return;

        const prev = localStorage.getItem(STORAGE_KEY);
        const startedAt = String(data.startedAt);
        if (prev !== null && prev !== startedAt) {
          localStorage.setItem(STORAGE_KEY, startedAt);
          window.location.reload();
          return;
        }
        localStorage.setItem(STORAGE_KEY, startedAt);
      } catch {
        // Backend may be restarting — ignore and try again next tick.
      }
    };

    interval = setInterval(checkReload, 1500);
    checkReload();

    return () => clearInterval(interval);
  }, []);
}
