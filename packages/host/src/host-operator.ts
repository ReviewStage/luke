import type { AccountSnapshot } from "@repo/credentials/snapshot";
import {
  type AgentAccountInboxAnswerView,
  agentAccountInboxAnswerViewSchema,
} from "@repo/features/agent-view";
import type { ProductEventName, ProductEventPropertiesFor } from "@repo/features/analytics";
import {
  type BrowserLiveClosedEvent,
  type BrowserLiveMessageEvent,
  browserLiveClosedEventSchema,
  browserLiveMessageEventSchema,
} from "@repo/features/browser-live-acts";
import type { LiveRead } from "@repo/features/live-wire";
import { type MirrorStandings, mirrorStandingsSchema } from "@repo/features/mirror-steps";
import { type PortForwarding, portForwardingSchema } from "@repo/features/port-forward-acts";
import {
  TASK_CALL_FAILURE,
  type TasksPageAnswer,
  type TasksPageParams,
  type TasksView,
  tasksPageAnswerSchema,
} from "@repo/features/tasks-view";
import {
  type TerminalCreatedActAnswer,
  type TerminalResumedActAnswer,
  type TerminalStateEvent,
  type TerminalsActAnswer,
  terminalCreatedActAnswerSchema,
  terminalOutputEventSchema,
  terminalResumedActAnswerSchema,
  terminalStateEventSchema,
  terminalsActAnswerSchema,
} from "@repo/features/terminal-view";
import {
  carried,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayCallResult,
  type GatewayClient,
  gatewayEventReader,
} from "@repo/gateway";
import type { AppSettings } from "@repo/settings/wire";
import {
  EXCESS_KEYS,
  isRecord,
  isWireBoolean,
  isWireNumber,
  isWireString,
  type UnparsedWireValue,
  type WireRecord,
} from "@repo/wire";
import { readEither } from "@repo/wire/effect";
import { Clock, Effect, type Schema as EffectSchema, Option, Result } from "effect";
import { Base64 } from "effect/encoding";
import type {
  AppAccessSlice,
  AppAccountPreferences,
  AppHostRead,
  AppInboxItems,
  AppThisMacHosts,
  AppWorkspacePhotos,
  SessionReplayState,
} from "./app-state.js";
import { type MacCommandAsk, macCommandAsksSchema } from "./mac-command-ask.js";

/** Everything a window's bootstrap reads of the host, in one answer. */
export interface HostBootstrap {
  settings: AppSettings;
  account: AccountSnapshot;
  sessionReplay: SessionReplayState;
  /** What the signed-in account may open in the app, as the host last read it. */
  access: AppAccessSlice;
}

interface HostSettingsChange {
  settings: AppSettings;
  /** The opaque reporter whose write produced the change, so the relay can skip echoing it. */
  reporter?: string;
}

/**
 * The client's door to the host over the Gateway for what is not a declared
 * act, which the act port answers from the composers directly
 * (`act-port/declared-acts.ts`): the events the host pushes, each read by
 * its `on*Changed` reader; the snapshots a window boots from; main's own
 * follow of what waits across the account; and the calls the rest of the
 * client makes of its own accord. Those callers are the client's state and
 * notices (`client/operator-client.ts`, `client/client-notices.ts`), the
 * desktop's window service and network watch, the web tab's host
 * (`web-host.ts`), the desktop's mirror ensure (`register-desktop-ipc.ts`),
 * and the terminal and browser-live procedures, whose platform work is
 * their own.
 *
 * Every method answers an effect: it composes one request and reads its
 * answer, and nothing here runs it; whoever asked yields it. The host is
 * this same process, so an answer that is not the shape the method
 * documents is a defect of the build rather than a reachable host state.
 * Nothing here holds host state.
 */
