export const PINS = {
  AGENT_SDK: "0.3.304",
  CLAUDE_CODE: "2.1.304",
} as const;

export const PROBE_SANDBOX = {
  IMAGE: "vercel/sandbox/node:24",
  AGENT_USER: "agent",
  ROOT: "/opt/agent-probe",
  CHECKOUT: "/workspace/repository",
  TIMEOUT_MS: 60 * 60 * 1_000,
  VCPUS: 4,
} as const;

export const DROP_CAPABILITIES = [
  "--inh-caps=-all",
  "--ambient-caps=-all",
  "--bounding-set=-all",
] as const;

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

export const PROBE_ENV = {
  CLAUDE_TOKEN: "APP_PROBE_CLAUDE_OAUTH_TOKEN",
  GITHUB_TOKEN: "APP_PROBE_GITHUB_TOKEN",
  REPOSITORY: "APP_PROBE_REPOSITORY",
  KEEP_SANDBOX: "APP_PROBE_KEEP_SANDBOX",
  MODEL: "APP_PROBE_MODEL",
} as const;

const REPOSITORY_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;

export function isRepositoryName(text: string): boolean {
  const name = text.split("/")[1] ?? "";
  return REPOSITORY_NAME.test(text) && name !== "." && name !== ".." && !name.endsWith(".git");
}

export const CLAUDE_TOKEN_VARIABLE = "CLAUDE_CODE_OAUTH_TOKEN";

export const ANTHROPIC_API = {
  HOST: "api.anthropic.com",
  MESSAGES: "https://api.anthropic.com/v1/messages",
  VERSION: "2023-06-01",
} as const;

export const DEFAULT_MODEL = "sonnet";

export const QUERY_OPTIONS = {
  systemPrompt: { type: "preset", preset: "claude_code" },
  settingSources: ["project"],
  permissionMode: "bypassPermissions",
  allowDangerouslySkipPermissions: true,
  includePartialMessages: true,
  sandbox: { enabled: false },
} as const;

export const LEAK_CHECK_MARKER = "APP_PROBE_LEAK_CHECK";

export const DRIVER_EVENT = {
  ACCOUNT: "agent_probe_account",
  ERROR: "agent_probe_error",
  EXIT: "agent_probe_exit",
} as const;

export const DRIVER_COMMAND = {
  MESSAGE: "message",
  STOP: "stop",
  END: "end",
} as const;
