import type { BrainAgent, BrainRequestRecord } from "@sidecar/brain";
import {
  BRAIN_DEFAULTS,
  type DeliveryClaimContext,
  type DeliveryLedger,
  deliveryRecordToWire,
} from "@sidecar/brain";
import type { BrainRequestOrigin } from "@sidecar/brain/requests";
import {
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_SUBMISSION_REJECTION,
  type BrainSubmissionResult,
  brainReplyWords,
  brainRequestRecordToWire,
  isBrainRequestOrigin,
  isTerminalBrainRequestStatus,
} from "@sidecar/brain/requests";
import type {
  BrainAskWait,
  BrainReplyClaimResult,
  BrainRequestSnapshot,
} from "@sidecar/brain/requests-wire";
import {
  GATEWAY_ERROR,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayMethodContext,
  type GatewayMethodHandler,
  type GatewayMethodOutcome,
  type GatewayMethodTable,
  GatewayServer,
  gatewayError,
  gatewayOk,
  invalid,
  NODE_CAPABILITY_STATUS,
  NodeRegistry,
  nodeSnapshotToWire,
} from "@sidecar/gateway";
import {
  type ConversationEntry,
  conversationEntryToWire,
  maximumTypedAskLength,
} from "@sidecar/realtime";
import type { ChildRunService, ResolvedConfiguration } from "@sidecar/runtime";
import {
  type ChildRunRecord,
  conversationRecordToWire,
  isIdentifier,
  MAIN_SESSION_KEY,
  type MaybePromise,
  type SessionKey,
  sessionKey as toSessionKey,
} from "@sidecar/runtime-contracts";
import {
  isRecord,
  isWireNumber,
  isWireString,
  type WireRecord,
  type WireValue,
} from "@sidecar/wire";
import { publishAsk } from "./brain/publication.js";
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
export interface GatewayBrainAccess {
  /** The brain of one conversation as it stands now; nothing between transitions or for an unopened key. */
  current: (sessionKey?: SessionKey) => BrainAgent | undefined;
  agentForRun: (runId: string) => BrainAgent | undefined;
  conversationForRun: (runId: string) => SessionKey | undefined;
  allRequests: () => readonly BrainRequestSnapshot[];
  /** The generation standing for a conversation, or nothing while none does. */
  generationId: (sessionKey: SessionKey) => string | undefined;
  holdsGeneration: (generationId: string) => boolean;
  /** Settles once every standing follower has published every report taken so far. */
  publicationSettled: () => Promise<void>;
  children: Pick<ChildRunService, "children" | "child" | "childrenOf">;
  configuration: () => ResolvedConfiguration;
  /** Republishes the configuration with the settable fields patched; answers the refusals, none on success. */
  updateConfiguration: (patch: SettableConfigurationPatch) => readonly string[];
}

export interface GatewayMemoryAccess {
  status: () => WireRecord;
}

/** The one current voice receiver, as the client owning it reports: ready, and under which epoch. */
export interface GatewayReceiverState {
  isReady: () => boolean;
  epoch: () => number;
}

export interface GatewayServiceDependencies {
  brain: GatewayBrainAccess;
  conversations: ConversationOperations;
  memory: GatewayMemoryAccess;
  /** How many sessions the roster holds now; the observation event's whole payload. */
  observedSessionCount: () => number;
  deliveries: DeliveryLedger<GrantedWords>;
  receiver: GatewayReceiverState;
  nodes?: NodeRegistry;
  recordConversationEntry: (
    entry: ConversationEntry,
    recordedAt: number,
    sessionKey: SessionKey,
  ) => boolean | Promise<boolean>;
  askWaitMs?: number;
  now: () => number;
  createId: () => string;
  /**
   * The host's further methods, beside the ones this service answers itself:
   * the settings, account, integration, and client-fact vocabulary the
   * runtime host owns. A method both name is the host's.
   */
  methods?: GatewayMethodTable;
  /** Hears the operator's connection close, when the transport can tell: the client's receiver and node are gone with it. */
  onOperatorDisconnected?: () => void;
}

export interface GatewayService {
  readonly server: GatewayServer;
  readonly nodes: NodeRegistry;
  /** The brain's whole list of records, as the followers report it: the ledger watches it and every client hears it. */
  runsReported: (snapshots: readonly BrainRequestSnapshot[]) => void;
  /** A run's end stands in History, written and marked: the moment its reply may be owed to the ear. */
  endPublished: (record: BrainRequestRecord, sessionKey: SessionKey) => void;
  /** A conversation's generation ended; every reply owed of it is withdrawn and the receiver told. */
  generationReplaced: (sessionKey: SessionKey) => void;
  /** The receiver reported ready under a new epoch: whatever is owed is offered to it now. */
  receiverReady: () => void;
  /** One conversation's thread as every window should draw it, less the opaque reporter whose report produced it. */
  historyChanged: (
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
    ...(record.performedActs !== undefined ? { performedActs: record.performedActs } : undefined),
    ...(record.unknownActs !== undefined ? { unknownActs: record.unknownActs } : undefined),
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
    lifecycleServiceIds: [...configuration.lifecycleServiceIds],
  };
}

