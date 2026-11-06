import { formatCount } from "./number-format.js";

export interface Noun {
  readonly one: string;
  readonly many: string;
}

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
  INTEGRATION: { one: "integration", many: "integrations" },
  RESULT: { one: "result", many: "results" },
  SECTION: { one: "section", many: "sections" },
  FILE: { one: "file", many: "files" },
  COMMENT: { one: "comment", many: "comments" },
  COMMIT: { one: "commit", many: "commits" },
  MEMORY: { one: "memory", many: "memories" },
  CHANNEL: { one: "channel", many: "channels" },
} as const satisfies Record<string, Noun>;

export const VERB = {
  SIGN_OUT: "Sign out",
  RETRY: "Retry",
  OPEN: "Open",
  RESET_TO_DEFAULTS: "Reset to defaults",
} as const;

export const INTEGRATION_LABEL = {
  one: "Integration",
  many: "Integrations",
} as const satisfies Noun;

export const FIELD_WORDS = {
  OPTIONAL: "Optional",
  SAVED: "Saved",
  SHOW: "Show",
  HIDE: "Hide",
} as const;

export const IRREVERSIBLE_WORDS = "This cannot be undone.";

const PLURAL = new Intl.PluralRules("en-US");

const AND = new Intl.ListFormat("en-US", { style: "long", type: "conjunction" });

const OR = new Intl.ListFormat("en-US", { style: "long", type: "disjunction" });

function sentenceStart(words: string): string {
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function nounFor(count: number, noun: Noun): string {
  return PLURAL.select(count) === "one" ? noun.one : noun.many;
}

export function countWords(count: number, noun: Noun): string {
  return `${count} ${nounFor(count, noun)}`;
}

export function andList(names: readonly string[]): string {
  return AND.format(names);
}

export function orList(names: readonly string[]): string {
  return OR.format(names);
}

export function orListParts(
  count: number,
): readonly ({ readonly item: number } | { readonly words: string })[] {
  const keys = Array.from({ length: count }, (_, index) => String(index));
  return OR.formatToParts(keys).map((part) =>
    part.type === "element" ? { item: Number(part.value) } : { words: part.value },
  );
}

export const SIGNED_OUT_WORDS = "Sign in to use this page.";

export function readingWords(things: string): string {
  return `Reading ${things}`;
}

export function backToWords(place: string): string {
  return `Back to ${place}`;
}

export function noMatchWords(noun: Noun): string {
  return `No ${noun.many} match`;
}

export function noneYetWords(noun: Noun): string {
  return `No ${noun.many} yet`;
}

export function readFailedWords(thing: string): string {
  return `${sentenceStart(thing)} could not be read.`;
}

export function pasteCutWords(limit: number): string {
  return `Your paste was cut to fit the ${formatCount(limit)}-character limit.`;
}

export function showMoreWords(count: number): string {
  return `Show ${formatCount(count)} more`;
}

export const SHELL_EXITED_WORDS = "exited";

export const SHOW_LESS_WORDS = "Show less";

export function selectedWords(count: number): string {
  return `${formatCount(count)} selected`;
}

export const SELECTION_WORDS = {
  SELECTED: "Selected",
  CLEAR: "Clear",
  CLEAR_SELECTION: "Clear selection",
} as const;

const NEW_INBOX_ITEM: Noun = {
  one: `new ${TERM.INBOX_ITEM.one}`,
  many: `new ${TERM.INBOX_ITEM.many}`,
};

export function inboxArrivalWords(said: readonly string[]): string {
  const [only] = said;
  if (said.length === 1 && only !== undefined) return `New in your inbox: ${only}`;
  return `${countWords(said.length, NEW_INBOX_ITEM)} in your inbox`;
}

export function replyFromWords(agent: string, lead?: string): string {
  return lead === undefined || lead === "" ? `Reply from ${agent}` : `Reply from ${agent}: ${lead}`;
}

export const REFRESH_FAILED_WORDS = "Could not refresh";

export const ACT_UNREACHED_WORDS = "Could not reach the service. Try again.";

export const SIGN_IN_FAILURE = {
  TIMED_OUT: "timed-out",
  BROWSER: "browser",
  ALREADY_WAITING: "already-waiting",
  REFUSED: "refused",
  OFFLINE: "offline",
  UNFINISHED: "unfinished",
} as const;

export type SignInFailure = (typeof SIGN_IN_FAILURE)[keyof typeof SIGN_IN_FAILURE];

export const SIGN_IN_FAILURE_WORDS = {
  [SIGN_IN_FAILURE.TIMED_OUT]: "Sign-in timed out waiting for your browser. Try again.",
  [SIGN_IN_FAILURE.BROWSER]: "Couldn't open the sign-in page in your browser. Try again.",
  [SIGN_IN_FAILURE.ALREADY_WAITING]:
    "A sign-in is already waiting in your browser. Finish it there, or try again later.",
  [SIGN_IN_FAILURE.REFUSED]: "The sign-in was declined in your browser. Try again.",
  [SIGN_IN_FAILURE.OFFLINE]: "You're offline. Connect to the internet, then sign in.",
  [SIGN_IN_FAILURE.UNFINISHED]: "Sign-in didn't finish. Try again.",
} as const satisfies Record<SignInFailure, string>;

const SIGN_IN_FAILURES: ReadonlySet<string> = new Set(Object.values(SIGN_IN_FAILURE));

export function isSignInFailure(value: unknown): value is SignInFailure {
  return typeof value === "string" && SIGN_IN_FAILURES.has(value);
}
