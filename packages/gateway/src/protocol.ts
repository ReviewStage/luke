/**
 * protocol.ts -- the Gateway's vocabulary: the methods a client asks the host,
 * the events the host tells every client, the refusals a handler fails with,
 * and the parameter and result shapes the desktop reads.
 *
 * The vocabulary lives here, below every implementation, so the host that
 * answers a method and the client that calls it read the same words from one
 * contract. Nothing in this file performs anything.
 */
import type { WireValue } from "@repo/wire";
import { Effect, Schema } from "effect";

/** Every method the host answers, by the name a client calls it. */
export const GATEWAY_METHOD = {
  SHUTDOWN: "gateway.shutdown",
  /** The Mac woke or unlocked: a task list already followed is sealed and followed again now, once however many of those land together. */
  TASKS_RESYNC: "tasks.resync",
  /** The app reaches the service again (`networkConnected` turned true): every read a window holds is asked again now, and a task list already followed is sealed and followed again, whatever resync came lately. */
  TASKS_REGAINED: "tasks.regained",
  /** One version of one page of one plan with its HTML, read from the service for the frame that draws it; answered to the caller, never held in the view. */
  TASKS_PAGE: "tasks.page",
  /** The account's workspaces read again from the service where the last read is a minute old or none stands; the view takes them. */
  WORKSPACES_REFRESH: "workspaces.refresh",
  /**
   * What waits on the developer across the account, followed from now until
   * it is let go or the account signs out: every open inbox item, heard as
   * `ACCOUNT_INBOX_CHANGED` events, never answered; following again starts
   * over. Main's own follow, which no window asks.
   */
  AGENTS_ACCOUNT_INBOX_FOLLOW: "agents.accountInboxFollow",
  /** The account inbox let go: no more `ACCOUNT_INBOX_CHANGED` events until it is followed again. */
  AGENTS_ACCOUNT_INBOX_UNFOLLOW: "agents.accountInboxUnfollow",
  /**
   * A coding agent's terminals (`@repo/features/terminal-view`): its shells
   * listed, started, named, and ended, and its sandbox resumed on the
   * developer's click; and a shell attached for one panel under a
   * connection id the desktop minted, typed into, resized, acked, woken
   * after a sleep, and detached. What a shell prints is heard as
   * `TERMINAL_OUTPUT` events, never answered.
   */
  TERMINALS_LIST: "terminals.list",
  TERMINALS_CREATE: "terminals.create",
  TERMINALS_RENAME: "terminals.rename",
  TERMINALS_KILL: "terminals.kill",
  TERMINALS_RESUME: "terminals.resume",
  TERMINALS_CONNECT: "terminals.connect",
  TERMINALS_INPUT: "terminals.input",
  TERMINALS_RESIZE: "terminals.resize",
  TERMINALS_ACK: "terminals.ack",
  TERMINALS_SHOWN: "terminals.shown",
  TERMINALS_DISCONNECT: "terminals.disconnect",
  TERMINALS_WAKE: "terminals.wake",
  /**
   * A cloud Browser tab's live view (`@repo/features/browser-live-wire`),
   * opened for one panel under a connection id the desktop minted, sent on,
   * and closed. The host only carries the socket's text frames each way;
   * what the service sends is heard as `BROWSER_LIVE_MESSAGE` events, and
   * its close as `BROWSER_LIVE_CLOSED`, never answered.
   */
  BROWSER_LIVE_CONNECT: "browserLive.connect",
  BROWSER_LIVE_SEND: "browserLive.send",
  BROWSER_LIVE_DISCONNECT: "browserLive.disconnect",
  /**
   * A cloud agent's mirror on this Mac (`@repo/host`'s `compose-mirrors.ts`),
   * made where none stands and kept in step from then on, answered with its
   * folder (`{ folder }`) once its worktree stands.
   */
  MIRRORS_ENSURE: "mirrors.ensure",
  /** Everything a window's bootstrap reads of the host, in one answer. */
  CLIENT_BOOTSTRAP: "client.bootstrap",
  SETTINGS_SNAPSHOT: "settings.snapshot",
  ACCOUNT_SNAPSHOT: "account.snapshot",
  ANALYTICS_RECORD: "analytics.record",
} as const;

