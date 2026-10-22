/**
 * sandbox.ts -- every role's sandbox: the one image each session starts from, and what the role's policy does with it as the session's stream runs.
 *
 * Both roots open their sessions' sandboxes from one Vercel environment,
 * the coding agent's: the code extension's tooling (`gh`, signed commits,
 * TypeScript diagnostics), `gh`'s stack extension, which restacks a stack
 * of pull requests, the runtimes a repository's checks are likely
 * to need, which the base image carries or `prepare` installs, and
 * Playwright with its Chromium, which an agent screenshots what it built
 * with and which the agent's own browser runs headful, and GTK 3, the one library an Electron app needs beyond Chromium's,
 * so an agent runs a desktop app under Xvfb the same way. Node is the
 * image's own; pnpm and Python are added where absent. Every command runs
 * with `NO_COLOR` set, so a test runner's output reaches the model as words
 * rather than escape codes it has to strip. Every session starts from the
 * snapshot `prepare` made, so the larger image costs a brain session
 * nothing at open.
 *
 * The image also carries what a coding agent on Claude Code runs on: the
 * pinned Claude Agent SDK with the `claude` binary it carries, bubblewrap
 * and socat for Claude Code's own command sandbox, and `agent`, the
 * unprivileged user it runs as, with a home no other user reads; and the
 * pinned Codex a coding agent on Codex runs on, as the same user, with its
 * `CODEX_HOME` in that home. What keeps that user's tokens from a teammate
 * is not sudo: the sandbox hands its default user the whole capability set,
 * with which it reaches root without sudo, so the default user keeps its
 * sudoers entry, which the sandbox's API runs a root command through (the
 * runner's launch among them). The boundary is the capability drop
 * (`sandbox-capabilities.ts`) every Terminal's shell, agent's command, and
 * runner starts under, which also leaves sudo unable to reach root, and
 * `agent`'s home, which only it reads; the preparation checks that the drop
 * holds. A package an agent needs is added here, never installed at runtime.
 *
 * Each root's `sandbox.ts` exports this one environment object, which is
 * safe because each eve project bundles its own copy of this module and
 * builds its own snapshot from it, and eve matches a sandbox's environment
 * by identity within one project alone. Each root keeps its own selector,
 * because eve requires one per agent node and the coding agent's checks the
 * repository out through its host, which only its edge may run.
 *
 * What the role's policy (`role.ts`) does with the sandbox once open is
 * read here by the store hook that watches the session's stream: whether a
 * turn's end stops it, whether a long pause inside a turn does, whether a
 * step keeps it alive past its short timeout, and whether a step renews the
 * credential the checkout set at its firewall, which a shallow checkout's deepen sets on
 * its first write and which stands only from then on. A member's own GitHub token is never
 * renewed, since it does not expire: a turn's end takes it off the firewall
 * where the sandbox stops, and the next turn's first step sets it again. No
 * effect runs here; the edges that call these run their own.
 */

import { createHash } from "node:crypto";
import { AGENT_TOOL } from "@luke/features/agent-tools";
import { Duration } from "effect";
import type { MessageStreamEvent } from "eve/client";
import { VercelSandbox, type VercelSandboxRuntimeOptions } from "eve/sandbox/vercel";
import { CODER } from "../coder-host/bounds.js";
import { keepAliveDue } from "../sandbox-keep-alive.js";
import { type AgentRole, ROLE_PROFILE, SANDBOX_POLICY, type SandboxPolicy } from "./role.js";
import { PREPARE_SCRIPT, prepareImage } from "./sandbox-image.js";

/**
 * What a session's store hook has told its sandbox, kept in the session's
 * durable state by the root that watches it: when a sandbox tool first ran,
 * which is when the sandbox opened, and whether its checkout opened
 * shallow; when the first write ran, which deepened a shallow checkout and
 * set the repository credential at the firewall; when that credential was
 * last renewed, whether it is its starter's own token, and whether a turn's
 * end may have taken it off since.
 */
