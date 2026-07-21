/**
 * TUI multi-select checklist using raw terminal input.
 *
 * Usage:
 *   tui-multiselect.ts "Item 1" "Item 2" ...
 *
 * Outputs comma-separated 1-based indices to stdout.
 * Empty string if nothing selected or cancelled.
 */

import tty from "node:tty";
import { isatty } from "node:tty";
import { openSync } from "node:fs";
import { WriteStream } from "node:tty";

const stdinFd = process.stdin.fd;
if (!isatty(stdinFd)) {
  process.stderr.write("TTY required\n");
  process.exit(1);
}
const stdin = new tty.ReadStream(stdinFd);
const ttyFd = openSync("/dev/tty", "w");
const ttyOut = new WriteStream(ttyFd);

const items = process.argv.slice(2);
if (items.length === 0) process.exit(0);

let cursor = 0;
const selected = new Set<number>();

function render() {
  ttyOut.write("\x1B[2J\x1B[H");
  ttyOut.write("  Select categories to clone\n\n");
  for (let i = 0; i < items.length; i++) {
    const check = selected.has(i) ? "●" : "○";
    const pointer = i === cursor ? "›" : " ";
    ttyOut.write(`  ${pointer} ${check} ${items[i]}\n`);
  }
  ttyOut.write("\n  ↑↓ navigate · Space toggle · Enter confirm · Ctrl+C cancel\n");
}

function cleanup() {
  ttyOut.write("\x1B[2J\x1B[H");
  stdin.setRawMode(false);
  stdin.pause();
  stdin.destroy();
  ttyOut.destroy();
}

stdin.setRawMode(true);
stdin.resume();
stdin.setEncoding("utf-8");
render();

stdin.on("data", (key: string) => {
  if (key === "\x1B[A" || key === "k") {
    cursor = cursor > 0 ? cursor - 1 : items.length - 1;
    render();
    return;
  }
  if (key === "\x1B[B" || key === "j") {
    cursor = cursor < items.length - 1 ? cursor + 1 : 0;
    render();
    return;
  }
  if (key === " ") {
    if (selected.has(cursor)) selected.delete(cursor);
    else selected.add(cursor);
    render();
    return;
  }
  if (key === "\r" || key === "\n") {
    cleanup();
    const result = [...selected].sort((a, b) => a - b).map((i) => String(i + 1)).join(",");
    process.stdout.write(result);
    process.exit(0);
  }
  if (key === "\u0003") {
    cleanup();
    process.exit(0);
  }
});
