/**
 * sandbox-image.ts -- the coding agent's image: the script that prepares it, the function that runs it, and nothing of eve's runtime.
 *
 * `sandbox.ts` hands this preparation to eve, which prepares its own
 * snapshot from it at build time, and `native-sandbox-template.ts` prepares
 * Luke's own template from it for a native harness's sandbox. It lives
 * apart from `sandbox.ts` because that module reaches eve's sandbox runtime,
 * which a web function cannot bundle, while this one reaches only the code
 * extension's tooling installer, a few self-contained modules.
 *
 * What the image carries, and why, is told in `sandbox.ts`.
 */

import {
  AGENT_USER,
  CLAUDE_CODE_PIN,
  CLAUDE_EXECUTABLE,
  CODEX_PIN,
  RUNNER_DIRECTORY,
} from "@luke/agent-runner/pins";
import { installCodeTooling } from "eve/extensions/code/sandbox";
import type { SandboxSession } from "eve/sandbox";
import { WITHOUT_CAPABILITIES } from "../sandbox-capabilities.js";
import { PREPARE_TMUX } from "../terminal/tmux.js";

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
 * The Claude Agent SDK and the `claude` binary it carries, as the runner
 * pins them (`@luke/agent-runner/pins`): the pair the Claude Code probe
 * proved in a sandbox, installed as root in a directory only root writes, so
 * no shell of the sandbox's user changes the binary Claude Code runs as
 * `agent`.
 */
const CLAUDE_CODE = CLAUDE_CODE_PIN;

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
  `$SUDO ln -sfn ${CLAUDE_EXECUTABLE} ${CLAUDE_CODE.LINK}`,
  "claude --version",
  `claude --version | grep -q '^${CLAUDE_CODE.VERSION} ' || { echo 'claude does not print ${CLAUDE_CODE.VERSION}' >&2; exit 1; }`,
];

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
 * Codex, as the runner pins it (`@luke/agent-runner/pins`): the release the
 * Codex probe proved in a sandbox, which the runner's Codex mode drives and
 * its protocol types are generated from. Installed as root under a prefix
 * only root writes, beside the Claude Agent SDK. Its `CODEX_HOME` is in
 * `agent`'s home, so `thread/resume` finds the threads it keeps there after
 * a stop; Codex refuses to start where it is missing, so the image makes it.
 */
const CODEX = CODEX_PIN;

/**
 * Installs Codex where it does not already print the pin, links it as
 * `codex`, and checks that it prints the pin, `$SUDO` as `PREPARE_TMUX` set
 * it; then makes `agent`'s `CODEX_HOME`, which only `agent` reads.
 */
const INSTALL_CODEX = [
  `if ! ${CODEX.DIRECTORY}/bin/codex --version 2>/dev/null | grep -Fxq 'codex-cli ${CODEX.VERSION}'; then`,
  `  $SUDO env HOME=/root npm install --global --prefix ${CODEX.DIRECTORY} --no-audit --no-fund @openai/codex@${CODEX.VERSION}`,
  "fi",
  `$SUDO ln -sfn ${CODEX.DIRECTORY}/bin/codex ${CODEX.LINK}`,
  "codex --version",
  `codex --version | grep -Fxq 'codex-cli ${CODEX.VERSION}' || { echo 'codex does not print ${CODEX.VERSION}' >&2; exit 1; }`,
  `$SUDO install -d -o ${AGENT_USER} -g ${AGENT_USER} -m 0700 ${CODEX.HOME}`,
];

/**
 * The directory each launch installs the runner's bundle in, made here as
 * root's, since the launch runs as the default user (holding the capability
 * set, which `install -o root` needs) and a directory it made would be that
 * user's, whose Terminal shells could then replace the bundle.
 */
const MAKE_RUNNER_DIRECTORY = [`$SUDO install -d -o root -g root -m 0755 ${RUNNER_DIRECTORY}`];

/**
 * The image's last step: a check that a command started under the
 * capability drop (`../sandbox-capabilities.ts`) holds no capability, which
 * fails the preparation rather than leave a Terminal's shell, an agent's
 * command, or the runner holding the set. Note that the default user keeps
 * its sudo, which eve's own commands use, and reaches root without sudo
 * anyway while it holds the set, so the drop, not sudoers, is the boundary.
 */
const CHECK_CAPABILITY_DROP = [
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
  // Note that we install the full browser beside the headless shell `playwright screenshot` runs,
  // though it costs about 400 MB in every snapshot, because the agent's own browser
  // (`../browser/sandbox-browser.ts`) runs it headful under Xvfb, where a site sees an ordinary
  // Chrome rather than a headless one that a sign-in would refuse.
  `npm install -g playwright@${PLAYWRIGHT_VERSION}`,
  "playwright install --with-deps chromium",
  // After Playwright, whose `--with-deps` has just refreshed the package lists and installed Xvfb.
  INSTALL_GTK,
  ...INSTALL_GH_STACK,
  ...INSTALL_BUBBLEWRAP,
  ...INSTALL_CLAUDE_CODE,
  ...CREATE_AGENT_USER,
  ...INSTALL_CODEX,
  ...MAKE_RUNNER_DIRECTORY,
  // Last, once everything is in place.
  ...CHECK_CAPABILITY_DROP,
].join("\n");

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