export interface SandboxRecord {
  /** The instant the first sandbox tool of the session was called. */
  readonly openedAt?: number;
  /**
   * Whether the sandbox opened on a shallow checkout, with no credential
   * standing until a write deepens it. A record kept before checkouts
   * opened shallow says nothing, and its checkout stood whole, its
   * credential with it, from the instant it opened.
   */
  readonly openedShallow?: boolean;
  /** The instant the first write of the session was called, which deepened its checkout and set the credential at the firewall. */
  readonly deepenedAt?: number;
  /** The instant the store hook last renewed the credential at the firewall. */
  readonly credentialAt?: number;
  /** Whether the credential is the agent's starter's own GitHub token rather than an installation's. */
  readonly memberToken?: boolean;
  /** Whether a member's token may be off the firewall since a turn ended, for the next step to set again. */
  readonly credentialLapsed?: boolean;
  /** The instant a step last kept the sandbox alive (`session-sandboxes.ts`'s `keepAliveFor`). */
  readonly keptAliveAt?: number;
}

/** How many snapshots Vercel keeps of a sandbox, as a bounds module names it. */
interface SnapshotBound {
  readonly count: number;
  readonly expiration: Duration.Duration;
  readonly deleteEvicted: boolean;
}

/** Vercel's retention of a sandbox's snapshots, as its create takes it. */
type Retention = NonNullable<VercelSandboxRuntimeOptions["keepLastSnapshots"]>;

/**
 * The options a session's own sandbox opens with. Note that a retention is
 * required here, because the open is the one create eve forwards it on
 * whose sandbox snapshots at every stop; the template, which is created
 * from `environment`, snapshots once and is left alone.
 */
type SessionOpen = VercelSandboxRuntimeOptions & { readonly keepLastSnapshots: Retention };

/** What each policy does with a sandbox: how it opens one, and what the store hook does with it as the stream runs. */
interface SandboxLifecycle {
  /** The options a session's own sandbox opens with; none for a worker, which opens no sandbox of its own. */
  readonly open: SessionOpen | undefined;
  readonly renewsCredential: boolean;
  readonly stopsAtTurnEnd: boolean;
  /** Whether its steps keep the sandbox alive past its timeout; a worker's keep its parent's alive from the worker's own hook. */
  readonly keepsAlive: boolean;
}

/** The bound as Vercel's create takes it, its expiration in milliseconds. */
function retentionOf(bound: SnapshotBound): Retention {
  return { ...bound, expiration: Duration.toMillis(bound.expiration) };
}

/**
 * The coding agent's sandbox opens with a short timeout, which its steps
 * keep moving on while a turn runs, so a long run is never cut off mid-turn
 * and one nothing stopped bills an hour rather than a day; and it is stopped
 * the moment a turn ends rather than waiting that out. Its size is enough memory for the repository's own lint,
 * chosen at open, so a stopped sandbox resumes at it. Every stop snapshots
 * the sandbox, so each keeps its newest snapshot alone.
 */
const SANDBOX_LIFECYCLE = {
  [SANDBOX_POLICY.SHALLOW_THEN_DEEP]: {
    open: {
      timeout: CODER.SANDBOX_TIMEOUT_MS,
      resources: { vcpus: CODER.SANDBOX_VCPUS },
      keepLastSnapshots: retentionOf(CODER.SANDBOX_SNAPSHOTS),
    },
    renewsCredential: true,
    stopsAtTurnEnd: true,
    keepsAlive: true,
  },
  [SANDBOX_POLICY.PARENT]: {
    open: undefined,
    renewsCredential: false,
    stopsAtTurnEnd: false,
    keepsAlive: false,
  },
} as const satisfies { readonly [Policy in SandboxPolicy]: SandboxLifecycle };

/** eve's event kinds for a turn's end, however it ended. */
const TURN_END_EVENTS: ReadonlySet<MessageStreamEvent["type"]> = new Set([
  "turn.completed",
  "turn.failed",
  "turn.cancelled",
]);

