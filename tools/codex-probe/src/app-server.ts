/**
 * app-server.ts -- how the probe starts `codex app-server` in the sandbox and speaks to it: the pin, the documented ChatGPT-plan provider, the token's isolation, the launch that drops to the `agent` user, and the newline-delimited JSON-RPC both ways.
 *
 * The provider is OpenAI's documented one for a ChatGPT plan
 * (developers.openai.com/siwc/token-sharing-open-source/codex-app-server):
 * Codex reads its bearer from `ACCESS_TOKEN` and sends it to the Responses
 * API, with no Codex sign-in of its own. The bearer is set in the app-server
 * process's environment and nowhere else: the launch passes it through the
 * Sandbox API's command environment, never argv, and
 * `shell_environment_policy` keeps it out of what every command Codex runs
 * inherits. The probe hands it the placeholder its sandbox's firewall swaps
 * for the access token (`probe.ts`), as a Vespin agent's launch does. Each
 * value here is a pure description a test can read; the probe runs them.
 */

import {
  isRecord,
  isWireNumber,
  isWireString,
  valueFromJsonText,
  type WireRecord,
  type WireValue,
} from "@repo/wire";

/** The pinned Codex and where the probe installs it, root-owned, outside the default user's reach. */
export const CODEX = {
  PACKAGE: "@openai/codex",
  VERSION: "0.163.0",
  PREFIX: "/opt/agent-codex",
  BIN: "/opt/agent-codex/bin/codex",
} as const;

/** The unprivileged user Codex runs as, and where its own state lives. */
export const AGENT_USER = {
  NAME: "agent",
  HOME: "/home/agent",
  CODEX_HOME: "/home/agent/.codex",
} as const;

/** The provider name and the environment variable it reads, as OpenAI's guide writes them. */
export const CHATGPT_PROVIDER = {
  ID: "openai_chatgpt_plan",
  NAME: "ChatGPT plan",
  BASE_URL: "https://api.openai.com/v1",
  ENV_KEY: "ACCESS_TOKEN",
} as const;

/**
 * Who the app-server says the client is. OpenAI's guide asks that the name
 * match the `agent_name_hint` the sign-in sent, so it is `Vespin`; P20 takes
 * whichever Gate A2 settles.
 */
export const CLIENT_INFO = { name: "Vespin", title: "Vespin", version: "0.19.0" } as const;

/** The fake MCP server's name in Codex's config, and the one tool it serves. */
export const PROBE_MCP = {
  SERVER: "agent_probe",
  TOOL: "echo",
  SCRIPT: "/opt/agent-probe/mcp.mjs",
} as const;

/** The JSON-RPC methods the probe sends, and the notifications it reads. */
export const METHOD = {
  INITIALIZE: "initialize",
  INITIALIZED: "initialized",
  MODEL_LIST: "model/list",
  THREAD_START: "thread/start",
  THREAD_RESUME: "thread/resume",
  TURN_START: "turn/start",
  TURN_STEER: "turn/steer",
  TURN_INTERRUPT: "turn/interrupt",
  ITEM_STARTED: "item/started",
  ITEM_COMPLETED: "item/completed",
  TURN_COMPLETED: "turn/completed",
  TOKEN_USAGE: "thread/tokenUsage/updated",
  RATE_LIMITS: "account/rateLimits/updated",
} as const;

/** One `-c key=value` override per entry, TOML values, as Codex's CLI takes them. */
type ConfigOverride = readonly [key: string, tomlValue: string];

/** A TOML string literal. */
function toml(value: string): string {
  return JSON.stringify(value);
}

/** The documented ChatGPT-plan provider, at the base URL given (the real one, or a scripted one in a test). */
function providerOverrides(baseUrl: string = CHATGPT_PROVIDER.BASE_URL): readonly ConfigOverride[] {
  const at = `model_providers.${CHATGPT_PROVIDER.ID}`;
  return [
    ["model_provider", toml(CHATGPT_PROVIDER.ID)],
    [`${at}.name`, toml(CHATGPT_PROVIDER.NAME)],
    [`${at}.base_url`, toml(baseUrl)],
    [`${at}.env_key`, toml(CHATGPT_PROVIDER.ENV_KEY)],
    [`${at}.wire_api`, toml("responses")],
    [`${at}.requires_openai_auth`, "false"],
    [`${at}.supports_websockets`, "false"],
  ];
}

/**
 * What a command Codex runs inherits: only the core variables (`PATH`,
 * `HOME`, and the like) with `ACCESS_TOKEN` excluded by name beside Codex's
 * own default `*TOKEN*` exclusion, and the fake MCP server, the stand-in for
 * Vespin's, is configured with no environment of ours. Codex runs no sandbox
 * of its own (`danger-full-access`), as the runner runs it, so a command
 * running as the same user can still read the app-server's own
 * `/proc/<pid>/environ`: what keeps the token from it is that the sandbox
 * holds only the placeholder, which the probe checks.
 */
