import type { BrainAgent } from "@sidecar/brain";
import { BRAIN_DEFAULTS } from "@sidecar/brain";
import {
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_SUBMISSION_REJECTION,
  type BrainSubmissionResult,
  brainRequestRecordToWire,
  isBrainRequestOrigin,
} from "@sidecar/brain/requests";
import type { BrainRequestSnapshot } from "@sidecar/brain/requests-wire";
import {
  GATEWAY_ERROR,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodContext,
  type GatewayMethodHandler,
  type GatewayMethodOutcome,
  type GatewayMethodTable,
  gatewayError,
  gatewayOk,
  invalid,
  NODE_CAPABILITY_STATUS,
  NodeRegistry,
  nodeSnapshotToWire,
} from "@sidecar/gateway";
import { GatewayServer, type GatewayServerOptions } from "@sidecar/gateway/server";
import type { ChildRunService, ResolvedConfiguration } from "@sidecar/runtime";
import {
  type ChildRunRecord,
  conversationRecordToWire,
  isIdentifier,
  MAIN_SESSION_KEY,
  type MaybePromise,
  type SessionKey,
  sessionKey as toSessionKey,
} from "@sidecar/runtime/vocabulary";
import {
  type ConversationEntry,
  conversationEntryToWire,
  maximumAskLength,
} from "@sidecar/session";
import { isRecord, isWireNumber, isWireString, type WireRecord } from "@sidecar/wire";
import type { SettableConfigurationPatch } from "./brain/wiring.js";
import type { ConversationOperations } from "./conversation-operations.js";

/** The two parameters a Gateway method refuses by name; protocol diagnostics, never words a person reads. */
const REFUSAL = {
  NO_RUN: "no run has that id",
  NOT_LISTED: "the directory does not list that conversation",
} as const;

/**
 * The host side of the Gateway: every capability the protocol
 * names, answered over the wirings that already own it. The service composes
 * nothing new about the brain, the store, or the notebook; it is the one
 * boundary a client crosses to reach them, and the one place their changes
 * become numbered events. Today the client is the same process over the
 * in-process transport; the seams are drawn so the process split that
 * follows moves the transport and nothing here.
 */
interface GatewayBrainAccess {
  /** The brain of one conversation as it stands now; nothing between transitions or for an unopened key. */
  current: (sessionKey?: SessionKey) => BrainAgent | undefined;
  agentForRun: (runId: string) => BrainAgent | undefined;
  allRequests: () => readonly BrainRequestSnapshot[];
  /** The generation standing for a conversation, or nothing while none does. */
  generationId: (sessionKey: SessionKey) => string | undefined;
  children: Pick<ChildRunService, "children" | "child" | "childrenOf">;
  configuration: () => ResolvedConfiguration;
  /** Republishes the configuration with the settable fields patched; answers the refusals, none on success. */
  updateConfiguration: (patch: SettableConfigurationPatch) => readonly string[];
}

interface GatewayMemoryAccess {
  status: () => WireRecord;
}

export interface GatewayServiceDependencies {
  brain: GatewayBrainAccess;
  conversations: ConversationOperations;
  memory: GatewayMemoryAccess;
  /** How many sessions the roster holds now; the observation event's whole payload. */
  observedSessionCount: () => number;
  nodes?: NodeRegistry;
  askWaitMs?: number;
  now: () => number;
  createId: () => string;
  /**
   * The host's further methods, beside the ones this service answers itself:
   * the settings, account, integration, and client-fact vocabulary the
   * runtime host owns. A method both name is the host's.
   */
  methods?: GatewayMethodTable;
}

