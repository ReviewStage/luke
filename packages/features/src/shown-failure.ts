/**
 * shown-failure.ts -- what Sentry is told of a failure the app showed a person: a log line for every one, and an issue besides for one nothing named, each carrying where it was shown, its code, its cause, the ids it was about, and the app's state, never the words a person wrote.
 *
 * The panel hands every failure it shows here (`@luke/panel/failure-report`),
 * an error toast and a failure drawn in place of what could not be read
 * alike. Each becomes one Sentry log line, searchable by every attribute
 * below: at `warn` for a refusal something named, such as a limit or a
 * refusal the service or the host worded, and at `error` for anything else.
 * One nothing named becomes an issue besides, grouped by where it was shown
 * and its code rather than by its stack, since one surface shows the same
 * failure from many paths.
 *
 * What it carries is chosen here rather than read from the failure whole:
 * names, tags, codes, HTTP statuses, faults, ids, the app's state, and the
 * cause's own message, every string read from the cause with each
 * credential-shaped run replaced (`credential-redaction.ts`) and cut at a
 * bound. There is no field for what
 * a person typed, a transcript, a plan, or a file. Note that a cause's
 * message is the error's own words, as an error's words already reach
 * Sentry (root `AGENTS.md`), and a refusal's is the sentence the service or
 * the host drew for it.
 *
 * Written against the few calls it makes rather than one SDK's types, so the
 * desktop's `@sentry/electron` and the web's `@sentry/browser` each hand
 * their own, as `sentry-reporting.ts` takes them.
 */

import { Predicate } from "effect";
import { redactCredentials } from "./credential-redaction.js";

/** Where a failure was shown: the surface whose words said so. */
export const FAILURE_SURFACE = {
  /** An act a person pressed for, whose answer nothing else read (`pressAct`). */
  ACT: "act",
  ACCOUNT_SIGN_OUT: "account.sign_out",
  ADMIN_WRITE: "admin.write",
  AGENT_ARCHIVE: "agent.archive",
  AGENT_PIN: "agent.pin",
  AGENT_RENAME: "agent.rename",
  AGENT_SERVERS: "agent.servers",
  AGENT_START: "agent.start",
  AGENT_STOP: "agent.stop",
  AUTOMATION_RUN: "automation.run",
  AUTOMATION_TOGGLE: "automation.toggle",
  CHANNEL_MOVE: "channel.move",
  COPY: "copy",
  FILE_READ: "file.read",
  FILE_SAVE: "file.save",
  GITHUB_ACCOUNT: "github.account",
  INBOX_CLOSE: "inbox.close",
  INBOX_MARK: "inbox.mark",
  MESSAGE_REVEAL: "message.reveal",
  OPERATOR_RESET: "operator.reset",
  PIN_MOVE: "pin.move",
  PLAN_ADD: "plan.add",
  PLAN_BREAKDOWN: "plan.breakdown",
  PLAN_RESTORE: "plan.restore",
  PLAN_SAVE: "plan.save",
  PULL_REQUEST_THREAD: "pull_request.thread",
  REPOSITORY_PIN: "repository.pin",
  SECTION_WRITE: "section.write",
  SETTING_WRITE: "setting.write",
  SETTINGS_RESET: "settings.reset",
  TASK_BLOCK: "task.block",
  TASK_DELETE: "task.delete",
  TASK_MARK: "task.mark",
  TASK_MOVE: "task.move",
  TASK_SETTLE: "task.settle",
  TASK_STANDING: "task.standing",
  TERMINAL_CREATE: "terminal.create",
  TRANSCRIPT_COPY: "transcript.copy",
  WINDOW_ZOOM: "window.zoom",
} as const;
export type FailureSurface = (typeof FAILURE_SURFACE)[keyof typeof FAILURE_SURFACE];

/**
 * What a failure shown with no cause at hand names in its place: the
 * condition its surface saw, sent as its code.
 */
export const FAILURE_CONDITION = {
  /** What it was about is no longer there. */
  GONE: "gone",
  /** A read answered nothing to show, and nothing more. */
  UNREAD: "unread",
  /** A write answered that it was not kept, and nothing more. */
  NOT_KEPT: "not-kept",
  /** A refusal that said nothing more. */
  REFUSED: "refused",
  /** Another write landed first. */
  CONFLICT: "conflict",
} as const;

/** Whether a failure was a refusal something named, which is expected, or anything else. */
export const FAILURE_KIND = { REFUSED: "refused", UNEXPECTED: "unexpected" } as const;
export type FailureKind = (typeof FAILURE_KIND)[keyof typeof FAILURE_KIND];

