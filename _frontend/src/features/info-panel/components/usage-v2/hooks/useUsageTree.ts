import { useEffect, useState, useCallback, useRef } from "react";
import { getUsageTree } from "../../../../../lib/api";
import { wsClient } from "../../../../../lib/ws";
import type { UsageTreeSession } from "../types";

export interface UsageTreeState {
  data: UsageTreeSession | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * Load live usage tree for a session.
 * Refetches when sessionId changes and when the turn finishes (done/error WS).
 */
export function useUsageTree(sessionId: string | null): UsageTreeState {
  const [data, setData] = useState<UsageTreeSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const fetchTree = useCallback((opts?: { silent?: boolean }) => {
    const sid = sessionIdRef.current;
    if (!sid) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    if (!opts?.silent) {
      setLoading(true);
      setError(null);
    }
    getUsageTree(sid)
      .then((tree) => {
        if (sessionIdRef.current !== sid) return;
        setData(tree);
        setLoading(false);
        setError(null);
      })
      .catch((err: unknown) => {
        if (sessionIdRef.current !== sid) return;
        const msg = err instanceof Error ? err.message : "unknown error";
        setError(msg);
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetchTree();
  }, [sessionId, fetchTree]);

  // Refresh after turn completes so own/incl stay current
  useEffect(() => {
    if (!sessionId) return;

    const onDone = (msg: { sessionId?: string }) => {
      if (msg?.sessionId === sessionId) fetchTree({ silent: true });
    };
    const onError = (msg: { sessionId?: string }) => {
      if (msg?.sessionId === sessionId) fetchTree({ silent: true });
    };
    // tool_end: subagent / tool finished under parent (payload has no toolName)
    const onToolEnd = (msg: { sessionId?: string }) => {
      if (msg?.sessionId === sessionId) fetchTree({ silent: true });
    };

    wsClient.on("done", onDone as (d: unknown) => void);
    wsClient.on("error", onError as (d: unknown) => void);
    wsClient.on("tool_end", onToolEnd as (d: unknown) => void);
    return () => {
      wsClient.off("done", onDone as (d: unknown) => void);
      wsClient.off("error", onError as (d: unknown) => void);
      wsClient.off("tool_end", onToolEnd as (d: unknown) => void);
    };
  }, [sessionId, fetchTree]);

  return { data, loading, error, refresh: () => fetchTree() };
}
