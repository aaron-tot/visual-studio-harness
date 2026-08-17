import type { FastifyInstance } from "fastify";
import {
  initXaiOAuth,
  requestDeviceCode,
  pollDeviceCode,
  getXaiAccessToken,
  hasXaiLogin,
  clearXaiTokens,
  type XaiDeviceCodeResponse,
} from "../features/oauth/xai";

/**
 * REST surface for the xAI (Grok) account-based login lifecycle.
 *
 * Flow: GET /api/oauth/xai/device → returns verification_uri + user_code.
 * The user opens the URL and approves in a browser (handled by the frontend).
 * GET /api/oauth/xai/status?device=... → poll until authorized/denied/expired.
 * DELETE /api/oauth/xai → disconnect (clear stored tokens).
 */
export function registerOAuthRoutes(app: FastifyInstance, dataDir: string): void {
  initXaiOAuth(dataDir);

  /** Model the current device-code response so status polling can advance it. */
  let activeDevice: XaiDeviceCodeResponse | null = null;

  app.get("/api/oauth/xai/device", async (request, reply) => {
    try {
      activeDevice = await requestDeviceCode();
      const url = activeDevice.verification_uri_complete ?? activeDevice.verification_uri;
      return {
        ok: true,
        verification_uri: url,
        user_code: activeDevice.user_code,
        expires_in: activeDevice.expires_in,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(502).send({ ok: false, error: msg });
    }
  });

  app.get("/api/oauth/xai/status", async (request, reply) => {
    if (!activeDevice) {
      return { ok: true, status: "none", loggedIn: await hasXaiLogin() };
    }
    const result = await pollDeviceCode(activeDevice);
    if (result.status === "authorized") {
      activeDevice = null;
      return { ok: true, status: "authorized", loggedIn: true };
    }
    if (result.status === "denied" || result.status === "expired" || result.status === "error") {
      activeDevice = null;
      return { ok: true, status: result.status, loggedIn: false, error: result.error };
    }
    // pending / slow_down / authorization_pending — keep the active device.
    return { ok: true, status: result.status, loggedIn: false };
  });

  app.get("/api/oauth/xai/logged-in", async () => {
    return { ok: true, loggedIn: await hasXaiLogin() };
  });

  app.delete("/api/oauth/xai", async () => {
    await clearXaiTokens();
    activeDevice = null;
    return { ok: true, loggedIn: false };
  });

  app.post("/api/oauth/xai/refresh", async () => {
    const token = await getXaiAccessToken();
    return { ok: token !== null, loggedIn: token !== null };
  });
}
