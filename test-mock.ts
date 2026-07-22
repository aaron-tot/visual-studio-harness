import { actions as toolsV2Actions } from "./_backend/src/llm/mock-models/toolsV2.ts";
import { executeActions } from "./_backend/src/llm/mock-models/shared.ts";

console.log("Total actions:", toolsV2Actions.length);

let count = 0;
for await (const event of executeActions(toolsV2Actions, 1)) {
  count++;
  console.log(`Event ${count}:`, event.type, event.toolCallId || event.toolName || event.finishReason || "");
}
console.log("Total events:", count);