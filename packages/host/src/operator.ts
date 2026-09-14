import { brainRequestRecordFromWire } from "@sidecar/brain/requests";
import {
  type BrainAskSubmission,
  type BrainAskSubmissionResult,
  type BrainAskWait,
  type BrainRequestSnapshot,
  isBrainAskSubmissionResult,
} from "@sidecar/brain/requests-wire";
import type { GatewayCallResult, GatewayClient } from "@sidecar/gateway";
import { GATEWAY_METHOD } from "@sidecar/gateway";
import { MAIN_SESSION_KEY, type SessionKey } from "@sidecar/runtime/vocabulary";
import { isRecord, type WireValue } from "@sidecar/wire";
import { Effect } from "effect";
import { CONVERSATION_DELETE_OUTCOME } from "./brain/conversation-deletion.js";
import { REJECTED_SUBMISSION } from "./brain/publication.js";

/**
 * The host's operator client: what a client's own surfaces — the windows'
 * IPC, and the main process itself — reach the host through. Each method is one
 * protocol call as an effect its caller runs, its parameters composed here and
 * its answer parsed with the same readers the bridge trusts, so a shape the
 * host answered that this build cannot read is a refusal rather than a guess.
 * Nothing here holds brain state; the host does.
 */
export interface GatewayOperator {
  submit: (
    submission: BrainAskSubmission,
    sessionKey?: SessionKey,
  ) => Effect.Effect<BrainAskSubmissionResult>;
  wait: (runId: string) => Effect.Effect<BrainAskWait>;
  cancel: (runId: string) => Effect.Effect<BrainRequestSnapshot | undefined>;
  runs: () => Effect.Effect<readonly BrainRequestSnapshot[]>;
  /** Delete conversation on a conversation: answers whether the erasure completed or was interrupted, false only when refused. */
  deleteConversation: (sessionKey?: SessionKey) => Effect.Effect<boolean>;
  /** The underlying client, for the calls the typed surface above does not name. */
  readonly client: GatewayClient;
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
  return {
    client,
    submit: (submission, sessionKey = MAIN_SESSION_KEY) =>
      Effect.map(
        client.call(
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
        submissionResultFromWire,
      ),
    wait: (runId) =>
      Effect.map(client.call(GATEWAY_METHOD.RUN_WAIT, { runId }), (result) => {
        if (!result.ok || !isRecord(result.result)) return { record: undefined, speak: false };
        const record = brainRequestRecordFromWire(result.result.record);
        return { record, speak: record !== undefined && result.result.speak === true };
      }),
    cancel: (runId) =>
      Effect.map(client.call(GATEWAY_METHOD.RUN_CANCEL, { runId }), (result) =>
        result.ok && isRecord(result.result)
          ? brainRequestRecordFromWire(result.result.record)
          : undefined,
      ),
    runs: () =>
      Effect.map(client.call(GATEWAY_METHOD.RUN_LIST), (result) =>
        result.ok ? runsFromWire(result.result) : [],
      ),
    deleteConversation: (sessionKey = MAIN_SESSION_KEY) =>
      Effect.map(
        client.call(GATEWAY_METHOD.CONVERSATION_DELETE, { sessionKey }),
        (result) =>
          result.ok &&
          isRecord(result.result) &&
          result.result.outcome === CONVERSATION_DELETE_OUTCOME.COMPLETE,
      ),
  };
}
