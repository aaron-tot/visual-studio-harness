import { useState, useEffect, useRef } from "react";
import { ExternalLink, Loader2, LogOut, Check } from "lucide-react";
import { xaiOAuthDevice, xaiOAuthStatus, xaiOAuthLoggedIn, xaiOAuthDisconnect } from "../../lib/api";

/**
 * Account-based login for the Grok (xAI) provider using RFC 8628
 * device-authorization. Lets a SuperGrok subscriber authenticate without
 * needing prepaid per-team API credits.
 */
export function GrokOAuthPanel() {
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [device, setDevice] = useState<{ verification_uri: string; user_code: string } | null>(null);
  const [status, setStatus] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    loadStatus();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const loadStatus = async () => {
    try {
      const r = await xaiOAuthLoggedIn();
      setLoggedIn(r.loggedIn);
    } catch {
      setLoggedIn(false);
    }
  };

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  };

  const startLogin = async () => {
    setBusy(true);
    setError(null);
    setStatus("");
    try {
      const r = await xaiOAuthDevice();
      if (!r.ok || !r.verification_uri || !r.user_code) {
        setError(r.error || "Failed to start login");
        setBusy(false);
        return;
      }
      setDevice({ verification_uri: r.verification_uri, user_code: r.user_code });
      setStatus("pending");
      // Long-poll the backend until the browser completes authorization.
      pollRef.current = setInterval(async () => {
        try {
          const s = await xaiOAuthStatus();
          setStatus(s.status);
          if (s.status === "authorized") {
            stopPolling();
            setLoggedIn(true);
            setDevice(null);
            setBusy(false);
          } else if (s.status === "denied" || s.status === "expired" || s.status === "error") {
            stopPolling();
            setError(s.error || `Login ${s.status}`);
            setDevice(null);
            setBusy(false);
          }
        } catch {
          // transient polling error — keep waiting
        }
      }, 4000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  const disconnect = async () => {
    stopPolling();
    await xaiOAuthDisconnect();
    setLoggedIn(false);
    setDevice(null);
    setStatus("");
    setError(null);
  };

  const openBrowser = () => {
    if (device?.verification_uri) window.open(device.verification_uri, "_blank", "noopener,noreferrer");
  };

  const polling = device !== null && !loggedIn;

  return (
    <div className="space-y-2 rounded border border-zinc-700/60 p-3 bg-zinc-800/40">
      {loggedIn === true ? (
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm text-green-400">
            <Check size={14} /> Connected to your xAI account
          </div>
          <button
            onClick={disconnect}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-red-400 transition-colors"
          >
            <LogOut size={12} /> Disconnect
          </button>
        </div>
      ) : (
        <>
          {polling ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-zinc-300">
                <Loader2 size={14} className="animate-spin" />
                Waiting for authorization...
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={openBrowser}
                  className="flex items-center gap-1.5 rounded bg-zinc-700 hover:bg-zinc-600 px-3 py-1.5 text-sm text-zinc-100"
                >
                  <ExternalLink size={13} /> Open verification page
                </button>
                <span className="text-sm text-zinc-400">
                  Enter code: <code className="font-mono font-semibold text-amber-300">{device?.user_code}</code>
                </span>
              </div>
              <p className="text-[11px] text-zinc-500">Status: {status}</p>
              <button
                onClick={disconnect}
                className="text-xs text-zinc-500 hover:text-zinc-300"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-zinc-400">
                Sign in with your xAI account to use Grok with your SuperGrok subscription.
              </p>
              <button
                onClick={startLogin}
                disabled={busy}
                className="flex items-center justify-center gap-1.5 rounded bg-zinc-700 hover:bg-zinc-600 disabled:opacity-50 w-full px-3 py-2 text-sm font-medium text-zinc-100"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <ExternalLink size={14} />}
                Sign in with SuperGrok
              </button>
            </div>
          )}
          {error && <p className="text-xs text-red-400 break-words whitespace-pre-wrap">{error}</p>}
        </>
      )}
    </div>
  );
}
