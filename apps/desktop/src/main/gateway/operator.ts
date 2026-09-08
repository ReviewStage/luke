import {
  BRAIN_SUBMISSION_OUTCOME,
  BRAIN_SUBMISSION_REJECTION,
  type BrainRequestRecord,
  brainRequestRecordFromWire,
  isBrainRequestOrigin,
} from "@sidecar/brain/requests";
import { type ConversationEntry, isConversationEntryKind } from "@sidecar/realtime";
import {
  type GatewayCallResult,
  GatewayClient,
  type GatewayClientOptions,
  type GatewayTransport,
} from "@sidecar/runtime";
import {
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayEvent,
  MAIN_SESSION_KEY,
  type SessionKey,
} from "@sidecar/runtime-contracts";
import { isRecord, isWireBoolean, isWireNumber, isWireString, type WireValue } from "@sidecar/wire";
import {
  type BrainAskSubmission,
  type BrainAskSubmissionResult,
  type BrainAskWait,
  type BrainReplyClaimResult,
  type BrainReplyOffer,
  type BrainRequestSnapshot,
  isBrainAskSubmissionResult,
  isBrainReplyOffer,
} from "#shared/wire/brain";
import { CONVERSATION_DELETE_OUTCOME } from "../brain/conversation-deletion";

/**
 * The desktop's operator client: what the windows' IPC and the main
 * process's own surfaces reach the host through. Each method is one protocol
 * call, its parameters composed here and its answer parsed with the same
 * readers the bridge trusts, so a shape the host answered that this build
 * cannot read is a refusal rather than a guess. Nothing here holds brain
 * state; the host does.
 */
export interface GatewayOperator {
  submit: (
    submission: BrainAskSubmission,
    sessionKey?: SessionKey,
  ) => Promise<BrainAskSubmissionResult>;
  /** Waits on one run; `speakerEpoch` is the receiver epoch the asking call holds, given only by the voice window. */
  wait: (runId: string, speakerEpoch: number | undefined) => Promise<BrainAskWait>;
  cancel: (runId: string) => Promise<BrainRequestSnapshot | undefined>;
  runs: () => Promise<readonly BrainRequestSnapshot[]>;
  claim: (runId: string, deliveryId: string, epoch: number) => Promise<BrainReplyClaimResult>;
  acknowledge: (runId: string, deliveryId: string, epoch: number) => Promise<boolean>;
  /** Delete history on a conversation: answers whether the erasure completed or was interrupted, false only when refused. */
  deleteHistory: (sessionKey?: SessionKey) => Promise<boolean>;
  onRunsChanged: (listener: (runs: readonly BrainRequestSnapshot[]) => void) => () => void;
  onDeliveryOffered: (listener: (offer: BrainReplyOffer) => void) => () => void;
  onDeliveriesWithdrawn: (listener: (epoch: number) => void) => () => void;
  onHistoryChanged: (listener: (change: GatewayHistoryChange) => void) => () => void;
  /** The underlying client, for the calls the typed surface above does not name. */
  readonly client: GatewayClient;
}

export interface GatewayHistoryChange {
  sessionKey: string;
  entries: readonly WireValue[];
  cleared: boolean;
  /** The window whose report produced the change, by its contents id, so the relay can skip echoing it. */
  reporter?: number;
}

/** One History line as the host's event carried it, or nothing for a shape this build cannot draw. */
export function conversationEntryFromWire(value: WireValue): ConversationEntry | undefined {
  if (!isRecord(value) || !isConversationEntryKind(value.kind) || !isWireString(value.words)) {
    return undefined;
  }
  const identity = value.identity;
  if (
    identity !== undefined &&
    !(
      isRecord(identity) &&
      isWireString(identity.providerId) &&
      isWireString(identity.providerSessionId)
    )
  ) {
    return undefined;
  }
  return {
    kind: value.kind,
    words: value.words,
    ...(isWireString(value.eventId) ? { eventId: value.eventId } : undefined),
    ...(isRecord(identity) &&
    isWireString(identity.providerId) &&
    isWireString(identity.providerSessionId)
      ? {
          identity: {
            providerId: identity.providerId,
            providerSessionId: identity.providerSessionId,
          },
        }
      : undefined),
    ...(isWireNumber(value.recordedAt) ? { recordedAt: value.recordedAt } : undefined),
    ...(isWireString(value.requestId) ? { requestId: value.requestId } : undefined),
  };
}

const REJECTED_ABSENT: BrainAskSubmissionResult = {
  outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED,
  reason: BRAIN_SUBMISSION_REJECTION.ABSENT,
};

function runsFromWire(value: WireValue | undefined): readonly BrainRequestSnapshot[] {
  if (!isRecord(value) || !Array.isArray(value.runs)) return [];
  const runs: BrainRequestRecord[] = [];
  for (const entry of value.runs) {
    const record = brainRequestRecordFromWire(entry);
    if (record) runs.push(record);
  }
  return runs;
}

