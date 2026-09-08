import type { BrainAgent, BrainRequestRecord } from "@sidecar/brain";
import { BRAIN_DEFAULTS } from "@sidecar/brain";
import {
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_SUBMISSION_REJECTION,
  type BrainSubmissionResult,
  isBrainRequestOrigin,
  isTerminalBrainRequestStatus,
} from "@sidecar/brain/requests";
import { type ConversationEntry, maximumTypedAskLength } from "@sidecar/realtime";
import {
  type ChildRunService,
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
  type ConversationRecord,
  GATEWAY_ERROR,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type HistoryArchiveRecord,
  isIdentifier,
  MAIN_SESSION_KEY,
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
  type UnparsedWireValue,
  type WireRecord,
  type WireValue,
} from "@sidecar/wire";
import type { BrainAskWait, BrainReplyClaimResult, BrainRequestSnapshot } from "#shared/wire/brain";
import { publishAsk } from "../brain/ipc";
import type { BrainReplyDeliveries } from "../brain/reply-delivery";
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
  updateConfiguration: (patch: GatewayConfigurationPatch) => readonly string[];
  /** How many compact notices main has not yet read. */
  pendingNoticeCount: () => number;
}

/** The fields a client may change in the configuration; everything else is the build's or the credential policy's. */
export interface GatewayConfigurationPatch {
  reasoningEffort?: string;
  maximumOutputTokens?: number;
}

export interface GatewayMemoryAccess {
  search: (
    query: string,
    maxResults: number | undefined,
    signal: AbortSignal,
  ) => Promise<WireRecord>;
  get: (path: string, from: number | undefined, lines: number | undefined) => Promise<WireRecord>;
  forget: (ask: MemoryForgetAsk) => Promise<MemoryForgetReport | undefined>;
  status: () => WireRecord;
}

export interface GatewayServiceDependencies {
  brain: GatewayBrainAccess;
  conversations: ConversationOperations;
  memory: GatewayMemoryAccess;
  /** The observed sessions as the roster holds them now. */
  observedSessions: () => readonly Session[];
  deliveries: BrainReplyDeliveries;
  /** The one current voice receiver, as the client owning it reports: ready, and under which epoch. */
  receiver: { isReady: () => boolean; epoch: () => number };
  nodes?: NodeRegistry;
  recordConversationEntry: (
    entry: ConversationEntry,
    recordedAt: number,
    sessionKey: SessionKey,
  ) => boolean | Promise<boolean>;
  askWaitMs?: number;
  now: () => number;
  createId: () => string;
  report: (message: string) => void;
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
  /** Whether a reply's grant may be checked against the receiver right now, for the wait and the claim. */
  claimContext: () => {
    receiverCurrent: (epoch: number) => boolean;
    generationStands: (generationId: string) => boolean;
    liveRecord: (runId: string) => BrainRequestRecord | undefined;
  };
}

const REFUSAL = {
  NO_BRAIN: "no brain stands for that conversation",
  NO_RUN: "no run has that id",
  NOT_LISTED: "the directory does not list that conversation",
  NO_CHILD: "no child has that id",
} as const;

function sessionKeyParam(value: UnparsedWireValue): SessionKey | undefined {
  return isIdentifier(value) ? toSessionKey(value) : undefined;
}

function sessionKeyOrMain(value: UnparsedWireValue): SessionKey | undefined {
  if (value === undefined) return MAIN_SESSION_KEY;
  return sessionKeyParam(value);
}

function invalid(message: string): GatewayMethodOutcome {
  return gatewayError(GATEWAY_ERROR.INVALID_PARAMS, message);
}

