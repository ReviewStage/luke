import {
  CONVERSATION_MESSAGE_AUTHOR,
  maximumSessionTitleLength,
  type ProviderConversationMessage,
} from "@sidecar/session";
import { isRecord, text, type UnparsedWireValue, type WireRecord } from "@sidecar/wire";
import {
  isDefined,
  knownValue,
  repositoryLabel,
  textFromRecord,
  timestampFromRecord,
} from "../shared/cloud-wire.js";
import {
  CONDUCTOR_DEFAULTS,
  CONDUCTOR_RETIRED_WORKSPACE_STATUSES,
  CONDUCTOR_WORKSPACE_STATUS,
  type ConductorSessionStatus,
  type ConductorWorkspaceStatus,
} from "./vocabulary.js";

/**
 * The shapes Conductor's documented endpoints take and answer with: the
 * routes, the fields of a request body, the fields of a response, and the
 * readers that turn one answer into what a row or a bubble says.
 */

/**
 * Documented public API routes. The reads walk projects, the user's own open
 * workspaces through the workspace listing's documented creator and archive
 * filters, and each workspace's sessions, and poll the status endpoints
 * workspaces and sessions document. Beside those pass-driven reads stands one
 * a user asks for by opening a conversation screen:
 * `GET …/sessions/{id}/messages`, Conductor's documented read of one
 * session's stored transcript, paged with the `after` cursor its own answers
 * hand back; the brain's own transcript read takes its newest page too, and
 * it is never issued by an observation pass. The writers
 * are `POST …/sessions/{id}/messages`, which is
 * Conductor's documented way to hand a prompt to an existing session — queued
 * while it is idle, steered into the running turn while it works —
 * `POST …/sessions/{id}/cancel`, which stops the current turn,
 * `POST /v0/workspaces`, which is its documented way to create a workspace in
 * a project the user already connected,
 * `POST …/workspaces/{id}/archive`, which is its documented way to file a
 * workspace away, and
 * `POST …/workspaces/{id}/rename` and `POST …/sessions/{id}/rename`, which
 * are its documented ways to give a workspace or a chat the name the user
 * just chose.
 */
export const CONDUCTOR_ROUTE = {
  IDENTITY: ["me"],
  PROJECTS: ["v0", "projects"],
  /** The documented read-only query endpoint over the transcripts view. */
  SQL: ["v0", "sql"],
} as const;

export const CONDUCTOR_ROUTE_SEGMENT = {
  ARCHIVE: "archive",
  CANCEL: "cancel",
  MESSAGES: "messages",
  RENAME: "rename",
  SESSIONS: "sessions",
  STATUS: "status",
  V0: "v0",
  WORKSPACES: "workspaces",
} as const;

/** The body `POST …/sessions/{id}/messages` documents. */
export const CONDUCTOR_MESSAGE_FIELD = {
  MESSAGE: "message",
} as const;

/** The one field both rename endpoints document: the new name itself. */
export const CONDUCTOR_RENAME_FIELD = {
  NAME: "name",
} as const;

/**
 * The body `POST /v0/workspaces` documents. The project names where; the name
 * is optional and Conductor generates one — and the branch it names — when it
 * is left off. The agent, model, and effort ride only when the user chose
 * them in settings, held to the build's documented table on the way; unset,
 * none is sent, so Conductor's own defaults decide. Fast mode is never sent —
 * the user is not offered it, so Conductor's default stands.
 */
export const CONDUCTOR_WORKSPACE_FIELD = {
  PROJECT_ID: "projectId",
  NAME: "name",
  AGENT: "agent",
  MODEL: "model",
  EFFORT: "effort",
  /** The first session, as `POST /v0/workspaces` names it in its response. */
  SESSION_ID: "sessionId",
} as const;

/** The body `POST /v0/sessions` documents, of it the fields Luke ever sends. */
export const CONDUCTOR_SESSION_CREATE_FIELD = {
  WORKSPACE_ID: "workspaceId",
  AGENT: "agent",
  MODEL: "model",
  EFFORT: "effort",
  NAME: "name",
  MESSAGE: "message",
} as const;

/**
 * The query parameters the reads send, all documented by the endpoints they
 * ride. Nothing enters a value but what the build fixed, the user id the same
 * pass's identity read reported, and the arithmetic page cursor the previous
 * page's own answer earned.
 */
export const CONDUCTOR_QUERY = {
  AFTER: "after",
  CREATOR: "creator",
  INCLUDE_ARCHIVED: "includeArchived",
  LIMIT: "limit",
  OFFSET: "offset",
} as const;