/** The ids of what a failure was about, each where it is known. */
export interface FailureAbout {
  readonly workspaceId?: string | undefined;
  readonly taskId?: string | undefined;
  readonly agentId?: string | undefined;
  readonly conversationId?: string | undefined;
  readonly turnId?: string | undefined;
  readonly inboxItemId?: string | undefined;
  readonly automationId?: string | undefined;
  readonly channelId?: string | undefined;
  readonly pullRequest?: number | undefined;
}

/** The app's state as a failure was shown. */
interface FailureState {
  /** Whether the machine had a network, as its platform last answered. */
  readonly online: boolean;
  /** Where the account stood: signed in, signing in, or signed out. */
  readonly account: string;
  /** The live stream's state, where one stands. */
  readonly live?: string | undefined;
}

/** A failure as it is reported: where it was shown, whether it was named, what failed, what it was about, by which act, and the app's state then. */
export interface ShownFailureReport {
  readonly surface: FailureSurface;
  readonly kind: FailureKind;
  readonly cause: unknown;
  readonly about: FailureAbout;
  readonly act?: string | undefined;
  readonly state: FailureState;
}

/** What a log line or an issue's context carries: names and values, never an object. */
type FailureAttributes = Record<string, string | number | boolean>;

/** The level a shown failure's issue is sent at. */
const ISSUE_LEVEL = "error";

/** What an issue tells Sentry beside its error: the path that caught it, and its level, grouping, tags, and context. */
interface ShownFailureHint {
  readonly mechanism: { readonly type: string; readonly handled: boolean };
  readonly captureContext: {
    readonly level: typeof ISSUE_LEVEL;
    readonly fingerprint: string[];
    readonly tags: FailureAttributes;
    readonly contexts: Record<string, FailureAttributes>;
  };
}

/** The calls of a Sentry SDK a shown failure is sent through, as `@sentry/electron/renderer` and `@sentry/browser` both export them. */
export interface ShownFailureSentry {
  readonly captureException: (error: Error, hint: ShownFailureHint) => string;
  readonly logger: {
    readonly warn: (message: string, attributes: FailureAttributes) => void;
    readonly error: (message: string, attributes: FailureAttributes) => void;
  };
}

/** What a cause says of itself, each where it says it. */
interface CauseFacts {
  readonly name?: string | undefined;
  readonly tag?: string | undefined;
  readonly code?: string | undefined;
  readonly status?: number | undefined;
  readonly fault?: string | undefined;
  readonly message?: string | undefined;
}

/** Every condition a failure may name in place of its cause, which a cause is read against. */
const FAILURE_CONDITIONS: ReadonlySet<unknown> = new Set(Object.values(FAILURE_CONDITION));

/** The attribute each id is sent under. */
const ABOUT_ATTRIBUTE = {
  workspaceId: "workspace.id",
  taskId: "task.id",
  agentId: "agent.id",
  conversationId: "conversation.id",
  turnId: "turn.id",
  inboxItemId: "inbox_item.id",
  automationId: "automation.id",
  channelId: "channel.id",
  pullRequest: "pull_request.number",
} as const satisfies { readonly [Key in keyof Required<FailureAbout>]: string };

/** The attribute each fact of the cause the panel saw is sent under. */
const ERROR_ATTRIBUTE = {
  name: "error.name",
  tag: "error.tag",
  code: "error.code",
  status: "error.status",
  fault: "error.fault",
  message: "error.message",
} as const satisfies { readonly [Key in keyof Required<CauseFacts>]: string };

/** The attribute each fact of the cause at the root of its chain is sent under, where it is another. */
const ROOT_ATTRIBUTE = {
  name: "error.root.name",
  tag: "error.root.tag",
  code: "error.root.code",
  status: "error.root.status",
  fault: "error.root.fault",
  message: "error.root.message",
} as const satisfies { readonly [Key in keyof Required<CauseFacts>]: string };

/** The attributes saying where it was shown, how, and in what state. */
const FAILURE_ATTRIBUTE = {
  SURFACE: "failure.surface",
  KIND: "failure.kind",
  CODE: "failure.code",
  ACT: "failure.act",
  ONLINE: "app.online",
  ACCOUNT: "app.account",
  LIVE: "app.live",
} as const;

/** The issue's context its attributes travel under. */
const SHOWN_FAILURE_CONTEXT = "shown_failure";

/** The mechanism an issue names, so Sentry says which path caught it; handled, since the app showed it. */
const SHOWN_FAILURE_MECHANISM = "auto.luke.shown_failure";

/** What every issue's fingerprint starts with, so a shown failure never groups with a crash of the same name. */
const SHOWN_FAILURE_FINGERPRINT = "shown-failure";

/** The code of a failure whose cause names none and has no name. */
const UNNAMED_CODE = "unnamed";

/** How long text read from a cause may be once redacted; past it, the rest is cut. */
const TEXT_BOUND = 500;

