const port = parseInt(process.argv[2] || "3001", 10);

async function killPort(port: number): Promise<void> {
  try {
    const proc = Bun.spawn(["lsof", "-ti", `:${port}`]);
    const output = await new Response(proc.stdout).text();
    const pids = output.trim().split("\n").filter(Boolean);
    for (const pid of pids) {
      process.kill(parseInt(pid, 10), "SIGTERM");
      console.log(`Killed process ${pid} on port ${port}`);
    }
  } catch {
    // No process on this port — nothing to do
  }
}

await killPort(port);