export const CONDUCTOR_FIELD = {
  ARCHIVED_AT: "archivedAt",
  CREATED_AT: "createdAt",
  CREATOR_ID: "creatorId",
  DATA: "data",
  DEEP_LINK: "deepLink",
  EFFORT: "effort",
  ERROR_MESSAGE: "errorMessage",
  FAST_MODE: "fastMode",
  GIT_REMOTE: "gitRemote",
  HAS_MORE: "hasMore",
  ID: "id",
  LAST_ACTIVITY_AT: "lastActivityAt",
  LAST_ERROR: "lastError",
  MODEL: "model",
  NAME: "name",
  REPO_URL: "repoUrl",
  RESOLVED_MODEL: "resolvedModel",
  /** The workspace listing's own word for where each workspace stands. */
  STATE: "state",
  STATUS: "status",
  UPDATED_AT: "updatedAt",
  USER_ID: "userId",
} as const;

/** The fields one stored message answers with, named as the endpoint documents them. */
export const CONDUCTOR_STORED_MESSAGE_FIELD = {
  ID: "id",
  TYPE: "type",
  CONTENT: "content",
  RECEIVED_AT: "receivedAt",
} as const;

/**
 * The two kinds of stored message whose author the store itself names: the
 * developer's own send, and an event the session's harness emitted. Anything
 * else the endpoint may answer with is a kind this build does not know, and
 * is dropped rather than guessed at.
 */
const CONDUCTOR_STORED_MESSAGE_TYPE = {
  USER_MESSAGE: "userMessage",
  AGENT: "agent",
} as const;

/** Inside a stored user message's content: the developer's words themselves. */
const CONDUCTOR_USER_CONTENT_FIELD = {
  MESSAGE: "message",
} as const;

/** Inside a stored agent message's content: the harness event it wraps, whole. */
const CONDUCTOR_AGENT_CONTENT_FIELD = {
  RAW_PAYLOAD: "rawPayload",
} as const;

/**
 * The two harness event shapes that carry the agent's own words, as
 * Conductor's store actually holds them. Claude-shaped harnesses (Claude Code
 * and Cursor both) store an `assistant` stream event whose message carries
 * content blocks; Codex stores its app-server events, where a completed
 * `agentMessage` item carries its text whole. Every other event — thinking,
 * tool calls, tool output, lifecycle — is not the agent speaking to the
 * developer, so it never becomes a bubble.
 */
const CONDUCTOR_HARNESS_EVENT_FIELD = {
  TYPE: "type",
  MESSAGE: "message",
  CONTENT: "content",
  EVENT: "event",
  ITEM: "item",
  TEXT: "text",
} as const;

const CONDUCTOR_CLAUDE_ASSISTANT_EVENT_TYPE = "assistant";
const CONDUCTOR_CLAUDE_TEXT_BLOCK_TYPE = "text";
const CONDUCTOR_CODEX_ITEM_COMPLETED_EVENT_TYPE = "item.completed";
const CONDUCTOR_CODEX_AGENT_MESSAGE_ITEM_TYPE = "agentMessage";

/**
 * How a conversation read is bounded: the documented page size the endpoint
 * itself caps at, how many pages one read may walk, and how many attributed
 * messages one answer may carry. A read that stops at a bound answers with
 * `hasMore` and the cursor to continue after, so nothing is lost — only
 * deferred to the next ask.
 */
export const CONDUCTOR_CONVERSATION_BOUNDS = {
  /** The window one stored-messages read asks for — the endpoint's own server-side cap. */
  PAGE_SIZE: 100,
  /** How many pages one poll may chase forward while the endpoint says more remain. */
  MAXIMUM_PAGES: 10,
  /** How many attributed messages one poll answer may carry. */
  MAXIMUM_MESSAGES: 200,
  /** How many attributed messages an older-history page aims to carry. */
  HISTORY_TARGET_MESSAGES: 30,
  /**
   * How many sessions' transcript ends one credential's reads remember at
   * once. A re-opened chat starts its walk where the last read of it reached,
   * so the cache is what makes a re-open one request.
   */
  END_CACHE_ENTRIES: 50,
} as const;

/** The columns the transcripts read asks for, named as the view answers them. */
export const CONDUCTOR_SQL_FIELD = {
  ROWS: "rows",
  SESSION_ID: "session_id",
  AGENT_TYPE: "agent_type",
} as const;

/**
 * The one query document this adapter ever sends, fixed by this build. The
 * endpoint takes a read as a POSTed document rather than a GET, so the
 * separation is held the way the Linear tracker holds it: observation only
 * ever sends this SELECT, and nothing reaches its text but session ids the
 * same pass reported — each validated as a UUID first, so no name, title, or
 * message a provider controls can ever be spliced into the document.
 *
 * The columns ask for the agent kind and nothing else. The view also holds
 * each chat's transcript, and no column of it is named here: the
 * conversation is the documented messages endpoint's to read, at the
 * developer's own press or the brain's own read tool, never an observation
 * pass's.
 */
