import { eq, and } from "drizzle-orm";
import { getDb } from "../../db/client";
import { events } from "../../db/schema";

export function appendEvent(
  sessionId: string,
  turnId: number,
  type: string,
  data: unknown,
  seq: number
): number {
  const db = getDb();
  const result = db.insert(events).values({
    sessionId,
    turnId,
    type,
    data: JSON.stringify(data),
    seq,
    createdAt: new Date().toISOString(),
  }).returning({ id: events.id }).get();
  return result.id;
}

export function getEventsByTurn(sessionId: string, turnId: number): any[] {
  const db = getDb();
  return db.select().from(events)
    .where(and(eq(events.sessionId, sessionId), eq(events.turnId, turnId)))
    .orderBy(events.seq)
    .all()
    .map(e => ({
      ...JSON.parse(e.data),
      type: e.type,
      seq: e.seq,
    }));
}

export function getEventsBySession(sessionId: string): any[] {
  const db = getDb();
  return db.select().from(events)
    .where(eq(events.sessionId, sessionId))
    .orderBy(events.seq)
    .all()
    .map(e => ({
      ...JSON.parse(e.data),
      type: e.type,
      seq: e.seq,
    }));
}
