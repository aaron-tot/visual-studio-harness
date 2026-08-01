import { resolve, dirname } from "node:path";

const projectRoot = resolve(dirname(new URL(import.meta.url).pathname), "..");

async function findPids(cmdPattern: string): Promise<number[]> {
  try {
    const proc = Bun.spawn(["pgrep", "-f", cmdPattern]);
    const output = await new Response(proc.stdout).text();
    return output.trim().split("\n").filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

for (const pattern of [`nodemon.*${projectRoot}`, `vite.*${projectRoot}`]) {
  const pids = await findPids(pattern);
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
      console.log(`Killed stale process ${pid}`);
    } catch { /* already gone */ }
  }
}
