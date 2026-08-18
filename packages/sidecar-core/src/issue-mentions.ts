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
 * Whether an identifier's hyphens may come back from the transcript as
 * spaces. The tolerance exists because a transcript is a rendering of speech
 * — LUKE-123 is often written down as "LUKE 123" — but the spaced form of a
 * short key is ordinary language: IT-1 must not claim every "it 1" a sentence
 * produces. So the spaced form is what a short name is, and it is held to the
 * titles' own minimum: only a key whose first segment could stand as a title
 * earns the tolerance. The literal hyphenated form stays precise at any
 * length — "it-1" is not a phrase speech produces by accident.
 */
function spacedFormTolerated(identifier: string): boolean {
  const prefix = identifier.split("-")[0] ?? "";
  return prefix.length >= MINIMUM_MENTION_TITLE_LENGTH;
}

/**
 * How a tolerant identifier is looked for in spoken words. Case falls away
 * because the caller lowercases both sides; the boundaries stay strict, so an
 * identifier inside a longer token is a different identifier and LUKE-1 never
 * claims a mention of LUKE-12.
 */
function identifierMentionPattern(identifier: string): RegExp {
  const escaped = identifier.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?<![\\p{L}\\p{N}])${escaped.replace(/-/g, "[-\\s]")}(?![\\p{L}\\p{N}])`,
    "iu",
  );
}

/** Where a tolerant identifier is first mentioned in the words, or nowhere. */
function firstIdentifierIndex(caption: string, identifier: string): number | undefined {
  const at = caption.search(identifierMentionPattern(identifier));
  return at === -1 ? undefined : at;
}

/** One name the caption may be searched for, and the issue it stands for. */
interface IssueMentionCandidate {
  issue: TrackedIssue;
  /** The literal lowercased name the caption is searched for. */
  name: string;
  /** Whether the name is an identifier whose hyphens may match spaces. */
  tolerant: boolean;
  /** Whether the name stopped being attributable to one issue and is dead. */
  ambiguous: boolean;
}

/**
 * How a name reads to a listener: hyphens and runs of whitespace as one
 * space. Ambiguity is keyed on this rather than on the literal spelling,
 * because the identifier tolerance makes LUKE-1 and a title "luke 1" the
 * same spoken phrase — two candidates whose literal names differ but whose
 * sound collides must die together, or one phrase lights two chips.
 */
function spokenForm(name: string): string {
  return name.replace(/[-\s]+/g, " ");
}

/**
 * The searchable names one issue roster offers, each mapped to the one issue
 * it attributably stands for — the session candidates' own discipline, one
 * roster over. Identifiers and titles are collected into the same map, keyed
 * by how they sound, so a title that reads like another issue's identifier —
 * spaced or hyphenated — dies with the collision instead of pointing two
 * chips at one phrase.
 */
function issueMentionCandidates(
  issues: readonly TrackedIssue[],
): Map<string, IssueMentionCandidate> {
  const candidates = new Map<string, IssueMentionCandidate>();
  const offer = (name: string, tolerant: boolean, issue: TrackedIssue) => {
    const existing = candidates.get(spokenForm(name));
    if (!existing) {
      candidates.set(spokenForm(name), { issue, name, tolerant, ambiguous: false });
      return;
    }
    // The same issue offering the same sound twice — an identifier equal to
    // its own title — is still one attributable name, not a collision.
    if (existing.issue !== issue) existing.ambiguous = true;
  };
  for (const issue of issues) {
    const identifier = issue.identifier.toLowerCase();
    offer(identifier, spacedFormTolerated(identifier), issue);
    const title = issue.title.trim().toLowerCase();
    if (title.length >= MINIMUM_MENTION_TITLE_LENGTH) offer(title, false, issue);
  }
  return candidates;
}

/**
 * The tracked issues a spoken reply names, in the order they are first heard,
 * for the surface to draw pressable previews of beside the sessions the same
 * words name. A reply may name an issue by its tracker identifier — LUKE-123,
 * however the transcript renders its hyphen — or by its whole title under the
 * session mentions' own minimum-length rule.
 *
 * Deterministic on the side that matters, exactly like the session mentions:
 * the issues come only from the observed roster, and one is included only
 * when its own identifier or title appears whole in the words being spoken —
 * so the model's words can select among what the tracker actually lists but
 * can never point a chip at anything else. Names that sound alike and stand
 * for different issues earn nothing, because a chip that might open the
 * wrong issue is worse than no chip; an issue named by identifier and title
 * at once counts once, at its first hearing; and the result is capped at
 * {@link MAXIMUM_MENTIONED_ISSUES}. The rows returned are the roster's own,
 * resolved here so every caller draws the same observed fields.
 */
export function mentionedIssues(
  caption: string | undefined,
  issues: readonly TrackedIssue[] | undefined,
): readonly TrackedIssue[] {
  if (!caption || !issues || issues.length === 0) return [];
  const spoken = caption.toLowerCase();
  const heard = new Map<TrackedIssue, number>();
  for (const candidate of issueMentionCandidates(issues).values()) {
    if (candidate.ambiguous) continue;
    // A tolerant identifier needs the pattern's hyphen-or-space; everything
    // else — titles, and identifiers too short to earn the tolerance — is a
    // literal whole name, which the plain walk finds cheaper.
    const at = candidate.tolerant
      ? firstIdentifierIndex(spoken, candidate.name)
      : firstWholeNameIndex(spoken, candidate.name);
    if (at === undefined) continue;
    const earliest = heard.get(candidate.issue);
    if (earliest === undefined || at < earliest) heard.set(candidate.issue, at);
  }
  return [...heard.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, MAXIMUM_MENTIONED_ISSUES)
    .map(([issue]) => issue);
}