/** How deep a cause's chain is read: past it, the rest is left out. */
const CHAIN_BOUND = 5;

/** The key a value's cause is read from, as `Error`'s `cause` names it. */
const CAUSE_KEY = "cause";

/** A property of `value` that is a string, or nothing. */
function stringOf(value: unknown, key: string): string | undefined {
  if (!Predicate.hasProperty(value, key)) return undefined;
  const read = value[key];
  return Predicate.isString(read) ? read : undefined;
}

/** A property of `value` that is a number, or nothing. */
function numberOf(value: unknown, key: string): number | undefined {
  if (!Predicate.hasProperty(value, key)) return undefined;
  const read = value[key];
  return Predicate.isNumber(read) ? read : undefined;
}

/**
 * Text read from a cause as it may be sent: every credential-shaped run
 * replaced, and cut at the bound. Note that a name, a tag, a code, and a
 * fault pass here as a message does, because each is whatever string the
 * cause held, and a code becomes a tag and the issue's fingerprint besides.
 */
function sendableText(text: string): string {
  const redacted = redactCredentials(text);
  return redacted.length > TEXT_BOUND ? `${redacted.slice(0, TEXT_BOUND)}…` : redacted;
}

/** A string a cause holds under `key`, as it may be sent, or nothing. */
function sendableOf(value: unknown, key: string): string | undefined {
  const read = stringOf(value, key);
  return read === undefined ? undefined : sendableText(read);
}

/**
 * What a cause says of itself: a condition named in its place as its code,
 * a sentence as its message, or else its name, `_tag`, code, HTTP status,
 * fault, and message, read by the fields an `Error`, an Effect tagged error, an
 * oRPC error, a hosted refusal's slug (`refusal`), a client's failed
 * answer (`{ failure }`), and a refused action's answer carry them in. Note that a refused answer's
 * `status` is a word, kept as its code, while an HTTP status is a number.
 */
function factsOf(cause: unknown): CauseFacts {
  if (FAILURE_CONDITIONS.has(cause) && Predicate.isString(cause)) return { code: cause };
  if (Predicate.isString(cause)) return { message: sendableText(cause) };
  const code = numberOf(cause, "code")?.toString() ?? sendableOf(cause, "code");
  const message = stringOf(cause, "message") ?? stringOf(cause, "reason");
  return {
    name: cause instanceof Error ? sendableText(cause.name) : sendableOf(cause, "name"),
    tag: sendableOf(cause, "_tag"),
    code:
      code ??
      sendableOf(cause, "failure") ??
      sendableOf(cause, "refusal") ??
      sendableOf(cause, "status"),
    status: numberOf(cause, "status") ?? numberOf(cause, "statusCode"),
    fault: sendableOf(cause, "fault"),
    message: message === undefined || message === "" ? undefined : sendableText(message),
  };
}

/** A cause and the causes beneath it, outermost first, as deep as the bound. */
function chainOf(cause: unknown): readonly unknown[] {
  const chain = [cause];
  let next = cause;
  while (chain.length < CHAIN_BOUND && Predicate.hasProperty(next, CAUSE_KEY)) {
    next = next[CAUSE_KEY];
    if (next === undefined || next === null || chain.includes(next)) break;
    chain.push(next);
  }
  return chain;
}

/**
 * A failure's code: the first code, fault, or tag its chain names, from the
 * outside in, a code before a fault before a tag since each is narrower than
 * the next, or else the name of the cause at its root, so a fault a failure
 * wrapped is grouped by what it was.
 */
function codeOf(chain: readonly CauseFacts[]): string {
  const named = chain.find((facts) => (facts.code ?? facts.fault ?? facts.tag) !== undefined);
  return named?.code ?? named?.fault ?? named?.tag ?? chain.at(-1)?.name ?? UNNAMED_CODE;
}

/** Each fact under its attribute's name, for those the cause says. */
function factAttributes(
  facts: CauseFacts,
  names: { readonly [Key in keyof Required<CauseFacts>]: string },
): FailureAttributes {
  const attributes: FailureAttributes = {};
  for (const key of Object.keys(names) as (keyof CauseFacts)[]) {
    const value = facts[key];
    if (value !== undefined) attributes[names[key]] = value;
  }
  return attributes;
}

/** Each id under its attribute's name, for those that are known. */
function aboutAttributes(about: FailureAbout): FailureAttributes {
  const attributes: FailureAttributes = {};
  for (const key of Object.keys(ABOUT_ATTRIBUTE) as (keyof FailureAbout)[]) {
    const value = about[key];
    if (value !== undefined) attributes[ABOUT_ATTRIBUTE[key]] = value;
  }
  return attributes;
}