export function requestRecordToWire(record: BrainRequestRecord): WireRecord {
  return {
    runId: record.runId,
    submissionId: record.submissionId,
    origin: record.origin,
    question: record.question,
    status: record.status,
    revision: record.revision,
    acceptedAt: record.acceptedAt,
    ...(record.startedAt !== undefined ? { startedAt: record.startedAt } : undefined),
    ...(record.settledAt !== undefined ? { settledAt: record.settledAt } : undefined),
    ...(record.text !== undefined ? { text: record.text } : undefined),
    ...(record.failure !== undefined ? { failure: record.failure } : undefined),
    performedActs: record.performedActs,
    unknownActs: record.unknownActs,
    ...(record.askRecordedAt !== undefined ? { askRecordedAt: record.askRecordedAt } : undefined),
    ...(record.historyRecordedAt !== undefined
      ? { historyRecordedAt: record.historyRecordedAt }
      : undefined),
  };
}

export function conversationEntryToWire(entry: ConversationEntry): WireRecord {
  return {
    kind: entry.kind,
    words: entry.words,
    ...(entry.eventId !== undefined ? { eventId: entry.eventId } : undefined),
    ...(entry.identity
      ? {
          identity: {
            providerId: entry.identity.providerId,
            providerSessionId: entry.identity.providerSessionId,
          },
        }
      : undefined),
    ...(entry.recordedAt !== undefined ? { recordedAt: entry.recordedAt } : undefined),
    ...(entry.requestId !== undefined ? { requestId: entry.requestId } : undefined),
  };
}

function conversationRecordToWire(record: ConversationRecord): WireRecord {
  return {
    sessionKey: record.sessionKey,
    kind: record.kind,
    name: record.name,
    createdAt: record.createdAt,
    lastActivityAt: record.lastActivityAt,
    ...(record.archivedAt !== undefined ? { archivedAt: record.archivedAt } : undefined),
    ...(record.archiveReason !== undefined ? { archiveReason: record.archiveReason } : undefined),
    ...(record.pinnedAt !== undefined ? { pinnedAt: record.pinnedAt } : undefined),
    ...(record.sessionId !== undefined ? { sessionId: record.sessionId } : undefined),
    ...(record.temporary !== undefined ? { temporary: record.temporary } : undefined),
  };
}

function archiveRecordToWire(record: HistoryArchiveRecord): WireRecord {
  return {
    archiveId: record.archiveId,
    sessionKey: record.sessionKey,
    kind: record.kind,
    name: record.name,
    createdAt: record.createdAt,
    deletedAt: record.deletedAt,
    encoding: record.encoding,
    sha256: record.sha256,
    byteLength: record.byteLength,
    fileName: record.fileName,
    ...(record.publishedAt !== undefined ? { publishedAt: record.publishedAt } : undefined),
    historyLines: record.historyLines,
    transcriptEvents: record.transcriptEvents,
  };
}

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

function stringList(value: UnparsedWireValue): readonly string[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const list: string[] = [];
  for (const entry of value) {
    if (!isWireString(entry)) return undefined;
    list.push(entry);
  }
  return list;
}

