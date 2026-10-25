import { EXCESS_KEYS } from "@luke/wire";
import { readEither, verbatimJsonSchema } from "@luke/wire/effect";
import { Schema as EffectSchema, SchemaTransformation } from "effect";

/**
 * The vocabulary every hosted endpoint shares: how a refusal is worded, what
 * a day's allowance looks like, and the two text shapes the per-domain
 * declarations are written from. Each domain's own answers live in its own
 * wire module beside this one.
 *
 * Every declaration below is composed directly as an Effect `Schema` and
 * exported under its own name: a caller reads a request through `readEither`,
 * an answer through `readServiceAnswer` below, and shows either through
 * `emitJsonSchema` from `@luke/wire/effect`.
 */

/** Every refusal a hosted endpoint answers with, by its reason. */
export const HOSTED_API_ERROR = {
  /** The bearer token is missing, expired, or revoked. */
  INVALID_TOKEN: "invalid-token",
  /** The request body is not what this endpoint takes. */
  INVALID_REQUEST: "invalid-request",
  /**
   * Today's free allowance for this meter is spent, or — on the recording
   * endpoint, which meters nothing — this account has sent more counts this
   * minute than the brake allows.
   */
  QUOTA_EXHAUSTED: "quota-exhausted",
  /**
   * The deployment holds no key for what was asked — OpenAI's for the hosted
   * tier, the analytics processor's for recording — so that endpoint is off.
   */
  UNAVAILABLE: "unavailable",
  /** The upstream refused or failed; the status travels, the bodies never do. */
  UPSTREAM_ERROR: "upstream-error",
  /**
   * The upstream itself is rate limiting; nothing was answered. Distinct from
   * a spent allowance: the caller cools down for the bounded wait the
   * `Retry-After` header names rather than for the day.
   */
  UPSTREAM_THROTTLED: "upstream-throttled",
  /** The request body weighs more than the endpoint's fixed byte bound; nothing of it was read. */
  REQUEST_TOO_LARGE: "request-too-large",
  /** The prepared prompt is longer than the contract's own prompt envelope; nothing was sent upstream. */
  PROMPT_TOO_LARGE: "prompt-too-large",
  /** A tool name the service's catalog does not register; no schema was selected. */
  UNKNOWN_TOOL: "unknown-tool",
  METHOD_NOT_ALLOWED: "method-not-allowed",
  /** The row the path names is not one this account holds; another account's and none at all read alike. */
  NOT_FOUND: "not-found",
  /**
   * The GitHub installation connected to the workspace reaches no such
   * repository, or the workspace has none connected. Nothing was written.
   */
  REPOSITORY_NOT_REACHABLE: "repository-not-reachable",
  /**
   * GitHub did not answer whether the workspace reaches the repository: it
   * was down, rate limiting, or slow past the deadline. Nothing was written,
   * and the same request a moment later may be taken.
   */
  GITHUB_UNANSWERED: "github-unanswered",
  /** The task names no repository yet, so there is nothing for a coding agent to check out; the developer picks one first. */
  NO_REPOSITORY: "no-repository",
  /** The branch a coding agent was asked to start on is none of the repository's on GitHub; nothing was started. */
  BRANCH_NOT_FOUND: "branch-not-found",
  /** The message spells more characters than one message to a coding agent may; shortened, it is taken. */
  MESSAGE_TOO_LONG: "message-too-long",
  /** The agent's session is still coming up and could not take the message yet; the same message a moment later is taken. */
  AGENT_NOT_READY: "agent-not-ready",
  /** The agent's session has ended for good: its sandbox cannot be reached again, and only a new agent goes on from here. */
  AGENT_RETIRED: "agent-retired",
  /**
   * The agent runs on a native harness whose sandbox image is still being
   * prepared, so it could not start or take the message yet; nothing was
   * written, and the same request a little later, under the same key, is taken.
   */
  AGENT_IMAGE_PREPARING: "agent-image-preparing",
  /**
   * The agent runs on a native harness (Claude Code or Codex) that this part
   * of Luke cannot reach yet, such as a call, which runs on eve alone; nothing
   * was written or charged. It is reached from the agent's own tab.
   */
  NATIVE_AGENT_NOT_HERE: "native-agent-not-here",
  /**
   * What was asked runs on OpenAI (a voice call, a dictated clip) and the
   * account saved no OpenAI API key of its own, which Luke spends none of its
   * own in place of; nothing was sent or charged. The key is added in Settings.
   */
  OPENAI_KEY_MISSING: "openai-key-missing",
  /**
   * What was asked runs on the account's own OpenAI key, and OpenAI refused
   * that key as none of its own: revoked, deleted, or mistyped. Nothing of
   * OpenAI's answer travels beside the slug. A new key is saved in Settings.
   */
  OPENAI_KEY_REFUSED: "openai-key-refused",
  /**
   * What was asked runs on the account's own OpenAI key, and OpenAI answered
   * that the key's account has no credit left (its `insufficient_quota`).
   * Nothing of OpenAI's answer travels beside the slug. Credit is added on
   * OpenAI's own billing page.
   */
  OPENAI_KEY_UNFUNDED: "openai-key-unfunded",
  /**
   * The agent runs on its starter's plan (a ChatGPT plan, on Codex), and the
   * starter's sign-in cannot launch it: none is kept, the provider signed it
   * out, or the service cannot open it. The starter signs in again in
   * Settings; nothing was written, and nothing turned to another payer.
   */
  AGENT_PLAN_SIGNED_OUT: "agent-plan-signed-out",
  /**
   * The agent runs on its starter's plan and its provider did not answer as
   * the sign-in was renewed; nothing was written, and the same request a
   * little later, under the same key, may be taken.
   */
  AGENT_PLAN_UNREACHABLE: "agent-plan-unreachable",
  /**
   * The agent runs on its starter's plan, whose usage limit refused its last
   * turn and has not reset; nothing was written, nothing turned to another
   * payer, and the same request after the reset may be taken.
   */
  AGENT_PLAN_LIMIT_REACHED: "agent-plan-limit-reached",
  /**
   * The agent runs on its starter's plan, whose provider said the account
   * is not eligible to run it; nothing was written, and nothing turned to
   * another payer.
   */
  AGENT_PLAN_INELIGIBLE: "agent-plan-ineligible",
  /**
   * The account keeps no credential that pays for a coding agent on the
   * model's provider: neither that provider's subscription (a Claude
   * setup-token, a ChatGPT sign-in) nor its API key. Luke's own key pays for
   * no coding agent, so nothing was written; the refusal names the provider,
   * which the account connects in Settings › Agents.
   */
  AGENT_CREDENTIAL_MISSING: "agent-credential-missing",
  /**
   * The agent runs on its starter's API key, which is saved but cannot be
   * opened under this deployment's key ring, as on a Preview whose database
   * holds keys sealed under production's. No retry opens it: the starter
   * saves the key again in Settings › Agents. Nothing was written.
   */
  AGENT_API_KEY_UNREADABLE: "agent-api-key-unreadable",
  /**
   * The task is archived: it is read, and takes nothing — no edit, no call,
   * no agent started or sent a message — until it is brought back. Nothing
   * was written.
   */
  TASK_ARCHIVED: "plan-archived",
  /**
   * The account's role in the workspace does not allow this: a member
   * removing someone, an owner removed or leaving. Nothing was written.
   */
  NOT_PERMITTED: "not-permitted",
  /** The address is already a member of the workspace, or already holds a pending invitation to it; nothing was sent. */
  ALREADY_INVITED: "already-invited",
  /** The coding agent's sandbox is stopped, so no shell starts in it until the developer resumes it; nothing was started. */
  SANDBOX_STOPPED: "sandbox-stopped",
  /**
   * The workspace's Linear could not be read: none is connected, Linear no
   * longer honours its grant, or the issue is none it reaches. An owner or
   * admin mends the first two in Settings › Workspace › Workspace connections.
   * Nothing was written.
   */
  LINEAR_UNAVAILABLE: "linear-unavailable",
  /** A skill of that name is already installed in the scope asked: the account's own, or the workspace's. Nothing was installed. */
  SKILL_NAME_TAKEN: "skill-name-taken",
  /** A skill's files were refused: past a skill's bounds, a `SKILL.md` that breaks the convention, or a credential-shaped literal. Nothing was installed. */
  SKILL_FILES_REFUSED: "skill-files-refused",
  /** A Start on This Mac was refused, for the reason it names (`LOCAL_AGENT_REFUSAL`). Nothing was written. */
  LOCAL_AGENT_REFUSED: "local-agent-refused",
} as const;