export interface GatewayService {
  readonly server: GatewayServer;
  /**
   * What its own server was built over, so a transport that composes a server
   * of its own — the socket binding, which provides the `Protocol` a server is
   * built on rather than attaching to one already built — answers the same
   * methods over the same readers.
   *
   * @deprecated A strangler shim beside `GatewayServer`'s: P7-02 composed the
   * host as a `Layer` and left both standing. `packages/gateway`'s
   * `ServerBoundTransport` (`transport.ts`) and `TextLoopbackTransport`
   * (`testing.ts`) still construct over `GatewayServer` directly — moving
   * their callers onto the layers changed the request's own microtask timing
   * enough to break their reconnection-race tests (the reason P6-04 left them
   * standing) — and the desktop's `InProcessTransport` construction in
   * `apps/desktop/src/main/services/operator-client.ts` goes through the same
   * `transport.ts`, so both fields go together once a later PR resolves that
   * and hands every transport the layers directly.
   */
  readonly serverOptions: GatewayServerOptions;
  readonly nodes: NodeRegistry;
  /** The brain's whole list of records, as the followers report it, for every client to hear. */
  runsReported: (snapshots: readonly BrainRequestSnapshot[]) => void;
  /** One conversation's thread as every window should draw it, less the opaque reporter whose report produced it. */
  conversationChanged: (
    sessionKey: SessionKey,
    entries: readonly ConversationEntry[],
    reporter?: string,
  ) => void;
  directoryChanged: () => void;
  observationChanged: () => void;
  configurationChanged: () => void;
  childChanged: (childId: string) => void;
}

/** A parameter that is not the shape its method takes; the reading handler answers it as an invalid-params refusal. */
class ParamRefusal extends Error {}

/**
 * Reads one request's parameters by name. A required read answers the value
 * or refuses; an optional read answers nothing for an absent parameter and
 * refuses one present in the wrong shape. Every refusal is worded the same
 * way, so a handler says what it needs and nothing else.
 */
class ParamReader {
  readonly #params: WireRecord;

  constructor(params: WireRecord) {
    this.#params = params;
  }

  identifier(name: string): string {
    const value = this.#params[name];
    if (isIdentifier(value)) return value;
    throw new ParamRefusal(`${name} must be a non-empty string`);
  }

  sessionKey(name: string): SessionKey {
    return toSessionKey(this.identifier(name));
  }

  optionalSessionKey(name: string): SessionKey | undefined {
    return this.#params[name] === undefined ? undefined : this.sessionKey(name);
  }

  /** The conversation a request names, or main when it names none: the one every window's ask is for. */
  sessionKeyOrMain(name: string): SessionKey {
    return this.optionalSessionKey(name) ?? MAIN_SESSION_KEY;
  }

  string(name: string): string {
    const value = this.#params[name];
    if (isWireString(value)) return value;
    throw new ParamRefusal(`${name} must be a string`);
  }

  optionalString(name: string): string | undefined {
    return this.#params[name] === undefined ? undefined : this.string(name);
  }

  number(name: string): number {
    const value = this.#params[name];
    if (isWireNumber(value)) return value;
    throw new ParamRefusal(`${name} must be a number`);
  }

  optionalNumber(name: string): number | undefined {
    return this.#params[name] === undefined ? undefined : this.number(name);
  }

  stringList(name: string): readonly string[] {
    const value = this.#params[name];
    if (Array.isArray(value) && value.every(isWireString)) return value;
    throw new ParamRefusal(`${name} must be a list of strings`);
  }

  optionalRecord(name: string): WireRecord | undefined {
    const value = this.#params[name];
    if (value === undefined || isRecord(value)) return value;
    throw new ParamRefusal(`${name} must be a record`);
  }
}

/** A handler that reads its parameters through the reader, answering a read's refusal as the method's. */
function reading(
  handle: (read: ParamReader, context: GatewayMethodContext) => MaybePromise<GatewayMethodOutcome>,
): GatewayMethodHandler {
  return async (params, context) => {
    try {
      return await handle(new ParamReader(params), context);
    } catch (error) {
      if (error instanceof ParamRefusal) return invalid(error.message);
      throw error;
    }
  };
}

