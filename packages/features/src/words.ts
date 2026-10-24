/**
 * words.ts -- the words the app says in many places: a count and its noun, a list of names, a read's reading, no-match and failed phrases, the glossary's fixed terms, and the voice's failures.
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

/**
 * The voice's failures, each said in words of its own. The notice line and
 * app state carry only these keys, never a browser's or a provider's text, so
 * nothing a session carried (an SDP line, a key) can reach the screen. A new
 * failure is a key here and its words in {@link VOICE_FAILURE_WORDS}, which
 * the compiler holds to naming every key.
 */
export const VOICE_FAILURE = {
  /** The call could not be built, the host opened no session for it, or it never started. */
  CALL_NOT_STARTED: "call-not-started",
  /** The system refused the microphone a call needs. */
  MICROPHONE_REFUSED: "microphone-refused",
  /** A call runs on the account's own OpenAI key, and none is saved. */
  OPENAI_KEY_MISSING: "openai-key-missing",
  /** OpenAI refused the saved key, as it does a revoked or deleted one. */
  OPENAI_KEY_REFUSED: "openai-key-refused",
  /** The saved key's OpenAI account has no credit left. */
  OPENAI_KEY_UNFUNDED: "openai-key-unfunded",
  /** No credential of the agent's starter pays for a call into it. */
  AGENT_KEY_MISSING: "agent-key-missing",
  /** The agent runs on Claude or Codex, which takes no call yet. */
  NATIVE_AGENT: "native-agent",
  /** The hosted service's ceiling is reached. */
  VOICE_UNAVAILABLE: "voice-unavailable",
} as const;

export type VoiceFailure = (typeof VOICE_FAILURE)[keyof typeof VOICE_FAILURE];

/** What a failure offers to do about itself, as the button beside its words. */
export const VOICE_REMEDY = {
  /** Settings, where the OpenAI key goes. */
  ADD_OPENAI_KEY: "add-openai-key",
  /** System Settings, where the microphone is allowed. */
  ALLOW_MICROPHONE: "allow-microphone",
  /** OpenAI's billing page, where the key's account is given credit. */
  ADD_OPENAI_CREDIT: "add-openai-credit",
} as const;

export type VoiceRemedy = (typeof VOICE_REMEDY)[keyof typeof VOICE_REMEDY];

/** A failure's words, what happened and what to do, and the remedy its button offers where one does it. */
export interface VoiceFailureWords {
  readonly words: string;
  readonly remedy?: VoiceRemedy;
}

export const VOICE_FAILURE_WORDS = {
  [VOICE_FAILURE.CALL_NOT_STARTED]: {
    words: "Luke could not start the call. Try again in a moment.",
  },
  [VOICE_FAILURE.MICROPHONE_REFUSED]: {
    words:
      "A call needs the microphone. Allow it in System Settings › Privacy & Security › Microphone.",
    remedy: VOICE_REMEDY.ALLOW_MICROPHONE,
  },
  [VOICE_FAILURE.OPENAI_KEY_MISSING]: {
    words: "Luke could not start the call. A call runs on your OpenAI key, and none is saved.",
    remedy: VOICE_REMEDY.ADD_OPENAI_KEY,
  },
  [VOICE_FAILURE.OPENAI_KEY_REFUSED]: {
    words: "Luke could not start the call. OpenAI refused your key, which may have been revoked.",
    remedy: VOICE_REMEDY.ADD_OPENAI_KEY,
  },
  [VOICE_FAILURE.OPENAI_KEY_UNFUNDED]: {
    words: "Luke could not start the call. Your OpenAI account is out of credit.",
    remedy: VOICE_REMEDY.ADD_OPENAI_CREDIT,
  },
  [VOICE_FAILURE.AGENT_KEY_MISSING]: {
    words: "Connect an API key in Settings to call this agent.",
  },
  [VOICE_FAILURE.NATIVE_AGENT]: {
    words: "This agent runs on Claude or Codex and can't take calls yet.",
  },
  [VOICE_FAILURE.VOICE_UNAVAILABLE]: {
    words: "Voice is temporarily unavailable. Try again later.",
  },
} as const satisfies Record<VoiceFailure, VoiceFailureWords>;

/** The label of each remedy's button. */
export const VOICE_REMEDY_LABEL = {
  [VOICE_REMEDY.ADD_OPENAI_KEY]: "Add an OpenAI key",
  [VOICE_REMEDY.ALLOW_MICROPHONE]: "Open System Settings",
  [VOICE_REMEDY.ADD_OPENAI_CREDIT]: "Add OpenAI credit",
} as const satisfies Record<VoiceRemedy, string>;

const VOICE_FAILURES: ReadonlySet<string> = new Set(Object.values(VOICE_FAILURE));

/** Whether a value crossing from another window is one of the voice's failures, and no free text. */
export function isVoiceFailure(value: unknown): value is VoiceFailure {
  return typeof value === "string" && VOICE_FAILURES.has(value);
}
