import type { BrainAgent, BrainRequestRecord } from "@sidecar/brain";
import { BRAIN_DEFAULTS } from "@sidecar/brain";
import {
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_SUBMISSION_REJECTION,
  type BrainSubmissionResult,
  brainRequestRecordToWire,
  isBrainRequestOrigin,
  isTerminalBrainRequestStatus,
} from "@sidecar/brain/requests";
import {
  type ConversationEntry,
  conversationEntryToWire,
  maximumTypedAskLength,
} from "@sidecar/realtime";
import {
  type ChildRunService,
  deliveryRecordToWire,
  type GatewayMethodContext,
  type GatewayMethodHandler,
  type GatewayMethodOutcome,
  type GatewayMethodTable,
  GatewayServer,
  gatewayError,
  gatewayOk,
  NodeRegistry,
  nodeSnapshotToWire,
  type ResolvedConfiguration,
} from "@sidecar/runtime";
import {
  type ChildCompletionRecord,
  type ChildRunRecord,
  conversationRecordToWire,
  GATEWAY_ERROR,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  historyArchiveRecordToWire,
  isIdentifier,
  MAIN_SESSION_KEY,
  type MaybePromise,
  NODE_CAPABILITY_STATUS,
  type SessionKey,
  sessionKey as toSessionKey,
} from "@sidecar/runtime-contracts";
import type { MemoryForgetAsk, MemoryForgetReport } from "@sidecar/runtime-store";
import type { Session } from "@sidecar/session";
import {
  isRecord,
  isWireBoolean,
  isWireNumber,
  isWireString,
  type WireRecord,
  type WireValue,
} from "@sidecar/wire";
import type { BrainAskWait, BrainReplyClaimResult, BrainRequestSnapshot } from "#shared/wire/brain";
import { publishAsk } from "../brain/ipc";
import type { BrainReplyDeliveries } from "../brain/reply-delivery";
import type { SettableConfigurationPatch } from "../brain/wiring";
import type { ConversationOperations } from "../conversation-operations";

/**
 * The host side of the desktop's Gateway: every capability the protocol
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
  children: Pick<
    ChildRunService,
    "children" | "child" | "childrenOf" | "completions" | "completion" | "cancel"
  >;
  configuration: () => ResolvedConfiguration;
  /** Republishes the configuration with the settable fields patched; answers the refusals, none on success. */
  updateConfiguration: (patch: SettableConfigurationPatch) => readonly string[];
  /** How many compact notices main has not yet read. */
  pendingNoticeCount: () => number;
}

export interface GatewayMemoryAccess {
  search: (
    query: string,
    maxResults: number | undefined,
    signal?: AbortSignal,
  ) => Promise<WireRecord>;
  get: (path: string, from: number | undefined, lines: number | undefined) => Promise<WireRecord>;
  forget: (ask: MemoryForgetAsk) => Promise<MemoryForgetReport | undefined>;
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
  /** The observed sessions as the roster holds them now. */
  observedSessions: () => readonly Session[];
  deliveries: BrainReplyDeliveries;
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
  historyChanged: (
    sessionKey: SessionKey,
    entries: readonly ConversationEntry[],
    reporter?: number,
  ) => void;
  directoryChanged: () => void;
  observationChanged: () => void;
  configurationChanged: () => void;
  childChanged: (childId: string) => void;
}

const REFUSAL = {
  NO_RUN: "no run has that id",
  NOT_LISTED: "the directory does not list that conversation",
  NO_CHILD: "no child has that id",
} as const;

