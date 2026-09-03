import type { SessionIdentity } from "./session.js";

/**
 * The most sessions one reply's mentions may put on the notice band. The band
 * under the housing wraps chips into rows, holds three rows on screen, and
 * scrolls past that — this cap is about twice the visible band, deep enough
 * for any reply worth hearing out and shallow enough that the scroll stays a
 * glance. A reply that walks through more sessions than that has the panel
 * for a record.
 */
export const MAXIMUM_MENTIONED_SESSIONS = 12;

/**
 * The shortest name a mention may be recognized by. A chip is a claim that
 * the words on screen name this session or workspace, and a two-letter name
 * matches too many sentences that were never about it. Anything named shorter
 * than this simply earns no chip — its row in the panel is unchanged.
 */
export const MINIMUM_MENTION_TITLE_LENGTH = 4;

/**
 * What a reply named: a session by its own title, or a workspace by the name
 * its provider groups chats under. The kind is what tells the surface which
 * words the chip should carry — the fields stay on the roster row the
 * identity resolves to, so a renamed session or workspace is worded as it is
 * now.
 */
export const SESSION_MENTION_KIND = {
  SESSION: "session",
  WORKSPACE: "workspace",
} as const;

export type SessionMentionKind = (typeof SESSION_MENTION_KIND)[keyof typeof SESSION_MENTION_KIND];

/**
 * What a row has to offer to be named by a reply: its identity, the two names
 * a mention may be made by, and when it was last seen — the tiebreak when one
 * workspace name fronts several chats. Stated as its own shape rather than as
 * `Session`, which every observed row already satisfies, because a
 * row the surface draws without having observed it — the fixture roster an
 * evidence run photographs — has to earn its chips by the same matching, and
 * these are the only fields the matching reads.
 */
export interface MentionableSession extends SessionIdentity {
  title: string;
  lastActivityAt: number;
  workspace?: {
    providerWorkspaceId: string;
    scopeId?: string;
    name?: string;
  };
}

/**
 * One thing a spoken reply named, resolved to a session the roster observes.
 * A workspace mention resolves to its most recently observed chat, because a
 * chip's press is a row press at one remove and only a session row has
 * anywhere to go — the chat is the workspace's freshest way in.
 */
export interface SessionMention extends SessionIdentity {
  kind: SessionMentionKind;
}

const WORDLIKE = /[\p{L}\p{N}]/u;

/** Whether the character beside a match keeps it a whole mention of the name. */
function boundaryAt(text: string, index: number): boolean {
  if (index < 0 || index >= text.length) return true;
  const character = text[index];
  return character === undefined || !WORDLIKE.test(character);
}

/**
 * Where a name is first mentioned whole in the caption, or nowhere. Whole
 * means bounded on both sides by something other than a letter or digit, so a
 * short name cannot ride inside a longer word that merely contains it.
 * Exported for the issue mentions, which hold titles to exactly this rule —
 * one definition of "named whole", however many rosters offer names.
 */
export function firstWholeNameIndex(caption: string, name: string): number | undefined {
  let from = 0;
  while (from + name.length <= caption.length) {
    const at = caption.indexOf(name, from);
    if (at === -1) return undefined;
    if (boundaryAt(caption, at - 1) && boundaryAt(caption, at + name.length)) return at;
    from = at + 1;
  }
  return undefined;
}

/** One name the caption may be searched for, and the session it stands for. */
interface MentionCandidate {
  kind: SessionMentionKind;
  session: MentionableSession;
  /** Whether the name stopped being attributable to one thing and is dead. */
  ambiguous: boolean;
}

/**
 * The searchable names one roster offers, each mapped to the one thing it
 * attributably stands for. Built in one pass so every collision is seen:
 *
 * - A session's own title, unless two observed sessions share it.
 * - A workspace's name, standing for its most recently observed chat — the
 *   name repeats across the workspace's own chats without harm, but one
 *   naming two distinct workspaces stands for neither.
 * - A name that is both a title and a workspace's is skipped outright: the
 *   mention cannot say which was meant, and a chip that might open the wrong
 *   one is worse than no chip.
 */