function submissionResultToWire(result: BrainSubmissionResult): WireRecord {
  return result.outcome === BRAIN_SUBMISSION_OUTCOME.ACCEPTED
    ? { outcome: result.outcome, runId: result.runId, acceptedAt: result.acceptedAt }
    : { outcome: result.outcome, reason: result.reason };
}

/** The words one granted reply is spoken as, read from the live record at the moment of the grant. */
export interface GrantedWords {
  words: string;
  origin: BrainRequestOrigin;
}

/** What a grant is checked against at the moment it lands: the receiver, the store, and the live record. */
export interface BrainReplyClaimContext {
  /** Whether the receiver is ready and the epoch given is its current one. */
  receiverCurrent: (epoch: number) => boolean;
  /** Whether the generation named still stands in the store. */
  generationStands: (generationId: string) => boolean;
  /** The run's record as the standing brain holds it now, or nothing. */
  liveRecord: (runId: string) => BrainRequestRecord | undefined;
}

/**
 * Whether a run's end may be spoken at all: ended, written and marked in
 * History, and wordable in History's own wording. The ledger keeps the
 * states, the epochs, and the one grant per run; this is the only thing read
 * out of a brain record on the way there.
 */
export function deliverable(record: BrainRequestRecord): boolean {
  return (
    isTerminalBrainRequestStatus(record.status) &&
    record.historyRecordedAt !== undefined &&
    brainReplyWords(record) !== undefined
  );
}

/** The claim context as the ledger asks for it: the words come from the live record, never the offer's. */
export function ledgerContext(context: BrainReplyClaimContext): DeliveryClaimContext<GrantedWords> {
  return {
    receiverCurrent: context.receiverCurrent,
    generationStands: context.generationStands,
    runHeld: (runId: string) => context.liveRecord(runId) !== undefined,
    liveWords: (runId: string): GrantedWords | undefined => {
      const live = context.liveRecord(runId);
      if (!live || !deliverable(live)) return undefined;
      const words = brainReplyWords(live);
      return words === undefined ? undefined : { words, origin: live.origin };
    },
  };
}

