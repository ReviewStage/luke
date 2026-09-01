import { isRememberedFact, maximumRememberedFacts, type RememberedFact } from "@sidecar/acts";
import {
  type ConversationEntry,
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
 * which is what every launch did before this file existed.
 */
export function conversationFromStored(
  stored: string | undefined,
  now: number,
): readonly ConversationEntry[] {
  const entries: ConversationEntry[] = [];
  for (const value of parsedList(stored, "entries")) {
    const entry = storedConversationEntry(value);
    if (entry) entries.push(entry);
  }
  return retainedConversationEntries(entries, now);
}

/** The record a thread persists as, already retained so the file cannot outgrow the policy. */
export function conversationRecord(entries: readonly ConversationEntry[], now: number): string {
  return `${JSON.stringify({ entries: retainedConversationEntries(entries, now) })}\n`;
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
