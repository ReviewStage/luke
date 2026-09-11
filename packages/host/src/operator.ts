import { brainRequestRecordFromWire } from "@sidecar/brain/requests";
import {
  type BrainAskSubmission,
  type BrainAskSubmissionResult,
  type BrainAskWait,
  type BrainRequestSnapshot,
  isBrainAskSubmissionResult,
} from "@sidecar/brain/requests-wire";
import type { GatewayCallResult, GatewayClient } from "@sidecar/gateway";
import { GATEWAY_EVENT, GATEWAY_METHOD, gatewayEventReader } from "@sidecar/gateway";
import { MAIN_SESSION_KEY, type SessionKey } from "@sidecar/runtime/vocabulary";
import { isRecord, isWireBoolean, isWireString, type WireValue } from "@sidecar/wire";
import { CONVERSATION_DELETE_OUTCOME } from "./brain/conversation-deletion.js";
import { REJECTED_SUBMISSION } from "./brain/publication.js";

/**
 * The host's operator client: what a client's own surfaces — the windows'
 * IPC, and the main process itself — reach the host through. Each method is one protocol
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
  wait: (runId: string) => Promise<BrainAskWait>;
  cancel: (runId: string) => Promise<BrainRequestSnapshot | undefined>;
  runs: () => Promise<readonly BrainRequestSnapshot[]>;
  /** Delete conversation on a conversation: answers whether the erasure completed or was interrupted, false only when refused. */
  deleteConversation: (sessionKey?: SessionKey) => Promise<boolean>;
  onRunsChanged: (listener: (runs: readonly BrainRequestSnapshot[]) => void) => () => void;
  onConversationChanged: (listener: (change: GatewayConversationChange) => void) => () => void;
  /** The underlying client, for the calls the typed surface above does not name. */
  readonly client: GatewayClient;
}

interface GatewayConversationChange {
  sessionKey: string;
  entries: readonly WireValue[];
  cleared: boolean;
  /** The opaque reporter whose report produced the change, minted by this client for one window, so the relay can skip echoing it. */
  reporter?: string;
}

function runsFromWire(value: WireValue | undefined): readonly BrainRequestSnapshot[] {
  if (!isRecord(value) || !Array.isArray(value.runs)) return [];
  return value.runs.flatMap((entry) => brainRequestRecordFromWire(entry) ?? []);
}

function submissionResultFromWire(result: GatewayCallResult): BrainAskSubmissionResult {
  return result.ok && isBrainAskSubmissionResult(result.result)
    ? result.result
    : REJECTED_SUBMISSION;
}

/** The operator is one typed surface over a client a caller shares with its host operator; the client is made once. */
export interface GatewayOperatorOptions {
  client: GatewayClient;
}

export function createGatewayOperator(options: GatewayOperatorOptions): GatewayOperator {
  const { client } = options;
  const on = gatewayEventReader(client);
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
    wait: async (runId) => {
      const result = await client.call(GATEWAY_METHOD.RUN_WAIT, { runId });
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
    deleteConversation: async (sessionKey = MAIN_SESSION_KEY) => {
      const result = await client.call(GATEWAY_METHOD.CONVERSATION_DELETE, { sessionKey });
      if (!result.ok || !isRecord(result.result)) return false;
      return (
        result.result.outcome === CONVERSATION_DELETE_OUTCOME.COMPLETE ||
        result.result.outcome === CONVERSATION_DELETE_OUTCOME.INCOMPLETE
      );
    },
    onRunsChanged: (listener) =>
      on(GATEWAY_EVENT.RUNS_CHANGED, (payload) => runsFromWire(payload), listener),
    onConversationChanged: (listener) =>
      on(
        GATEWAY_EVENT.CONVERSATION_CHANGED,
        (payload): GatewayConversationChange | undefined => {
          if (!isRecord(payload) || !isWireString(payload.sessionKey)) return undefined;
          if (!Array.isArray(payload.entries) || !isWireBoolean(payload.cleared)) return undefined;
          return {
            sessionKey: payload.sessionKey,
            entries: payload.entries,
            cleared: payload.cleared,
            ...(isWireString(payload.reporter) ? { reporter: payload.reporter } : undefined),
          };
        },
        listener,
      ),
  };
}