export const CONDUCTOR_READ_AGENT_KINDS_PREFIX =
  `SELECT ${CONDUCTOR_SQL_FIELD.SESSION_ID}, ${CONDUCTOR_SQL_FIELD.AGENT_TYPE} ` +
  `FROM session_transcripts_view WHERE ${CONDUCTOR_SQL_FIELD.SESSION_ID} IN (`;

export const CONDUCTOR_READ_AGENT_KINDS_SUFFIX = ")";

export interface ConductorReportedStatus {
  status: ConductorSessionStatus | undefined;
  updatedAt: number | undefined;
  errorMessage?: string;
}

/**
 * What the lifecycle endpoint said about one workspace: where it stands, and
 * the failure message it carries when standing it up went wrong.
 */
export interface ConductorWorkspaceLifecycle {
  status?: ConductorWorkspaceStatus;
  errorMessage?: string;
}

/** What the transcripts view said about one session: who runs it. */
export interface ConductorTranscript {
  agentKind?: string;
}

export interface ConductorProject {
  id: string;
  repositoryLabel: string;
}

/**
 * A workspace still open on Conductor's own surface. An archived workspace
 * never becomes one of these: filing a workspace away is how a user says its
 * chats are done being watched, so the listing drops it before its sessions
 * are ever asked for.
 */
export interface ConductorWorkspace {
  id: string;
  name?: string;
  repositoryLabel: string;
  creatorId?: string;
  lastActivityAt: number;
}

/**
 * A chat still open on Conductor's own surface. An archived chat never becomes
 * one of these, for the same reason an archived workspace never becomes a
 * `ConductorWorkspace`: filing a chat away is how a user says that one
 * conversation is done being watched, so the listing drops it before its
 * status or transcript is ever asked for.
 */
export interface ConductorSession {
  id: string;
  workspace: ConductorWorkspace;
  name?: string;
  model?: string;
  deepLink?: string;
}

/**
 * One stored message, kept only when the store itself says who wrote it: a
 * `userMessage` is the developer's own send and its content carries their
 * words, and an `agent` message is kept only when the harness event it wraps
 * is the agent speaking. The words are never cut — the read's bounds live on
 * the page, not the message — and a message this build cannot attribute is
 * dropped whole rather than rendered as a guess.
 */
export function conversationMessageFromRecord(
  record: WireRecord,
): ProviderConversationMessage | undefined {
  const id = textFromRecord(record, CONDUCTOR_STORED_MESSAGE_FIELD.ID);
  if (!id) return undefined;
  const content = record[CONDUCTOR_STORED_MESSAGE_FIELD.CONTENT];
  if (!isRecord(content)) return undefined;
  const kind = textFromRecord(record, CONDUCTOR_STORED_MESSAGE_FIELD.TYPE);
  const words =
    kind === CONDUCTOR_STORED_MESSAGE_TYPE.USER_MESSAGE
      ? text(content[CONDUCTOR_USER_CONTENT_FIELD.MESSAGE])
      : kind === CONDUCTOR_STORED_MESSAGE_TYPE.AGENT
        ? agentWordsFromHarnessEvent(content[CONDUCTOR_AGENT_CONTENT_FIELD.RAW_PAYLOAD])
        : undefined;
  if (!words) return undefined;
  const receivedAt = timestampFromRecord(record, CONDUCTOR_STORED_MESSAGE_FIELD.RECEIVED_AT);
  return {
    id,
    author:
      kind === CONDUCTOR_STORED_MESSAGE_TYPE.USER_MESSAGE
        ? CONVERSATION_MESSAGE_AUTHOR.USER
        : CONVERSATION_MESSAGE_AUTHOR.AGENT,
    text: words,
    ...(receivedAt !== undefined ? { receivedAt } : undefined),
  };
}

/**
 * The agent's own words inside one stored harness event, in the two shapes
 * Conductor's store holds. A Claude-shaped `assistant` event speaks through
 * its message's text blocks — thinking and tool-use blocks are not words to
 * the developer, so only the text blocks join. A Codex `item.completed`
 * event speaks only as a completed `agentMessage` item, whose text rides
 * whole; a started item is still empty and an item of any other kind is a
 * tool at work. Every other event answers nothing, which drops its message.
 */
