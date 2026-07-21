import { useState, useEffect, useRef } from "react";
import { wsClient } from "./ws";

const WS_POLL_MS = 500;
const HEALTH_POLL_MS = 5000;
const GRACE_MS = 3000;
const HEALTH_API = "/api/health";

export function useConnectionStatus() {
  const [connected, setConnected] = useState(false);
  const [showBanner, setShowBanner] = useState(false);
  const wsDisconnectedSince = useRef<number | null>(null);
  const httpHealthy = useRef(true);

  useEffect(() => {
    const httpCheck = async () => {
      try {
        const res = await fetch(HEALTH_API);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        httpHealthy.current = true;
      } catch {
        httpHealthy.current = false;
      }
    };

    httpCheck();
    const httpTimer = setInterval(httpCheck, HEALTH_POLL_MS);
    return () => clearInterval(httpTimer);
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const wsOk = wsClient.connected;
      const wsEverConnected = wsClient.hadOpen;
      const httpOk = httpHealthy.current;

      const reallyConnected = wsOk && httpOk;
      setConnected(reallyConnected);

      if (reallyConnected) {
        wsDisconnectedSince.current = null;
        if (showBanner) setShowBanner(false);
      } else {
        if (!wsEverConnected) return;

        if (wsDisconnectedSince.current === null) {
          wsDisconnectedSince.current = Date.now();
        } else if (Date.now() - wsDisconnectedSince.current > GRACE_MS && !showBanner) {
          setShowBanner(true);
        }
      }
    }, WS_POLL_MS);
    return () => clearInterval(interval);
  }, [showBanner]);

  return { connected, showBanner };
}
