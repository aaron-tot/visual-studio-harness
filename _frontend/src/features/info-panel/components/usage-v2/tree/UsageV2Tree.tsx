import { SessionNode } from "./SessionNode";
import { UsageCharts } from "../cost/UsageCharts";
import type { UsageTreeSession } from "../types";

export function UsageV2Tree({
  session,
}: {
  session: UsageTreeSession;
}) {
  return (
    <div className="py-1">
      <UsageCharts session={session} />
      <SessionNode session={session} depth={0} />
    </div>
  );
}
