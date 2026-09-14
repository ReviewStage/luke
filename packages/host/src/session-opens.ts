import { ACTION_REFUSAL } from "@sidecar/actions";
import { PRODUCT_EVENT, PRODUCT_SESSION_ACTION, type RecordProductEvent } from "@sidecar/analytics";
import {
  ExternalOpenAnswerLostError,
  isProviderId,
  type SessionApplicationId,
  type SessionIdentity,
  type SessionOpenResult,
  type SessionRoster,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS, UNKNOWN_ACTION_STATUS } from "@sidecar/wire";
import { Effect } from "effect";

/**
 * An open that was handed to the native node and whose answer was lost with
 * the node's connection: the system may have opened the address. Thrown by
 * the open port so the action that asked records itself unknown, never failed
 * and never retried.
 */
export { ExternalOpenAnswerLostError as NodeAnswerLostError };

/** What an open answers when its answer was lost: the effect is uncertain. */
function unknownOpen(error: ExternalOpenAnswerLostError): SessionOpenResult {
  return { status: UNKNOWN_ACTION_STATUS, reason: error.message };
}

/**
 * What opening a session needs from the app: the roster an open reads its
 * address from, the door to the operating system, and the count a landed
 * open earns.
 */
export interface SessionOpensDependencies {
  sessionRegistry: Pick<SessionRoster, "get">;
  /**
   * Hands an address to the operating system through the native node. A
   * row's press has already stood its panel down, so the client's windows
   * are owed nothing more.
   */
  openExternal: (url: string) => Promise<void>;
  recordProductEvent: RecordProductEvent;
}

/**
 * The opens a session row's press reaches: the chat itself, the chat in one
 * of the apps its provider lists, and the change beside it. Each reads its
 * address off the roster as the service relayed it from the provider's own
 * pass, and hands it to the system through the native node. The writes a
 * row makes — a follow-up, a control — are `session-row-actions.ts`'s, admitted
 * there against the roster the row was drawn from; the brain's own session
 * actions, which this module carried as `SessionActionPerformer`, went with
 * the local brain (LUKE-206).
 */
export interface SessionOpens {
  openSession(identity: SessionIdentity): Effect.Effect<SessionOpenResult>;
  openSessionApplication(
    identity: SessionIdentity,
    applicationId: SessionApplicationId,
  ): Effect.Effect<SessionOpenResult>;
  openSessionChange(identity: SessionIdentity): Effect.Effect<SessionOpenResult>;
}

/** What an open answers when the system refused it: the words a row press hears. */
export const OPEN_REFUSAL = {
  SESSION: "The system could not open that session.",
  APPLICATION: "The system could not open that session in the selected app.",
  CHANGE: "The system could not open that pull request.",
} as const;

const REFUSAL = {
  // The sentences `admit` already says for these. The performer refuses the
  // same things at the last boundary before an effect, and a refusal worded
  // twice is a refusal that drifts.
  NO_SESSION: ACTION_REFUSAL.NO_SESSION,
  NO_ADDRESS: ACTION_REFUSAL.NO_ADDRESS,
  NO_APP_ADDRESS: "That session has no address to open in that app.",
  NO_CHANGE: "That session reports no pull request.",
  OPEN_FAILED: OPEN_REFUSAL.SESSION,
  OPEN_APP_FAILED: OPEN_REFUSAL.APPLICATION,
  OPEN_CHANGE_FAILED: OPEN_REFUSAL.CHANGE,
} as const;