/** The policy's lifecycle for the role. */
function lifecycleOf(role: AgentRole): SandboxLifecycle {
  return SANDBOX_LIFECYCLE[ROLE_PROFILE[role].sandbox];
}

/**
 * The instant the repository credential was first set at the firewall: as
 * the first write deepened a checkout that opened shallow, or as the
 * sandbox opened on a whole one; none while a shallow checkout stands, which
 * holds no credential.
 */
function credentialSetAt(record: SandboxRecord): number | undefined {
  return record.openedShallow === true ? record.deepenedAt : record.openedAt;
}

/** Whether the repository credential stands at the firewall: once it was first set, as the checkout deepened or opened whole. */
function credentialStands(record: SandboxRecord): boolean {
  return credentialSetAt(record) !== undefined;
}

/** Whether the credential set at the firewall is old enough to renew: first set, or last renewed, that long ago. */
function credentialIsOld(record: SandboxRecord, now: number): boolean {
  const setAt = record.credentialAt ?? credentialSetAt(record);
  return setAt !== undefined && now - setAt >= Duration.toMillis(CODER.GITHUB_TOKEN_REFRESH);
}

/**
 * The image every session starts from. Note that eve keys the prepared
 * snapshot by the bytes of each root's own `sandbox.ts` and by the
 * environment's options, never by `prepare`'s source. So the digest of
 * everything authored here that prepares the image, the script and the
 * function that runs it, rides in `env`. Without it, an edit here would
 * leave both roots starting from the snapshot the old preparation made.
 */
export const environment = VercelSandbox.environment({
  env: {
    NO_COLOR: "1",
    // The extension is pinned, so a notice of a newer release is one the agent cannot act on.
    GH_STACK_NO_UPDATE_NOTIFIER: "1",
    LUKE_SANDBOX_IMAGE: createHash("sha256")
      .update(PREPARE_SCRIPT)
      .update(prepareImage.toString())
      .digest("hex")
      .slice(0, 16),
  },
  prepare: prepareImage,
});

/** The role's own sandbox, opened as its policy says; call it inside the root's `defineSandbox` selector. A worker's role opens none. */
export function openSandbox(role: AgentRole) {
  const options = lifecycleOf(role).open;
  if (options === undefined) {
    throw new Error(`The ${role} role reads in its parent's sandbox and opens none of its own.`);
  }
  return environment.open(options);
}

/** Whether the event ends a turn. */
export function endsTurn(event: MessageStreamEvent): boolean {
  return TURN_END_EVENTS.has(event.type);
}

/**
 * Whether the role's policy stops its sandbox at this event: a turn's end,
 * once a sandbox tool has opened it, unless a developer's terminal holds it
 * (`held`), when the sweep stops it once the terminal's lease lapses.
 */
export function stopsAtTurnEnd(
  role: AgentRole,
  event: MessageStreamEvent,
  record: SandboxRecord,
  held: boolean,
): boolean {
  return (
    lifecycleOf(role).stopsAtTurnEnd && endsTurn(event) && record.openedAt !== undefined && !held
  );
}

/** The seconds of a pause past which the sandbox is stopped for it. */
const SLEEP_STOPS_AT_SECONDS = Duration.toSeconds(CODER.SLEEP_STOPS_AT);

/** Whether a call's input asks a pause of at least the bound, read from the JSON object the model emitted. */
function longPause(input: unknown): boolean {
  if (typeof input !== "object" || input === null || !("seconds" in input)) return false;
  return typeof input.seconds === "number" && input.seconds >= SLEEP_STOPS_AT_SECONDS;
}

/**
 * Whether the role's policy stops its sandbox for this event: a step whose
 * one call is a pause (`coder-host/sleep.ts`) of at least
 * `CODER.SLEEP_STOPS_AT`, once a sandbox tool has opened the sandbox. A
 * step that calls anything beside the pause may still be using the
 * sandbox, so it is left up. The caller stops it only where no developer's
 * terminal holds it and no process the agent started still runs
 * (`sandbox-idle.ts`); the next step's first call into the sandbox resumes
 * it from the snapshot its stop wrote, as Vercel resumes a stopped
 * persistent sandbox on its next command
 * (https://vercel.com/kb/guide/vercel-sandbox-duration-and-persistence).
 */
