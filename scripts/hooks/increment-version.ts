#!/usr/bin/env bun
/**
 * Increment the patch version in package.json (targeted line replacement,
 * preserving all other formatting).
 *
 * Usage: bun scripts/hooks/increment-version.ts [path-to-package.json]
 * Prints the new version to stdout.
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const pkgPath = process.argv[2] ? resolve(process.argv[2]) : resolve("./package.json");

// Matches `"version": "..."` and captures the version value
const VERSION_RE = /"version"\s*:\s*"([^"]+)"/;

/** Increment the last numeric segment; preserve any pre-release suffix. */
function increment(version: string): string | null {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!m) return null;
  const patch = parseInt(m[3], 10) + 1;
  return `${m[1]}.${m[2]}.${patch}${m[4] ? `-${m[4]}` : ""}`;
}

let content: string;
try {
  content = readFileSync(pkgPath, "utf-8");
} catch (err) {
  console.error(`increment-version: cannot read ${pkgPath}: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}

const match = content.match(VERSION_RE);
if (!match) {
  console.error(`increment-version: no "version" field found in ${pkgPath}`);
  process.exit(1);
}

const current = match[1];
const next = increment(current);
if (!next) {
  console.error(`increment-version: invalid version format: ${current}`);
  process.exit(1);
}

writeFileSync(pkgPath, content.replace(match[0], `"version": "${next}"`));
console.log(next);
