// Barrel shim — Phase 2 refactor moved logic to features/chat/.
// Remove this file after all call sites are updated.
export { useChatStore } from "../features/chat/index";
export type { ChatState } from "../features/chat/types";