function agentWordsFromHarnessEvent(rawPayload: UnparsedWireValue): string | undefined {
  if (!isRecord(rawPayload)) return undefined;
  if (rawPayload[CONDUCTOR_HARNESS_EVENT_FIELD.TYPE] === CONDUCTOR_CLAUDE_ASSISTANT_EVENT_TYPE) {
    const message = rawPayload[CONDUCTOR_HARNESS_EVENT_FIELD.MESSAGE];
    if (!isRecord(message)) return undefined;
    const blocks = message[CONDUCTOR_HARNESS_EVENT_FIELD.CONTENT];
    if (!Array.isArray(blocks)) return undefined;
    const words = blocks
      .filter(isRecord)
      .filter(
        (block) => block[CONDUCTOR_HARNESS_EVENT_FIELD.TYPE] === CONDUCTOR_CLAUDE_TEXT_BLOCK_TYPE,
      )
      .map((block) => text(block[CONDUCTOR_HARNESS_EVENT_FIELD.TEXT]))
      .filter(isDefined)
      .join("\n\n");
    return words || undefined;
  }
  const event = rawPayload[CONDUCTOR_HARNESS_EVENT_FIELD.EVENT];
  if (!isRecord(event)) return undefined;
  if (event[CONDUCTOR_HARNESS_EVENT_FIELD.TYPE] !== CONDUCTOR_CODEX_ITEM_COMPLETED_EVENT_TYPE) {
    return undefined;
  }
  const item = event[CONDUCTOR_HARNESS_EVENT_FIELD.ITEM];
  if (!isRecord(item)) return undefined;
  if (item[CONDUCTOR_HARNESS_EVENT_FIELD.TYPE] !== CONDUCTOR_CODEX_AGENT_MESSAGE_ITEM_TYPE) {
    return undefined;
  }
  return text(item[CONDUCTOR_HARNESS_EVENT_FIELD.TEXT]);
}

/**
 * The agent kind joins the model label — `codex · gpt-5.5 · high` — because
 * which agent runs a chat is as much its configuration as which model does.
 */
export function agentAndModelLabel(
  agentKind: string | undefined,
  model: string | undefined,
): string | undefined {
  const label = [agentKind, model].filter(isDefined).join(" · ");
  return label || undefined;
}

/**
 * One listed workspace, answering for itself. The listing was already asked
 * to leave the archived out, but a record marked retired is dropped here all
 * the same, before a lifecycle or session read ever spends a request on it —
 * judged by the lifecycle read alone, a page of long-archived workspaces
 * stood or fell with dozens of per-workspace reads every pass, and any one
 * of them failing resurrected a workspace the user had already filed away.
 * A state this build does not know is kept, not dropped: the lifecycle read
 * still decides for it, as it did when the listing marked nothing.
 */
export function workspaceFromRecord(record: WireRecord): ConductorWorkspace | undefined {
  const id = textFromRecord(record, CONDUCTOR_FIELD.ID);
  const lastActivityAt =
    timestampFromRecord(record, CONDUCTOR_FIELD.LAST_ACTIVITY_AT) ??
    timestampFromRecord(record, CONDUCTOR_FIELD.CREATED_AT);
  if (!id || lastActivityAt === undefined) return undefined;
  const state = knownValue(
    CONDUCTOR_WORKSPACE_STATUS,
    textFromRecord(record, CONDUCTOR_FIELD.STATE),
  );
  if (state && CONDUCTOR_RETIRED_WORKSPACE_STATUSES.has(state)) return undefined;
  const creatorId = textFromRecord(record, CONDUCTOR_FIELD.CREATOR_ID);
  const name = textFromRecord(record, CONDUCTOR_FIELD.NAME)?.slice(0, maximumSessionTitleLength);
  const repoUrl = textFromRecord(record, CONDUCTOR_FIELD.REPO_URL);
  return {
    id,
    repositoryLabel: repositoryLabel(repoUrl, undefined),
    lastActivityAt,
    ...(name ? { name } : undefined),
    ...(creatorId ? { creatorId } : undefined),
  };
}

/** Conductor reports the model it resolved as well as the one that was asked for. */
export function modelLabel(record: WireRecord): string | undefined {
  const model = (
    textFromRecord(record, CONDUCTOR_FIELD.RESOLVED_MODEL) ??
    textFromRecord(record, CONDUCTOR_FIELD.MODEL)
  )?.slice(0, CONDUCTOR_DEFAULTS.MAXIMUM_MODEL_LABEL_LENGTH);
  if (!model) return undefined;
  const effort = textFromRecord(record, CONDUCTOR_FIELD.EFFORT);
  const fast = record[CONDUCTOR_FIELD.FAST_MODE] === true ? "fast" : undefined;
  return [model, effort, fast].filter(isDefined).join(" · ");
}
