import { Duration } from "effect";
import { REPOSITORY_SANDBOX_CONTRACT } from "../repository-shell.js";

/**
 * bounds.ts -- the bounds and names the coding-agent host runs under.
 *
 * A coding agent is one eve session over a `coding_agent` conversation, run
 * by the second eve service beside the planning brain: the same door, the
 * same conversation admission, the same relay into the store, under a
 * different agent. What differs is named here: how long its sandbox may
 * live, how often the repository credential at its firewall is renewed,
 * where its checkout stands, and how a transcript read waits.
 */
export const CODER = {
  /** The most a Vercel Sandbox session may live: the platform's own maximum, so a long run is never cut off mid-turn. */
  SANDBOX_TIMEOUT_MS: 24 * 60 * 60 * 1_000,
  /** An installation token is good for an hour from its mint; the one at the firewall is renewed this long after, inside that hour. */
  GITHUB_TOKEN_REFRESH: Duration.minutes(50),
  /** The context window the session is told where the catalog names none for the model. */
  FALLBACK_CONTEXT_WINDOW_TOKENS: 200_000,
  /** Where the agent's checkout stands in its sandbox, which is where the planning checkout stands too. */
  CHECKOUT_PATH: REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT,
  /** The branches an agent works on; an instruction to the model, enforced by nothing. */
  BRANCH_PREFIX: "luke/",
  /** How long a transcript read is held open for a new message while the agent runs, inside the function's own duration. */
  MESSAGES_HOLD: Duration.seconds(20),
  /** How often a held transcript read looks for a new message. */
  MESSAGES_POLL: Duration.millis(500),
  /**
   * How long after its Start an agent with no turn row yet still reads as
   * starting. eve took the session and its first turn lands in seconds; an
   * agent still without one past this is read as failed, so nothing reads
   * starting forever and no transcript read is held for it.
   */
  STARTING_GRACE: Duration.minutes(5),
} as const;

/** The environment the coding-agent host reads beside the names every hosted route already honours. */
export const CODER_ENVIRONMENT = {
  /** Selects the scripted fixture model in place of the providers; set only by the fixture eval. */
  MODEL_FIXTURE: "LUKE_CODER_MODEL_FIXTURE",
} as const;

/** The one fixture the model environment may name, and the model id its turns are recorded under. */
export const CODER_MODEL_FIXTURE = {
  SCRIPTED: "scripted",
  SCRIPTED_MODEL_ID: "luke-coder-scripted",
} as const;

/** Why the host refused a session's standing or a step, in words a log or a failed turn can carry. */
export const CODER_REFUSAL = {
  NO_AGENT: "Not run: this conversation is no coding agent's.",
  UNKNOWN_PROVIDER: "Not run: the agent's model is outside the providers Luke runs agents on.",
  NO_PROVIDER_KEY: "Not run: this deployment holds no key for the agent's model provider.",
  SIGN_IN_REQUIRED:
    "Not run: the developer must sign in with GitHub again before the repository can be checked out.",
  NOT_REACHABLE:
    "Not run: the agent's repository is not reachable for the developer through the Luke GitHub App.",
  GITHUB_UNAVAILABLE: "Not run: GitHub could not be asked for the repository's credential.",
} as const;

export type CoderRefusal = (typeof CODER_REFUSAL)[keyof typeof CODER_REFUSAL];
