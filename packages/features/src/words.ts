/**
 * words.ts -- the words the app says in many places: a count and its noun, a list of names, a read's reading, no-match and failed phrases, and the glossary's fixed terms.
 *
 * Each kind of words has one function here, so a screen names only its noun
 * and every screen, the service's included, says it the same way. It holds no
 * DOM and no React, so the service and every client read it alike. Times and
 * numbers are `time-format.ts`'s and `number-format.ts`'s, not this module's.
 */

/** A noun as a count says it: its one form and its many form. */
export interface Noun {
  readonly one: string;
  readonly many: string;
}

/**
 * The glossary's nouns, each the one word for its thing. An agent's helpers are
 * its workers, an Inbox entry is an item, and a person in a workspace is a member.
 */
export const TERM = {
  TASK: { one: "task", many: "tasks" },
  PAGE: { one: "page", many: "pages" },
  AGENT: { one: "agent", many: "agents" },
  WORKER: { one: "worker", many: "workers" },
  INBOX_ITEM: { one: "item", many: "items" },
  MEMBER: { one: "member", many: "members" },
  PULL_REQUEST: { one: "pull request", many: "pull requests" },
  REPOSITORY: { one: "repository", many: "repositories" },
  SKILL: { one: "skill", many: "skills" },
  RESULT: { one: "result", many: "results" },
  SECTION: { one: "section", many: "sections" },
  FILE: { one: "file", many: "files" },
} as const satisfies Record<string, Noun>;

/** The glossary's verbs: the one label each act goes by. */
export const VERB = {
  SIGN_OUT: "Sign out",
  RETRY: "Retry",
  OPEN: "Open",
  RESET_TO_DEFAULTS: "Reset to defaults",
} as const;

/** How English counts: "one" for 1, "other" for 0, 2, and 1.5. */
const PLURAL = new Intl.PluralRules("en-US");

/** Names joined as a sentence says them, with the Oxford comma: "a, b, and c". */
const AND = new Intl.ListFormat("en-US", { style: "long", type: "conjunction" });

/** Names offered as a choice, with the Oxford comma: "a, b, or c". */
const OR = new Intl.ListFormat("en-US", { style: "long", type: "disjunction" });

/** Words whose first letter stands at the start of a sentence. */
function sentenceStart(words: string): string {
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The noun alone in the form `count` asks for: "result" at 1, "results" at 0 or 2. */
function nounFor(count: number, noun: Noun): string {
  return PLURAL.select(count) === "one" ? noun.one : noun.many;
}

/** A count and its noun: "1 result", "0 agents", "2 pull requests". */
export function countWords(count: number, noun: Noun): string {
  return `${count} ${nounFor(count, noun)}`;
}

/** Names as a sentence joins them: "Linear", "Linear and Notion", "Linear, Notion, and Sentry". */
export function andList(names: readonly string[]): string {
  return AND.format(names);
}

/** Names as a choice joins them: "Linear", "Linear or Notion", "Linear, Notion, or Sentry". */
export function orList(names: readonly string[]): string {
  return OR.format(names);
}

/** What a wait is called while something is read: "Reading tasks". A label, so no "…". */
export function readingWords(things: string): string {
  return `Reading ${things}`;
}

/** What a search or filter that found nothing says: "No tasks match". */
export function noMatchWords(noun: Noun): string {
  return `No ${noun.many} match`;
}

/** What a place with nothing in it yet says: "No tasks yet". */
export function noneYetWords(noun: Noun): string {
  return `No ${noun.many} yet`;
}

/** What a read that failed says, of what it read: "Your tasks could not be read." */
export function readFailedWords(thing: string): string {
  return `${sentenceStart(thing)} could not be read.`;
}
