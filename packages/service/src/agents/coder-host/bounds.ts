import { Duration } from "effect";
import { REPOSITORY_SANDBOX_CONTRACT } from "../repository-sandbox-contract.js";

/**
 * bounds.ts -- the bounds and names the coding-agent host runs under.
 *
 * A coding agent is one eve session over a `coding_agent` conversation, run
 * by the second eve service beside the brain: the same door, the
 * same conversation admission, the same relay into the store, under a
 * different agent. What differs is named here: how long its sandbox may
 * live and how large it is, how often the repository credential at its
 * firewall is renewed, where its checkout stands, how a transcript read
 * waits, how full its context grows before eve compacts it, and how much
 * a worker it delegates to may spend.
 */
export const CODER = {
  /** The most a Vercel Sandbox session may live: the platform's own maximum, so a long run is never cut off mid-turn. */
  SANDBOX_TIMEOUT_MS: 24 * 60 * 60 * 1_000,
  /**
   * The sandbox's vCPUs, each with 2 GB of memory. Four, because oxlint with
   * JS plugins reserves its arena as one mapping of about 6 GiB, which the
   * kernel's default overcommit refuses where memory is the two-vCPU 4 GB, so
   * the repository's lint panicked there at any thread count.
   */
  SANDBOX_VCPUS: 4,
  /**
   * The snapshots Vercel keeps of the agent's sandbox: the newest alone, which
   * is all a resume reads, so snapshot storage stays flat however many turns
   * stop it. An evicted one is deleted at once, and the kept one expires a
   * month after it was last used, named here because Vercel's own pages
   * disagree on the default.
   */
  SANDBOX_SNAPSHOTS: { count: 1, expiration: Duration.days(30), deleteEvicted: true },
  /** An installation token is good for an hour from its mint; the one at the firewall is renewed this long after, inside that hour. */
  GITHUB_TOKEN_REFRESH: Duration.minutes(50),
  /**
   * The longest one pause (`sleep.ts`) may be. The credential at the
   * firewall is renewed only as a step starts, so a step may start on one
   * nearly fifty minutes old; a pause past the ten minutes it has left would
   * leave a background command reaching GitHub, such as a watch of the
   * checks, signed out before the next step renews it. Eight leaves room for
   * the step's own model call ahead of the pause; a longer wait is two.
   */
  SLEEP_MAX: Duration.minutes(8),
  /** The context window the session is told where the catalog names none for the model. */
  FALLBACK_CONTEXT_WINDOW_TOKENS: 200_000,
  /**
   * The share of the context window past which eve compacts the session,
   * told to eve as the agent's own setting (`apps/dev/agent.ts`) and read by
   * the agent's tab as the line its context ring turns red at. It is eve's
   * own default, written down so the two cannot drift apart.
   */
  COMPACTION_THRESHOLD_SHARE: 0.9,
  /** Where the agent's checkout stands in its sandbox, which is where the brain's checkout stands too. */
  CHECKOUT_PATH: REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT,
  /** The branches an agent works on; an instruction to the model, enforced by nothing. */
  BRANCH_PREFIX: "luke/",
  /** The most times an agent fixes a failing check on its pull request and pushes again before it stops and says so; an instruction to the model, enforced by nothing. */
  CI_FIX_ROUNDS: 3,
  /** How long a transcript read is held open for a new message while the agent runs, inside the function's own duration. */
  MESSAGES_HOLD: Duration.seconds(20),
  /** How often a held transcript read looks for a new message. */
  MESSAGES_POLL: Duration.millis(500),
  /**
   * How often a held read of what waits across the account looks for a
   * change. Slower than `MESSAGES_POLL`, because a desktop holds that read
   * for as long as it is signed in, and an item heard a moment later costs
   * the developer nothing.
   */
  ACCOUNT_INBOX_POLL: Duration.seconds(2),
  /**
   * How long a title call may take before its agent or worker goes untitled
   * (`title.ts`), which is also how long after a delegation a read of an
   * ended agent, or of the worker, waits for the worker's title to land.
   */
  TITLE_TIMEOUT: Duration.seconds(20),
  /** The turns an agent is titled in (`title.ts`), past which an untitled agent keeps the model's name and a read waits for no title of its own. */
  TITLE_TURNS: 3,
  /** How long one instance keeps what an agent published before asking GitHub again; a tab asks beside every page of a held read. */
  PUBLISHED_TTL: Duration.seconds(30),
  /**
   * How long after its Start an agent with no turn row yet still reads as
   * starting. eve took the session and its first turn lands in seconds; an
   * agent still without one past this is read as failed, so nothing reads
   * starting forever and no transcript read is held for it.
   */
  STARTING_GRACE: Duration.minutes(5),
  /**
   * How long a line of the developer's may stand with no turn to take it
   * while none runs, and still read the agent as running. eve opens the
   * turn on a line it took in seconds, as it lands the first turn of a
   * Start (`STARTING_GRACE`, whose length this shares); a line still
   * waiting past this is one whose turn is not coming, as when the session
   * failed with the store's hooks failing beside it, so no failed turn was
   * written. It is read as failed rather than running forever, so the
   * developer is offered Continue on it.
   */
  LINE_GRACE: Duration.minutes(5),
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
  NO_FAST_VERSION:
    "Not run: Luke cannot run the fast version of the agent's model at its provider. Choose the model with Fast off.",
  /** No step is refused this way since Fast runs on an account's own key; kept for the turns that were refused so before, which still read as this. */
  FAST_ON_OWN_KEY:
    "Not run: Fast isn't available on your own API key; Luke runs Fast on its own Anthropic key alone. Choose the model with Fast off.",
  /** No step fails this way since a refused fast call runs at standard speed; kept for the turns that failed so before, which still read as this. */
  FAST_NOT_ENABLED:
    "Not run: Fast mode isn't enabled for this Anthropic organization. Choose the model with Fast off.",
  ACCOUNT_KEY_UNREADABLE:
    "Not run: your own API key for the agent's model provider cannot be read. Replace it in Settings.",
  ACCOUNT_KEY_REFUSED:
    "Not run: the provider refused your own API key for the agent's model. Replace it in Settings.",
  ACCOUNT_KEY_NO_QUOTA:
    "Not run: the provider refused the work for your own API key's billing or quota.",
  NOT_REACHABLE:
    "Not run: the agent's repository is not reachable through the GitHub installation connected to its task's workspace.",
  GITHUB_UNAVAILABLE: "Not run: GitHub could not be asked for the repository's credential.",
  NO_DELEGATION: "Not run: this session is no worker of a coding agent's.",
  NO_DELEGATION_PINNED: "Not run: the worker's session was started by no call of a coding agent's.",
  CATALOG_UNAVAILABLE: "Not run: the model catalog could not be read; delegate again in a moment.",
} as const;

export type CoderRefusal = (typeof CODER_REFUSAL)[keyof typeof CODER_REFUSAL];
