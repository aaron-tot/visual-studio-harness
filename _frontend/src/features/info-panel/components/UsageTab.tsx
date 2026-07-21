import { UsageTree } from "./usage/UsageTree";

export function UsageTab() {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="px-3 py-1.5 text-[9px] text-amber-700/80 italic">
        FAKE data — not live
      </div>
      <div className="px-3 pb-1.5 text-[9px] text-zinc-600">
        tokens: own (incl) · model/provider: main (other) or main (many) — hover lists all
      </div>
      <UsageTree />
    </div>
  );
}
