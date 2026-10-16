/**
 * sandbox.ts -- every role's sandbox: the one image each session starts from, and what the role's policy does with it as the session's stream runs.
 *
 * Both roots open their sessions' sandboxes from one Vercel environment,
 * the coding agent's: the code extension's tooling (`gh`, signed commits,
 * TypeScript diagnostics), the runtimes a repository's checks are likely
 * to need, which the base image carries or `prepare` installs, and
 * Playwright with its Chromium, which an agent screenshots what it built
 * with, and GTK 3, the one library an Electron app needs beyond Chromium's,
 * so an agent runs a desktop app under Xvfb the same way. Node is the
 * image's own; pnpm and Python are added where absent. Every command runs
 * with `NO_COLOR` set, so a test runner's output reaches the model as words
 * rather than escape codes it has to strip. Every session starts from the
 * snapshot `prepare` made, so the larger image costs a planning session
 * nothing at open.
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
 * turn's end stops it, and whether a step renews the credential the
 * checkout set at its firewall. No effect runs here; the edges that call
 * these run their own.
 */

import { createHash } from "node:crypto";
import { Duration } from "effect";
import type { MessageStreamEvent } from "eve/client";
import { installCodeTooling } from "eve/extensions/code/sandbox";
import type { SandboxSession } from "eve/sandbox";
import { VercelSandbox, type VercelSandboxRuntimeOptions } from "eve/sandbox/vercel";
import { CODER } from "../coder-host/bounds.js";
import { PREPARE_TMUX } from "../terminal/tmux.js";
import { type AgentRole, ROLE_PROFILE, SANDBOX_POLICY, type SandboxPolicy } from "./role.js";

/** The Playwright the image carries, pinned so a rebuilt snapshot holds the same browser. */
const PLAYWRIGHT_VERSION = "1.64.1";

/**
 * Installs GTK 3 with the system's own package manager, `$SUDO` as
 * `PREPARE_TMUX` set it. Electron's binary links it where Playwright's
 * Chromium does not, and it is the one library `--with-deps` leaves an
 * Electron app missing; Ubuntu since 24.04 names it with the `t64` suffix.
 */
const INSTALL_GTK =
  "if command -v dnf >/dev/null 2>&1; then $SUDO dnf install -y gtk3; else $SUDO apt-get install -y --no-install-recommends libgtk-3-0t64 || $SUDO apt-get install -y --no-install-recommends libgtk-3-0; fi";

/** The commands `prepare` runs on the snapshot, after the code extension's tooling. */
const PREPARE_SCRIPT = [
  "set -e",
  "git --version",
  "node --version",
  "command -v pnpm >/dev/null 2>&1 || npm install -g pnpm",
  "if ! command -v python3 >/dev/null 2>&1; then",
  '  if [ "$(id -u)" = 0 ]; then apt-get update && apt-get install -y python3; else sudo -n apt-get update && sudo -n apt-get install -y python3; fi',
  "fi",
  "pnpm --version && python3 --version",
  // tmux holds each Terminal tab's shell, so it outlives any connection to it (`terminal/tmux.ts`).
  ...PREPARE_TMUX,
  // Playwright and its Chromium, so a coding agent opens what it built and screenshots it; the
  // browser's system libraries are installed through sudo by Playwright itself, the browser for the user.
  `npm install -g playwright@${PLAYWRIGHT_VERSION}`,
  "playwright install --with-deps chromium",
  // After Playwright, whose `--with-deps` has just refreshed the package lists and installed Xvfb.
  INSTALL_GTK,
].join("\n");

/**
 * What a session's store hook has told its sandbox, kept in the session's
 * durable state by the root that watches it: when a sandbox tool first ran,
 * which is when the sandbox opened and its checkout set the repository
 * credential at the firewall, and when that credential was last renewed.
 */
export interface SandboxRecord {
  /** The instant the first sandbox tool of the session was called. */
  readonly openedAt?: number;
  /** The instant the store hook last renewed the credential at the firewall. */
  readonly credentialAt?: number;
}

/** What each policy does with a sandbox: how it opens one, and what the store hook does with it as the stream runs. */
interface SandboxLifecycle {
  /** The options a session's own sandbox opens with; none for a worker, which opens no sandbox of its own. */
  readonly open: VercelSandboxRuntimeOptions | undefined;
  readonly renewsCredential: boolean;
  readonly stopsAtTurnEnd: boolean;
}

/**
 * The coding agent's sandbox lives the platform's maximum, so a long run is
 * never cut off mid-turn, and is stopped the moment a turn ends rather than
 * waiting that out. Its size is enough memory for the repository's own lint,
 * chosen at open, so a stopped sandbox resumes at it. A planning sandbox
 * opens at the defaults and is never stopped by Luke: Vercel stops it for
 * idleness, and it resumes from its snapshot with the checkout intact.
 */
const SANDBOX_LIFECYCLE = {
  [SANDBOX_POLICY.READ_SHALLOW_LAZY]: { open: {}, renewsCredential: false, stopsAtTurnEnd: false },
  [SANDBOX_POLICY.WRITE_FULL_EAGER]: {
    open: { timeout: CODER.SANDBOX_TIMEOUT_MS, resources: { vcpus: CODER.SANDBOX_VCPUS } },
    renewsCredential: true,
    stopsAtTurnEnd: true,
  },
  [SANDBOX_POLICY.PARENT]: { open: undefined, renewsCredential: false, stopsAtTurnEnd: false },
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

/** Whether the credential set at the firewall is old enough to renew: set when the sandbox opened, or when it was last renewed. */
function credentialIsOld(record: SandboxRecord, now: number): boolean {
  const setAt = record.credentialAt ?? record.openedAt;
  return setAt !== undefined && now - setAt >= Duration.toMillis(CODER.GITHUB_TOKEN_REFRESH);
}

/** What the image is prepared with, once per build, on the snapshot every session starts from. */
async function prepareImage(sandbox: SandboxSession): Promise<void> {
  await installCodeTooling(sandbox);
  const prepared = await sandbox.run({ command: PREPARE_SCRIPT });
  if (prepared.exitCode !== 0) {
    throw new Error(`the sandbox image could not be prepared: ${prepared.stderr}`);
  }
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

/** Whether the role's policy renews the credential at its sandbox's firewall at this event: a step that starts once the credential has aged. */
export function renewsCredential(
  role: AgentRole,
  event: MessageStreamEvent,
  record: SandboxRecord,
  now: number,
): boolean {
  return (
    lifecycleOf(role).renewsCredential &&
    event.type === "step.started" &&
    credentialIsOld(record, now)
  );
}
