/**
 * sandbox.ts -- every role's sandbox: the one image each session starts from, and what the role's policy does with it as the session's stream runs.
 *
 * Both roots open their sessions' sandboxes from one Vercel environment,
 * the coding agent's: the code extension's tooling (`gh`, signed commits,
 * TypeScript diagnostics), `gh`'s stack extension, which restacks a stack
 * of pull requests, the runtimes a repository's checks are likely
 * to need, which the base image carries or `prepare` installs, and
 * Playwright with its Chromium, which an agent screenshots what it built
 * with, and GTK 3, the one library an Electron app needs beyond Chromium's,
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
 * `CODEX_HOME` in that home. And the image holds no sudo at runtime:
 * everything that needs root is installed here, and the default user's
 * sudoers entry is dropped as the last step, so neither a Terminal's shell
 * nor an agent's command reaches root through it. A package an agent needs is added here, never installed at runtime.
 * Those shells and commands also run with every capability dropped
 * (`sandbox-capabilities.ts`), since the sandbox hands its default user the
 * whole set without sudo; the preparation checks that the drop holds.
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
 * checkout set at its firewall, which a shallow checkout's deepen sets on
 * its first write and which stands only from then on. A member's own GitHub token is never
 * renewed, since it does not expire: a turn's end takes it off the firewall
 * where the sandbox stops, and the next turn's first step sets it again. No
 * effect runs here; the edges that call these run their own.
 */

import { createHash } from "node:crypto";
import { Duration } from "effect";
import type { MessageStreamEvent } from "eve/client";
import { installCodeTooling } from "eve/extensions/code/sandbox";
import type { SandboxSession } from "eve/sandbox";
import { VercelSandbox, type VercelSandboxRuntimeOptions } from "eve/sandbox/vercel";
import { BRAIN_HOST } from "../brain-host/bounds.js";
import { CODER } from "../coder-host/bounds.js";
import { WITHOUT_CAPABILITIES } from "../sandbox-capabilities.js";
import { PREPARE_TMUX } from "../terminal/tmux.js";
import { type AgentRole, ROLE_PROFILE, SANDBOX_POLICY, type SandboxPolicy } from "./role.js";

/** The Playwright the image carries, pinned so a rebuilt snapshot holds the same browser. */
const PLAYWRIGHT_VERSION = "1.64.1";

/**
 * GitHub's own `gh stack` extension (github/gh-stack), pinned to a release
 * and to the SHA-256 GitHub publishes for its Linux x86-64 binary, the
 * Vercel sandbox's architecture.
 */
const GH_STACK = {
  VERSION: "v0.2.1",
  SHA256: "ffe9d48b6342faffc3b0cb420202ff1df32e24faf32693debd7423274bbdf859",
  DIRECTORY: "/usr/local/lib/gh-stack",
} as const;

/**
 * Installs `gh stack`, `$SUDO` as `PREPARE_TMUX` set it. `gh extension
 * install github/gh-stack` cannot run here: it reaches GitHub's API with
 * `gh`'s token, and while the image is prepared no credential stands at the
 * firewall, so GitHub would refuse the wrapper's placeholder. So the pinned
 * release's binary is fetched from its public download, checked against its
 * digest, and linked as a local extension, which `gh` installs without
 * reaching GitHub. Each step is skipped where it already holds, so a second
 * run changes nothing.
 */
const INSTALL_GH_STACK = [
  `if ! echo '${GH_STACK.SHA256}  ${GH_STACK.DIRECTORY}/gh-stack' | sha256sum --check --status >/dev/null 2>&1; then`,
  `  curl -fsSL -o /tmp/gh-stack https://github.com/github/gh-stack/releases/download/${GH_STACK.VERSION}/linux-amd64`,
  `  echo '${GH_STACK.SHA256}  /tmp/gh-stack' | sha256sum --check --quiet`,
  `  $SUDO install -D -m 755 /tmp/gh-stack ${GH_STACK.DIRECTORY}/gh-stack`,
  "  rm -f /tmp/gh-stack",
  "fi",
  `gh stack --help >/dev/null 2>&1 || (cd ${GH_STACK.DIRECTORY} && gh extension install .)`,
  "gh stack --help >/dev/null",
];