/** What a failure's log line and issue carry: where, how, its cause and its root's, the ids, and the app's state. */
function attributesOf(report: ShownFailureReport, chain: readonly CauseFacts[], code: string) {
  const root = chain.length > 1 ? chain.at(-1) : undefined;
  return {
    [FAILURE_ATTRIBUTE.SURFACE]: report.surface,
    [FAILURE_ATTRIBUTE.KIND]: report.kind,
    [FAILURE_ATTRIBUTE.CODE]: code,
    ...(report.act === undefined ? {} : { [FAILURE_ATTRIBUTE.ACT]: report.act }),
    ...factAttributes(chain[0] ?? {}, ERROR_ATTRIBUTE),
    ...(root === undefined ? {} : factAttributes(root, ROOT_ATTRIBUTE)),
    ...aboutAttributes(report.about),
    [FAILURE_ATTRIBUTE.ONLINE]: report.state.online,
    [FAILURE_ATTRIBUTE.ACCOUNT]: report.state.account,
    ...(report.state.live === undefined ? {} : { [FAILURE_ATTRIBUTE.LIVE]: report.state.live }),
  } satisfies FailureAttributes;
}

/**
 * A stack as it may be sent: the cause's own frames under the header the
 * sent error says, where the cause's stack opens on its own header, as V8's
 * does; one that opens otherwise, as Safari's and Firefox's frames alone
 * do, is kept as it is, since its frames carry no message.
 */
function sendableStack(cause: Error, sent: Error): string | undefined {
  const stack = cause.stack;
  if (stack === undefined) return undefined;
  const header = cause.message === "" ? cause.name : `${cause.name}: ${cause.message}`;
  if (!stack.startsWith(header)) {
    return cause.message !== "" && stack.includes(cause.message) ? undefined : stack;
  }
  const sentHeader = sent.message === "" ? sent.name : `${sent.name}: ${sent.message}`;
  return `${sentHeader}${stack.slice(header.length)}`;
}

/**
 * The error an issue is captured with: the cause's name, or its tag, its
 * message as it may be sent, its own frames, and the causes beneath it
 * likewise, so Sentry's linked errors read no message unredacted.
 */
function sendableError(chain: readonly unknown[], facts: readonly CauseFacts[]): Error {
  const [cause, ...beneath] = chain;
  const [own, ...beneathFacts] = facts;
  const linked = beneath.length === 0 ? undefined : { cause: sendableError(beneath, beneathFacts) };
  const sent = new Error(own?.message ?? "", linked);
  sent.name = own?.tag ?? own?.name ?? UNNAMED_CODE;
  const stack = cause instanceof Error ? sendableStack(cause, sent) : undefined;
  if (stack !== undefined) sent.stack = stack;
  return sent;
}

/**
 * The ids a payload names under the keys `FailureAbout` reads, for an act
 * whose failure was shown with nothing else to say what it was about.
 */
export function failureAboutOf(payload: unknown): FailureAbout {
  return {
    workspaceId: stringOf(payload, "workspaceId"),
    taskId: stringOf(payload, "taskId"),
    agentId: stringOf(payload, "agentId"),
    conversationId: stringOf(payload, "conversationId"),
    turnId: stringOf(payload, "turnId"),
    inboxItemId: stringOf(payload, "inboxItemId"),
    automationId: stringOf(payload, "automationId"),
    channelId: stringOf(payload, "channelId"),
    pullRequest: numberOf(payload, "pullRequest"),
  };
}

/**
 * Sends Sentry a failure the app showed: a log line, at `warn` for a refusal
 * something named and at `error` for anything else, and for anything else
 * an issue besides, grouped by where it was shown and its code.
 */
export function sendShownFailure(sentry: ShownFailureSentry, report: ShownFailureReport): void {
  const chain = chainOf(report.cause);
  const facts = chain.map(factsOf);
  const code = codeOf(facts);
  const attributes = attributesOf(report, facts, code);
  const line = `A failure was shown on ${report.surface}: ${code}`;
  if (report.kind === FAILURE_KIND.REFUSED) {
    sentry.logger.warn(line, attributes);
    return;
  }
  sentry.logger.error(line, attributes);
  sentry.captureException(sendableError(chain, facts), {
    mechanism: { type: SHOWN_FAILURE_MECHANISM, handled: true },
    captureContext: {
      level: ISSUE_LEVEL,
      fingerprint: [SHOWN_FAILURE_FINGERPRINT, report.surface, code],
      tags: {
        [FAILURE_ATTRIBUTE.SURFACE]: report.surface,
        [FAILURE_ATTRIBUTE.CODE]: code,
        ...aboutAttributes(report.about),
      },
      contexts: { [SHOWN_FAILURE_CONTEXT]: attributes },
    },
  });
}
