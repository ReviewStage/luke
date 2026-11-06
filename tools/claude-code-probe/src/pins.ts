/**
 * pins.ts -- what the probe pins and names: the Agent SDK and its CLI, the sandbox's users and paths, and the options `query()` runs with.
 *
 * The SDK is pinned exactly, and the CLI with it: the SDK's own
 * `claudeCodeVersion` names the `claude` binary its platform package carries,
 * so installing one installs the other. P03 pins the same pair in the image
 * and P05 in the runner; a bump moves all three on purpose.
 */

export const PINS = {
  /** `@anthropic-ai/claude-agent-sdk`, installed exactly in the sandbox. */
  AGENT_SDK: "0.3.304",
  /** The `claude` binary that SDK release carries (its `claudeCodeVersion`). */
  CLAUDE_CODE: "2.1.304",
} as const;

export const PROBE_SANDBOX = {
  /** Vercel's Node image, the agents' image's own base (`apps/web/agent-image/Dockerfile`): Node, git, and sudo. */
  IMAGE: "vercel/sandbox/node:24",
  /** The unprivileged user Claude Code runs as. */
  AGENT_USER: "agent",
  /** Root-owned, world-readable: the SDK, the driver, and the leak check. */
  ROOT: "/opt/agent-probe",
  /** Where today's coding agent checks its repository out (`REPOSITORY_SANDBOX_CONTRACT`). */
  CHECKOUT: "/workspace/repository",
  /** Long enough for the image, three launches, and a stop and resume between them. */
  TIMEOUT_MS: 60 * 60 * 1_000,
  /** The size this repository's own coding agents run at (`CODER.SANDBOX_VCPUS_BY_REPOSITORY`). */
  VCPUS: 4,
} as const;

/**
 * Every capability dropped: inheritable, ambient, and the bounding set. The
 * sandbox's default user holds the full capability set without sudo, which
 * reads another user's `/proc/<pid>/environ` and `/etc/shadow`; with these
 * dropped it reads neither. Found by P16's Codex probe.
 */
export const DROP_CAPABILITIES = [
  "--inh-caps=-all",
  "--ambient-caps=-all",
  "--bounding-set=-all",
] as const;

/** The launch's drop from root to the agent user, every capability gone, its home as its own. */
export const AS_AGENT = [
  "setpriv",
  "--reuid=agent",
  "--regid=agent",
  "--init-groups",
  ...DROP_CAPABILITIES,
  "--",
  "env",
  "HOME=/home/agent",
  "USER=agent",
  "LOGNAME=agent",
] as const;

export const PROBE_FILES = {
  DRIVER: `${PROBE_SANDBOX.ROOT}/driver.mjs`,
  LEAK_CHECK: `${PROBE_SANDBOX.ROOT}/leak-check.sh`,
} as const;

/** The environment variables the probe reads on the developer's machine; none is ever printed. */
export const PROBE_ENV = {
  CLAUDE_TOKEN: "APP_PROBE_CLAUDE_OAUTH_TOKEN",
  GITHUB_TOKEN: "APP_PROBE_GITHUB_TOKEN",
  REPOSITORY: "APP_PROBE_REPOSITORY",
  KEEP_SANDBOX: "APP_PROBE_KEEP_SANDBOX",
  MODEL: "APP_PROBE_MODEL",
} as const;

/** GitHub's own spelling of `owner/name`: an owner of letters, digits and hyphens, a name of letters, digits, `.`, `_` and `-`. */
const REPOSITORY_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;

/** Whether the text names exactly one repository as `owner/name`, so the clone URL and the firewall's path reach that one and no other. */
export function isRepositoryName(text: string): boolean {
  const name = text.split("/")[1] ?? "";
  return REPOSITORY_NAME.test(text) && name !== "." && name !== ".." && !name.endsWith(".git");
}

/** The variable the CLI reads its plan token from, which holds the launch's placeholder. */
export const CLAUDE_TOKEN_VARIABLE = "CLAUDE_CODE_OAUTH_TOKEN";

/** Anthropic's API, where the sandbox's firewall sets the plan's token in the placeholder's place, as the service's launch has it do (`claude-code-sessions.ts`). */
export const ANTHROPIC_API = {
  HOST: "api.anthropic.com",
  MESSAGES: "https://api.anthropic.com/v1/messages",
  VERSION: "2023-06-01",
} as const;

/** The probe's default model, by the CLI's own alias, so a pin bump never names a retired model. */
export const DEFAULT_MODEL = "sonnet";

/**
 * The options the driver hands `query()` beside the prompt stream, the
 * model, the working directory, and `resume`: the plan's own (P05), with no
 * command sandbox, as the runner runs it (`runner.ts`): the sandbox is the
 * boundary, and its firewall holds the token.
 */
export const QUERY_OPTIONS = {
  systemPrompt: { type: "preset", preset: "claude_code" },
  settingSources: ["project"],
  permissionMode: "bypassPermissions",
  allowDangerouslySkipPermissions: true,
  includePartialMessages: true,
  sandbox: { enabled: false },
} as const;

/** The marker a leak check's one line of JSON follows, in a command's output or a tool's result. */
export const LEAK_CHECK_MARKER = "APP_PROBE_LEAK_CHECK";

/** What the driver prints of its own beside the SDK's messages, each a `type` the SDK never uses. */
export const DRIVER_EVENT = {
  ACCOUNT: "agent_probe_account",
  ERROR: "agent_probe_error",
  EXIT: "agent_probe_exit",
} as const;

/** What the probe writes to the driver's stdin after its config line. */
export const DRIVER_COMMAND = {
  MESSAGE: "message",
  STOP: "stop",
  END: "end",
} as const;