function submissionResultFromWire(result: GatewayCallResult): BrainAskSubmissionResult {
  if (!result.ok || !isRecord(result.result) || !isBrainAskSubmissionResult(result.result)) {
    return REJECTED_ABSENT;
  }
  const value = result.result;
  if (value.outcome === BRAIN_SUBMISSION_OUTCOME.ACCEPTED) {
    if (!isWireString(value.runId) || !isWireNumber(value.acceptedAt)) return REJECTED_ABSENT;
    return { outcome: value.outcome, runId: value.runId, acceptedAt: value.acceptedAt };
  }
  const reason = Object.values(BRAIN_SUBMISSION_REJECTION).find((held) => held === value.reason);
  return reason ? { outcome: BRAIN_SUBMISSION_OUTCOME.REJECTED, reason } : REJECTED_ABSENT;
}

function claimFromWire(result: GatewayCallResult): BrainReplyClaimResult {
  if (!result.ok || !isRecord(result.result) || result.result.granted !== true) {
    return { granted: false };
  }
  const { words, origin } = result.result;
  if (!isWireString(words) || !isBrainRequestOrigin(origin)) return { granted: false };
  return { granted: true, words, origin };
}

export interface GatewayOperatorOptions extends Omit<GatewayClientOptions, "transport"> {
  transport: GatewayTransport;
}

export function createGatewayOperator(options: GatewayOperatorOptions): GatewayOperator {
  const client = new GatewayClient(options);
  const on = <Payload>(
    kind: GatewayEvent["kind"],
    read: (payload: WireValue) => Payload | undefined,
    listener: (payload: Payload) => void,
  ) =>
    client.on(kind, (event) => {
      const payload = read(event.payload);
      if (payload !== undefined) listener(payload);
    });
  return {
    client,
    submit: async (submission, sessionKey = MAIN_SESSION_KEY) =>
      submissionResultFromWire(
        await client.call(
          GATEWAY_METHOD.RUN_SUBMIT,
          {
            sessionKey,
            submissionId: submission.submissionId,
            question: submission.question,
            origin: submission.origin,
          },
          // The submission id is the caller's own retry identifier, so a
          // transport retry and a renderer retry meet the same answer.
          { idempotencyKey: submission.submissionId },
        ),
      ),
    wait: async (runId, speakerEpoch) => {
      const result = await client.call(GATEWAY_METHOD.RUN_WAIT, {
        runId,
        ...(speakerEpoch !== undefined ? { speakerEpoch } : undefined),
      });
      if (!result.ok || !isRecord(result.result)) return { record: undefined, speak: false };
      const record = brainRequestRecordFromWire(result.result.record);
      return { record, speak: record !== undefined && result.result.speak === true };
    },
    cancel: async (runId) => {
      const result = await client.call(GATEWAY_METHOD.RUN_CANCEL, { runId });
      if (!result.ok || !isRecord(result.result)) return undefined;
      return brainRequestRecordFromWire(result.result.record);
    },
    runs: async () => {
      const result = await client.call(GATEWAY_METHOD.RUN_LIST);
      return result.ok ? runsFromWire(result.result) : [];
    },
    claim: async (runId, deliveryId, epoch) =>
      claimFromWire(await client.call(GATEWAY_METHOD.DELIVERY_CLAIM, { runId, deliveryId, epoch })),
    acknowledge: async (runId, deliveryId, epoch) => {
      const result = await client.call(GATEWAY_METHOD.DELIVERY_ACKNOWLEDGE, {
        runId,
        deliveryId,
        epoch,
      });
      return result.ok && isRecord(result.result) && result.result.acknowledged === true;
    },
    deleteHistory: async (sessionKey = MAIN_SESSION_KEY) => {
      const result = await client.call(GATEWAY_METHOD.CONVERSATION_DELETE, { sessionKey });
      if (!result.ok || !isRecord(result.result)) return false;
      return (
        result.result.outcome === CONVERSATION_DELETE_OUTCOME.COMPLETE ||
        result.result.outcome === CONVERSATION_DELETE_OUTCOME.INCOMPLETE
      );
    },
    onRunsChanged: (listener) =>
      on(GATEWAY_EVENT.RUNS_CHANGED, (payload) => runsFromWire(payload), listener),
    onDeliveryOffered: (listener) =>
      on(
        GATEWAY_EVENT.DELIVERY_OFFERED,
        (payload) => (isBrainReplyOffer(payload) ? payload : undefined),
        (offer) =>
          listener({ runId: offer.runId, deliveryId: offer.deliveryId, epoch: offer.epoch }),
      ),
    onDeliveriesWithdrawn: (listener) =>
      on(
        GATEWAY_EVENT.DELIVERIES_WITHDRAWN,
        (payload) => (isRecord(payload) && isWireNumber(payload.epoch) ? payload.epoch : undefined),
        listener,
      ),
    onHistoryChanged: (listener) =>
      on(
        GATEWAY_EVENT.HISTORY_CHANGED,
        (payload): GatewayHistoryChange | undefined => {
          if (!isRecord(payload) || !isWireString(payload.sessionKey)) return undefined;
          if (!Array.isArray(payload.entries) || !isWireBoolean(payload.cleared)) return undefined;
          return {
            sessionKey: payload.sessionKey,
            entries: payload.entries,
            cleared: payload.cleared,
            ...(isWireNumber(payload.reporter) ? { reporter: payload.reporter } : undefined),
          };
        },
        listener,
      ),
  };
}
