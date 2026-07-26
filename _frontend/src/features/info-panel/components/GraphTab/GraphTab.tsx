import { useState } from "react";
import { TabButton } from "../ui";
import { StatusView } from "./StatusView";
import { TreeView } from "./TreeView";
import { FilesView } from "./FilesView";
import { SymbolsView } from "./SymbolsView";
import { DepsView } from "./DepsView";

type GraphSubTab = "status" | "tree" | "files" | "symbols" | "deps";

export function GraphTab() {
  const [subTab, setSubTab] = useState<GraphSubTab>("status");

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex gap-1 px-2 py-1 border-b border-zinc-800/50 flex-wrap">
        <TabButton active={subTab === "status"} onClick={() => setSubTab("status")}>
          Status
        </TabButton>
        <TabButton active={subTab === "tree"} onClick={() => setSubTab("tree")}>
          Tree
        </TabButton>
        <TabButton active={subTab === "files"} onClick={() => setSubTab("files")}>
          Files
        </TabButton>
        <TabButton active={subTab === "symbols"} onClick={() => setSubTab("symbols")}>
          Symbols
        </TabButton>
        <TabButton active={subTab === "deps"} onClick={() => setSubTab("deps")}>
          Deps
        </TabButton>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto">
        {subTab === "status" && <StatusView />}
        {subTab === "tree" && <TreeView />}
        {subTab === "files" && <FilesView />}
        {subTab === "symbols" && <SymbolsView />}
        {subTab === "deps" && <DepsView />}
      </div>
    </div>
  );
}