export type GatewayMethod = (typeof GATEWAY_METHOD)[keyof typeof GATEWAY_METHOD];

/** Every way a call can be refused: the dispatcher's own two, and the codes a handler fails with. */
export const GATEWAY_ERROR = {
  UNKNOWN_METHOD: "unknown_method",
  INVALID_PARAMS: "invalid_params",
  NOT_FOUND: "not_found",
  REFUSED: "refused",
  NODE_UNAVAILABLE: "node_unavailable",
  UNKNOWN_CAPABILITY: "unknown_capability",
  INTERNAL: "internal",
} as const;

export type GatewayErrorCode = (typeof GATEWAY_ERROR)[keyof typeof GATEWAY_ERROR];

/** A refused call as the client reads it: the code, and a sentence for a person. */
export interface GatewayError {
  readonly code: GatewayErrorCode;
  readonly message: string;
}

/** One refusal's code, fixed by its class: the constructor takes the message alone. */
function refusalCode<Code extends GatewayErrorCode>(code: Code) {
  return Schema.Literal(code).pipe(Schema.withConstructorDefault(Effect.succeed(code)));
}

/**
 * Every error code as its own tagged error, so a handler that refuses has a
 * typed failure to fail with rather than a bare code. Each class's `code` is
 * the exact string `GATEWAY_ERROR` already names, and the dispatcher hands a
 * client the `{ code, message }` of whichever one a handler failed with.
 */
export class UnknownMethodRefusal extends Schema.TaggedError<UnknownMethodRefusal>()(
  "UnknownMethodRefusal",
  { code: refusalCode(GATEWAY_ERROR.UNKNOWN_METHOD), message: Schema.String },
) {}

export class InvalidParamsRefusal extends Schema.TaggedError<InvalidParamsRefusal>()(
  "InvalidParamsRefusal",
  { code: refusalCode(GATEWAY_ERROR.INVALID_PARAMS), message: Schema.String },
) {}

export class NotFoundRefusal extends Schema.TaggedError<NotFoundRefusal>()("NotFoundRefusal", {
  code: refusalCode(GATEWAY_ERROR.NOT_FOUND),
  message: Schema.String,
}) {}

export class RefusedRefusal extends Schema.TaggedError<RefusedRefusal>()("RefusedRefusal", {
  code: refusalCode(GATEWAY_ERROR.REFUSED),
  message: Schema.String,
}) {}

export class NodeUnavailableRefusal extends Schema.TaggedError<NodeUnavailableRefusal>()(
  "NodeUnavailableRefusal",
  { code: refusalCode(GATEWAY_ERROR.NODE_UNAVAILABLE), message: Schema.String },
) {}

export class UnknownCapabilityRefusal extends Schema.TaggedError<UnknownCapabilityRefusal>()(
  "UnknownCapabilityRefusal",
  { code: refusalCode(GATEWAY_ERROR.UNKNOWN_CAPABILITY), message: Schema.String },
) {}

export class InternalRefusal extends Schema.TaggedError<InternalRefusal>()("InternalRefusal", {
  code: refusalCode(GATEWAY_ERROR.INTERNAL),
  message: Schema.String,
}) {}

/** Every refusal a handler may fail with, one per error code. */
export type GatewayRefusal =
  | UnknownMethodRefusal
  | InvalidParamsRefusal
  | NotFoundRefusal
  | RefusedRefusal
  | NodeUnavailableRefusal
  | UnknownCapabilityRefusal
  | InternalRefusal;

