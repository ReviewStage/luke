import { isRememberedFact, maximumRememberedFacts, type RememberedFact } from "@sidecar/acts";
import {
  type ConversationEntry,
  conversationEntryKey,
  enrichedConversationEntry,
  retainedConversationEntries,
  storedConversationEntry,
} from "@sidecar/realtime";
import { isRecord, type UnparsedWireValue } from "@sidecar/wire";

/**
 * What Luke keeps across launches, and how it is read back. The decisions are
 * pure so they can be tested without Electron, on the arrival flow's own
 * pattern; the wiring that reads and writes the files lives in desktop-app.
 *
 * Two files, because the two hold different kinds of thing and deserve
 * different answers to "how long". The conversation is retired on a clock;
 * durable facts leave only when Luke replaces or forgets them.
 *
 * Both live in Luke's own application data beside `settings.json`, and never
 * in a provider's file.
 */

export const CONVERSATION_FILE = "conversation.json";
export const REMEMBERED_FACTS_FILE = "memory.json";

/**
 * Reads a stored thread, dropping lines that do not parse rather than the
 * whole file. A conversation is not load-bearing: half a thread beats none,
 * and a launch that cannot read the file at all simply begins with nothing,
 * which is what every launch did before this file existed. A line recorded
 * at or before the last Clear's cutoff — one the Clear's marker outlived
 * because the thread's own erasure did not land before the launch ended — is
 * dropped here as the Clear meant it to be.
 */
export function conversationFromStored(
  stored: string | undefined,
  now: number,
  clearedAt?: number,
): readonly ConversationEntry[] {
  const entries: ConversationEntry[] = [];
  for (const value of parsedList(stored, "entries")) {
    const entry = storedConversationEntry(value);
    if (entry && conversationEntryAfterClear(entry, clearedAt)) entries.push(entry);
  }
  return retainedConversationEntries(entries, now);
}

/** Whether a line may stand given the last Clear: with no cutoff every line does; with one, only a clocked line after it. */
export function conversationEntryAfterClear(
  entry: ConversationEntry,
  clearedAt: number | undefined,
): boolean {
  return (
    clearedAt === undefined || (entry.recordedAt !== undefined && entry.recordedAt > clearedAt)
  );
}

/** The record a thread persists as, already retained so the file cannot outgrow the policy. */
export function conversationRecord(entries: readonly ConversationEntry[], now: number): string {
  return `${JSON.stringify({ entries: retainedConversationEntries(entries, now) })}\n`;
}

/** Merges complete window snapshots without letting either window erase the other's new lines. */
export function mergeConversationHistory(
  current: readonly ConversationEntry[],
  incoming: readonly ConversationEntry[],
  clearedAt: number | undefined,
  now: number,
): readonly ConversationEntry[] {
  const afterClear = (entry: ConversationEntry) => conversationEntryAfterClear(entry, clearedAt);
  const merged = current.filter(afterClear);
  const currentByKey = new Map<string, number[]>();
  merged.forEach((entry, index) => {
    const key = conversationEntryKey(entry);
    currentByKey.set(key, [...(currentByKey.get(key) ?? []), index]);
  });
  const incomingCounts = new Map<string, number>();
  for (const entry of incoming.filter(afterClear)) {
    const key = conversationEntryKey(entry);
    const seen = incomingCounts.get(key) ?? 0;
    incomingCounts.set(key, seen + 1);
    const held = currentByKey.get(key)?.[seen];
    if (held === undefined) {
      merged.push(entry);
      continue;
    }
    // The same line again: it may now know the run it opened.
    const current = merged[held];
    if (current) merged[held] = enrichedConversationEntry(current, entry);
  }
  return retainedConversationEntries(
    merged.sort((left, right) => (left.recordedAt ?? now) - (right.recordedAt ?? now)),
    now,
  );
}

/**
 * Reads remembered entries, dropping invalid records and anything beyond the cap.
 */
export function rememberedFactsFromStored(stored: string | undefined): readonly RememberedFact[] {
  const facts: RememberedFact[] = [];
  const ids = new Set<string>();
  const words = new Set<string>();
  for (const value of parsedList(stored, "facts")) {
    if (isRememberedFact(value) && !ids.has(value.id) && !words.has(value.words)) {
      facts.push(value);
      ids.add(value.id);
      words.add(value.words);
    }
    if (facts.length === maximumRememberedFacts) break;
  }
  return facts;
}

export function rememberedFactsRecord(facts: readonly RememberedFact[]): string {
  return `${JSON.stringify({ facts })}\n`;
}

function parsedList(stored: string | undefined, field: string): readonly UnparsedWireValue[] {
  if (stored === undefined) return [];
  let parsed: UnparsedWireValue;
  try {
    parsed = JSON.parse(stored);
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];
  const list = parsed[field];
  return Array.isArray(list) ? list : [];
}
