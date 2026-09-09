import type {
  BrainAskSubmission,
  BrainAskSubmissionResult,
  BrainAskWait,
  BrainReplyClaimResult,
} from "@sidecar/brain/requests-wire";
import type { SpeechOutcome } from "@sidecar/realtime/speech";
import type { ConversationEntry } from "@sidecar/session";
import type { VoiceExchangeOpening, VoiceViewReport } from "./voice-view-reporter.js";

/** Everything the voice policy asks of the process that hosts it. */
export interface VoiceBridge {
  reportView(view: VoiceViewReport, exchange: VoiceExchangeOpening | undefined): void;
  reportReady(epoch: number): void;
  /** Persists appended lines with the store that owns the thread; answers whether it took them. */
  appendConversation(entries: readonly ConversationEntry[]): Promise<boolean>;
  settleSpeech(id: string, outcome: SpeechOutcome): void;
  submitBrainAsk(submission: BrainAskSubmission): Promise<BrainAskSubmissionResult>;
  waitBrainAsk(runId: string, epoch: number): Promise<BrainAskWait>;
  claimBrainReply(runId: string, deliveryId: string, epoch: number): Promise<BrainReplyClaimResult>;
  ackBrainReply(runId: string, deliveryId: string, epoch: number): void;
  /** Asks the system for the microphone, answering whether it is granted. */
  requestMicrophone(): Promise<boolean>;
  /** The neutral note said when the hosted service's emergency brake refuses a call. */
  hostedUnavailableNote(): Promise<string | undefined>;
}