function invalid(message: string): GatewayMethodOutcome {
  return gatewayError(GATEWAY_ERROR.INVALID_PARAMS, message);
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

  optionalBoolean(name: string): boolean | undefined {
    const value = this.#params[name];
    if (value === undefined || isWireBoolean(value)) return value;
    throw new ParamRefusal(`${name} must be a boolean`);
  }

  stringList(name: string): readonly string[] {
    const value = this.#params[name];
    if (Array.isArray(value) && value.every(isWireString)) return value;
    throw new ParamRefusal(`${name} must be a list of strings`);
  }

  optionalStringList(name: string): readonly string[] | undefined {
    return this.#params[name] === undefined ? undefined : this.stringList(name);
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

/** The bounded projection of a completion: where its delivery stands, never the result's words. */
function completionToWire(completion: ChildCompletionRecord): WireRecord {
  return {
    completionId: completion.completionId,
    childId: completion.childId,
    destination: completion.destination,
    status: completion.status,
    delivery: completion.delivery,
    attempts: completion.attempts,
    ...(completion.failureDetail !== undefined
      ? { failureDetail: completion.failureDetail }
      : undefined),
  };
}

/** The observed roster's bounded fields: what the rows draw, never a transcript. */
function sessionToWire(session: Session): WireRecord {
  return {
    providerId: session.providerId,
    providerSessionId: session.providerSessionId,
    title: session.title,
    status: session.status,
    location: session.location,
    lastActivityAt: session.lastActivityAt,
    canReceiveMessage: session.canReceiveMessage,
    ...(session.workspace?.name !== undefined ? { workspace: session.workspace.name } : undefined),
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

function forgetReportToWire(report: MemoryForgetReport): WireRecord {
  return {
    forgottenEntries: report.forgottenEntries,
    removedCandidates: report.removedCandidates,
    removedMemoryEntries: report.removedMemoryEntries,
    tombstoned: report.tombstoned,
    limitations: [...report.limitations],
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
    conversations: conversations.directory().entries.map(conversationRecordToWire),
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
    const granted = deliveries.grantOnCall(live, generationId, epoch, claimContext());
    if (granted) offerReplies();
    return granted;
  };

  const submit = async (
    read: ParamReader,
    steerRunId: string | undefined,
  ): Promise<GatewayMethodOutcome> => {
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
    if (steerRunId !== undefined) {
      const live = agent.request(steerRunId);
      if (!live || isTerminalBrainRequestStatus(live.status)) {
        return gatewayError(GATEWAY_ERROR.NOT_FOUND, "no run under way has that id to steer");
      }
    }
    const result = await agent.submitAsk({ submissionId, origin, question });
    if (result.outcome === BRAIN_SUBMISSION_OUTCOME.ACCEPTED) {
      await publishAsk(agent, result.runId, dependencies.recordConversationEntry, sessionKey);
    }
    return gatewayOk(submissionResultToWire(result));
  };

  const methods: GatewayMethodTable = {
    [GATEWAY_METHOD.CONVERSATION_LIST]: () => {
      const directory = conversations.directory();
      return gatewayOk({
        entries: directory.entries.map(conversationRecordToWire),
        archives: directory.archives.map(historyArchiveRecordToWire),
      });
    },
    [GATEWAY_METHOD.CONVERSATION_CREATE]: reading(async (read) => {
      const temporary = read.optionalBoolean("temporary") === true;
      const created = await conversations.createThread(temporary);
      return created
        ? gatewayOk({ sessionKey: created })
        : gatewayError(GATEWAY_ERROR.REFUSED, "the store did not create a thread");
    }),
    [GATEWAY_METHOD.CONVERSATION_HISTORY]: reading((read) => {
      const sessionKey = read.sessionKeyOrMain("sessionKey");
      if (!conversations.holds(sessionKey)) {
        return gatewayError(GATEWAY_ERROR.NOT_FOUND, REFUSAL.NOT_LISTED);
      }
      return gatewayOk({ entries: conversations.history(sessionKey).map(conversationEntryToWire) });
    }),
    [GATEWAY_METHOD.CONVERSATION_RESET]: reading(async (read) =>
      gatewayOk({ reset: await conversations.startFresh(read.sessionKeyOrMain("sessionKey")) }),
    ),
    [GATEWAY_METHOD.CONVERSATION_ARCHIVE]: reading(async (read) =>
      gatewayOk({ archived: await conversations.archive(read.sessionKey("sessionKey")) }),
    ),
    [GATEWAY_METHOD.CONVERSATION_UNARCHIVE]: reading(async (read) =>
      gatewayOk({ unarchived: await conversations.unarchive(read.sessionKey("sessionKey")) }),
    ),
    [GATEWAY_METHOD.CONVERSATION_DELETE]: reading(async (read) =>
      gatewayOk({
        outcome: await conversations.deleteHistory(read.sessionKeyOrMain("sessionKey")),
      }),
    ),
    [GATEWAY_METHOD.CONVERSATION_RESTORE]: reading(async (read) =>
      gatewayOk({ outcome: await conversations.restoreArchive(read.identifier("archiveId")) }),
    ),
    [GATEWAY_METHOD.RUN_SUBMIT]: reading((read) => submit(read, undefined)),
    [GATEWAY_METHOD.RUN_STEER]: reading((read) => submit(read, read.identifier("runId"))),
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
    [GATEWAY_METHOD.RUN_STATUS]: reading((read) => {
      const runId = read.identifier("runId");
      const record = brain.agentForRun(runId)?.request(runId);
      if (!record) return gatewayError(GATEWAY_ERROR.NOT_FOUND, REFUSAL.NO_RUN);
      return gatewayOk({
        record: brainRequestRecordToWire(record),
        sessionKey: brain.conversationForRun(runId) ?? MAIN_SESSION_KEY,
      });
    }),
    [GATEWAY_METHOD.RUN_LIST]: () =>
      gatewayOk({ runs: brain.allRequests().map(brainRequestRecordToWire) }),
    [GATEWAY_METHOD.CHILD_LIST]: reading((read) => {
      const requester = read.optionalSessionKey("sessionKey");
      const records = requester ? brain.children.childrenOf(requester) : brain.children.children();
      return gatewayOk({ children: records.map(childRecordToWire) });
    }),
    [GATEWAY_METHOD.CHILD_STATUS]: reading((read) => {
      const childId = read.identifier("childId");
      const record = brain.children.child(childId);
      if (!record) return gatewayError(GATEWAY_ERROR.NOT_FOUND, REFUSAL.NO_CHILD);
      const completion = brain.children.completion(childId);
      return gatewayOk({
        child: childRecordToWire(record),
        ...(completion ? { completion: completionToWire(completion) } : undefined),
      });
    }),
    [GATEWAY_METHOD.CHILD_CANCEL]: reading(async (read) => {
      const childId = read.identifier("childId");
      if (!brain.children.child(childId)) {
        return gatewayError(GATEWAY_ERROR.NOT_FOUND, REFUSAL.NO_CHILD);
      }
      const cancelled = await brain.children.cancel(childId);
      return gatewayOk(
        cancelled.ok
          ? { cancelled: true }
          : { cancelled: false, remaining: [...cancelled.remaining] },
      );
    }),
    [GATEWAY_METHOD.CHILD_COMPLETIONS]: () =>
      gatewayOk({ completions: brain.children.completions().map(completionToWire) }),
    [GATEWAY_METHOD.MEMORY_SEARCH]: reading(async (read) =>
      gatewayOk(
        await dependencies.memory.search(read.string("query"), read.optionalNumber("maxResults")),
      ),
    ),
    [GATEWAY_METHOD.MEMORY_GET]: reading(async (read) =>
      gatewayOk(
        await dependencies.memory.get(
          read.string("path"),
          read.optionalNumber("from"),
          read.optionalNumber("lines"),
        ),
      ),
    ),
    // A forget names any of three kinds of source; a list it leaves out
    // names none of that kind, so an absent list is an empty one.
    [GATEWAY_METHOD.MEMORY_FORGET]: reading(async (read) => {
      const entryIds = read.optionalStringList("entryIds") ?? [];
      const sessionKeys = read.optionalStringList("sessionKeys") ?? [];
      const candidateKeys = read.optionalStringList("candidateKeys") ?? [];
      const reason = read.string("reason");
      if (sessionKeys.some((key) => !isIdentifier(key))) {
        return invalid("sessionKeys must be non-empty strings");
      }
      const report = await dependencies.memory.forget({
        entryIds,
        sessionKeys: sessionKeys.map(toSessionKey),
        candidateKeys,
        reason,
      });
      return report
        ? gatewayOk(forgetReportToWire(report))
        : gatewayError(GATEWAY_ERROR.REFUSED, "no notebook stands to forget from");
    }),
    [GATEWAY_METHOD.MEMORY_STATUS]: () => gatewayOk(dependencies.memory.status()),
    [GATEWAY_METHOD.CONFIGURATION_SNAPSHOT]: () =>
      gatewayOk(configurationToWire(brain.configuration())),
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
    [GATEWAY_METHOD.OBSERVATION_STATE]: () =>
      gatewayOk({
        sessions: dependencies.observedSessions().map(sessionToWire),
        pendingNotices: brain.pendingNoticeCount(),
      }),
    // A registration over the protocol names capabilities the host may ask
    // for; each is invoked back through the registering client's own
    // channel, which the in-process build wires directly.
    [GATEWAY_METHOD.NODE_REGISTER]: reading((read, context) => {
      const nodeId = read.identifier("nodeId");
      if (read.stringList("capabilities").length === 0) {
        return invalid("capabilities must name at least one capability");
      }
      if (nodes.has(nodeId)) {
        nodes.setConnected(nodeId, true);
        return gatewayOk({ nodeId, connected: true, clientId: context.client.clientId });
      }
      return gatewayError(
        GATEWAY_ERROR.REFUSED,
        "a node's capabilities are registered by the process that performs them",
      );
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
    [GATEWAY_METHOD.DELIVERY_LIST]: () =>
      gatewayOk({
        deliveries: deliveries.records().map(deliveryRecordToWire),
        receiverEpoch: receiver.epoch(),
        receiverReady: receiver.isReady(),
      }),
    [GATEWAY_METHOD.DELIVERY_CLAIM]: reading((read) => {
      const claim: BrainReplyClaimResult = deliveries.claim(
        read.identifier("runId"),
        read.identifier("deliveryId"),
        read.number("epoch"),
        claimContext(),
      );
      return gatewayOk(
        claim.granted
          ? { granted: true, words: claim.words, origin: claim.origin }
          : { granted: false },
      );
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
    [GATEWAY_METHOD.DELIVERY_GRANT_ON_CALL]: reading((read) => {
      const runId = read.identifier("runId");
      const epoch = read.number("epoch");
      const live = brain.agentForRun(runId)?.request(runId);
      const generationId = runGeneration(runId);
      if (!live || generationId === undefined) {
        return gatewayError(GATEWAY_ERROR.NOT_FOUND, REFUSAL.NO_RUN);
      }
      return gatewayOk({ granted: grantReplyOnCall(live, generationId, epoch) });
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
      deliveries.observe(snapshots);
      server.emit(GATEWAY_EVENT.RUNS_CHANGED, { runs: snapshots.map(brainRequestRecordToWire) });
    },
    endPublished: (record, sessionKey) => {
      const generationId = brain.generationId(sessionKey);
      if (generationId === undefined) return;
      deliveries.published(record, generationId);
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
        entries: conversations.directory().entries.map(conversationRecordToWire),
      });
    },
    observationChanged: () => {
      server.emit(GATEWAY_EVENT.OBSERVATION_CHANGED, {
        sessions: dependencies.observedSessions().length,
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
