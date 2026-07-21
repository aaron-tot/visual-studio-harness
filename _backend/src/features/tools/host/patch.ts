import { readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import { atomicWriteFile } from "./atomic-write";
import { SandboxError } from "../sandbox";

/**
 * Minimal OpenCode-style patch format:
 * *** Add File: path
 * contents...
 * *** Update File: path
 * <<<<<<< SEARCH
 * old
 * =======
 * new
 * >>>>>>> REPLACE
 * *** Delete File: path
 */
export async function applyPatchText(
  _workspaceRoot: string,
  patchText: string,
  resolvePath: (userPath: string) => Promise<string>
): Promise<{ touched: string[]; summary: string }> {
  const lines = patchText.replace(/\r\n/g, "\n").split("\n");
  const touched: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("*** Add File:")) {
      const rel = line.slice("*** Add File:".length).trim();
      i++;
      const contentLines: string[] = [];
      while (i < lines.length && !lines[i].startsWith("*** ")) {
        contentLines.push(lines[i]);
        i++;
      }
      // drop single trailing empty line from split artifact
      let content = contentLines.join("\n");
      if (!content.endsWith("\n") && contentLines.length > 0) content += "\n";
      const abs = await resolvePath(rel);
      await mkdir(dirname(abs), { recursive: true });
      await atomicWriteFile(abs, content);
      touched.push(rel);
      continue;
    }

    if (line.startsWith("*** Delete File:")) {
      const rel = line.slice("*** Delete File:".length).trim();
      i++;
      const abs = await resolvePath(rel);
      try {
        await unlink(abs);
      } catch (err: unknown) {
        const code = err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : "";
        if (code !== "ENOENT") throw err;
      }
      touched.push(rel);
      continue;
    }

    if (line.startsWith("*** Update File:")) {
      const rel = line.slice("*** Update File:".length).trim();
      i++;
      const abs = await resolvePath(rel);
      let fileText: string;
      try {
        fileText = await readFile(abs, "utf-8");
      } catch {
        throw new SandboxError(`ERROR apply_patch: update target not found: ${rel}`);
      }

      while (i < lines.length && !lines[i].startsWith("*** ")) {
        if (lines[i].trim() === "<<<<<<< SEARCH") {
          i++;
          const searchLines: string[] = [];
          while (i < lines.length && lines[i].trim() !== "=======") {
            searchLines.push(lines[i]);
            i++;
          }
          if (i >= lines.length || lines[i].trim() !== "=======") {
            throw new SandboxError(`ERROR apply_patch: missing ======= in update for ${rel}`);
          }
          i++; // skip =======
          const replaceLines: string[] = [];
          while (i < lines.length && lines[i].trim() !== ">>>>>>> REPLACE") {
            if (lines[i].startsWith("*** ")) break;
            replaceLines.push(lines[i]);
            i++;
          }
          if (i >= lines.length || lines[i].trim() !== ">>>>>>> REPLACE") {
            throw new SandboxError(`ERROR apply_patch: missing >>>>>>> REPLACE in update for ${rel}`);
          }
          i++; // skip REPLACE marker

          const search = searchLines.join("\n");
          const replace = replaceLines.join("\n");
          if (!search) {
            throw new SandboxError(`ERROR apply_patch: empty SEARCH block for ${rel}`);
          }
          const count = countOccurrences(fileText, search);
          if (count !== 1) {
            throw new SandboxError(
              `ERROR apply_patch: SEARCH matched ${count} times in ${rel} (need exactly 1). Expand unique context.`
            );
          }
          fileText = fileText.replace(search, replace);
        } else {
          // skip blank lines between hunks
          i++;
        }
      }

      await atomicWriteFile(abs, fileText);
      touched.push(rel);
      continue;
    }

    // skip unknown / blank
    i++;
  }

  if (touched.length === 0) {
    throw new SandboxError(
      "ERROR apply_patch: no operations found. Use *** Add File: / *** Update File: / *** Delete File:"
    );
  }

  return {
    touched,
    summary: `Applied patch to ${touched.length} path(s): ${touched.join(", ")}`,
  };
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let pos = 0;
  while (true) {
    const idx = haystack.indexOf(needle, pos);
    if (idx === -1) break;
    count++;
    pos = idx + needle.length;
  }
  return count;
}