export interface HostOperator {
  bootstrap(): Effect.Effect<Option.Option<HostBootstrap>>;
  settingsSnapshot(): Effect.Effect<Option.Option<AppSettings>>;
  /** Which machine This Mac is and the device its host's record names, held by the host for the session, whole, each time it moves; never on a platform with no This Mac. */
  onThisMacHostChanged(listener: (held: AppThisMacHosts) => void): () => void;
  accountSnapshot(): Effect.Effect<Option.Option<AccountSnapshot>>;
  recordEvent<Name extends ProductEventName>(
    name: Name,
    properties: ProductEventPropertiesFor<Name>,
  ): Effect.Effect<void>;
  /** The Mac woke or unlocked: the host follows the task list again from a fresh seal. */
  tasksResync(): Effect.Effect<void>;
  /** The app reaches the service again: the host asks every read a window holds again, and follows the task list again from a fresh seal. */
  tasksRegained(): Effect.Effect<void>;
  /** The account's workspaces read again, where the host's last read is a minute old. */
  workspacesRefresh(): Effect.Effect<void>;
  /** One version of one page of a task with its HTML, for the frame that draws it; or that the service did not answer. */
  tasksPage(params: TasksPageParams): Effect.Effect<TasksPageAnswer>;
  /** Every listed workspace's photo the host holds, whole, each time one is fetched or let go. */
  onWorkspacePhotosChanged(listener: (held: AppWorkspacePhotos) => void): () => void;
  /** One live follow's slice the host holds for the windows, whole, named by its read, each time any of its keys moves (`contract/live-follow.ts`). */
  onLiveReadChanged(listener: (changed: LiveReadChanged) => void): () => void;
  /** What waits on the developer across the account, followed from now until let go or signed out, heard through `onAccountInboxChanged`; following again starts over. */
  agentAccountInboxFollow(): Effect.Effect<void>;
  /** The account inbox let go: nothing more is heard of it until it is followed again. */
  agentAccountInboxUnfollow(): Effect.Effect<void>;
  /** What waits across the followed account, or why there is none, each time it moves. */
  onAccountInboxChanged(listener: (answer: AgentAccountInboxAnswerView) => void): () => void;
  /** Every inbox item the account reaches, whole, each time the host's read of them for the session moves. */
  onInboxItemsChanged(listener: (read: AppHostRead<AppInboxItems>) => void): () => void;
  /** The account's preferences row, whole, each time the host's read of it for the session moves or a write is drawn over it. */
  onAccountPreferencesChanged(listener: (held: AppAccountPreferences) => void): () => void;
  onSettingsChanged(listener: (change: HostSettingsChange) => void): () => void;
  onAccountChanged(listener: (account: AccountSnapshot) => void): () => void;
  onAccountAccessChanged(listener: (access: AppAccessSlice) => void): () => void;
  onSessionReplayChanged(listener: (replay: SessionReplayState) => void): () => void;
  onTasksChanged(listener: (view: TasksView) => void): () => void;
  /** The commands agents asked to run on this Mac that wait on the developer, whole, each time one is asked or answered. */
  onMacCommandAsksChanged(listener: (asks: readonly MacCommandAsk[]) => void): () => void;
  /** How many changes made offline the service refused as they were sent again, each time the count moves. */
  onOfflineRefusedChanged(listener: (count: number) => void): () => void;
  /** An agent's shells and where its sandbox stands, or why not; none where the host could not answer. */
  terminalList(params: { agentId: string }): Effect.Effect<TerminalsActAnswer | undefined>;
  terminalCreate(params: {
    agentId: string;
    title?: string | undefined;
  }): Effect.Effect<TerminalCreatedActAnswer | undefined>;
  terminalRename(params: {
    agentId: string;
    terminalId: string;
    title: string;
  }): Effect.Effect<TerminalsActAnswer | undefined>;
  terminalKill(params: {
    agentId: string;
    terminalId: string;
  }): Effect.Effect<TerminalsActAnswer | undefined>;
  terminalResume(params: { agentId: string }): Effect.Effect<TerminalResumedActAnswer | undefined>;
  /** One shell attached under the connection id given; whether the host took the attach. */
  terminalConnect(params: {
    connectionId: string;
    agentId: string;
    terminalId: string;
    cols: number;
    rows: number;
  }): Effect.Effect<boolean>;
  terminalInput(params: { connectionId: string; data: string }): Effect.Effect<void>;
  terminalResize(params: { connectionId: string; cols: number; rows: number }): Effect.Effect<void>;
  terminalAck(params: { connectionId: string; bytes: number }): Effect.Effect<void>;
  /** The connection's tab is shown in the window the developer is using, which moves its idle bound on. */
  terminalShown(params: { connectionId: string }): Effect.Effect<void>;
  terminalDisconnect(params: { connectionId: string }): Effect.Effect<void>;
  /** Every waiting connection opened again now, as after the Mac woke. */
  terminalWake(): Effect.Effect<void>;
  /** What an attached shell printed, by its connection. */
  onTerminalOutput(
    listener: (output: { connectionId: string; data: Uint8Array }) => void,
  ): () => void;
  /** How an attached shell's connection stands, by its connection. */
  onTerminalState(listener: (state: TerminalStateEvent) => void): () => void;
  /** A cloud agent's mirror on this Mac made where none stands, answered with its folder; none where the host could not. */
  mirrorEnsure(params: { agentId: string }): Effect.Effect<string | undefined>;
  /** One cloud Browser tab's live view opened under the connection id given; whether the host took it. */
  browserLiveConnect(params: {
    connectionId: string;
    agentId: string;
    tabId: string;
  }): Effect.Effect<boolean>;
  /** One text frame for the service on a live view's connection. */
  browserLiveSend(params: { connectionId: string; text: string }): Effect.Effect<void>;
  /** A live view's connection let go, its socket closed. */
  browserLiveDisconnect(params: { connectionId: string }): Effect.Effect<void>;
  /** One text frame the service sent on a live view, by its connection. */
  onBrowserLiveMessage(listener: (message: BrowserLiveMessageEvent) => void): () => void;
  /** A live view's socket closed, with its code, by its connection. */
  onBrowserLiveClosed(listener: (closed: BrowserLiveClosedEvent) => void): () => void;
  /** The one agent forwarded to this Mac's localhost and how its forwarding stands, or none, each time it moves. */
  onPortForwardingChanged(listener: (forwarding: PortForwarding) => void): () => void;
  /** How each cloud agent's mirror on this Mac stands until its worktree does, by the agent, each time one moves. */
  onMirrorsChanged(listener: (mirrors: MirrorStandings) => void): () => void;
}