/**
 * The bounded projection of a child the protocol carries: its task and its
 * result text stay with the store, so a client sees that a result exists and
 * never the words. Not a serialization `childRunRecordFromWire` reads back.
 */
function childRecordToWire(record: ChildRunRecord): WireRecord {
  return {
    childId: record.childId,
    agentId: record.agentId,
    requesterSessionKey: record.requesterSessionKey,
    ...(record.requesterRunId !== undefined
      ? { requesterRunId: record.requesterRunId }
      : undefined),
    childSessionKey: record.childSessionKey,
    childRunId: record.childRunId,
    ...(record.label !== undefined ? { label: record.label } : undefined),
    depth: record.depth,
    ...(record.model !== undefined ? { model: record.model } : undefined),
    requestedContext: record.requestedContext,
    context: record.context,
    ...(record.contextNote !== undefined ? { contextNote: record.contextNote } : undefined),
    policy: { allowed: [...record.policy.allowed], denied: [...record.policy.denied] },
    timeoutMs: record.timeoutMs,
    cleanup: record.cleanup,
    completionDestination: record.completionDestination,
    expectsCompletion: record.expectsCompletion,
    status: record.status,
    acceptedAt: record.acceptedAt,
    ...(record.startedAt !== undefined ? { startedAt: record.startedAt } : undefined),
    ...(record.settledAt !== undefined ? { settledAt: record.settledAt } : undefined),
    ...(record.failureDetail !== undefined ? { failureDetail: record.failureDetail } : undefined),
    ...(record.performedActions !== undefined
      ? { performedActions: record.performedActions }
      : undefined),
    ...(record.unknownActions !== undefined
      ? { unknownActions: record.unknownActions }
      : undefined),
    ...(record.archivedAt !== undefined ? { archivedAt: record.archivedAt } : undefined),
    hasResult: record.resultText !== undefined,
  };
}

function configurationToWire(snapshot: ResolvedConfiguration): WireRecord {
  const { configuration } = snapshot;
  return {
    revision: snapshot.revision,
    agentId: configuration.agentId,
    agentRuntimeId: configuration.agentRuntimeId,
    modelAdapterId: configuration.modelAdapterId,
    contextEngineId: configuration.contextEngineId,
    ...(configuration.memoryProviderId !== undefined
      ? { memoryProviderId: configuration.memoryProviderId }
      : undefined),
    credential: { ...configuration.credential },
    workspaceDirectory: configuration.workspaceDirectory,
    skillRoots: [...configuration.skillRoots],
    ...(configuration.reasoningEffort !== undefined
      ? { reasoningEffort: configuration.reasoningEffort }
      : undefined),
    ...(configuration.maximumOutputTokens !== undefined
      ? { maximumOutputTokens: configuration.maximumOutputTokens }
      : undefined),
  };
}

function submissionResultToWire(result: BrainSubmissionResult): WireRecord {
  return result.outcome === BRAIN_SUBMISSION_OUTCOME.ACCEPTED
    ? { outcome: result.outcome, runId: result.runId, acceptedAt: result.acceptedAt }
    : { outcome: result.outcome, reason: result.reason };
}

