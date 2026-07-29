/**
 * Memory pressure logging utility.
 * Logs process.memoryUsage() at key points so growth trajectory is visible in logs.
 */

export function logMemory(label: string): void {
  try {
    const usage = process.memoryUsage();
    const rssMB = (usage.rss / 1024 / 1024).toFixed(1);
    const heapMB = (usage.heapUsed / 1024 / 1024).toFixed(1);
    const externalMB = (usage.external / 1024 / 1024).toFixed(1);
    console.log(`[memory] ${label} — RSS: ${rssMB} MB, Heap: ${heapMB} MB, External: ${externalMB} MB`);
  } catch {
    // memoryUsage() should never throw, but guard against platform issues
  }
}