export function createGatewayService(dependencies: GatewayServiceDependencies): GatewayService {
  const { brain, conversations, deliveries, receiver } = dependencies;
  const nodes = dependencies.nodes ?? new NodeRegistry();
  const askWaitMs = dependencies.askWaitMs ?? BRAIN_DEFAULTS.ASK_WAIT_MS;

  const claimContext = () => ({
    receiverCurrent: (epoch: number) => receiver.isReady() && receiver.epoch() === epoch,
    generationStands: (generationId: string) => brain.holdsGeneration(generationId),
    liveRecord: (runId: string) => brain.agentForRun(runId)?.request(runId),
  });

  const snapshot = (): WireValue => ({
    runs: brain.allRequests().map(requestRecordToWire),
    conversations: conversations.directory().entries.map(conversationRecordToWire),
    deliveries: deliveries.records().map((delivery) => ({ ...delivery })),
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

  const submit = async (
    params: WireRecord,
    steerRunId: string | undefined,
  ): Promise<GatewayMethodOutcome> => {
    const sessionKey = sessionKeyOrMain(params.sessionKey);
    if (!sessionKey) return invalid("sessionKey must be a non-empty string");
    if (!isIdentifier(params.submissionId) || !isWireString(params.question)) {
      return invalid("a submission needs a submissionId and a question");
    }
    if (!isBrainRequestOrigin(params.origin)) return invalid("origin is not one this build knows");
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
    const question = params.question.trim().slice(0, maximumTypedAskLength);
    const result = await agent.submitAsk({
      submissionId: params.submissionId,
      origin: params.origin,
      question,
    });
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
        archives: directory.archives.map(archiveRecordToWire),
      });
    },
    [GATEWAY_METHOD.CONVERSATION_CREATE]: async (params) => {
      if (params.temporary !== undefined && !isWireBoolean(params.temporary)) {
        return invalid("temporary must be a boolean");
      }
      const created = await conversations.createThread(params.temporary === true);
      return created
        ? gatewayOk({ sessionKey: created })
        : gatewayError(GATEWAY_ERROR.REFUSED, "the store did not create a thread");
    },
    [GATEWAY_METHOD.CONVERSATION_HISTORY]: (params) => {
      const sessionKey = sessionKeyOrMain(params.sessionKey);
      if (!sessionKey) return invalid("sessionKey must be a non-empty string");
      if (!conversations.holds(sessionKey)) {
        return gatewayError(GATEWAY_ERROR.NOT_FOUND, REFUSAL.NOT_LISTED);
      }
      return gatewayOk({ entries: conversations.history(sessionKey).map(conversationEntryToWire) });
    },
    [GATEWAY_METHOD.CONVERSATION_RESET]: async (params) => {
      const sessionKey = sessionKeyOrMain(params.sessionKey);
      if (!sessionKey) return invalid("sessionKey must be a non-empty string");
      return gatewayOk({ reset: await conversations.startFresh(sessionKey) });
    },
    [GATEWAY_METHOD.CONVERSATION_ARCHIVE]: async (params) => {
      const sessionKey = sessionKeyParam(params.sessionKey);
      if (!sessionKey) return invalid("sessionKey must be a non-empty string");
      return gatewayOk({ archived: await conversations.archive(sessionKey) });
    },
    [GATEWAY_METHOD.CONVERSATION_UNARCHIVE]: async (params) => {
      const sessionKey = sessionKeyParam(params.sessionKey);
      if (!sessionKey) return invalid("sessionKey must be a non-empty string");
      return gatewayOk({ unarchived: await conversations.unarchive(sessionKey) });
    },
    [GATEWAY_METHOD.CONVERSATION_DELETE]: async (params) => {
      const sessionKey = sessionKeyOrMain(params.sessionKey);
      if (!sessionKey) return invalid("sessionKey must be a non-empty string");
      return gatewayOk({ outcome: await conversations.deleteHistory(sessionKey) });
    },
    [GATEWAY_METHOD.CONVERSATION_RESTORE]: async (params) => {
      if (!isIdentifier(params.archiveId)) return invalid("archiveId must be a non-empty string");
      return gatewayOk({ outcome: await conversations.restoreArchive(params.archiveId) });
    },
    [GATEWAY_METHOD.RUN_SUBMIT]: (params) => submit(params, undefined),
    [GATEWAY_METHOD.RUN_STEER]: (params) => {
      if (!isIdentifier(params.runId)) return invalid("runId must be a non-empty string");
      return submit(params, params.runId);
    },
    [GATEWAY_METHOD.RUN_CANCEL]: async (params) => {
      if (!isIdentifier(params.runId)) return invalid("runId must be a non-empty string");
      const agent = brain.agentForRun(params.runId);
      if (!agent) return gatewayError(GATEWAY_ERROR.NOT_FOUND, REFUSAL.NO_RUN);
      const cancelled = await agent.cancelAsk(params.runId);
      return gatewayOk(cancelled ? { record: requestRecordToWire(cancelled) } : {});
    },
    // A wait that finds its run ended does not hand the words over on the
    // strength of the record alone: the followers' publication is let finish,
    // the live record is re-read for its History mark, and the grant to say
    // the words on the call is asked of the ledger — only when the caller
    // names the receiver epoch it holds, which only the voice window does.
    [GATEWAY_METHOD.RUN_WAIT]: async (params) => {
      if (!isIdentifier(params.runId)) return invalid("runId must be a non-empty string");
      if (params.speakerEpoch !== undefined && !isWireNumber(params.speakerEpoch)) {
        return invalid("speakerEpoch must be a number");
      }
      const runId = params.runId;
      const waited = await brain.agentForRun(runId)?.waitAsk(runId, askWaitMs);
      const answer = (wait: BrainAskWait): GatewayMethodOutcome =>
        gatewayOk({
          ...(wait.record ? { record: requestRecordToWire(wait.record) } : undefined),
          speak: wait.speak,
        });
      if (!waited || !isTerminalBrainRequestStatus(waited.status)) {
        return answer({ record: waited, speak: false });
      }
      await brain.publicationSettled();
      const live = brain.agentForRun(runId)?.request(runId) ?? waited;
      if (params.speakerEpoch === undefined || live.historyRecordedAt === undefined) {
        return answer({ record: live, speak: false });
      }
      const sessionKey = brain.conversationForRun(runId);
      const generationId = sessionKey === undefined ? undefined : brain.generationId(sessionKey);
      const granted =
        generationId !== undefined &&
        deliveries.grantOnCall(live, generationId, params.speakerEpoch, claimContext());
      // The grant took the run's offer out of the receiver's hand, and no
      // acknowledgement will come for a reply said on the call: the next owed
      // reply is offered now.
      if (granted) offerReplies();
      return answer({ record: live, speak: granted });
    },
    [GATEWAY_METHOD.RUN_STATUS]: (params) => {
      if (!isIdentifier(params.runId)) return invalid("runId must be a non-empty string");
      const record = brain.agentForRun(params.runId)?.request(params.runId);
      if (!record) return gatewayError(GATEWAY_ERROR.NOT_FOUND, REFUSAL.NO_RUN);
      return gatewayOk({
        record: requestRecordToWire(record),
        sessionKey: brain.conversationForRun(params.runId) ?? MAIN_SESSION_KEY,
      });
    },
    [GATEWAY_METHOD.RUN_LIST]: () =>
      gatewayOk({ runs: brain.allRequests().map(requestRecordToWire) }),
    [GATEWAY_METHOD.CHILD_LIST]: (params) => {
      const requester =
        params.sessionKey === undefined ? undefined : sessionKeyParam(params.sessionKey);
      if (params.sessionKey !== undefined && !requester) {
        return invalid("sessionKey must be a non-empty string");
      }
      const records = requester ? brain.children.childrenOf(requester) : brain.children.children();
      return gatewayOk({ children: records.map(childRecordToWire) });
    },
    [GATEWAY_METHOD.CHILD_STATUS]: (params) => {
      if (!isIdentifier(params.childId)) return invalid("childId must be a non-empty string");
      const record = brain.children.child(params.childId);
      if (!record) return gatewayError(GATEWAY_ERROR.NOT_FOUND, REFUSAL.NO_CHILD);
      const completion = brain.children.completion(params.childId);
      return gatewayOk({
        child: childRecordToWire(record),
        ...(completion ? { completion: completionToWire(completion) } : undefined),
      });
    },
    [GATEWAY_METHOD.CHILD_CANCEL]: async (params) => {
      if (!isIdentifier(params.childId)) return invalid("childId must be a non-empty string");
      if (!brain.children.child(params.childId)) {
        return gatewayError(GATEWAY_ERROR.NOT_FOUND, REFUSAL.NO_CHILD);
      }
      const cancelled = await brain.children.cancel(params.childId);
      return gatewayOk(
        cancelled.ok
          ? { cancelled: true }
          : { cancelled: false, remaining: [...cancelled.remaining] },
      );
    },
    [GATEWAY_METHOD.CHILD_COMPLETIONS]: () =>
      gatewayOk({ completions: brain.children.completions().map(completionToWire) }),
    [GATEWAY_METHOD.MEMORY_SEARCH]: async (params) => {
      if (!isWireString(params.query)) return invalid("query must be a string");
      if (params.maxResults !== undefined && !isWireNumber(params.maxResults)) {
        return invalid("maxResults must be a number");
      }
      return gatewayOk(
        await dependencies.memory.search(
          params.query,
          params.maxResults,
          new AbortController().signal,
        ),
      );
    },
    [GATEWAY_METHOD.MEMORY_GET]: async (params) => {
      if (!isWireString(params.path)) return invalid("path must be a string");
      if (params.from !== undefined && !isWireNumber(params.from))
        return invalid("from must be a number");
      if (params.lines !== undefined && !isWireNumber(params.lines)) {
        return invalid("lines must be a number");
      }
      return gatewayOk(await dependencies.memory.get(params.path, params.from, params.lines));
    },
    [GATEWAY_METHOD.MEMORY_FORGET]: async (params) => {
      const entryIds = stringList(params.entryIds);
      const sessionKeys = stringList(params.sessionKeys);
      const candidateKeys = stringList(params.candidateKeys);
      if (!entryIds || !sessionKeys || !candidateKeys || !isWireString(params.reason)) {
        return invalid("a forget names entry ids, session keys, or candidate keys, and a reason");
      }
      if (sessionKeys.some((key) => !isIdentifier(key))) {
        return invalid("sessionKeys must be non-empty strings");
      }
      const report = await dependencies.memory.forget({
        entryIds,
        sessionKeys: sessionKeys.map(toSessionKey),
        candidateKeys,
        reason: params.reason,
      });
      return report
        ? gatewayOk(forgetReportToWire(report))
        : gatewayError(GATEWAY_ERROR.REFUSED, "no notebook stands to forget from");
    },
    [GATEWAY_METHOD.MEMORY_STATUS]: () => gatewayOk(dependencies.memory.status()),
    [GATEWAY_METHOD.CONFIGURATION_SNAPSHOT]: () =>
      gatewayOk(configurationToWire(brain.configuration())),
    [GATEWAY_METHOD.CONFIGURATION_UPDATE]: (params) => {
      const patch: GatewayConfigurationPatch = {};
      if (params.reasoningEffort !== undefined) {
        if (!isWireString(params.reasoningEffort))
          return invalid("reasoningEffort must be a string");
        patch.reasoningEffort = params.reasoningEffort;
      }
      if (params.maximumOutputTokens !== undefined) {
        if (!isWireNumber(params.maximumOutputTokens)) {
          return invalid("maximumOutputTokens must be a number");
        }
        patch.maximumOutputTokens = params.maximumOutputTokens;
      }
      const refusals = brain.updateConfiguration(patch);
      if (refusals.length > 0) {
        return gatewayError(GATEWAY_ERROR.REFUSED, refusals.join(", "));
      }
      return gatewayOk(configurationToWire(brain.configuration()));
    },
    [GATEWAY_METHOD.OBSERVATION_STATE]: () =>
      gatewayOk({
        sessions: dependencies.observedSessions().map(sessionToWire),
        pendingNotices: brain.pendingNoticeCount(),
      }),
    [GATEWAY_METHOD.NODE_REGISTER]: (params, context) => {
      // A registration over the protocol names capabilities the host may ask
      // for; each is invoked back through the registering client's own
      // channel, which the in-process build wires directly.
      if (!isIdentifier(params.nodeId)) return invalid("nodeId must be a non-empty string");
      const capabilities = stringList(params.capabilities);
      if (!capabilities || capabilities.length === 0) {
        return invalid("capabilities must name at least one capability");
      }
      const nodeId = params.nodeId;
      const registered = nodes.list().find((node) => node.nodeId === nodeId);
      if (registered) {
        nodes.setConnected(nodeId, true);
        return gatewayOk({ nodeId, connected: true, clientId: context.client.clientId });
      }
      return gatewayError(
        GATEWAY_ERROR.REFUSED,
        "a node's capabilities are registered by the process that performs them",
      );
    },
    [GATEWAY_METHOD.NODE_UNREGISTER]: (params) => {
      if (!isIdentifier(params.nodeId)) return invalid("nodeId must be a non-empty string");
      return gatewayOk({ disconnected: nodes.setConnected(params.nodeId, false) });
    },
    [GATEWAY_METHOD.NODE_INVOKE]: async (params) => {
      if (!isWireString(params.capability)) return invalid("capability must be a string");
      const arguments_ = params.params === undefined ? {} : params.params;
      if (!isRecord(arguments_)) return invalid("params must be a record");
      const result = await nodes.invoke(params.capability, arguments_);
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
    },
    [GATEWAY_METHOD.DELIVERY_LIST]: () =>
      gatewayOk({
        deliveries: deliveries.records().map((delivery) => ({ ...delivery })),
        receiverEpoch: receiver.epoch(),
        receiverReady: receiver.isReady(),
      }),
    [GATEWAY_METHOD.DELIVERY_CLAIM]: (params) => {
      if (!isIdentifier(params.runId) || !isIdentifier(params.deliveryId)) {
        return invalid("a claim names a runId and a deliveryId");
      }
      if (!isWireNumber(params.epoch)) return invalid("epoch must be a number");
      const claim: BrainReplyClaimResult = deliveries.claim(
        params.runId,
        params.deliveryId,
        params.epoch,
        claimContext(),
      );
      return gatewayOk(
        claim.granted
          ? { granted: true, words: claim.words, origin: claim.origin }
          : { granted: false },
      );
    },
    [GATEWAY_METHOD.DELIVERY_ACKNOWLEDGE]: (params) => {
      if (!isIdentifier(params.runId) || !isIdentifier(params.deliveryId)) {
        return invalid("an acknowledgement names a runId and a deliveryId");
      }
      if (!isWireNumber(params.epoch)) return invalid("epoch must be a number");
      const emptied = deliveries.acknowledge(params.runId, params.deliveryId, params.epoch);
      if (emptied) offerReplies();
      return gatewayOk({ acknowledged: emptied });
    },
    [GATEWAY_METHOD.DELIVERY_GRANT_ON_CALL]: (params) => {
      if (!isIdentifier(params.runId)) return invalid("runId must be a non-empty string");
      if (!isWireNumber(params.epoch)) return invalid("epoch must be a number");
      const live = brain.agentForRun(params.runId)?.request(params.runId);
      const sessionKey = brain.conversationForRun(params.runId);
      const generationId = sessionKey === undefined ? undefined : brain.generationId(sessionKey);
      if (!live || generationId === undefined) {
        return gatewayError(GATEWAY_ERROR.NOT_FOUND, REFUSAL.NO_RUN);
      }
      const granted = deliveries.grantOnCall(live, generationId, params.epoch, claimContext());
      if (granted) offerReplies();
      return gatewayOk({ granted });
    },
  };

  const server = new GatewayServer({
    methods,
    configurationRevision: () => brain.configuration().revision,
    sessionRevision: (key) => {
      const sessionKey = sessionKeyParam(key);
      return sessionKey ? brain.generationId(sessionKey) : undefined;
    },
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
    claimContext,
    runsReported: (snapshots) => {
      deliveries.observe(snapshots);
      server.emit(GATEWAY_EVENT.RUNS_CHANGED, { runs: snapshots.map(requestRecordToWire) });
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