/**
 * Installs GTK 3 with the system's own package manager, `$SUDO` as
 * `PREPARE_TMUX` set it. Electron's binary links it where Playwright's
 * Chromium does not, and it is the one library `--with-deps` leaves an
 * Electron app missing; Ubuntu since 24.04 names it with the `t64` suffix.
 */
const INSTALL_GTK =
  "if command -v dnf >/dev/null 2>&1; then $SUDO dnf install -y gtk3; else $SUDO apt-get install -y --no-install-recommends libgtk-3-0t64 || $SUDO apt-get install -y --no-install-recommends libgtk-3-0; fi";

/**
 * Makes every `apt-get` after it wait up to ten minutes for dpkg's lock
 * rather than fail at once. A freshly booted image can have another
 * `apt-get` holding it as `prepare` starts, and Playwright's own
 * `--with-deps` install takes no option to wait, so the wait is set in apt's
 * configuration, where it and every install here read it.
 */
const WAIT_FOR_DPKG_LOCK = `if [ -d /etc/apt/apt.conf.d ]; then echo 'DPkg::Lock::Timeout "600";' | if [ "$(id -u)" = 0 ]; then tee /etc/apt/apt.conf.d/90luke-dpkg-lock-timeout; else sudo -n tee /etc/apt/apt.conf.d/90luke-dpkg-lock-timeout; fi >/dev/null; fi`;

/**
 * Installs bubblewrap and socat, which Claude Code's command sandbox runs
 * each command under on Linux, `$SUDO` as `PREPARE_TMUX` set it.
 */
const INSTALL_BUBBLEWRAP = [
  "if command -v dnf >/dev/null 2>&1; then $SUDO dnf install -y bubblewrap socat; else $SUDO apt-get install -y --no-install-recommends bubblewrap socat; fi",
  "bwrap --version",
];

/**
 * The Claude Agent SDK, pinned exactly, and the `claude` binary its
 * platform package carries (the SDK's own `claudeCodeVersion`), so
 * installing the one installs the other. The pair is the one the Claude
 * Code probe proved in a sandbox, and the runner that drives the binary
 * pins the same SDK; a bump moves both on purpose. Installed as root in a
 * directory only root writes, so no shell of the sandbox's user changes the
 * binary Claude Code runs as `agent`. The binary is the Linux x86-64 build,
 * the Vercel sandbox's architecture.
 */
const CLAUDE_CODE = {
  SDK_VERSION: "0.3.304",
  VERSION: "2.1.304",
  DIRECTORY: "/opt/luke/claude-agent-sdk",
  BINARY: "node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude",
} as const;

/**
 * Installs the SDK where its binary does not already print the pin, links
 * the binary as `claude`, and checks that it prints the pin, `$SUDO` as
 * `PREPARE_TMUX` set it. Note that root's npm reads root's home, never the
 * default user's configuration.
 */
const INSTALL_CLAUDE_CODE = [
  `if ! ${CLAUDE_CODE.DIRECTORY}/${CLAUDE_CODE.BINARY} --version 2>/dev/null | grep -q '^${CLAUDE_CODE.VERSION} '; then`,
  `  $SUDO env HOME=/root npm install --prefix ${CLAUDE_CODE.DIRECTORY} --no-audit --no-fund --save-exact @anthropic-ai/claude-agent-sdk@${CLAUDE_CODE.SDK_VERSION}`,
  "fi",
  `$SUDO ln -sfn ${CLAUDE_CODE.DIRECTORY}/${CLAUDE_CODE.BINARY} /usr/local/bin/claude`,
  "claude --version",
  `claude --version | grep -q '^${CLAUDE_CODE.VERSION} ' || { echo 'claude does not print ${CLAUDE_CODE.VERSION}' >&2; exit 1; }`,
];

