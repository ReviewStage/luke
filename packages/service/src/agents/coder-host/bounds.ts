import { LINE_GRACE_MILLIS, STARTING_GRACE_MILLIS } from "@luke/features/coding-agent-status";
import { Duration } from "effect";
import { REPOSITORY_SANDBOX_CONTRACT } from "../repository-sandbox-contract.js";

/**
 * bounds.ts -- the bounds and names the coding-agent host runs under.
 *
 * A coding agent is one eve session over a `coding_agent` conversation, run
 * by the second eve service beside the brain: the same door, the
 * same conversation admission, the same relay into the store, under a
 * different agent. What differs is named here: how long its sandbox may
 * live, how it is kept alive, and how large it is, how often the repository credential at its
 * firewall is renewed, where its checkout stands, how a transcript read
 * waits, how full its context grows before eve compacts it, and how much
 * a worker it delegates to may spend.
 */
export const CODER = {
  /**
   * How long a Vercel Sandbox session lives past its last sign of use: the
   * timeout it opens with, and how far ahead of now each keep-alive puts its
   * end (`sandbox-lifetime.ts`). An idle sandbox is stopped by what knows it
   * idle rather than by this: an eve turn's end stops it at once, and so
   * does a pause from `SLEEP_STOPS_AT` on; a native runner keeps its sandbox
   * alive by its heartbeat for as long as it runs, and its end stops it,
   * which comes `RUNNER_WARM` after the agent's turn is over, or two minutes
   * into a wait on wakeups alone (`@luke/agent-runner`'s `RUNNER_RELEASE`,
   * whose process table tells the harness's own processes from the
   * agent's). A shorter timeout would stop none of those sooner, so this is
   * only the backstop for one nothing stopped, which bills its memory until
   * then: at the default size, 4 GB for an hour, where the
   * platform's 24-hour maximum billed 96 GB-hours. An hour, because a live
   * turn shows use far more often than that: an eve step starts at least
   * every few minutes
   * (`SLEEP_MAX` and the credential's renewal already lean on it), a native
   * runner posts its events as its harness emits them, and a terminal or a
   * watched browser closes after five idle minutes. Each of them keeps it
   * alive at most every `SANDBOX_KEEP_ALIVE_EVERY`, which leaves fifty
   * minutes of margin for the longest quiet stretch inside a turn.
   */
  SANDBOX_TIMEOUT_MS: 60 * 60 * 1_000,
  /**
   * The longest a Vercel Sandbox session may live in all, however often it is
   * kept alive: the platform's maximum on Pro and Enterprise, past which it
   * refuses an extension, so a keep-alive extends to it and no further.
   */
  SANDBOX_MAX_LIFETIME_MS: 24 * 60 * 60 * 1_000,
  /**
   * How often a live turn, a terminal, or a watched browser keeps the
   * sandbox alive: one lookup and at most one extension each time, so a
   * step's start or an event batch costs nothing more between them. Ten
   * minutes, a sixth of the timeout, so a check that fails once leaves the
   * next several to land before the sandbox would stop.
   */
  SANDBOX_KEEP_ALIVE_EVERY: Duration.minutes(10),
  /**
   * The sandbox's vCPUs, each with 2 GB of memory, where its repository asks
   * for no more (`SANDBOX_VCPUS_BY_REPOSITORY`); also the size the image's
   * template and a repository snapshot are built at, since Vercel opens a
   * snapshot at whatever size the create asks. Two, because provisioned
   * memory and active CPU are most of the sandboxes' bill and both scale
   * with vCPUs, so a repository whose own checks need more asks for it
   * rather than every sandbox paying for it.
   */
  SANDBOX_VCPUS: 2,
  /**
   * The repositories whose agents' sandboxes open larger than
   * `SANDBOX_VCPUS`, by `owner/name` lowercased, as `sandboxVcpus` reads
   * them; a repository asks for more by a row here. Luke's own is four,
   * because its typecheck needs about 5 GB of real memory. Measured on a
   * fresh checkout: `pnpm typecheck` takes 83 seconds at four vCPUs and peaks
   * near 5.2 GB, and at two vCPUs (4 GB) it is killed out of memory at a
   * workspace concurrency of 4 or 2; at 1 it passes in 194 seconds with 216
   * MiB free, before the agent's own runner is counted. The service's tests
   * take 1,527 seconds there against 415. Note that oxlint is not the limit:
   * with JS plugins it reserves about 6 GiB per thread, which the kernel's
   * default overcommit refuses at 4 GB, but it uses under one, and
   * `vm.overcommit_memory=1`, set on every boot, since a resumed sandbox
   * boots with the default, lets it lint there in 36 seconds.
   */
  SANDBOX_VCPUS_BY_REPOSITORY: new Map([["reviewstage/luke", 4]]) as ReadonlyMap<string, number>,
  /**
   * The snapshots Vercel keeps of the agent's sandbox: the newest alone, which
   * is all a resume reads, so snapshot storage stays flat however many turns
   * stop it. An evicted one is deleted at once, and the kept one expires a
   * week after it was last used, named here because Vercel's own pages
   * disagree on the default. A week, because the storage is billed for as long
   * as a snapshot is kept and an agent left idle longer is rarely picked up
   * again. The cost: an agent resumed after 7 idle days finds no snapshot and
   * starts from a fresh clone of its repository, so its uncommitted and
   * unpushed work is gone. An eve agent's sandbox opens anew through its
   * root's selector, checkout and all, where its sandbox or its snapshot is
   * gone (`patches/eve@0.74.0.patch`, held by
   * `agent-runtime/sandbox-resume.test.ts`), and a native agent's resume does
   * the same (`runner-sessions.ts`).
   */
  SANDBOX_SNAPSHOTS: { count: 1, expiration: Duration.days(7), deleteEvicted: true },
  /** An installation token is good for an hour from its mint; the one at the firewall is renewed this long after, inside that hour. */
  GITHUB_TOKEN_REFRESH: Duration.minutes(50),
  /**
   * The longest one pause (`sleep.ts`) may be. The credential at the
   * firewall is renewed only as a step starts, so a step may start on one
   * nearly fifty minutes old; a pause past the ten minutes it has left would
   * leave a background command reaching GitHub signed out before the next
   * step renews it. Eight leaves room for
   * the step's own model call ahead of the pause; a longer wait is two.
   */
  SLEEP_MAX: Duration.minutes(8),
  /**
   * The shortest pause (`sleep.ts`) the sandbox is stopped for, where no
   * process the agent started still runs (`../agent-runtime/sandbox-idle.ts`),
   * and resumed from its snapshot at the next step. Vercel bills provisioned
   * memory by the minute a session runs, idle or not, and a stop writes a
   * snapshot and the next step waits on a resume, so a pause shorter than
   * two billed minutes saves too little to be worth the resume
   * (https://vercel.com/kb/guide/vercel-sandbox-duration-and-persistence).
   */
  SLEEP_STOPS_AT: Duration.minutes(2),
  /** The context window the session is told where the catalog names none for the model. */
  FALLBACK_CONTEXT_WINDOW_TOKENS: 200_000,
  /**
   * The share of the context window past which eve compacts the session,
   * told to eve as the agent's own setting (`apps/dev/agent.ts`) and read by
   * the agent's tab as the line its context ring turns red at. It is eve's
   * own default, written down so the two cannot drift apart.
   */
  COMPACTION_THRESHOLD_SHARE: 0.9,
  /**
   * The share of the context window past which an operator's next turn is
   * told its history will soon be summarised, so it keeps what is durable
   * first (`turn-context.ts`'s `FLUSH_LINE`): below eve's own mark, so the
   * turn it is told on still runs before eve compacts.
   */
  FLUSH_THRESHOLD_SHARE: 0.8,
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
   * How many of a transcript read's independent queries run at once. The
   * function's pool holds five connections (`db/index.ts`), so one read
   * takes at most four and leaves one for the request's other reads.
   */
  READ_CONCURRENCY: 4,
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
  /** How long what a read of GitHub wrote on an agent's row answers a tab's read on any instance in GitHub's place (`published.ts`). */
  PUBLISHED_ROW_FRESH: Duration.seconds(60),
  /** How long an ended agent's closed pull request on its row answers in GitHub's place, since it may reopen where no webhook says so. */
  PUBLISHED_CLOSED_FRESH: Duration.minutes(10),
  /**
   * How long after its Start an agent with no turn row yet still reads as
   * starting. eve took the session and its first turn lands in seconds; an
   * agent still without one past this is read as failed, so nothing reads
   * starting forever and no transcript read is held for it.
   */
  STARTING_GRACE: Duration.millis(STARTING_GRACE_MILLIS),
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
  LINE_GRACE: Duration.millis(LINE_GRACE_MILLIS),
  /**
   * The lease one call holds on a native agent's runner across reading
   * whether it runs and writing to it or launching it
   * (`runner-sessions.ts`). `HOLD` is how long a lease stands before
   * another call may take it over: past the platform's default function
   * duration of five minutes, so a holder killed mid-launch lets go by
   * then, and longer than a launch with its checkout takes. `WAIT` is how
   * long a call waits behind another's lease before it fails as
   * unavailable, checking every `POLL`.
   */
  RUNNER_LEASE: {
    HOLD: Duration.minutes(5),
    WAIT: Duration.minutes(2),
    POLL: Duration.millis(250),
  },
  /**
   * How long a native agent's runner stays warm once its turn is over, for
   * the next message to reach it as a line on its stdin rather than through
   * a resumed sandbox and a relaunched CLI; past it, the sweep retires the
   * runner (`retireWarmRunner`) and its END stops the sandbox. Zero, so the
   * events route retires a runner as its IDLE lands (`runnerIdled`), under
   * the runner lease, and its END stops the sandbox within seconds: ten warm
   * minutes kept a 4 vCPU, 8 GB sandbox up for up to 62 sandbox-hours a day
   * over Oct 23–24, about $5–10 a day, for the 636 of 1,536 finished turns a
   * follow-up reached within three minutes. Those now resume from the stop's
   * snapshot. Note that the runner is still launched warm and retired rather
   * than launched to end on its own, because a runner ending by itself stops
   * reading its stdin while its END is still posted, and a message written
   * then would be taken as delivered and never run. A window is one line
   * here: raise it, and the sweep retires runners past it again.
   */
  RUNNER_WARM: Duration.zero,
  /**
   * How long renewing a running runner's credential may take once its
   * message is written. The send answers only after it, inside the store's
   * thirty-second dispatch deadline (`AWAITING_LINE_DISPATCH_DEADLINE`), and
   * a send that timed out there records no line for a message the runner
   * already took, so a renewal past this is given up and logged; the next
   * message renews it.
   */
  CREDENTIAL_RENEWAL: Duration.seconds(5),
  /**
   * How long a rewind waits for a native agent's runner to end on its Stop
   * before ending its command: a turn interrupted mid-step settles in a
   * second or two, and a runner that never does is ended rather than left
   * to write to the session the rewind cuts.
   */
  RUNNER_HALT: Duration.seconds(15),
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
  NO_REPOSITORY: "Not run: the agent works in no repository.",
  UNKNOWN_PROVIDER: "Not run: the agent's model is outside the providers Luke runs agents on.",
  NO_PROVIDER_KEY: "Not run: the account saved no API key for the agent's model provider.",
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

/** The vCPUs an agent's sandbox opens with: what its repository asks for, or `SANDBOX_VCPUS` for one that asks for nothing and for an agent with no repository. */
export function sandboxVcpus(repository: string | null): number {
  if (repository === null) return CODER.SANDBOX_VCPUS;
  return CODER.SANDBOX_VCPUS_BY_REPOSITORY.get(repository.toLowerCase()) ?? CODER.SANDBOX_VCPUS;
}
