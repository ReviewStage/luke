/**
 * image.ts -- what the probe adds to today's image, as root, and the root commands it reads the sandbox with.
 *
 * Today's image is `PREPARE_SCRIPT` (`agent-runtime/sandbox.ts`), run as the
 * sandbox's default user exactly as eve's `prepare` runs it. On top of it the
 * probe installs what P03 would: bubblewrap and socat for Claude Code's
 * command sandbox, the pinned Agent SDK with its `claude` binary in a
 * root-owned directory, and the `agent` user with a private home. The
 * checkout stays the default user's, shared with `agent` through the default
 * user's group, so a Terminal and the agent work on the same files. The
 * default user keeps its sudo, as the image does: the Sandbox API's `sudo`
 * runs through it, and the capability drop is the boundary.
 *
 * Every script takes the default user's name as its first positional
 * argument (`bash -c <script> probe <user>`) rather than spliced into its
 * text.
 */

import { PINS, PROBE_SANDBOX } from "./pins.js";

const { AGENT_USER, ROOT, CHECKOUT } = PROBE_SANDBOX;

/** A name for `$0` when a script runs under `bash -c`, so `$1` is the first argument. */
export const SCRIPT_NAME = "luke-probe";

/** The commit identity the agent's commits carry; the probe's own, never the developer's. */
const PROBE_COMMITTER = {
  NAME: "Luke probe",
  EMAIL: "luke-probe@users.noreply.github.com",
} as const;

/** What P03 would add to the image, run as root before the checkout. */
export const INSTALL_CLAUDE_CODE = [
  "set -euo pipefail",
  'DEFAULT_USER="$1"',
  'DEFAULT_GROUP="$(id -gn "$DEFAULT_USER")"',
  "if command -v dnf >/dev/null 2>&1; then dnf install -y bubblewrap socat; else apt-get install -y --no-install-recommends bubblewrap socat; fi",
  'echo "bubblewrap $(bwrap --version)"',
  `install -d -m 755 ${ROOT}`,
  `npm install --prefix ${ROOT} --no-audit --no-fund --save-exact @anthropic-ai/claude-agent-sdk@${PINS.AGENT_SDK}`,
  `chmod -R go-w ${ROOT}`,
  `CLAUDE_BIN="$(find ${ROOT}/node_modules/@anthropic-ai -path '*claude-agent-sdk-linux*' -name claude -type f | head -n 1)"`,
  'echo "claude binary at $CLAUDE_BIN: $("$CLAUDE_BIN" --version)"',
  `id -u ${AGENT_USER} >/dev/null 2>&1 || useradd --create-home --shell /bin/bash ${AGENT_USER}`,
  `chmod 700 /home/${AGENT_USER}`,
  `usermod -aG "$DEFAULT_GROUP" ${AGENT_USER}`,
  'install -d -o "$DEFAULT_USER" -g "$DEFAULT_GROUP" -m 755 /workspace',
  `git config --system --add safe.directory ${CHECKOUT}`,
  `git config --system user.name '${PROBE_COMMITTER.NAME}'`,
  `git config --system user.email '${PROBE_COMMITTER.EMAIL}'`,
].join("\n");

/** The checkout shared with the agent user through the default user's group, run as root after the clone. */
export const SHARE_CHECKOUT = [
  "set -euo pipefail",
  `git -C ${CHECKOUT} config core.sharedRepository group`,
  `chmod -R g+rwX ${CHECKOUT}`,
  `find ${CHECKOUT} -type d -exec chmod g+s {} +`,
].join("\n");

/**
 * Whether bubblewrap starts a namespaced command, as the agent user, with
 * the capabilities the user would otherwise inherit and with every one
 * dropped; root runs it through the launch's own drop (`AS_AGENT`).
 */
export const BUBBLEWRAP_STARTS =
  "if bwrap --ro-bind / / --dev /dev --proc /proc --unshare-all --die-with-parent true; then echo started; else echo refused; fi";

/** The session's files wherever the CLI keeps them, by the session id as the first argument; run as root. */
export const FIND_SESSION_FILES =
  'find / -xdev \\( -path /proc -o -path /sys \\) -prune -o -name "$1.jsonl" -print 2>/dev/null';

/** Every file root can read that holds a token-shaped string, by path alone; the SDK's own install is left out. */
export const ROOT_TOKEN_SCAN = `grep -rIlE 'sk-ant-[a-z]{3}[0-9]{2}-[A-Za-z0-9_-]{16,}' /home /root /tmp /var/tmp /workspace /etc ${ROOT} --exclude-dir=node_modules 2>/dev/null`;
