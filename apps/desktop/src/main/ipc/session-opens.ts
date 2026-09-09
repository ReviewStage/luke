import { OPEN_REFUSAL, type SessionActionPerformer } from "@sidecar/host";
import type { SessionOpenResult } from "@sidecar/session";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { ACT_KIND } from "#shared/messages/acts";
import type { ActRows } from "../act-router";

export interface SessionOpensDependencies {
  /** The opens alone: a press is not a write, and the writes reach the performer only through the brain in the host. */
  performer: Pick<
    SessionActionPerformer,
    "openSession" | "openSessionApplication" | "openSessionChange"
  >;
}

type SessionOpenKind =
  | typeof ACT_KIND.SESSION_OPEN
  | typeof ACT_KIND.SESSION_OPEN_APPLICATION
  | typeof ACT_KIND.SESSION_OPEN_CHANGE;

/**
 * The presses that need no brain: a row, an app mark, and the pull-request
 * chip each hand an address the roster reported to the system. Opening is not
 * a write, so nothing here is admitted as one. A system that could not open
 * the address is an answer of the act's own kind rather than a refusal, so the
 * row draws the sentence its provider's own performer would have.
 */
export function sessionOpenRows(
  dependencies: SessionOpensDependencies,
): Pick<ActRows, SessionOpenKind> {
  const { performer } = dependencies;
  const opened = async (
    open: () => Promise<SessionOpenResult>,
    refusal: string,
  ): Promise<SessionOpenResult> => {
    try {
      return await open();
    } catch {
      return { status: ACTION_RESULT_STATUS.REJECTED, reason: refusal };
    }
  };
  return {
    [ACT_KIND.SESSION_OPEN]: ({ identity }) =>
      opened(() => performer.openSession(identity), OPEN_REFUSAL.SESSION),
    [ACT_KIND.SESSION_OPEN_APPLICATION]: ({ identity, applicationId }) =>
      opened(
        () => performer.openSessionApplication(identity, applicationId),
        OPEN_REFUSAL.APPLICATION,
      ),
    [ACT_KIND.SESSION_OPEN_CHANGE]: ({ identity }) =>
      opened(() => performer.openSessionChange(identity), OPEN_REFUSAL.CHANGE),
  };
}