export function parksForLongSleep(
  role: AgentRole,
  event: MessageStreamEvent,
  record: SandboxRecord,
): boolean {
  if (!lifecycleOf(role).stopsAtTurnEnd || event.type !== "actions.requested") return false;
  const [only, ...rest] = event.data.actions;
  return (
    only !== undefined &&
    rest.length === 0 &&
    only.kind === "tool-call" &&
    only.toolName === AGENT_TOOL.SLEEP &&
    longPause(only.input) &&
    record.openedAt !== undefined
  );
}

/**
 * Whether a stop for a long pause takes a member's own token off the
 * firewall, and lapses it for the next step to set again, as a turn's end
 * that stops the sandbox does (`withdrawsCredential`): once the token
 * stands at all.
 */
export function withdrawsCredentialForSleep(role: AgentRole, record: SandboxRecord): boolean {
  return (
    lifecycleOf(role).renewsCredential && credentialStands(record) && record.memberToken === true
  );
}

/**
 * Whether the role's policy sets the credential at its sandbox's firewall
 * again at this event: a step that starts once an installation token has
 * aged, or once a member's own token lapsed at a turn's end, and only once
 * the credential stands at all, a shallow checkout's never. A member's
 * token is never renewed for its age, since it does not expire.
 */
export function renewsCredential(
  role: AgentRole,
  event: MessageStreamEvent,
  record: SandboxRecord,
  now: number,
): boolean {
  return (
    lifecycleOf(role).renewsCredential &&
    event.type === "step.started" &&
    credentialStands(record) &&
    (record.credentialLapsed === true ||
      (record.memberToken !== true && credentialIsOld(record, now)))
  );
}

/**
 * Whether a step starting at the instant given keeps a sandbox alive: the
 * first step a session's hook sees, and from then on the first one a
 * keep-alive interval (`CODER.SANDBOX_KEEP_ALIVE_EVERY`) after the last, so
 * the sandbox is looked up a few times an hour of a turn rather than at
 * every step. A worker's hook asks this of its own record for its parent's
 * sandbox, which the worker reads in.
 */
export function keepsAliveAt(
  event: MessageStreamEvent,
  keptAliveAt: number | undefined,
  now: number,
): boolean {
  return event.type === "step.started" && keepAliveDue(keptAliveAt, now);
}

/**
 * Whether the role's policy keeps its own sandbox alive at this event: a
 * step due by `keepsAliveAt`, once a sandbox tool has opened the sandbox. A
 * sandbox stopped since is not resumed by it, only found not running.
 */
export function keepsSandboxAlive(
  role: AgentRole,
  event: MessageStreamEvent,
  record: SandboxRecord,
  now: number,
): boolean {
  return (
    lifecycleOf(role).keepsAlive &&
    record.openedAt !== undefined &&
    keepsAliveAt(event, record.keptAliveAt, now)
  );
}

/**
 * Whether a turn's end lapses a member's own token: once the token stands
 * at the firewall, every turn's end does, since it or a terminal's close
 * may take the token off before the next turn, which sets it again.
 */
export function lapsesCredential(
  role: AgentRole,
  event: MessageStreamEvent,
  record: SandboxRecord,
): boolean {
  return (
    lifecycleOf(role).renewsCredential &&
    endsTurn(event) &&
    credentialStands(record) &&
    record.memberToken === true
  );
}

/**
 * Whether a turn's end takes a member's own token off the firewall: where
 * it stops the sandbox, so nothing stands while nobody uses it. A sandbox a
 * developer's terminal holds keeps it, for the terminal to take off as it
 * closes (`terminal/relay.ts`).
 */
export function withdrawsCredential(
  role: AgentRole,
  event: MessageStreamEvent,
  record: SandboxRecord,
  held: boolean,
): boolean {
  return lapsesCredential(role, event, record) && stopsAtTurnEnd(role, event, record, held);
}
