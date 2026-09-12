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
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayEventKind,
  type GatewayMethodContext,
  type GatewayMethodHandler,
  type GatewayMethodTable,
  type GatewayRefusal,
  invalid,
  NODE_CAPABILITY_STATUS,
  NodeRegistry,
  NotFoundRefusal,
  nodeSnapshotToWire,
  RefusedRefusal,
} from "@sidecar/gateway";
import {
  type GatewayInProcessHost,
  type GatewayServerLayerOptions,
  gatewayInProcessHost,
} from "@sidecar/gateway/server";
import type { ChildRunService, ResolvedConfiguration } from "@sidecar/runtime";
import {
  type ChildRunRecord,
  conversationRecordToWire,
  isIdentifier,
  MAIN_SESSION_KEY,
  type SessionKey,
  sessionKey as toSessionKey,
} from "@sidecar/runtime/vocabulary";
import {
  type ConversationEntry,
  conversationEntryToWire,
  maximumAskLength,
} from "@sidecar/session";
import {
  isRecord,
  isWireNumber,
  isWireString,
  type WireRecord,
  type WireValue,
} from "@sidecar/wire";
import { Effect, type Scope } from "effect";
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
  /** The in-process host every transport in this process is bound to: the protocol's door, the log, and the admissions door. */
  readonly gateway: GatewayInProcessHost;
  /**
   * What its own server was built over, so a transport that composes a server
   * of its own — the socket binding, which provides the `Protocol` a server is
   * built on rather than attaching to one already built — answers the same
   * methods over the same readers.
   */
  readonly layerOptions: GatewayServerLayerOptions;
  /**
   * Closes the door to new work: every mutating method but the shutdown
   * itself answers shutting-down from here on, while reads, hellos, and
   * reconnections still answer, so a client can see the host leaving rather
   * than lose it. Nothing under way is touched; that is the coordinator's.
   */
  readonly closeAdmissions: Effect.Effect<void>;
  /** Appends one event to the log, for a host concern with no narrower report of its own below. */
  readonly emit: (kind: GatewayEventKind, payload: WireValue) => void;
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
  handle: (
    read: ParamReader,
    context: GatewayMethodContext,
  ) => Effect.Effect<WireValue | undefined, GatewayRefusal>,
): GatewayMethodHandler {
  return (params, context) =>
    Effect.suspend(() => handle(new ParamReader(params), context)).pipe(
      Effect.catchAllDefect((defect) =>
        defect instanceof ParamRefusal ? invalid(defect.message) : Effect.die(defect),
      ),
    );
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

/**
 * The host's side of the Gateway, composed in the caller's own `Scope`: the
 * method table this service answers, and the in-process host the server's
 * layers were built into, which every transport in this process is bound to
 * and whose event log each change below becomes a numbered event in.
 */
export function createGatewayService(
  dependencies: GatewayServiceDependencies,
): Effect.Effect<GatewayService, never, Scope.Scope> {
  const { brain, conversations } = dependencies;
  const nodes = dependencies.nodes ?? new NodeRegistry();
  const askWaitMs = dependencies.askWaitMs ?? BRAIN_DEFAULTS.ASK_WAIT_MS;

  const snapshot = (): WireRecord => ({
    runs: brain.allRequests().map(brainRequestRecordToWire),
    conversations: conversations.directory().map(conversationRecordToWire),
    configurationRevision: brain.configuration().revision,
    nodes: nodes.list().map(nodeSnapshotToWire),
  });

  const submit = (read: ParamReader): Effect.Effect<WireValue, GatewayRefusal> =>
    Effect.gen(function* () {
      const sessionKey = read.sessionKeyOrMain("sessionKey");
      const submissionId = read.identifier("submissionId");
      const question = read.string("question").trim().slice(0, maximumAskLength);
      const origin = read.string("origin");
      if (!isBrainRequestOrigin(origin))
        return yield* invalid("origin is not one this build knows");
      const agent = brain.current(sessionKey);
      if (!agent) {
        return submissionResultToWire({
          outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
          reason: BRAIN_SUBMISSION_REJECTION.ABSENT,
        });
      }
      const result = yield* Effect.promise(() =>
        agent.submitAsk({ submissionId, origin, question }),
      );
      return submissionResultToWire(result);
    });

  /** Which connection a remote node was last registered on, so only that connection's closing disconnects it. */
  const nodeOwners = new Map<string, string>();

  const methods: GatewayMethodTable = {
    ...dependencies.methods,
    [GATEWAY_METHOD.CONVERSATION_LINES]: reading((read) => {
      const sessionKey = read.sessionKeyOrMain("sessionKey");
      if (!conversations.holds(sessionKey)) {
        return Effect.fail(new NotFoundRefusal({ message: REFUSAL.NOT_LISTED }));
      }
      return Effect.succeed({
        entries: conversations.lines(sessionKey).map(conversationEntryToWire),
      });
    }),
    [GATEWAY_METHOD.CONVERSATION_DELETE]: reading((read) =>
      Effect.map(
        Effect.promise(() => conversations.deleteConversation(read.sessionKeyOrMain("sessionKey"))),
        (outcome) => ({ outcome }),
      ),
    ),
    [GATEWAY_METHOD.RUN_SUBMIT]: reading((read) => submit(read)),
    [GATEWAY_METHOD.RUN_CANCEL]: reading((read) =>
      Effect.gen(function* () {
        const runId = read.identifier("runId");
        const agent = brain.agentForRun(runId);
        if (!agent) return yield* Effect.fail(new NotFoundRefusal({ message: REFUSAL.NO_RUN }));
        const cancelled = yield* Effect.promise(() => agent.cancelAsk(runId));
        return cancelled ? { record: brainRequestRecordToWire(cancelled) } : {};
      }),
    ),
    // A wait answers the record and never the words: the live session speaks
    // a reply from the run's own events, so no caller is granted them here.
    [GATEWAY_METHOD.RUN_WAIT]: reading((read) =>
      Effect.gen(function* () {
        const runId = read.identifier("runId");
        const waited = yield* Effect.promise(async () =>
          brain.agentForRun(runId)?.waitAsk(runId, askWaitMs),
        );
        return {
          ...(waited ? { record: brainRequestRecordToWire(waited) } : undefined),
          speak: false,
        };
      }),
    ),
    [GATEWAY_METHOD.RUN_LIST]: () =>
      Effect.succeed({ runs: brain.allRequests().map(brainRequestRecordToWire) }),
    [GATEWAY_METHOD.CHILD_LIST]: reading((read) => {
      const requester = read.optionalSessionKey("sessionKey");
      const records = requester ? brain.children.childrenOf(requester) : brain.children.children();
      return Effect.succeed({ children: records.map(childRecordToWire) });
    }),
    [GATEWAY_METHOD.MEMORY_STATUS]: () => Effect.succeed(dependencies.memory.status()),
    [GATEWAY_METHOD.CONFIGURATION_UPDATE]: reading((read) => {
      const reasoningEffort = read.optionalString("reasoningEffort");
      const maximumOutputTokens = read.optionalNumber("maximumOutputTokens");
      const patch: SettableConfigurationPatch = {
        ...(reasoningEffort !== undefined ? { reasoningEffort } : undefined),
        ...(maximumOutputTokens !== undefined ? { maximumOutputTokens } : undefined),
      };
      const refusals = brain.updateConfiguration(patch);
      if (refusals.length > 0) {
        return Effect.fail(new RefusedRefusal({ message: refusals.join(", ") }));
      }
      return Effect.succeed(configurationToWire(brain.configuration()));
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
          return Effect.succeed({ nodeId, connected: true, clientId: context.client.clientId });
        }
        return Effect.fail(
          new RefusedRefusal({
            message: "a node's capabilities are registered by the process that performs them",
          }),
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
      return Effect.succeed({ nodeId, connected: true, clientId: context.client.clientId });
    }),
    [GATEWAY_METHOD.NODE_UNREGISTER]: reading((read) =>
      Effect.succeed({ disconnected: nodes.setConnected(read.identifier("nodeId"), false) }),
    ),
    [GATEWAY_METHOD.NODE_INVOKE]: reading((read) => {
      const capability = read.string("capability");
      const params = read.optionalRecord("params") ?? {};
      return Effect.map(
        Effect.promise(() => nodes.invoke(capability, params)),
        (result) =>
          result.status === NODE_CAPABILITY_STATUS.OK
            ? {
                status: result.status,
                ...(result.value !== undefined ? { value: result.value } : undefined),
              }
            : { status: result.status, capability: result.capability, reason: result.reason },
      );
    }),
  };

  const layerOptions: GatewayServerLayerOptions = {
    methods,
    configurationRevision: () => brain.configuration().revision,
    sessionRevision: (key) =>
      isIdentifier(key) ? brain.generationId(toSessionKey(key)) : undefined,
    snapshot,
    now: dependencies.now,
    createEventId: dependencies.createId,
  };

  return Effect.map(gatewayInProcessHost(layerOptions), (gateway) => {
    /**
     * The log's own append, where the composers ask for it: every change
     * below is reported to this service synchronously, from a collaborator's
     * own callback rather than from an effect — the brain wiring's request
     * and conversation reports, the live session's, the node registry's — so
     * the append is the log's synchronous one, and an in-process transport
     * delivers what it appended on the same tick.
     */
    const emit = (
      kind: GatewayEventKind,
      payload: WireValue,
      identity?: { sessionKey?: string; runId?: string },
    ): void => {
      gateway.log.publish(kind, payload, identity);
    };

    nodes.onChange((list) => {
      emit(GATEWAY_EVENT.NODE_CHANGED, { nodes: list.map(nodeSnapshotToWire) });
    });

    return {
      gateway,
      layerOptions,
      emit,
      closeAdmissions: gateway.admissions.close,
      nodes,
      runsReported: (snapshots) => {
        emit(GATEWAY_EVENT.RUNS_CHANGED, { runs: snapshots.map(brainRequestRecordToWire) });
      },
      conversationChanged: (sessionKey, entries, reporter) => {
        emit(
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
        emit(GATEWAY_EVENT.DIRECTORY_CHANGED, {
          entries: conversations.directory().map(conversationRecordToWire),
        });
      },
      observationChanged: () => {
        emit(GATEWAY_EVENT.OBSERVATION_CHANGED, {
          sessions: dependencies.observedSessionCount(),
        });
      },
      configurationChanged: () => {
        emit(GATEWAY_EVENT.CONFIGURATION_CHANGED, configurationToWire(brain.configuration()));
      },
      childChanged: (childId) => {
        const record = brain.children.child(childId);
        emit(GATEWAY_EVENT.CHILD_CHANGED, record ? childRecordToWire(record) : { childId });
      },
    };
  });
}
