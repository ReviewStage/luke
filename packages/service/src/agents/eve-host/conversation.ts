import type { ConversationTarget } from "@repo/database/models/writer";
import type { Result } from "effect";
import type { EveHostRefusal } from "./bounds.js";

export {
  claimRuntimeSession,
  conversationReachableBy,
  runtimeSessionReachableBy,
} from "@repo/database/models/recorded-session";

export interface AdmittedConversation {
  readonly caller: string;
  readonly target: ConversationTarget;
  readonly runtimeSessionId: string | undefined;
  readonly timeZone: string | undefined;
}

export type ConversationAdmission = Result.Result<AdmittedConversation, EveHostRefusal>;