export type HostedApiError = (typeof HOSTED_API_ERROR)[keyof typeof HOSTED_API_ERROR];

/** What one day's allowance looked like when the service last answered. */
export interface HostedQuota {
  used: number;
  limit: number;
  /** When the day's counter resets, as epoch milliseconds. */
  resetsAt: number;
}

const HOSTED_API_ERROR_NAMES = Object.values(HOSTED_API_ERROR);

/**
 * A count an answer reports: any finite number at or above zero, whole or
 * not, because what these carry are the service's own counters and instants
 * and a fractional one is the service miscounting rather than the wire
 * carrying something else.
 */
export const countedNumber = EffectSchema.Finite.check(EffectSchema.isGreaterThanOrEqualTo(0));

/**
 * Reads an answer of the service, or a frame it sent, dropping any key a
 * newer service added rather than refusing the whole answer. Every desktop
 * read of what the service answered goes through this, because a build that
 * refused an unknown key — v0.11.0 reading a task — stops working the day
 * the service adds one. A request frame the desktop builds, an IPC act, and
 * anything the service parses are read with `readEither` as declared,
 * refusing a key they do not name.
 */
export const readServiceAnswer = <S extends EffectSchema.ConstraintDecoder<unknown>>(schema: S) =>
  readEither(schema, { excess: EXCESS_KEYS.DROP });