export function createSessionOpens(dependencies: SessionOpensDependencies): SessionOpens {
  const { sessionRegistry, openExternal, recordProductEvent } = dependencies;

  const countOpen = (identity: SessionIdentity) => {
    if (isProviderId(identity.providerId)) {
      recordProductEvent(PRODUCT_EVENT.SESSION_ACTION_SEND, {
        provider_id: identity.providerId,
        session_action: PRODUCT_SESSION_ACTION.SESSION_OPEN,
      });
    }
  };

  /**
   * Hands one address to the system through the native node: the one answer
   * both opens read of it, and the count a landed open earns. Uninterruptible
   * for the same reason a write is — an open already handed to the node is
   * awaited for its answer, so the open that landed is the one counted.
   */
  const openThroughNode = (
    identity: SessionIdentity,
    url: string,
    failureReason: string,
  ): Effect.Effect<SessionOpenResult> =>
    Effect.tryPromise({ try: () => openExternal(url), catch: (error) => error }).pipe(
      Effect.as<SessionOpenResult>({ status: ACTION_RESULT_STATUS.ACCEPTED }),
      Effect.tap(() => Effect.sync(() => countOpen(identity))),
      Effect.catch((error) =>
        Effect.succeed<SessionOpenResult>(
          error instanceof ExternalOpenAnswerLostError
            ? unknownOpen(error)
            : { status: ACTION_RESULT_STATUS.REJECTED, reason: failureReason },
        ),
      ),
      Effect.uninterruptible,
    );

  const openAddress = (
    identity: SessionIdentity,
    address: (identity: SessionIdentity) => string | undefined,
    // A session that left the roster and one still standing with nowhere to
    // go are different answers, and only the second says what to try instead.
    absentAddressReason: string,
    failureReason: string,
  ): Effect.Effect<SessionOpenResult> =>
    Effect.suspend(() => {
      const observed = sessionRegistry.get(identity) !== undefined;
      const url = observed ? address(identity) : undefined;
      if (!url) {
        return Effect.succeed<SessionOpenResult>({
          status: ACTION_RESULT_STATUS.UNSUPPORTED,
          reason: observed ? absentAddressReason : REFUSAL.NO_SESSION,
        });
      }
      return openThroughNode(identity, url, failureReason);
    });

  // What a press fires is the address the roster reported, as the service
  // relayed it from the provider's own pass.
  const openSession = (identity: SessionIdentity) =>
    openAddress(
      identity,
      (target) => sessionRegistry.get(target)?.detail.link,
      REFUSAL.NO_ADDRESS,
      REFUSAL.OPEN_FAILED,
    );

  const openSessionApplication = (
    identity: SessionIdentity,
    applicationId: SessionApplicationId,
  ): Effect.Effect<SessionOpenResult> =>
    Effect.suspend(() => {
      const session = sessionRegistry.get(identity);
      if (!session) {
        return Effect.succeed<SessionOpenResult>({
          status: ACTION_RESULT_STATUS.UNSUPPORTED,
          reason: REFUSAL.NO_SESSION,
        });
      }
      const application = session.applications.find((candidate) => candidate.id === applicationId);
      if (!application) {
        // The display names travel with the roster the caller already read,
        // so naming what still opens surfaces nothing the roster withheld.
        const openable = session.applications.filter((candidate) => candidate.link);
        return Effect.succeed<SessionOpenResult>({
          status: ACTION_RESULT_STATUS.UNSUPPORTED,
          reason: openable.length
            ? `That session opens only in ${openable.map((candidate) => candidate.displayName).join(", ")}.`
            : "That session lists no app to open in.",
        });
      }
      const url = application.link;
      if (!url) {
        return Effect.succeed<SessionOpenResult>({
          status: ACTION_RESULT_STATUS.UNSUPPORTED,
          reason: REFUSAL.NO_APP_ADDRESS,
        });
      }
      return openThroughNode(identity, url, REFUSAL.OPEN_APP_FAILED);
    });

  // The change is a web page beside the chat, not the chat itself: its row
  // press leaves the panel up.
  const openSessionChange = (identity: SessionIdentity) =>
    openAddress(
      identity,
      (target) => sessionRegistry.get(target)?.detail.change,
      REFUSAL.NO_CHANGE,
      REFUSAL.OPEN_CHANGE_FAILED,
    );

  return { openSession, openSessionApplication, openSessionChange };
}