function mentionCandidates(sessions: readonly MentionableSession[]): Map<string, MentionCandidate> {
  const candidates = new Map<string, MentionCandidate>();
  for (const session of sessions) {
    const title = session.title.trim().toLowerCase();
    if (title.length >= MINIMUM_MENTION_TITLE_LENGTH) {
      const existing = candidates.get(title);
      if (existing) existing.ambiguous = true;
      else candidates.set(title, { kind: SESSION_MENTION_KIND.SESSION, session, ambiguous: false });
    }
    const workspaceName = session.workspace?.name?.trim().toLowerCase();
    if (workspaceName === undefined || workspaceName.length < MINIMUM_MENTION_TITLE_LENGTH) {
      continue;
    }
    const existing = candidates.get(workspaceName);
    if (!existing) {
      candidates.set(workspaceName, {
        kind: SESSION_MENTION_KIND.WORKSPACE,
        session,
        ambiguous: false,
      });
      continue;
    }
    if (existing.kind === SESSION_MENTION_KIND.SESSION) {
      // The same name titles a session outright; neither reading survives.
      existing.ambiguous = true;
      continue;
    }
    // Another chat wearing the same workspace name: the same workspace keeps
    // its freshest chat as the way in, and a different workspace — another
    // provider's, or another id under this one — kills the name.
    const sameWorkspace =
      (existing.session.workspace?.scopeId ?? existing.session.providerId) ===
        (session.workspace?.scopeId ?? session.providerId) &&
      existing.session.workspace?.providerWorkspaceId === session.workspace?.providerWorkspaceId;
    if (!sameWorkspace) {
      existing.ambiguous = true;
      continue;
    }
    if (session.lastActivityAt > existing.session.lastActivityAt) existing.session = session;
  }
  return candidates;
}

/**
 * The sessions a spoken reply names, for the surface to draw pressable
 * previews of — "what are we working on?" is answered with a walk through
 * several, and each deserves the same chip an announcement's one subject
 * gets. A reply may name a chat by its title or a whole workspace by the
 * name its provider groups chats under; a workspace mention resolves to its
 * most recently observed chat.
 *
 * The specific beats the general: a workspace named beside one of its own
 * chats is absorbed by the chat's mention, because the band is a row of
 * destinations and the named chat is the precise way into that workspace —
 * the freshest-chat fallback exists for a workspace named alone, and using
 * it when the sentence itself picked a chat would open a chat nobody was
 * talking about. A workspace named with no chat of its own keeps its chip.
 *
 * Deterministic on the side that matters: the identities come only from the
 * observed roster, and something is included only when its own name appears
 * whole in the words being spoken — case aside — so the model's words can
 * select among what Luke was actually shown but can never point a chip at
 * anything else. The result is ordered by first mention, because that is the
 * order the developer hears them in, deduplicated by the session each
 * mention resolves to, and capped at {@link MAXIMUM_MENTIONED_SESSIONS}.
 * Every ambiguity — a title two sessions share, a name two workspaces
 * share, a name that is both — earns nothing at all, because a chip that
 * might open the wrong thing is worse than no chip. The panel still shows
 * every row.
 */
export function mentionedSessions(
  caption: string | undefined,
  sessions: readonly MentionableSession[],
): readonly SessionMention[] {
  if (!caption) return [];
  const spoken = caption.toLowerCase();
  const mentions: { at: number; kind: SessionMentionKind; session: MentionableSession }[] = [];
  for (const [name, candidate] of mentionCandidates(sessions)) {
    if (candidate.ambiguous) continue;
    const at = firstWholeNameIndex(spoken, name);
    if (at === undefined) continue;
    mentions.push({ at, kind: candidate.kind, session: candidate.session });
  }
  // The workspaces the reply named a chat of, by the original identifiers.
  // Their own mentions are absorbed below — before the dedup and the cap, so
  // an absorbed workspace frees its slot rather than spending it.
  const chatNamedIn = new Map<string, Set<string>>();
  for (const entry of mentions) {
    if (entry.kind !== SESSION_MENTION_KIND.SESSION) continue;
    const workspaceId = entry.session.workspace?.providerWorkspaceId;
    if (workspaceId === undefined) continue;
    const scopeId = entry.session.workspace?.scopeId ?? entry.session.providerId;
    let workspaceIds = chatNamedIn.get(scopeId);
    if (!workspaceIds) {
      workspaceIds = new Set();
      chatNamedIn.set(scopeId, workspaceIds);
    }
    workspaceIds.add(workspaceId);
  }
  // One chip per session falls out of the absorption: every candidate name is
  // distinct, a session-kind mention resolves only to its own title's session,
  // and a workspace-kind mention that could share a chat with a named title is
  // exactly the one absorbed above.
  return mentions
    .filter(
      (entry) =>
        entry.kind !== SESSION_MENTION_KIND.WORKSPACE ||
        entry.session.workspace?.providerWorkspaceId === undefined ||
        !chatNamedIn
          .get(entry.session.workspace.scopeId ?? entry.session.providerId)
          ?.has(entry.session.workspace.providerWorkspaceId),
    )
    .sort((a, b) => a.at - b.at)
    .slice(0, MAXIMUM_MENTIONED_SESSIONS)
    .map(
      (entry): SessionMention => ({
        kind: entry.kind,
        providerId: entry.session.providerId,
        providerSessionId: entry.session.providerSessionId,
      }),
    );
}