export function createGatewayService(dependencies: GatewayServiceDependencies): GatewayService {
  const { brain, conversations } = dependencies;
  const nodes = dependencies.nodes ?? new NodeRegistry();
  const askWaitMs = dependencies.askWaitMs ?? BRAIN_DEFAULTS.ASK_WAIT_MS;

  const snapshot = (): WireRecord => ({
    runs: brain.allRequests().map(brainRequestRecordToWire),
    conversations: conversations.directory().map(conversationRecordToWire),
    configurationRevision: brain.configuration().revision,
    nodes: nodes.list().map(nodeSnapshotToWire),
  });

  const submit = async (read: ParamReader): Promise<GatewayMethodOutcome> => {
    const sessionKey = read.sessionKeyOrMain("sessionKey");
    const submissionId = read.identifier("submissionId");
    const question = read.string("question").trim().slice(0, maximumAskLength);
    const origin = read.string("origin");
    if (!isBrainRequestOrigin(origin)) return invalid("origin is not one this build knows");
    const agent = brain.current(sessionKey);
    if (!agent) {
      return gatewayOk(
        submissionResultToWire({
          outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
          reason: BRAIN_SUBMISSION_REJECTION.ABSENT,
        }),
      );
    }
    const result = await agent.submitAsk({ submissionId, origin, question });
    return gatewayOk(submissionResultToWire(result));
  };

  /** Which connection a remote node was last registered on, so only that connection's closing disconnects it. */
  const nodeOwners = new Map<string, string>();

  const methods: GatewayMethodTable = {
    ...dependencies.methods,
    [GATEWAY_METHOD.CONVERSATION_LINES]: reading((read) => {
      const sessionKey = read.sessionKeyOrMain("sessionKey");
      if (!conversations.holds(sessionKey)) {
        return gatewayError(GATEWAY_ERROR.NOT_FOUND, REFUSAL.NOT_LISTED);
      }
      return gatewayOk({ entries: conversations.lines(sessionKey).map(conversationEntryToWire) });
    }),
    [GATEWAY_METHOD.CONVERSATION_DELETE]: reading(async (read) =>
      gatewayOk({
        outcome: await conversations.deleteConversation(read.sessionKeyOrMain("sessionKey")),
      }),
    ),
    [GATEWAY_METHOD.RUN_SUBMIT]: reading((read) => submit(read)),
    [GATEWAY_METHOD.RUN_CANCEL]: reading(async (read) => {
      const runId = read.identifier("runId");
      const agent = brain.agentForRun(runId);
      if (!agent) return gatewayError(GATEWAY_ERROR.NOT_FOUND, REFUSAL.NO_RUN);
      const cancelled = await agent.cancelAsk(runId);
      return gatewayOk(cancelled ? { record: brainRequestRecordToWire(cancelled) } : {});
    }),
    // A wait answers the record and never the words: the live session speaks
    // a reply from the run's own events, so no caller is granted them here.
    [GATEWAY_METHOD.RUN_WAIT]: reading(async (read) => {
      const runId = read.identifier("runId");
      const waited = await brain.agentForRun(runId)?.waitAsk(runId, askWaitMs);
      return gatewayOk({
        ...(waited ? { record: brainRequestRecordToWire(waited) } : undefined),
        speak: false,
      });
    }),
    [GATEWAY_METHOD.RUN_LIST]: () =>
      gatewayOk({ runs: brain.allRequests().map(brainRequestRecordToWire) }),
    [GATEWAY_METHOD.CHILD_LIST]: reading((read) => {
      const requester = read.optionalSessionKey("sessionKey");
      const records = requester ? brain.children.childrenOf(requester) : brain.children.children();
      return gatewayOk({ children: records.map(childRecordToWire) });
    }),
    [GATEWAY_METHOD.MEMORY_STATUS]: () => gatewayOk(dependencies.memory.status()),
    [GATEWAY_METHOD.CONFIGURATION_UPDATE]: reading((read) => {
      const reasoningEffort = read.optionalString("reasoningEffort");
      const maximumOutputTokens = read.optionalNumber("maximumOutputTokens");
      const patch: SettableConfigurationPatch = {
        ...(reasoningEffort !== undefined ? { reasoningEffort } : undefined),
        ...(maximumOutputTokens !== undefined ? { maximumOutputTokens } : undefined),
      };
      const refusals = brain.updateConfiguration(patch);
      if (refusals.length > 0) {
        return gatewayError(GATEWAY_ERROR.REFUSED, refusals.join(", "));
      }
      return gatewayOk(configurationToWire(brain.configuration()));
    }),
    // A registration names the capabilities the host may ask the registering
    // connection for. Each ask travels back on that connection alone, bound
    // to it by the invocation id its ledger holds; the connection closing
    // marks the node disconnected, so the next ask answers unavailable, and
    // a later registration from a new connection takes the node over whole.
    [GATEWAY_METHOD.NODE_REGISTER]: reading((read, context) => {
      const nodeId = read.identifier("nodeId");
      const capabilities = read.stringList("capabilities");
      if (capabilities.length === 0) {
        return invalid("capabilities must name at least one capability");
      }
      const connection = context.connection;
      if (!connection) {
        if (nodes.has(nodeId)) {
          nodes.setConnected(nodeId, true);
          return gatewayOk({ nodeId, connected: true, clientId: context.client.clientId });
        }
        return gatewayError(
          GATEWAY_ERROR.REFUSED,
          "a node's capabilities are registered by the process that performs them",
        );
      }
      nodeOwners.set(nodeId, connection.connectionId);
      nodes.registerRemote({
        nodeId,
        capabilities,
        invoke: (capability, params) =>
          connection.invoke({
            invocationId: dependencies.createId(),
            nodeId,
            capability,
            params,
          }),
      });
      connection.onClosed(() => {
        if (nodeOwners.get(nodeId) !== connection.connectionId) return;
        nodes.setConnected(nodeId, false);
      });
      return gatewayOk({ nodeId, connected: true, clientId: context.client.clientId });
    }),
    [GATEWAY_METHOD.NODE_UNREGISTER]: reading((read) =>
      gatewayOk({ disconnected: nodes.setConnected(read.identifier("nodeId"), false) }),
    ),
    [GATEWAY_METHOD.NODE_INVOKE]: reading(async (read) => {
      const capability = read.string("capability");
      const result = await nodes.invoke(capability, read.optionalRecord("params") ?? {});
      if (result.status === NODE_CAPABILITY_STATUS.OK) {
        return gatewayOk({
          status: result.status,
          ...(result.value !== undefined ? { value: result.value } : undefined),
        });
      }
      return gatewayOk({
        status: result.status,
        capability: result.capability,
        reason: result.reason,
      });
    }),
  };

  const serverOptions: GatewayServerOptions = {
    methods,
    configurationRevision: () => brain.configuration().revision,
    sessionRevision: (key) =>
      isIdentifier(key) ? brain.generationId(toSessionKey(key)) : undefined,
    snapshot,
    now: dependencies.now,
    createEventId: dependencies.createId,
  };
  const server = new GatewayServer(serverOptions);

  nodes.onChange((list) => {
    server.emit(GATEWAY_EVENT.NODE_CHANGED, { nodes: list.map(nodeSnapshotToWire) });
  });

  return {
    server,
    serverOptions,
    nodes,
    runsReported: (snapshots) => {
      server.emit(GATEWAY_EVENT.RUNS_CHANGED, { runs: snapshots.map(brainRequestRecordToWire) });
    },
    conversationChanged: (sessionKey, entries, reporter) => {
      server.emit(
        GATEWAY_EVENT.CONVERSATION_CHANGED,
        {
          sessionKey,
          entries: entries.map(conversationEntryToWire),
          cleared: entries.length === 0,
          ...(reporter !== undefined ? { reporter } : undefined),
        },
        { sessionKey },
      );
    },
    directoryChanged: () => {
      server.emit(GATEWAY_EVENT.DIRECTORY_CHANGED, {
        entries: conversations.directory().map(conversationRecordToWire),
      });
    },
    observationChanged: () => {
      server.emit(GATEWAY_EVENT.OBSERVATION_CHANGED, {
        sessions: dependencies.observedSessionCount(),
      });
    },
    configurationChanged: () => {
      server.emit(GATEWAY_EVENT.CONFIGURATION_CHANGED, configurationToWire(brain.configuration()));
    },
    childChanged: (childId) => {
      const record = brain.children.child(childId);
      server.emit(GATEWAY_EVENT.CHILD_CHANGED, record ? childRecordToWire(record) : { childId });
    },
  };
}
