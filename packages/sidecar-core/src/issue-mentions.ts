import type { TrackedIssue } from "./issues.js";
import { firstWholeNameIndex, MINIMUM_MENTION_TITLE_LENGTH } from "./session-mentions.js";

/**
 * The most issues one reply's mentions may put on the notice band, the session
 * cap's own number for the session cap's own reasons: deep enough for any
 * reply worth hearing out, shallow enough that the band's scroll stays a
 * glance. A reply that reads the whole board has the tracker for a record.
 */
export const MAXIMUM_MENTIONED_ISSUES = 12;

/**
 * How one issue's identifier is looked for in spoken words. Case falls away
 * because a transcript is a rendering of speech, and a hyphen may come back
 * as a space or a pause on the same grounds — but the boundaries stay strict:
 * an identifier inside a longer token is a different identifier, so LUKE-1
 * never claims a mention of LUKE-12. An identifier is precise the way a title
 * is not, so it earns a mention at any length.
 */
function identifierMentionPattern(identifier: string): RegExp {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escaped.replace(/-/g, "[-\\s]")}(?![\\p{L}\\p{N}])`,
    "iu",
  );
}

/** Where an identifier is first mentioned in the words, or nowhere. */
function firstIdentifierIndex(caption: string, identifier: string): number | undefined {
  const at = caption.search(identifierMentionPattern(identifier));
  return at === -1 ? undefined : at;
}

/** One name the caption may be searched for, and the issue it stands for. */
interface IssueMentionCandidate {
  issue: TrackedIssue;
  /** Whether the name stopped being attributable to one issue and is dead. */
  ambiguous: boolean;
}

/**
 * The searchable names one issue roster offers, each mapped to the one issue
 * it attributably stands for — the session candidates' own discipline, one
 * roster over. Identifiers and titles are collected into the same map, so a
 * title that reads exactly like another issue's identifier dies with the
 * collision instead of pointing two chips at one phrase.
 */
function issueMentionCandidates(
  issues: readonly TrackedIssue[],
): Map<string, IssueMentionCandidate> {
  const candidates = new Map<string, IssueMentionCandidate>();
  const offer = (name: string, issue: TrackedIssue) => {
    const existing = candidates.get(name);
    if (!existing) {
      candidates.set(name, { issue, ambiguous: false });
      return;
    }
    // The same issue offering the same words twice — an identifier equal to
    // its own title — is still one attributable name, not a collision.
    if (existing.issue !== issue) existing.ambiguous = true;
  };
  for (const issue of issues) {
    offer(issue.identifier.toLowerCase(), issue);
    const title = issue.title.trim().toLowerCase();
    if (title.length >= MINIMUM_MENTION_TITLE_LENGTH) offer(title, issue);
  }
  return candidates;
}

/**
 * The tracked issues a spoken reply names, in the order they are first heard,
 * for the surface to draw pressable previews of beside the sessions the same
 * words name. A reply may name an issue by its tracker identifier — LUKE-123,
 * however the transcript renders it — or by its whole title under the session
 * mentions' own minimum-length rule.
 *
 * Deterministic on the side that matters, exactly like the session mentions:
 * the issues come only from the observed roster, and one is included only
 * when its own identifier or title appears whole in the words being spoken —
 * so the model's words can select among what the tracker actually lists but
 * can never point a chip at anything else. A name two issues share earns
 * nothing, because a chip that might open the wrong issue is worse than no
 * chip; an issue named by identifier and title at once counts once, at its
 * first hearing; and the result is capped at {@link MAXIMUM_MENTIONED_ISSUES}.
 * The rows returned are the roster's own, resolved here so every caller draws
 * the same observed fields.
 */
export function mentionedIssues(
  caption: string | undefined,
  issues: readonly TrackedIssue[] | undefined,
): readonly TrackedIssue[] {
  if (!caption || !issues || issues.length === 0) return [];
  const spoken = caption.toLowerCase();
  const heard = new Map<TrackedIssue, number>();
  for (const [name, candidate] of issueMentionCandidates(issues)) {
    if (candidate.ambiguous) continue;
    // The identifier's tolerance (a hyphen spoken as a space) is harmless on
    // a title too, so one matcher serves both kinds of name — except that a
    // title may carry regex-meaningful punctuation, which the pattern
    // escapes, and the plain whole-name walk is cheaper where it suffices.
    const at =
      name === candidate.issue.identifier.toLowerCase()
        ? firstIdentifierIndex(spoken, name)
        : firstWholeNameIndex(spoken, name);
    if (at === undefined) continue;
    const earliest = heard.get(candidate.issue);
    if (earliest === undefined || at < earliest) heard.set(candidate.issue, at);
  }
  return [...heard.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, MAXIMUM_MENTIONED_ISSUES)
    .map(([issue]) => issue);
}