/**
 * An answer's records are plain structs: whether a key a newer service added
 * is dropped or refused is no longer the declaration's to state, so a reader
 * of one of these asks for it through {@link readServiceAnswer}, and the
 * option it passes reaches every struct nested inside.
 */
export const hostedQuotaSchema = EffectSchema.Struct({
  used: countedNumber,
  limit: countedNumber,
  resetsAt: countedNumber,
});

/** A member set read with its ends trimmed, the way an enum reads one. */
function trimmedEnum<const Member extends string>(members: readonly Member[]) {
  return verbatimJsonSchema(
    EffectSchema.Trim.pipe(
      EffectSchema.decodeTo(
        EffectSchema.Literals(members),
        SchemaTransformation.passthroughSupertype(),
      ),
    ),
    { type: "string", enum: members },
  );
}

const hostedErrorRecord = EffectSchema.Struct({ error: trimmedEnum(HOSTED_API_ERROR_NAMES) });

/** The error reason out of a refused hosted answer, or nothing. */
export const hostedErrorSchema = hostedErrorRecord.pipe(
  EffectSchema.decodeTo(
    EffectSchema.Literals(HOSTED_API_ERROR_NAMES),
    SchemaTransformation.transform({
      decode: (answer) => answer.error,
      encode: (error) => ({ error }),
    }),
  ),
);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

/** The length of a UUID as its text form spells it. */
export const WIRE_UUID_LENGTH = 36;

export function isWireUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

const trimmedUuidText = EffectSchema.Trim.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(WIRE_UUID_LENGTH),
);

/**
 * A row's or a device's id as the hosted wire takes it: the UUID text, case
 * folded so the same id spelled two ways is one. A stored id column is
 * `uuid`, and Postgres refuses any other text bound to it, so an id is held
 * to this shape at the boundary rather than met as a failed query.
 */
export const wireUuidSchema = trimmedUuidText
  .pipe(EffectSchema.decodeTo(EffectSchema.String, SchemaTransformation.toLowerCase()))
  .check(EffectSchema.makeFilter(isWireUuid));

/**
 * A member named where the service attributes work to one: their account's
 * id, and the name it holds now, a member who has since left the workspace
 * among them. The window calls the member You only where the id is its own
 * account's.
 */
export const memberRefSchema = EffectSchema.Struct({
  userId: EffectSchema.String,
  name: EffectSchema.String,
});
