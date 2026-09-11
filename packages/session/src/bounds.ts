import { text, type UnparsedWireValue } from "@sidecar/wire";
import { isOpenableSessionLink, SESSION_LINK_SCHEME } from "./session-identity.js";
import type { SessionDiffSummary } from "./session-shape.js";

/**
 * Stands where the front of a transcript was cut, so a reader — a model or a
 * row — knows it is holding a tail rather than the whole conversation. One
 * marker for every cut: the brain's bounded read and a provider adapter's own
 * rendering both say the same thing, so nothing downstream has to recognize
 * two spellings of the same fact.
 */
export const OMISSION_MARKER = "[… earlier transcript omitted …]";

export const maximumSessionTitleLength = 160;
/** An agent kind is a short identifier, never a sentence. */
export const maximumSpawnableAgentLength = 40;
/** How many kinds of agent one session may offer to start. */
export const maximumSpawnableAgents = 8;
/** One line of context beside a title, not a paragraph. */
export const maximumSessionDetailLength = 120;
/**
 * The one line Luke derives about what a local session is working on, read
 * from the rendering of its own transcript. A phrase, never a sentence: it
 * names the work in an announcement in place of a title that only ever said
 * where the conversation began.
 */
export const maximumSessionSubjectLength = 80;
/**
 * How much of a transcript file's end one read may load. It is the one bound
 * on how much of a session a rendering can carry, so it is also the most a
 * rendering could measure when it is validated on the wire.
 */
export const transcriptReadTailBytes = 256 * 1024;
/** Long enough for any provider's session address without becoming a payload. */
export const maximumSessionLinkLength = 300;
/** A reply typed into a row, not a document pasted through one. */
export const maximumSessionMessageLength = 4_000;

/**
 * How long an ask to Luke himself may run, as the host composes it from the
 * live transcript. The same bound a session message carries: room for
 * anything worth saying in one turn, and a floor under a run-on that is cut
 * rather than sent, because the ask is a sentence to a companion, not a
 * transfer.
 */
export const maximumAskLength = maximumSessionMessageLength;

/**
 * The text of a message on its way to a session, or nothing. Unlike an observed
 * field this one is refused rather than cut when it runs long: a truncated
 * message says something its author did not.
 */
export function sessionMessageText(value: UnparsedWireValue): string | undefined {
  const normalized = text(value);
  if (!normalized || normalized.length > maximumSessionMessageLength) return undefined;
  return normalized;
}

export function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must not be empty`);
  return normalized;
}

/**
 * Closes a provider-written field to one line and cuts it to its bound, or
 * drops an empty one: every field this reaches is drawn or sent as a line.
 */
export function boundedText(value: string | undefined, maximumLength: number): string | undefined {
  const normalized = value?.replace(/\s+/gu, " ").trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maximumLength);
}

/**
 * A session's address, or nothing. Unlike every other bounded field this one is
 * dropped rather than cut when it runs long: a truncated address is a different
 * address, and this is the field something is opened from.
 */
export function sessionLink(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized || normalized.length > maximumSessionLinkLength) return undefined;
  return isOpenableSessionLink(normalized) ? normalized : undefined;
}

/**
 * The published work's address, or nothing, under the link's own rules — a
 * truncated address is a different address — narrowed further to `https`
 * alone: every pull request a provider reports lives on the web, and this
 * field too is one the surface acts on rather than merely draws.
 */
export function sessionChange(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  if (!normalized || normalized.length > maximumSessionLinkLength) return undefined;
  try {
    return new URL(normalized).protocol === SESSION_LINK_SCHEME.HTTPS ? normalized : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The pull request's own number, read from the published work's address so a
 * surface can name the work the way its host does — "#245" — instead of the
 * generic words. Every host this build has seen a change from ends the
 * address with the number (GitHub's `/pull/245`, GitLab's
 * `/-/merge_requests/3`, Bitbucket's `/pull-requests/9`), so the final path
 * segment is the number or the address names none. Nothing but the number
 * ever leaves this read: an address whose tail is not one yields nothing,
 * and the surface keeps the generic words rather than guessing.
 */
export function sessionChangeNumber(change: string): number | undefined {
  let tail: string | undefined;
  try {
    tail = new URL(change).pathname.split("/").filter(Boolean).at(-1);
  } catch {
    return undefined;
  }
  return tail !== undefined && /^\d+$/.test(tail) ? Number(tail) : undefined;
}

/** A count a row can draw; anything past it is a report to distrust whole. */
export const maximumSessionDiffCount = 999_999;

/**
 * A provider's diff counts, or nothing. Dropped whole rather than partially:
 * one count outside sense makes the others' claim on the row suspect, and a
 * summary of all zeroes says nothing a row should spend words on.
 */
export function sessionDiffSummary(
  diff: SessionDiffSummary | undefined,
): SessionDiffSummary | undefined {
  if (!diff) return undefined;
  const counts = [diff.filesChanged, diff.linesAdded, diff.linesRemoved];
  const sound = counts.every(
    (count) => Number.isSafeInteger(count) && count >= 0 && count <= maximumSessionDiffCount,
  );
  if (!sound || counts.every((count) => count === 0)) return undefined;
  return {
    filesChanged: diff.filesChanged,
    linesAdded: diff.linesAdded,
    linesRemoved: diff.linesRemoved,
  };
}

export function timestamp(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be a non-negative finite timestamp`);
  }
  return value;
}

/**
 * Bounds and deduplicates the agents a session offers to start beside it. An
 * entry outside its bound is dropped rather than cut: a truncated agent kind
 * names a different agent, and this list is what a creation ask is held to.
 */
export function boundedAgentKinds(agents: readonly string[] | undefined): readonly string[] {
  if (!agents) return [];
  const unique = new Set<string>();
  for (const agent of agents) {
    const normalized = agent.trim();
    if (!normalized || normalized.length > maximumSpawnableAgentLength) continue;
    unique.add(normalized);
    if (unique.size >= maximumSpawnableAgents) break;
  }
  return [...unique];
}

/** A workspace name reads in one breath; anything longer is a different ask. */
export const maximumWorkspaceNameLength = 80;

/** How many projects the app will offer workspace creation in at once. */
export const maximumObservedWorkspaceProjects = 20;

/**
 * The name a new workspace was asked for under, or nothing. Refused rather
 * than cut when it runs long, the same posture as a message: a truncated name
 * says something its author did not.
 */
export function workspaceNameText(value: UnparsedWireValue): string | undefined {
  const normalized = text(value);
  if (!normalized || normalized.length > maximumWorkspaceNameLength) return undefined;
  return normalized;
}
