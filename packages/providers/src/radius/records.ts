import os from "node:os";
import path from "node:path";
import { PROVIDER_ID, type SessionProvider } from "@sidecar/session";
import { isRecord, oneLine, text, type WireRecord } from "@sidecar/wire";

/**
 * The vocabulary of the store the Radius browser keeps its agent chats in:
 * one SQLite database under its own application directory,
 * `~/.radius/state/agent-chat.sqlite`. A `chat_conversations` row is the chat
 * — its name, the project it was opened in, and whether the user filed it
 * away — a `turns` row is one run of that chat, and the `events` rows under a
 * turn are what the agent did during it. Radius is a host rather than an
 * agent: a chat is a Claude Code, Codex, or Cursor conversation before it is
 * a Radius one, and the database says which by the agent its turns name and
 * by the bridge table that holds the chat's id on the agent's own side.
 */

const RADIUS_DIRECTORY_NAME = ".radius";
const RADIUS_STATE_DIRECTORY = "state";

/** Where the browser keeps every agent chat it has run. */
export const RADIUS_DATABASE_FILE = "agent-chat.sqlite";

export function defaultRadiusHome(): string {
  return path.join(os.homedir(), RADIUS_DIRECTORY_NAME);
}

export function radiusDatabasePath(radiusHome: string): string {
  return path.join(radiusHome, RADIUS_STATE_DIRECTORY, RADIUS_DATABASE_FILE);
}

/** The columns this code reads off `chat_conversations` rows. */
export const RADIUS_CONVERSATION_COLUMN = {
  CONVERSATION_ID: "conversation_id",
  LABEL: "label",
  PROJECT_ID: "project_id",
  PROJECT_LABEL: "project_label",
  PROJECT_PATH: "project_path",
  UPDATED_AT: "updated_at",
  LAST_MESSAGE_AT: "last_message_at",
} as const;

/** The columns this code reads off `turns` rows. */
export const RADIUS_TURN_COLUMN = {
  ID: "id",
  CONVERSATION_ID: "conversation_id",
  STATUS: "status",
  MODEL: "model",
  CREATED_AT: "created_at",
  COMPLETED_AT: "completed_at",
  ERROR: "error",
} as const;

/** The columns this code reads off `events` rows. */
export const RADIUS_EVENT_COLUMN = {
  KIND: "kind",
  PAYLOAD_JSON: "payload_json",
  CREATED_AT: "created_at",
} as const;

/**
 * The one turn status this build reads a meaning from. A turn wearing it ran
 * to its own end, which is what lets its closing words stand as a recap.
 * Every other token — a turn the user stopped, one the runtime gave up on —
 * is read structurally instead, from `completed_at` and `error`, so a status
 * word this build has never seen still lands somewhere honest rather than
 * being guessed at.
 */
export const RADIUS_TURN_STATUS = { COMPLETED: "completed" } as const;

/** The event kinds under a turn whose meaning this code consults. */
export const RADIUS_EVENT_KIND = {
  MESSAGE_COMPLETED: "message.completed",
  TOOL_STARTED: "tool.started",
  TOOL_COMPLETED: "tool.completed",
} as const;

/** The roles a `message.completed` payload names. */
export const RADIUS_MESSAGE_ROLE = {
  USER: "user",
  ASSISTANT: "assistant",
} as const;

/**
 * The agents Radius runs a chat as, named the way its own store names them:
 * the prefix its model ids carry, which is also the agent named by the three
 * bridge tables the schema keeps chat ids on the agent's side in. An agent
 * outside this set is one this build cannot name, so the chat reports none
 * rather than a guess — the Radius row itself is unaffected.
 */
export const RADIUS_AGENT = {
  CLAUDE_CODE: "claude-code",
  CODEX: "codex",
  CURSOR: "cursor",
} as const;

type RadiusAgent = (typeof RADIUS_AGENT)[keyof typeof RADIUS_AGENT];

const RADIUS_AGENT_PROVIDER = {
  [RADIUS_AGENT.CLAUDE_CODE]: { id: PROVIDER_ID.CLAUDE_CODE, displayName: "Claude Code" },
  [RADIUS_AGENT.CODEX]: { id: PROVIDER_ID.CODEX, displayName: "Codex" },
  [RADIUS_AGENT.CURSOR]: { id: PROVIDER_ID.CURSOR, displayName: "Cursor" },
} as const satisfies Readonly<Record<RadiusAgent, SessionProvider>>;

function radiusAgentProvider(agent: string): SessionProvider | undefined {
  for (const [key, provider] of Object.entries(RADIUS_AGENT_PROVIDER)) {
    if (key === agent) return provider;
  }
  return undefined;
}

/** The model id split into the agent that ran the turn and the model it ran. */
export interface RadiusTurnModel {
  agent?: SessionProvider;
  model?: string;
}

/**
 * Radius names a turn's model as `<agent>/<model>` — `claude-code/opus-5` —
 * so the one column carries both fields the observation already has slots
 * for. Splitting them is what keeps a row from saying "Claude Code" twice;
 * a model id in any other shape is reported whole, under no agent.
 */
export function radiusTurnModel(value: string | undefined): RadiusTurnModel {
  const model = value?.trim();
  if (!model) return {};
  const separator = model.indexOf("/");
  if (separator <= 0) return { model };
  const agent = radiusAgentProvider(model.slice(0, separator));
  if (!agent) return { model };
  const named = model.slice(separator + 1).trim();
  return { agent, ...(named ? { model: named } : undefined) };
}

/** The `payload` object inside one stored agent event. */
export function radiusEventPayload(event: WireRecord): WireRecord | undefined {
  const payload = event.payload;
  return isRecord(payload) ? payload : undefined;
}

/**
 * Tool arguments whose value names the work, in the order they read best. The
 * set matches what the other local adapters report — a URL is deliberately
 * not in it, because a signed URL is a credential and no other adapter sends
 * one anywhere; a fetch is named by its tool alone.
 */
const RADIUS_TOOL_ARGUMENT_KEY = [
  "description",
  "command",
  "file_path",
  "path",
  "pattern",
  "prompt",
  "query",
] as const;

/** What Radius calls the tool an event describes. */
export function radiusToolName(payload: WireRecord): string | undefined {
  return text(payload.toolName);
}

/**
 * The agent's own id for the call an event describes. Radius announces some
 * calls twice — two `tool.started` events under one id — so a reader that
 * renders one line per call has to recognize the repeat by this.
 */
export function radiusToolId(payload: WireRecord): string | undefined {
  return text(payload.toolId);
}

/** The argument that names a tool call's work, if any argument carries one. */
export function radiusToolDetail(payload: WireRecord, maximumLength: number): string | undefined {
  const args = payload.args;
  if (!isRecord(args)) return undefined;
  return RADIUS_TOOL_ARGUMENT_KEY.map((key) => oneLine(text(args[key]), maximumLength)).find(
    (candidate) => candidate !== undefined,
  );
}
