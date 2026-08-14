#!/usr/bin/env bun
/**
 * Increment the patch version across all version-bearing files, preserving
 * each file's formatting.
 *
 * Supported formats:
 *   - package.json:      "version": "0.0.1-alpha"
 *   - _shared/version.ts: VERSION = "0.0.1-alpha"
 *
 * Usage: bun scripts/hooks/increment-version.ts [file ...]
 *   With no args, defaults to ./package.json.
 *   Prints the new version to stdout (from the first file bumped).
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

const DEFAULT_FILES = [resolve("./package.json"), resolve("./_shared/version.ts")];
const paths = process.argv.length > 2 ? process.argv.slice(2).map((p) => resolve(p)) : DEFAULT_FILES;

// JSON style:  "version": "X"          (captures the version value)
// TS style:    VERSION = "X"           (captures the version value)
const JSON_RE = /("version"\s*:\s*")([^"]+)(")/;
const TS_RE = /(VERSION\s*=\s*")([^"]+)(")/;

/** Increment the last numeric segment; preserve any pre-release suffix. */
function increment(version: string): string | null {
  const m = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/);
  if (!m) return null;
  const patch = parseInt(m[3], 10) + 1;
  return `${m[1]}.${m[2]}.${patch}${m[4] ? `-${m[4]}` : ""}`;
}

let next: string | null = null;

for (const filePath of paths) {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch (err) {
    console.error(`increment-version: cannot read ${filePath}: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  // Detect the format present in this file.
  const jsonMatch = content.match(JSON_RE);
  const tsMatch = content.match(TS_RE);
  const kind = jsonMatch ? "json" : tsMatch ? "ts" : null;
  const match = jsonMatch ?? tsMatch;

  if (!kind || !match) {
    console.error(`increment-version: no version field found in ${filePath}`);
    process.exit(1);
  }

  const current = match[2];
  const bumped = increment(current);
  if (!bumped) {
    console.error(`increment-version: invalid version format: ${current}`);
    process.exit(1);
  }

  if (next === null) next = bumped;

  // Only rewrite when the version *changes* (keeps files in sync idempotently).
  if (current !== bumped) {
    // Rebuild: prefix group + bumped value + trailing group, preserving quotes.
    const replacement = kind === "json"
      ? `${match[1]}${bumped}${match[3]}`
      : `${match[1]}${bumped}${match[3]}`;
    writeFileSync(filePath, content.replace(match[0], replacement));
  }
}

console.log(next ?? "unknown");