/**
 * The host's answer to a call, read by its schema; `unanswered` where the
 * host refused it or answered a shape its method does not document.
 */
function answerOf<Answer, Encoded, Unanswered>(
  schema: EffectSchema.Codec<Answer, Encoded>,
  unanswered: Unanswered,
) {
  return (answer: GatewayCallResult): Answer | Unanswered =>
    (answer.ok
      ? Result.getOrUndefined(readEither(schema, { excess: EXCESS_KEYS.DROP })(answer.result))
      : undefined) ?? unanswered;
}

interface HostOperatorOptions {
  client: GatewayClient;
  report: (message: string) => void;
}

/**
 * The host's answers are the same structured-clone payloads the windows
 * already receive over the bridge, carried through the protocol as JSON. The
 * readers below check the field the client itself decides on and hand the
 * rest on to the act, whose own answer guard is checked in the router and
 * again in the window that asked.
 */
function record(result: GatewayCallResult): WireRecord | undefined {
  return result.ok && isRecord(result.result) ? result.result : undefined;
}

/** One answered value of the host's, as the domain type its method documents. */
function answered<Value>(value: UnparsedWireValue): Value | undefined {
  // SAFETY: the host is our own authenticated process answering the shape the method documents; the act's own answer guard re-checks it before a renderer sees it.
  return value === undefined ? undefined : (value as unknown as Value);
}

/** One live follow's slice as the host tells it: its read's name, and the slice whole. */
export interface LiveReadChanged {
  readonly read: LiveRead;
  readonly held: unknown;
}

/** A task call that reached no answer, as every task method answers one. */
const TASK_UNANSWERED = { failure: TASK_CALL_FAILURE.UNANSWERED } as const;