export const GATEWAY_EVENT = {
  NODE_CHANGED: "node.changed",
  SETTINGS_CHANGED: "settings.changed",
  ACCOUNT_CHANGED: "account.changed",
  /** What the signed-in account may open in the app (whether it is an admin), whenever a read or the account moved it. */
  ACCOUNT_ACCESS_CHANGED: "accountAccess.changed",
  SESSION_REPLAY_CHANGED: "sessionReplay.changed",
  /** The panel's tasks and active task, whole, whenever a read moved them. */
  TASKS_CHANGED: "tasks.changed",
  /** What an attached shell printed, named by its connection, for the one panel that connection's port reaches. */
  TERMINAL_OUTPUT: "terminal.output",
  /** How an attached shell's connection stands, named by its connection. */
  TERMINAL_STATE: "terminal.state",
  /** One text frame a cloud Browser tab's live view sent, named by its connection, for the one panel that connection's port reaches. */
  BROWSER_LIVE_MESSAGE: "browserLive.message",
  /** A cloud Browser tab's live view closed, with its close code, named by its connection. */
  BROWSER_LIVE_CLOSED: "browserLive.closed",
  /** Every listed workspace's photo the host holds, whole, each time one is fetched or let go. */
  WORKSPACE_PHOTOS_CHANGED: "workspacePhotos.changed",
  /**
   * One live follow's slice (`@repo/host/contract`'s live follows), whole,
   * named by its read (`LIVE_READ`), as the host's reads of it stand, each
   * time any of them moves: `{ read, held }`.
   */
  LIVE_READ_CHANGED: "liveRead.changed",
  /** What waits across the followed account, whole or why there is none, each time it moves while it is followed. */
  ACCOUNT_INBOX_CHANGED: "accountInbox.changed",
  /** Every inbox item the account reaches, whole, as the host's read of them for the session stands, each time it moves. */
  INBOX_ITEMS_CHANGED: "inboxItems.changed",
  /** The account's preferences row, whole, as the host's read of it for the session stands with every write drawn over it, each time it moves. */
  ACCOUNT_PREFERENCES_CHANGED: "accountPreferences.changed",
  /** Which machine This Mac is and the device its host's record names, under the account signed in, whole, as the host reads it at its start and every few seconds after, each time it moves. */
  THIS_MAC_HOST_CHANGED: "thisMacHost.changed",
  /** The one agent whose cloud ports are forwarded to this Mac and how its forwarding stands, or none, each time it moves. */
  PORT_FORWARDS_CHANGED: "portForwards.changed",
  /** How each cloud agent's mirror on this Mac stands until its worktree does, by the agent, whole, each time one moves. */
  MIRRORS_CHANGED: "mirrors.changed",
  /** How many changes made offline the service refused as they were sent again, since the windows last cleared the count, each time it moves. */
  OFFLINE_REFUSED_CHANGED: "offlineRefused.changed",
  /** The commands agents asked to run on this Mac that wait on the developer's answer, whole, each time one is asked or answered. */
  MAC_COMMAND_ASKS_CHANGED: "macCommandAsks.changed",
} as const;

export type GatewayEventKind = (typeof GATEWAY_EVENT)[keyof typeof GATEWAY_EVENT];

/** Who is asking: the one operator client, or a node offering capabilities. */
export const GATEWAY_CLIENT_ROLE = {
  OPERATOR: "operator",
  NODE: "node",
} as const;

export type GatewayClientRole = (typeof GATEWAY_CLIENT_ROLE)[keyof typeof GATEWAY_CLIENT_ROLE];

export interface GatewayClientIdentity {
  clientId: string;
  role: GatewayClientRole;
}

/**
 * What a node capability's invocation answers. Unavailable is a typed answer,
 * never a thrown error and never a success: a required node that is not
 * connected leaves the action undone and says so, so nothing records it as done.
 * Unknown is the other typed answer an absent node can give, and it is not
 * unavailable: the ask reached the node and no answer came back, so the
 * effect may have happened. What reads an unknown must record the action as
 * uncertain, never as failed and never as safe to repeat.
 */
export const NODE_CAPABILITY_STATUS = {
  OK: "ok",
  /** Never dispatched: no connected node offered the capability. */
  UNAVAILABLE: "unavailable",
  /** The node performed and reported a failure. */
  FAILED: "failed",
  /** Dispatched, and the answer lost; the effect is uncertain. */
  UNKNOWN: "unknown",
} as const;

export type NodeCapabilityResult =
  | { readonly status: typeof NODE_CAPABILITY_STATUS.OK; readonly value: WireValue | undefined }
  | {
      readonly status:
        | typeof NODE_CAPABILITY_STATUS.UNAVAILABLE
        | typeof NODE_CAPABILITY_STATUS.FAILED
        | typeof NODE_CAPABILITY_STATUS.UNKNOWN;
      readonly capability: string;
      readonly reason: string;
    };