function isolationOverrides(): readonly ConfigOverride[] {
  return [
    ["shell_environment_policy.inherit", toml("core")],
    ["shell_environment_policy.ignore_default_excludes", "false"],
    ["shell_environment_policy.exclude", `[${toml(CHATGPT_PROVIDER.ENV_KEY)}]`],
    [`mcp_servers.${PROBE_MCP.SERVER}.command`, toml("node")],
    [`mcp_servers.${PROBE_MCP.SERVER}.args`, `[${toml(PROBE_MCP.SCRIPT)}]`],
    // Note that we approve the server's tools up front, because under `approval_policy = "never"`
    // Codex 0.163.0 otherwise fails every MCP call as needing an approval it may not ask for.
    [`mcp_servers.${PROBE_MCP.SERVER}.default_tools_approval_mode`, toml("approve")],
    ["approval_policy", toml("never")],
    ["sandbox_mode", toml("danger-full-access")],
  ];
}

/** The overrides as Codex's argv: `-c key=value` pairs. Nothing in them is secret. */
function overrideArgs(overrides: readonly ConfigOverride[]): readonly string[] {
  return overrides.flatMap(([key, value]) => ["-c", `${key}=${value}`]);
}

/** What the Sandbox API is asked to run: a root command whose environment carries Codex's bearer. */
export interface LaunchSpec {
  readonly cmd: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly sudo: true;
}

/**
 * The app-server's launch: run as root through the Sandbox API (`sudo: true`,
 * whose environment travels in the request body rather than argv), then
 * dropped to `agent` by `setpriv`, which keeps the environment, with every
 * capability set emptied, the bounding set included. A Vercel Sandbox hands
 * its default user's processes the full capability set without sudo, so a
 * launch that only changed user would leave Codex and its commands able to
 * read any process's environment and any file, and to reach root. Note that the SDK's own
 * `asUser()` is not used, because it carries a command's environment into
 * argv as `env KEY=value`, where every process in the sandbox can read it.
 */
export function launchSpec(input: {
  /** What Codex sends as its bearer: the placeholder in the probe's sandbox. */
  readonly bearer: string;
  readonly baseUrl?: string;
}): LaunchSpec {
  const overrides = [...providerOverrides(input.baseUrl), ...isolationOverrides()];
  return {
    cmd: "setpriv",
    args: [
      `--reuid=${AGENT_USER.NAME}`,
      `--regid=${AGENT_USER.NAME}`,
      "--init-groups",
      "--inh-caps=-all",
      "--ambient-caps=-all",
      "--bounding-set=-all",
      "--",
      CODEX.BIN,
      "app-server",
      "--listen",
      "stdio://",
      ...overrideArgs(overrides),
    ],
    env: {
      [CHATGPT_PROVIDER.ENV_KEY]: input.bearer,
      HOME: AGENT_USER.HOME,
      CODEX_HOME: AGENT_USER.CODEX_HOME,
      USER: AGENT_USER.NAME,
      LOGNAME: AGENT_USER.NAME,
      PATH: `${CODEX.PREFIX}/bin:/usr/local/bin:/usr/bin:/bin`,
      NO_COLOR: "1",
    },
    sudo: true,
  };
}

/** A message the probe writes to the app-server's stdin, one line each. */
export type ClientMessage =
  | { readonly id: number; readonly method: string; readonly params: WireValue }
  | { readonly method: string; readonly params?: WireValue }
  | {
      readonly id: number | string;
      readonly error: { readonly code: number; readonly message: string };
    };

/** A message the app-server wrote, read by its shape. */
export type ServerMessage =
  | {
      readonly kind: "response";
      readonly id: number;
      readonly result: WireValue | undefined;
      readonly error: WireRecord | undefined;
    }
  | { readonly kind: "notification"; readonly method: string; readonly params: WireRecord }
  | {
      readonly kind: "request";
      readonly id: number | string;
      readonly method: string;
      readonly params: WireRecord;
    }
  | { readonly kind: "unreadable"; readonly line: string };

/** One message as one line of JSON. */
export function encodeMessage(message: ClientMessage): string {
  return `${JSON.stringify(message)}\n`;
}

/** A line the app-server wrote, read as a response, a notification, a request of its own, or neither. */
export function readServerLine(line: string): ServerMessage {
  const value = valueFromJsonText(line);
  if (!isRecord(value)) return { kind: "unreadable", line };
  const { id, method } = value;
  const params = isRecord(value.params) ? value.params : {};
  if (isWireString(method) && (isWireNumber(id) || isWireString(id))) {
    return { kind: "request", id, method, params };
  }
  if (isWireString(method)) return { kind: "notification", method, params };
  if (isWireNumber(id)) {
    return {
      kind: "response",
      id,
      result: value.result,
      error: isRecord(value.error) ? value.error : undefined,
    };
  }
  return { kind: "unreadable", line };
}

/**
 * Splits a byte stream into whole lines, keeping a partial last line until
 * its newline arrives, since the Sandbox API's log chunks break anywhere.
 */
export class LineSplitter {
  private pending = "";

  /** The whole lines a chunk completes, in order, empty ones dropped. */
  push(chunk: string): readonly string[] {
    const lines = (this.pending + chunk).split("\n");
    this.pending = lines.pop() ?? "";
    return lines.map((line) => line.replace(/\r$/u, "")).filter((line) => line.length > 0);
  }
}

/** A user message as Codex's `UserInput` takes it. */
export function textInput(text: string): WireValue {
  return [{ type: "text", text, text_elements: [] }];
}
