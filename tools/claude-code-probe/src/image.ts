import { PINS, PROBE_SANDBOX } from "./pins.js";

const { AGENT_USER, ROOT, CHECKOUT } = PROBE_SANDBOX;

export const SCRIPT_NAME = "agent-probe";

const PROBE_COMMITTER = {
  NAME: "Vespin probe",
  EMAIL: "agent-probe@users.noreply.github.com",
} as const;

export const INSTALL_CLAUDE_CODE = [
  "set -euo pipefail",
  'DEFAULT_USER="$1"',
  'DEFAULT_GROUP="$(id -gn "$DEFAULT_USER")"',
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

export const SHARE_CHECKOUT = [
  "set -euo pipefail",
  `git -C ${CHECKOUT} config core.sharedRepository group`,
  `chmod -R g+rwX ${CHECKOUT}`,
  `find ${CHECKOUT} -type d -exec chmod g+s {} +`,
].join("\n");

export const FIND_SESSION_FILES =
  'find / -xdev \\( -path /proc -o -path /sys \\) -prune -o -name "$1.jsonl" -print 2>/dev/null';

export const ROOT_TOKEN_SCAN = `grep -rIlE 'sk-ant-[a-z]{3}[0-9]{2}-[A-Za-z0-9_-]{16,}' /home /root /tmp /var/tmp /workspace /etc ${ROOT} --exclude-dir=node_modules 2>/dev/null`;