export function createHostOperator(options: HostOperatorOptions): HostOperator {
  const { client } = options;

  const fire = (result: Effect.Effect<GatewayCallResult>): Effect.Effect<void> =>
    Effect.asVoid(result);

  const on = gatewayEventReader(client);

  return {
    bootstrap: () =>
      Effect.map(client.call(GATEWAY_METHOD.CLIENT_BOOTSTRAP), (answer) =>
        Option.fromUndefinedOr(answered<HostBootstrap>(record(answer))),
      ),
    onThisMacHostChanged: (listener) =>
      on(
        GATEWAY_EVENT.THIS_MAC_HOST_CHANGED,
        // Note that This Mac is the host's own, handed over in this process, so it is passed on as built, as the held beats are.
        (payload) => (isRecord(payload) ? answered<AppThisMacHosts>(payload) : undefined),
        listener,
      ),
    settingsSnapshot: () =>
      Effect.map(client.call(GATEWAY_METHOD.SETTINGS_SNAPSHOT), (answer) =>
        Option.fromUndefinedOr(answered<AppSettings>(record(answer)?.settings)),
      ),
    accountSnapshot: () =>
      Effect.map(client.call(GATEWAY_METHOD.ACCOUNT_SNAPSHOT), (answer) =>
        Option.fromUndefinedOr(answered<AccountSnapshot>(record(answer)?.account)),
      ),
    recordEvent: (name, properties) =>
      Effect.flatMap(Clock.currentTimeMillis, (at) =>
        fire(
          client.call(GATEWAY_METHOD.ANALYTICS_RECORD, {
            // The host reads the event against the allowlist again before it is queued.
            event: { name, at, properties: carried(properties) },
          }),
        ),
      ),
    tasksResync: () => fire(client.call(GATEWAY_METHOD.TASKS_RESYNC)),
    tasksRegained: () => fire(client.call(GATEWAY_METHOD.TASKS_REGAINED)),
    workspacesRefresh: () => fire(client.call(GATEWAY_METHOD.WORKSPACES_REFRESH)),
    tasksPage: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TASKS_PAGE, {
          ...("taskId" in params ? { taskId: params.taskId } : { agentId: params.agentId }),
          pageId: params.pageId,
          version: params.version,
        }),
        answerOf(tasksPageAnswerSchema, TASK_UNANSWERED),
      ),
    onWorkspacePhotosChanged: (listener) =>
      on(
        GATEWAY_EVENT.WORKSPACE_PHOTOS_CHANGED,
        // Note that the held photos are the host's own, handed over in this process, so they are passed on as built, as the held people are.
        (payload) => (isRecord(payload) ? answered<AppWorkspacePhotos>(payload) : undefined),
        listener,
      ),
    onLiveReadChanged: (listener) =>
      on(
        GATEWAY_EVENT.LIVE_READ_CHANGED,
        // Note that the held slice is the host's own, handed over in this process, so it is passed on as built, as the held models are.
        (payload) =>
          isRecord(payload) && isWireString(payload.read)
            ? answered<LiveReadChanged>(payload)
            : undefined,
        listener,
      ),
    agentAccountInboxFollow: () =>
      fire(client.call(GATEWAY_METHOD.AGENTS_ACCOUNT_INBOX_FOLLOW, {})),
    agentAccountInboxUnfollow: () =>
      fire(client.call(GATEWAY_METHOD.AGENTS_ACCOUNT_INBOX_UNFOLLOW, {})),
    onAccountInboxChanged: (listener) =>
      on(
        GATEWAY_EVENT.ACCOUNT_INBOX_CHANGED,
        (payload) =>
          Result.getOrUndefined(
            readEither(agentAccountInboxAnswerViewSchema, { excess: EXCESS_KEYS.DROP })(payload),
          ),
        listener,
      ),
    onAccountPreferencesChanged: (listener) =>
      on(
        GATEWAY_EVENT.ACCOUNT_PREFERENCES_CHANGED,
        // Note that the read is the host's own, handed over in this process, so it is passed on as built, as the inbox items are.
        (payload) => (isRecord(payload) ? answered<AppAccountPreferences>(payload) : undefined),
        listener,
      ),
    onInboxItemsChanged: (listener) =>
      on(
        GATEWAY_EVENT.INBOX_ITEMS_CHANGED,
        // Note that the read is the host's own, handed over in this process, so it is passed on as built, as the tasks are.
        (payload) =>
          isRecord(payload) ? answered<AppHostRead<AppInboxItems>>(payload) : undefined,
        listener,
      ),
    onSettingsChanged: (listener) =>
      on(
        GATEWAY_EVENT.SETTINGS_CHANGED,
        (payload): HostSettingsChange | undefined => {
          if (!isRecord(payload) || !isRecord(payload.settings)) return undefined;
          const settings = answered<AppSettings>(payload.settings);
          if (!settings) return undefined;
          return {
            settings,
            ...(isWireString(payload.reporter) ? { reporter: payload.reporter } : undefined),
          };
        },
        listener,
      ),
    onAccountChanged: (listener) =>
      on(
        GATEWAY_EVENT.ACCOUNT_CHANGED,
        (payload) => (isRecord(payload) ? answered<AccountSnapshot>(payload) : undefined),
        listener,
      ),
    onAccountAccessChanged: (listener) =>
      on(
        GATEWAY_EVENT.ACCOUNT_ACCESS_CHANGED,
        (payload): AppAccessSlice | undefined =>
          isRecord(payload) && isWireBoolean(payload.admin)
            ? {
                admin: payload.admin,
                ...(payload.pending === true ? { pending: true } : undefined),
                ...(isWireNumber(payload.supportAccessUntil)
                  ? { supportAccessUntil: payload.supportAccessUntil }
                  : undefined),
              }
            : undefined,
        listener,
      ),
    onOfflineRefusedChanged: (listener) =>
      on(
        GATEWAY_EVENT.OFFLINE_REFUSED_CHANGED,
        (payload) => (isRecord(payload) && isWireNumber(payload.count) ? payload.count : undefined),
        listener,
      ),
    onTasksChanged: (listener) =>
      on(
        GATEWAY_EVENT.TASKS_CHANGED,
        // Note that the view is the host's own, handed over in this process
        // (`gatewayHost`), so it is passed on as built: a decode here would
        // only rebuild the same tree new, and every comparison after it walk it.
        (payload) => (isRecord(payload) ? answered<TasksView>(payload) : undefined),
        listener,
      ),
    onMacCommandAsksChanged: (listener) =>
      on(
        GATEWAY_EVENT.MAC_COMMAND_ASKS_CHANGED,
        (payload) =>
          Result.getOrUndefined(
            readEither(macCommandAsksSchema, { excess: EXCESS_KEYS.DROP })(payload),
          )?.asks,
        listener,
      ),
    terminalList: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TERMINALS_LIST, { agentId: params.agentId }),
        answerOf(terminalsActAnswerSchema, undefined),
      ),
    terminalCreate: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TERMINALS_CREATE, {
          agentId: params.agentId,
          ...(params.title === undefined ? undefined : { title: params.title }),
        }),
        answerOf(terminalCreatedActAnswerSchema, undefined),
      ),
    terminalRename: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TERMINALS_RENAME, {
          agentId: params.agentId,
          terminalId: params.terminalId,
          title: params.title,
        }),
        answerOf(terminalsActAnswerSchema, undefined),
      ),
    terminalKill: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TERMINALS_KILL, {
          agentId: params.agentId,
          terminalId: params.terminalId,
        }),
        answerOf(terminalsActAnswerSchema, undefined),
      ),
    terminalResume: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TERMINALS_RESUME, { agentId: params.agentId }),
        answerOf(terminalResumedActAnswerSchema, undefined),
      ),
    terminalConnect: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.TERMINALS_CONNECT, {
          connectionId: params.connectionId,
          agentId: params.agentId,
          terminalId: params.terminalId,
          cols: params.cols,
          rows: params.rows,
        }),
        (answer) => answer.ok,
      ),
    terminalInput: (params) =>
      fire(
        client.call(GATEWAY_METHOD.TERMINALS_INPUT, {
          connectionId: params.connectionId,
          data: params.data,
        }),
      ),
    terminalResize: (params) =>
      fire(
        client.call(GATEWAY_METHOD.TERMINALS_RESIZE, {
          connectionId: params.connectionId,
          cols: params.cols,
          rows: params.rows,
        }),
      ),
    terminalAck: (params) =>
      fire(
        client.call(GATEWAY_METHOD.TERMINALS_ACK, {
          connectionId: params.connectionId,
          bytes: params.bytes,
        }),
      ),
    terminalShown: (params) =>
      fire(client.call(GATEWAY_METHOD.TERMINALS_SHOWN, { connectionId: params.connectionId })),
    terminalDisconnect: (params) =>
      fire(client.call(GATEWAY_METHOD.TERMINALS_DISCONNECT, { connectionId: params.connectionId })),
    terminalWake: () => fire(client.call(GATEWAY_METHOD.TERMINALS_WAKE)),
    onTerminalOutput: (listener) =>
      on(
        GATEWAY_EVENT.TERMINAL_OUTPUT,
        (payload) => {
          const output = Result.getOrUndefined(readEither(terminalOutputEventSchema)(payload));
          if (output === undefined) return undefined;
          const bytes = Base64.decode(output.data);
          return Result.isSuccess(bytes)
            ? { connectionId: output.connectionId, data: bytes.success }
            : undefined;
        },
        listener,
      ),
    onTerminalState: (listener) =>
      on(
        GATEWAY_EVENT.TERMINAL_STATE,
        (payload) => Result.getOrUndefined(readEither(terminalStateEventSchema)(payload)),
        listener,
      ),
    mirrorEnsure: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.MIRRORS_ENSURE, { agentId: params.agentId }),
        (answer) => {
          const folder = record(answer)?.folder;
          return typeof folder === "string" ? folder : undefined;
        },
      ),
    browserLiveConnect: (params) =>
      Effect.map(
        client.call(GATEWAY_METHOD.BROWSER_LIVE_CONNECT, {
          connectionId: params.connectionId,
          agentId: params.agentId,
          tabId: params.tabId,
        }),
        (answer) => answer.ok,
      ),
    browserLiveSend: (params) =>
      fire(
        client.call(GATEWAY_METHOD.BROWSER_LIVE_SEND, {
          connectionId: params.connectionId,
          text: params.text,
        }),
      ),
    browserLiveDisconnect: (params) =>
      fire(
        client.call(GATEWAY_METHOD.BROWSER_LIVE_DISCONNECT, { connectionId: params.connectionId }),
      ),
    onBrowserLiveMessage: (listener) =>
      on(
        GATEWAY_EVENT.BROWSER_LIVE_MESSAGE,
        (payload) => Result.getOrUndefined(readEither(browserLiveMessageEventSchema)(payload)),
        listener,
      ),
    onBrowserLiveClosed: (listener) =>
      on(
        GATEWAY_EVENT.BROWSER_LIVE_CLOSED,
        (payload) => Result.getOrUndefined(readEither(browserLiveClosedEventSchema)(payload)),
        listener,
      ),
    onPortForwardingChanged: (listener) =>
      on(
        GATEWAY_EVENT.PORT_FORWARDS_CHANGED,
        (payload) => {
          const read = readEither(portForwardingSchema)(payload);
          return Result.isSuccess(read) ? { forwarding: read.success } : undefined;
        },
        ({ forwarding }) => listener(forwarding),
      ),
    onMirrorsChanged: (listener) =>
      on(
        GATEWAY_EVENT.MIRRORS_CHANGED,
        (payload) => {
          const read = readEither(mirrorStandingsSchema)(payload);
          return Result.isSuccess(read) ? { mirrors: read.success } : undefined;
        },
        ({ mirrors }) => listener(mirrors),
      ),
    onSessionReplayChanged: (listener) =>
      on(
        GATEWAY_EVENT.SESSION_REPLAY_CHANGED,
        (payload): SessionReplayState | undefined =>
          isRecord(payload) && isWireBoolean(payload.permitted)
            ? {
                permitted: payload.permitted,
                ...(isWireString(payload.accountId) ? { accountId: payload.accountId } : undefined),
                ...(isWireString(payload.name) ? { name: payload.name } : undefined),
                ...(isWireString(payload.email) ? { email: payload.email } : undefined),
              }
            : undefined,
        listener,
      ),
  };
}
