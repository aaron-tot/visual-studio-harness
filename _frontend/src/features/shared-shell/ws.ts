/** Side-effect: register shared-shell WS handlers for the lifetime of the app. */
import { initSharedShellWs } from "./store";

// Register once at module load. Handlers reference the store by getState/setState
// which are stable, so the cleanup is intentionally not called (app-wide lifetime).
initSharedShellWs();
