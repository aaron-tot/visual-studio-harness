import { join } from "node:path";
import { rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { copyRecursive } from "../features/mds/scope";

/** Typed move error carrying an HTTP status code for the REST layer. */
export class MoveError extends Error {
  constructor(
    message: string,
    public readonly code: 400 | 404 | 409,
  ) {
    super(message);
    this.name = "MoveError";
  }
}

export interface MoveScopedDirParams {
  name: string;
  fromDir: string;
  toDir: string;
}

/** Copy `fromDir/<name>` into `toDir/<name>` then remove the source. */
export async function moveScopedDir(
  params: MoveScopedDirParams,
): Promise<{ fromPath: string; toPath: string }> {
  const from = join(params.fromDir, params.name);
  const to = join(params.toDir, params.name);
  if (!existsSync(from)) {
    throw new MoveError(`"${params.name}" not found in source scope`, 404);
  }
  if (existsSync(to)) {
    throw new MoveError(`target already exists: "${params.name}"`, 409);
  }
  const tmp = join(params.toDir, `.${params.name}.tmp-${process.pid}`);
  try {
    await copyRecursive(from, tmp);
    await rename(tmp, to);
  } catch (err) {
    await rm(tmp, { recursive: true, force: true });
    throw err;
  }
  await rm(from, { recursive: true, force: true });
  return { fromPath: from, toPath: to };
}
