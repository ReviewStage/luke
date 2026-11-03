import type { ConversationTarget } from "@repo/database/models/writer";
import type { Result } from "effect";
import type { EveHostRefusal } from "./bounds.js";

export {
  claimRuntimeSession,
  conversationReachableBy,
  runtimeSessionReachableBy,
} from "@repo/database/models/recorded-session";

/**
 * The conversation an agent's call was admitted to (`../workspace-mcp/bearer.ts`
 * admits a runner's bearer to its own): the account it acts for, which
 * gates every read, is metered, and binds the tools, and the conversation's
 * owner, the opener, whose id addresses its rows.
 */
export interface AdmittedConversation {
  /** The account the current request acts for: it reads, pays, and acts through the tools. */
  readonly caller: string;
  /** The conversation as the store addresses it, under the account that opened it. */
  readonly target: ConversationTarget;
  /** The session id the conversation row last recorded, where one has been. */
  readonly runtimeSessionId: string | undefined;
  /** The time zone the current request named, which the turn reads the developer's day in; none reads UTC. */
  readonly timeZone: string | undefined;
}

/** The conversation the session was admitted to, or the one word for why it was not. */
export type ConversationAdmission = Result.Result<AdmittedConversation, EveHostRefusal>;
