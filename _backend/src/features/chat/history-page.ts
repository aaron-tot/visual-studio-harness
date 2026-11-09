import { and, desc, eq, lt } from "drizzle-orm";
import { getDb, getDbForDataDir } from "../../db/client";
import { turns } from "../../db/schema";
import { CHAT_HISTORY_PAGE, isCountedBubble, type ChatHistoryWindow } from "../../../../_shared/chat-history";
import { projectTurnRows, turnChatCols, type TurnChatRow } from "./project-chat";

function dbFor(dataDir?: string) {
  return dataDir ? getDbForDataDir(dataDir) : getDb();
}

/** Turns for a session ordered newest → oldest, optionally bounded below by `beforeTurnNumber` (exclusive). */
function fetchTurnChatRowsDesc(
  db: ReturnType<typeof dbFor>,
  sessionId: string,
  beforeTurnNumber: number | null,
  limit: number
): TurnChatRow[] {
  const where =
    beforeTurnNumber == null
      ? eq(turns.sessionId, sessionId)
      : and(eq(turns.sessionId, sessionId), lt(turns.turnNumber, beforeTurnNumber));
  return db
    .select(turnChatCols)
    .from(turns)
    .where(where)
    .orderBy(desc(turns.turnNumber))
    .limit(limit)
    .all() as TurnChatRow[];
}

/**
 * Windowed chat projection: return the newest `limit` NON-ERROR message bubbles
 * (or, when `beforeTurnNumber` is set, the page of whole turns immediately older
 * than that cursor). Pages are built from whole turns so a turn's user/assistant
 * pair (and a summary's marker+user+assistant trio) is never split. Error
 * bubbles are still delivered but do not consume the bubble budget.
 *
 * `cursor` is the real DB turn_number of the oldest included turn — pass it back
 * as `beforeTurnNumber` to fetch the next older page.
 */
export function projectSessionChatPage(
  sessionId: string,
  opts: { limit?: number; beforeTurnNumber?: number | null; dataDir?: string } = {}
): ChatHistoryWindow {
  const limit = opts.limit ?? CHAT_HISTORY_PAGE;
  const db = dbFor(opts.dataDir);
  // Over-fetch sized so one chunk almost always covers `limit` bubbles even when
  // recent turns are errors; scan another chunk only if needed.
  const CHUNK = Math.max(limit * 6, 12);

  let beforeTurn: number | null = opts.beforeTurnNumber ?? null;
  const includedTurns: TurnChatRow[] = [];
  let counted = 0;

  while (counted < limit) {
    const chunk = fetchTurnChatRowsDesc(db, sessionId, beforeTurn, CHUNK);
    if (chunk.length === 0) break;

    const chunkMsgs = projectTurnRows(chunk, sessionId, opts.dataDir);
    let reached = false;
    for (const t of chunk) {
      // Messages belonging to this turn: user (id*2), assistant (id*2+1), summary marker (-id).
      const ids = new Set<number>([t.id * 2, t.id * 2 + 1, -t.id]);
      const turnMsgs = chunkMsgs.filter((m) => m.id != null && ids.has(m.id as number));
      counted += turnMsgs.reduce((n, m) => n + (isCountedBubble(m) ? 1 : 0), 0);
      includedTurns.push(t);
      if (counted >= limit) {
        reached = true;
        break;
      }
    }
    if (reached) break;

    beforeTurn = chunk[chunk.length - 1].turnNumber;
    if (chunk.length < CHUNK) break; // no older turns remain
  }

  if (includedTurns.length === 0) {
    return { messages: [], hasMore: false, cursor: null };
  }

  const cursor = includedTurns[includedTurns.length - 1].turnNumber;
  const older = db
    .select({ id: turns.id })
    .from(turns)
    .where(and(eq(turns.sessionId, sessionId), lt(turns.turnNumber, cursor)))
    .limit(1)
    .all();
  const hasMore = older.length > 0;

  const messages = projectTurnRows(includedTurns, sessionId, opts.dataDir);
  return { messages, hasMore, cursor };
}