export function createGatewayService(dependencies: GatewayServiceDependencies): GatewayService {
  const { brain, conversations, deliveries, receiver } = dependencies;
  const nodes = dependencies.nodes ?? new NodeRegistry();
  const askWaitMs = dependencies.askWaitMs ?? BRAIN_DEFAULTS.ASK_WAIT_MS;

  /** What a grant is checked against at the moment it lands: the receiver, the store, and the live record. */
  const claimContext = () => ({
    receiverCurrent: (epoch: number) => receiver.isReady() && receiver.epoch() === epoch,
    generationStands: (generationId: string) => brain.holdsGeneration(generationId),
    liveRecord: (runId: string) => brain.agentForRun(runId)?.request(runId),
  });

  const snapshot = (): WireValue => ({
    runs: brain.allRequests().map(brainRequestRecordToWire),
    conversations: conversations.directory().map(conversationRecordToWire),
    deliveries: deliveries.records().map(deliveryRecordToWire),
    configurationRevision: brain.configuration().revision,
    nodes: nodes.list().map(nodeSnapshotToWire),
    receiverEpoch: receiver.epoch(),
  });

  /**
   * Hands the ready receiver the one delivery it may hold now, under the
   * epoch it is sent to; the next follows its acknowledgement. Nothing is
   * offered while no receiver has reported, and nothing here is held by the
   * announcement quiet: a reply to the developer's own ask is conversation,
   * not news.
   */
  const offerReplies = (): void => {
    if (!receiver.isReady()) return;
    const offer = deliveries.nextOffer(receiver.epoch());
    if (!offer) return;
    server.emit(
      GATEWAY_EVENT.DELIVERY_OFFERED,
      { runId: offer.runId, deliveryId: offer.deliveryId, epoch: offer.epoch },
      { runId: offer.runId },
    );
  };

  /** The generation the run's conversation stands in now, or nothing for a run of no conversation the host holds. */
  const runGeneration = (runId: string): string | undefined => {
    const sessionKey = brain.conversationForRun(runId);
    return sessionKey === undefined ? undefined : brain.generationId(sessionKey);
  };

  /**
   * Grants the asking call the words of one ended run, under the receiver
   * epoch it named. The grant takes the run's offer out of the receiver's
   * hand, and no acknowledgement will come for a reply said on the call, so
   * the next owed reply is offered at once.
   */
  const grantReplyOnCall = (
    live: BrainRequestRecord,
    generationId: string,
    epoch: number,
  ): boolean => {
    const granted =
      deliverable(live) &&
      deliveries.grantOnCall(live.runId, generationId, epoch, ledgerContext(claimContext()));
    if (granted) offerReplies();
    return granted;
  };

  const submit = async (read: ParamReader): Promise<GatewayMethodOutcome> => {
    const sessionKey = read.sessionKeyOrMain("sessionKey");
    const submissionId = read.identifier("submissionId");
    const question = read.string("question").trim().slice(0, maximumTypedAskLength);
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
    if (result.outcome === BRAIN_SUBMISSION_OUTCOME.ACCEPTED) {
      await publishAsk(agent, result.runId, dependencies.recordConversationEntry, sessionKey);
    }
    return gatewayOk(submissionResultToWire(result));
  };

  /** Which connection a remote node was last registered on, so only that connection's closing disconnects it. */
  const nodeOwners = new Map<string, string>();

  const methods: GatewayMethodTable = {
    ...dependencies.methods,
    [GATEWAY_METHOD.CONVERSATION_HISTORY]: reading((read) => {
      const sessionKey = read.sessionKeyOrMain("sessionKey");
      if (!conversations.holds(sessionKey)) {
        return gatewayError(GATEWAY_ERROR.NOT_FOUND, REFUSAL.NOT_LISTED);
      }
      return gatewayOk({ entries: conversations.history(sessionKey).map(conversationEntryToWire) });
    }),
    [GATEWAY_METHOD.CONVERSATION_DELETE]: reading(async (read) =>
      gatewayOk({
        outcome: await conversations.deleteHistory(read.sessionKeyOrMain("sessionKey")),
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
    // A wait that finds its run ended does not hand the words over on the
    // strength of the record alone: the followers' publication is let finish,
    // the live record is re-read for its History mark, and the grant to say
    // the words on the call is asked of the ledger — only when the caller
    // names the receiver epoch it holds, which only the voice window does.
    [GATEWAY_METHOD.RUN_WAIT]: reading(async (read) => {
      const runId = read.identifier("runId");
      const speakerEpoch = read.optionalNumber("speakerEpoch");
      const waited = await brain.agentForRun(runId)?.waitAsk(runId, askWaitMs);
      const answer = (wait: BrainAskWait): GatewayMethodOutcome =>
        gatewayOk({
          ...(wait.record ? { record: brainRequestRecordToWire(wait.record) } : undefined),
          speak: wait.speak,
        });
      if (!waited || !isTerminalBrainRequestStatus(waited.status)) {
        return answer({ record: waited, speak: false });
      }
      await brain.publicationSettled();
      const live = brain.agentForRun(runId)?.request(runId) ?? waited;
      if (speakerEpoch === undefined || live.historyRecordedAt === undefined) {
        return answer({ record: live, speak: false });
      }
      const generationId = runGeneration(runId);
      const granted =
        generationId !== undefined && grantReplyOnCall(live, generationId, speakerEpoch);
      return answer({ record: live, speak: granted });
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
    // A registration over the protocol names capabilities the host may ask
    // for; each is invoked back through the registering client's own
    // channel, which the in-process build wires directly.
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
        dependencies.onOperatorDisconnected?.();
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
    [GATEWAY_METHOD.DELIVERY_CLAIM]: reading((read) => {
      const granted = deliveries.claim(
        read.identifier("runId"),
        read.identifier("deliveryId"),
        read.number("epoch"),
        ledgerContext(claimContext()),
      );
      const claim: BrainReplyClaimResult = granted.granted
        ? { granted: true, words: granted.words.words, origin: granted.words.origin }
        : { granted: false };
      return gatewayOk({ ...claim });
    }),
    [GATEWAY_METHOD.DELIVERY_ACKNOWLEDGE]: reading((read) => {
      const emptied = deliveries.acknowledge(
        read.identifier("runId"),
        read.identifier("deliveryId"),
        read.number("epoch"),
      );
      if (emptied) offerReplies();
      return gatewayOk({ acknowledged: emptied });
    }),
  };

  const server = new GatewayServer({
    methods,
    configurationRevision: () => brain.configuration().revision,
    sessionRevision: (key) =>
      isIdentifier(key) ? brain.generationId(toSessionKey(key)) : undefined,
    snapshot,
    now: dependencies.now,
    createEventId: dependencies.createId,
  });

  nodes.onChange((list) => {
    server.emit(GATEWAY_EVENT.NODE_CHANGED, { nodes: list.map(nodeSnapshotToWire) });
  });

  return {
    server,
    nodes,
    runsReported: (snapshots) => {
      deliveries.observe(
        snapshots.map((record) => ({
          runId: record.runId,
          ended: isTerminalBrainRequestStatus(record.status),
        })),
      );
      server.emit(GATEWAY_EVENT.RUNS_CHANGED, { runs: snapshots.map(brainRequestRecordToWire) });
    },
    endPublished: (record, sessionKey) => {
      const generationId = brain.generationId(sessionKey);
      if (generationId === undefined) return;
      if (deliverable(record)) deliveries.published(record.runId, generationId);
      offerReplies();
    },
    generationReplaced: () => {
      deliveries.reset();
      server.emit(GATEWAY_EVENT.DELIVERIES_WITHDRAWN, { epoch: receiver.epoch() });
    },
    receiverReady: offerReplies,
    historyChanged: (sessionKey, entries, reporter) => {
      server.emit(
        GATEWAY_EVENT.HISTORY_CHANGED,
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