/** The unprivileged user Claude Code runs as, apart from the sandbox's default user. */
const AGENT_USER = "agent";

/**
 * Creates `agent` where it is missing, with a home only it reads, and in
 * the default user's group, so the checkout can be shared with it, `$SUDO`
 * as `PREPARE_TMUX` set it. Note that the Sandbox SDK's own user creation is
 * not used, because the homes it makes are readable by the default user's
 * group, so a Terminal could read what Claude Code keeps there.
 */
const CREATE_AGENT_USER = [
  `id -u ${AGENT_USER} >/dev/null 2>&1 || $SUDO useradd --create-home --shell /bin/bash ${AGENT_USER}`,
  `$SUDO chmod 700 /home/${AGENT_USER}`,
  `$SUDO usermod -aG "$(id -gn)" ${AGENT_USER}`,
];

/**
 * Codex, pinned exactly, the release the Codex probe proved in a sandbox
 * and the runner's Codex mode drives; a bump moves them together. Installed
 * as root under a prefix only root writes, beside the Claude Agent SDK, so
 * no shell of the sandbox's user changes the binary Codex runs as `agent`.
 * Its `CODEX_HOME` is in `agent`'s home, on the sandbox's persisted disk, so
 * the threads it keeps there outlive a stop and `thread/resume` finds them;
 * Codex refuses to start where it is missing, so the image makes it.
 */
const CODEX = {
  VERSION: "0.163.0",
  DIRECTORY: "/opt/luke/codex",
  HOME: `/home/${AGENT_USER}/.codex`,
} as const;

/**
 * Installs Codex where it does not already print the pin, links it as
 * `codex`, and checks that it prints the pin, `$SUDO` as `PREPARE_TMUX` set
 * it; then makes `agent`'s `CODEX_HOME`, which only `agent` reads.
 */
const INSTALL_CODEX = [
  `if ! ${CODEX.DIRECTORY}/bin/codex --version 2>/dev/null | grep -Fxq 'codex-cli ${CODEX.VERSION}'; then`,
  `  $SUDO env HOME=/root npm install --global --prefix ${CODEX.DIRECTORY} --no-audit --no-fund @openai/codex@${CODEX.VERSION}`,
  "fi",
  `$SUDO ln -sfn ${CODEX.DIRECTORY}/bin/codex /usr/local/bin/codex`,
  "codex --version",
  `codex --version | grep -Fxq 'codex-cli ${CODEX.VERSION}' || { echo 'codex does not print ${CODEX.VERSION}' >&2; exit 1; }`,
  `$SUDO install -d -o ${AGENT_USER} -g ${AGENT_USER} -m 0700 ${CODEX.HOME}`,
];

/**
 * Removes every sudoers line and file that grants the user named as `$1`,
 * and takes it out of the groups a sudoers file commonly grants. Run as root
 * in one shell, so the user's sudo is not lost halfway through.
 */
const DROP_SUDOERS = [
  'user="$1"',
  "for file in /etc/sudoers.d/*; do",
  '  if [ -f "$file" ] && grep -qE "^[[:space:]]*$user[[:space:]]" "$file"; then rm -f "$file"; fi',
  "done",
  'sed -i "/^[[:space:]]*$user[[:space:]]/d" /etc/sudoers',
  'for group in wheel sudo admin; do gpasswd -d "$user" "$group" >/dev/null 2>&1 || true; done',
].join("\n");

/**
 * The image's last step: the default user's sudo dropped, then a check that
 * it is gone and that a command started under the capability drop holds no
 * capability, which fails the preparation rather than leave either standing.
 * A sandbox prepared as root has no default user's sudo to drop.
 */
