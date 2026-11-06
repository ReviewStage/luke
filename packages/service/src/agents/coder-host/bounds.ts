import { LINE_GRACE_MILLIS, STARTING_GRACE_MILLIS } from "@repo/features/agent-status";
import { AGENT_MACHINE, type AgentMachineKind } from "@repo/features/agent-wire";
import { GITHUB_TOKEN_REFRESH } from "@repo/features/host-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
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
   * end (`sandbox-keep-alive.ts`). A native runner keeps its sandbox alive by
   * its heartbeat for as long as it runs, and its end at the agent's turn's
   * end stops it, or two minutes into a wait on wakeups alone
   * (`@repo/agent-runner`'s `RUNNER_RELEASE`, whose process table tells the
   * harness's own processes from the agent's). What its end leaves up, as a
   * developer's Terminal holds it, is stopped by this timeout once nothing
   * keeps it alive, its snapshot taken as at any stop, so this is how an
   * idle sandbox ends, and it bills its memory until then: at the default
   * size, 4 GB for twenty minutes. Twenty, because a live turn shows use far
   * more often than that: a native runner posts at least every heartbeat
   * (`RUNNER_HEARTBEAT`, five minutes), and a terminal or a watched browser
   * closes after five idle minutes. Each of them keeps it alive at most every
   * `SANDBOX_KEEP_ALIVE_EVERY`.
   */
  SANDBOX_TIMEOUT_MS: 20 * 60 * 1_000,
  /**
   * The longest a Vercel Sandbox session may live in all, however often it is
   * kept alive: the platform's maximum on Pro and Enterprise, past which it
   * refuses an extension.
   */
  SANDBOX_MAX_LIFETIME_MS: 24 * 60 * 60 * 1_000,
  /**
   * How often a live turn, a terminal, or a watched browser keeps the
   * sandbox alive: one list and at most one extension each time, so a
   * step's start or an event batch costs nothing more between them, and an
   * extension only once less than the timeout less this is left
   * (`keepAliveExtension`). Five minutes, a quarter of the timeout, so a
   * keep-alive that found no extension due, and the heartbeat's five minutes
   * before the next sign of use past this, still land before the sandbox
   * would stop.
   */
  SANDBOX_KEEP_ALIVE_EVERY: Duration.minutes(5),
  /**
   * The sandbox's vCPUs, each with 2 GB of memory, where its repository asks
   * for no more (`SANDBOX_VCPUS_BY_REPOSITORY`); also the size a repository
   * snapshot is built at, since Vercel opens a
   * snapshot at whatever size the create asks. Two, because provisioned
   * memory and active CPU are most of the sandboxes' bill and both scale
   * with vCPUs, so a repository whose own checks need more asks for it
   * rather than every sandbox paying for it.
   */
  SANDBOX_VCPUS: 2,
  /**
   * The repositories whose agents' sandboxes open larger than
   * `SANDBOX_VCPUS`, by `owner/name` lowercased, as `sandboxVcpus` reads
   * them; a repository asks for more by a row here. This repository's own is four,
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
  SANDBOX_VCPUS_BY_REPOSITORY: new Map([["reviewstage/vespin", 4]]) as ReadonlyMap<string, number>,
  /**
   * The snapshots Vercel keeps of the agent's sandbox: the newest alone, which
   * is all a resume reads, so snapshot storage stays flat however many turns
   * stop it. An evicted one is deleted at once, and the kept one expires
   * three days after it was last used, named here because Vercel's own pages
   * disagree on the default. Three days, because the storage is billed for as
   * long as a snapshot is kept, flat by the day, and an agent left idle longer
   * is rarely picked up again. The cost: an agent resumed after 3 idle days
   * finds no snapshot and starts from a fresh clone of its repository, so its
   * uncommitted and unpushed work is gone, and an agent archived while its
   * sandbox ran keeps its for a day alone (`session-sandboxes.ts`). A
   * native agent whose sandbox or snapshot is gone opens a fresh one,
   * checkout and all (`runner-sessions.ts`).
   */
  SANDBOX_SNAPSHOTS: { count: 1, expiration: Duration.days(3), deleteEvicted: true },
  /** An installation token is good for an hour from its mint; the one at the firewall is renewed this long after, inside that hour, as a host renews its agents' (`@repo/features/host-wire`). */
  GITHUB_TOKEN_REFRESH,
  /** The context window the session is told where the catalog names none for the model. */
  FALLBACK_CONTEXT_WINDOW_TOKENS: 200_000,
  /**
   * The share of the context window past which eve compacted a session,
   * read by the agent's tab as the line a Codex or eve agent's context ring
   * turns red at, and by a replay as the room it fits into. It was eve's
   * own default; no harness is told it now.
   */
  COMPACTION_THRESHOLD_SHARE: 0.9,
  /**
   * What Claude Code holds back from the window before it compacts: the
   * output it reserves, the lesser of the model's most output and 20K, which
   * every model we offer it outputs more than, and its 13K buffer past
   * that. Its own constants, read from the pinned binary; no harness is told
   * them, so a bump of `CLAUDE_CODE_PIN` checks them again.
   */
  CLAUDE_CODE_COMPACTION_RESERVE_TOKENS: 20_000 + 13_000,
  /** Where the agent's checkout stands in its sandbox, which is where the brain's checkout stands too. */
  CHECKOUT_PATH: REPOSITORY_SANDBOX_CONTRACT.PATH.CHECKOUT,
  /** The branches an agent works on; an instruction to the model, enforced by nothing, and how a pull request is told as an agent's (`isAgentBranch`). */
  BRANCH_PREFIX: "agent/",
  /**
   * The prefix agents worked on before `BRANCH_PREFIX`, still read as an
   * agent's, because pull requests opened on it stand open and their
   * reviews, comments, and checks must still wake their agents.
   */
  LEGACY_BRANCH_PREFIX: "luke/",
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
   * the next message to reach it as a line rather than through a relaunched
   * CLI, one window per machine: read by the machine the runner's place is on
   * (`FoundPlace.machine`), never by a flag. A runner is launched warm only
   * on a machine whose window is not zero (`runner-sessions.ts`'s launch),
   * and past its window a sweep retires it (`retireWarmRunner`,
   * `../../maintenance/device-warm-sweep.ts`).
   *
   * The sandbox's is zero, so its runner is launched to end at its turn's
   * end, and its END stops the sandbox, as Vercel advises: an idle sandbox
   * bills its memory. Ten warm minutes kept a 4 vCPU, 8 GB sandbox up for up
   * to 62 sandbox-hours a day over Oct 23–24, about $5–10 a day, for the 636
   * of 1,536 finished turns a follow-up reached within three minutes. Those
   * resume from the stop's snapshot. A message sent while the runner ends is
   * queued for it to read, and a runner that ends without reading it leaves
   * it waiting, which its END hands on (`runner-sessions.ts`'s
   * `LINES_WAITING`).
   *
   * The device's is thirty minutes, because nothing is billed on a host, and
   * every message within it goes into the running session rather than
   * through a relaunched CLI, a new GitHub token, and the last runner's
   * grace. Thirty, half the runner's own cap (`@repo/agent-runner`'s
   * `RUNNER_WARM.IDLE_CAP_MS`, sixty minutes), because the window is closed
   * by our retire under the lease and never by the runner ending itself,
   * whose stdin a message its host writes in that instant is lost on: the
   * sweep retires it past the window, a message sent past it ends the
   * runner and relaunches whether or not the sweep ran (`sendHolding`), and
   * a host waiting to switch release has its runner retired at its IDLE
   * (`runnerIdled`).
   */
  RUNNER_WARM: {
    [AGENT_MACHINE.VERCEL]: Duration.zero,
    [AGENT_MACHINE.DEVICE]: Duration.minutes(30),
  } satisfies Record<AgentMachineKind, Duration.Duration>,
  /**
   * How long a message to a runner that reads its lines waits on that
   * runner's exit, its liveness in place of the 404 a write to an exited
   * command's stdin answers: a command that exited answers within one round
   * trip, and one that runs answers nothing, so the wait is all it costs,
   * run beside the message's own reads. A runner read as running that has
   * in fact gone leaves its line waiting for the next message's read.
   */
  RUNNER_EXIT_READ: Duration.seconds(1),
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
  /**
   * How long a native agent's turn has to end on its Stop once the stop line
   * is written (`runner-sessions.ts`'s `forcedStop`) before its runner is
   * ended and the turn settled canceled. A turn interrupted mid-step ends in
   * a second or two, and the runner ends an interrupt its CLI never answers
   * within `RUNNER_CONTROL.ANSWER_MS`, so one still running past this has a
   * runner that will not end it: ask, wait briefly, then force, rather than
   * leaving it running for the sweep's five minutes
   * (`TURN_ABANDON.CANCEL_AFTER_MS`).
   */
  STOP_CONFIRM: Duration.seconds(10),
  /**
   * How a resume past a message's answer that meets its sandbox still
   * stopping or being snapshotted (Vercel's 422 `sandbox_stopping` or
   * `sandbox_snapshotting`) is tried again: every `SPACING`, at most `TRIES`
   * times, about a minute, which a turn's stop and its snapshot end within,
   * and well under the five minutes work past an answer may run. A resume
   * inside a request tries once more at once instead, since a wait there
   * would outlast the store's dispatch deadline.
   */
  RESUME_WHILE_ENDING: { SPACING: Duration.seconds(2), TRIES: 30 },
} as const;