const DROP_SUDO = [
  'if [ "$(id -u)" != 0 ]; then',
  `  sudo -n sh -c '${DROP_SUDOERS.replaceAll("'", `'\\''`)}' drop-sudo "$(id -un)"`,
  "  if sudo -n true 2>/dev/null; then echo 'sudo still stands for the default user' >&2; exit 1; fi",
  "fi",
  `${WITHOUT_CAPABILITIES.COMMAND} ${WITHOUT_CAPABILITIES.ARGS.join(" ")} grep -q '^CapEff:[[:space:]]*0*$' /proc/self/status || { echo 'a command without capabilities still holds one' >&2; exit 1; }`,
];

/** The commands `prepare` runs on the snapshot, after the code extension's tooling; the Claude Code probe (`tools/claude-code-probe`) prepares its sandbox from the same script. */
export const PREPARE_SCRIPT = [
  "set -e",
  "git --version",
  "node --version",
  WAIT_FOR_DPKG_LOCK,
  "command -v pnpm >/dev/null 2>&1 || npm install -g pnpm",
  "if ! command -v python3 >/dev/null 2>&1; then",
  '  if [ "$(id -u)" = 0 ]; then apt-get update && apt-get install -y python3; else sudo -n apt-get update && sudo -n apt-get install -y python3; fi',
  "fi",
  "pnpm --version && python3 --version",
  // tmux holds each Terminal tab's shell, so it outlives any connection to it (`terminal/tmux.ts`).
  ...PREPARE_TMUX,
  // Playwright and its Chromium, so a coding agent opens what it built and screenshots it; the
  // browser's system libraries are installed through sudo by Playwright itself, the browser for the user.
  // Note that we install only the headless shell, because nothing here launches headed Chromium
  // (`playwright screenshot` runs headless, Electron ships its own), and the full browser
  // would be hundreds of megabytes in every snapshot for nothing.
  `npm install -g playwright@${PLAYWRIGHT_VERSION}`,
  "playwright install --with-deps --only-shell chromium",
  // After Playwright, whose `--with-deps` has just refreshed the package lists and installed Xvfb.
  INSTALL_GTK,
  ...INSTALL_GH_STACK,
  ...INSTALL_BUBBLEWRAP,
  ...INSTALL_CLAUDE_CODE,
  ...CREATE_AGENT_USER,
  ...INSTALL_CODEX,
  // Last, once everything that needs root is in place.
  ...DROP_SUDO,
].join("\n");

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
}

/** The bound as Vercel's create takes it, its expiration in milliseconds. */
function retentionOf(bound: SnapshotBound): Retention {
  return { ...bound, expiration: Duration.toMillis(bound.expiration) };
}

/**
 * The coding agent's sandbox lives the platform's maximum, so a long run is
 * never cut off mid-turn, and is stopped the moment a turn ends rather than
 * waiting that out. Its size is enough memory for the repository's own lint,
 * chosen at open, so a stopped sandbox resumes at it. A brain sandbox opens
 * at the defaults and is never stopped by Luke: Vercel stops it when eve's
 * default timeout of thirty minutes runs out, counted from its start or
 * resume whether it is busy or not, and it resumes from its snapshot with
 * the checkout intact. Every stop snapshots the sandbox, so each keeps its
 * newest snapshot alone.
 */
const SANDBOX_LIFECYCLE = {
  [SANDBOX_POLICY.READ_SHALLOW_LAZY]: {
    open: { keepLastSnapshots: retentionOf(BRAIN_HOST.SANDBOX_SNAPSHOTS) },
    renewsCredential: false,
    stopsAtTurnEnd: false,
  },
  [SANDBOX_POLICY.SHALLOW_THEN_DEEP]: {
    open: {
      timeout: CODER.SANDBOX_TIMEOUT_MS,
      resources: { vcpus: CODER.SANDBOX_VCPUS },
      keepLastSnapshots: retentionOf(CODER.SANDBOX_SNAPSHOTS),
    },
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
 * What the image is prepared with, once per build, on the snapshot every
 * session starts from; exported so `tools/codex-probe` builds its sandbox
 * from the same image.
 */
export async function prepareImage(sandbox: SandboxSession): Promise<void> {
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