/** Why the host refused a session's standing or a step, in words a log or a failed turn can carry. */
export const CODER_REFUSAL = {
  NO_AGENT: "Not run: this conversation is no agent's.",
  NO_REPOSITORY: "Not run: the agent works in no repository.",
  /** No step is refused this way since Fast runs on an account's own key; kept for the turns that were refused so before, which still read as this. */
  FAST_ON_OWN_KEY: `Not run: Fast isn't available on your own API key; ${PRODUCT_NAME} runs Fast on its own Anthropic key alone. Choose the model with Fast off.`,
  /** No step fails this way since a refused fast call runs at standard speed; kept for the turns that failed so before, which still read as this. */
  FAST_NOT_ENABLED:
    "Not run: Fast mode isn't enabled for this Anthropic organization. Choose the model with Fast off.",
  /** No step is refused for its own key this way since eve, whose steps ran on it, was retired; kept with the two below for the turns refused so before, which still read as these. */
  ACCOUNT_KEY_UNREADABLE:
    "Not run: your own API key for the agent's model provider cannot be read. Replace it in Settings.",
  ACCOUNT_KEY_REFUSED:
    "Not run: the provider refused your own API key for the agent's model. Replace it in Settings.",
  ACCOUNT_KEY_NO_QUOTA:
    "Not run: the provider refused the work for your own API key's billing or quota.",
  NOT_REACHABLE:
    "Not run: the agent's repository is not reachable through the GitHub installation connected to its task's workspace.",
  GITHUB_UNAVAILABLE: "Not run: GitHub could not be asked for the repository's credential.",
} as const;

export type CoderRefusal = (typeof CODER_REFUSAL)[keyof typeof CODER_REFUSAL];

/** The vCPUs an agent's sandbox opens with: what its repository asks for, or `SANDBOX_VCPUS` for one that asks for nothing and for an agent with no repository. */
export function sandboxVcpus(repository: string | null): number {
  if (repository === null) return CODER.SANDBOX_VCPUS;
  return CODER.SANDBOX_VCPUS_BY_REPOSITORY.get(repository.toLowerCase()) ?? CODER.SANDBOX_VCPUS;
}

/** Whether a branch is one an agent works on, under today's prefix or the one before it. */
export function isAgentBranch(branch: string): boolean {
  return branch.startsWith(CODER.BRANCH_PREFIX) || branch.startsWith(CODER.LEGACY_BRANCH_PREFIX);
}
