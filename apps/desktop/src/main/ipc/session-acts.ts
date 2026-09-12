import { OPEN_REFUSAL } from "@sidecar/host";
import type {
  SessionApplicationId,
  SessionIdentity,
  SessionOpenResult,
  SessionWriteResult,
} from "@sidecar/session";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { ACT_KIND } from "#shared/messages/acts";
import { ActRefused, type ActRows, type ActSender } from "../act-router";

/**
 * The host's own session acts as this process reaches them: through the
 * Gateway client, which answers promises, and never the host's in-process
 * performer, whose acts are effects on the fiber that carries them.
 */
export interface SessionActsDependencies {
  /** The opens alone: a press is not a write, and reaches the roster's address without admission. */
  performer: {
    openSession(identity: SessionIdentity): Promise<SessionOpenResult>;
    openSessionApplication(
      identity: SessionIdentity,
      applicationId: SessionApplicationId,
    ): Promise<SessionOpenResult>;
    openSessionChange(identity: SessionIdentity): Promise<SessionOpenResult>;
  };
  /**
   * The two writes a row asks for, carried to the host, whose `admitEffect()`
   * decides each against the roster it reads for itself; nothing here decides
   * whether a session takes them.
   */
  writes: {
    sendMessage(identity: SessionIdentity, text: string): Promise<SessionWriteResult>;
    executeControl(identity: SessionIdentity, controlId: string): Promise<SessionWriteResult>;
  };
}

type SessionActKind =
  | typeof ACT_KIND.SESSION_OPEN
  | typeof ACT_KIND.SESSION_OPEN_APPLICATION
  | typeof ACT_KIND.SESSION_OPEN_CHANGE
  | typeof ACT_KIND.SESSION_SEND_MESSAGE
  | typeof ACT_KIND.SESSION_EXECUTE_CONTROL;

/** The one refusal this process adds of its own: a row is the panel's, and only a panel draws one. */
export const ROW_WRITE_REFUSAL = "Only a session row on the panel can send that.";

/**
 * The presses a session row makes. Three need no brain and no admission: a
 * row, an app mark, and the pull-request chip each hand an address the roster
 * reported to the system, and opening is not a write. The other two are the
 * row's writes — the follow-up typed into its composer and a control its
 * provider advertised — and the one check this process makes of them is who
 * asked: a row exists only on a panel, so the hidden voice window and the
 * introduction's takeover, which draw no row, are refused before the host is
 * reached. Everything else about a write — whether the session is observed,
 * whether it takes the write, what reaches the provider — is the host's
 * admission to decide, and its refusal comes back as the row's own answer.
 */
export function sessionActRows(
  dependencies: SessionActsDependencies,
): Pick<ActRows, SessionActKind> {
  const { performer, writes } = dependencies;
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
  const fromRow = (sender: ActSender): void => {
    if (!sender.panel || sender.introduction) throw new ActRefused(ROW_WRITE_REFUSAL);
  };
  const written = async (
    write: () => Promise<SessionWriteResult>,
    refusal: string,
  ): Promise<SessionWriteResult> => {
    try {
      return await write();
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
    [ACT_KIND.SESSION_SEND_MESSAGE]: ({ identity, text }, sender) => {
      fromRow(sender);
      return written(() => writes.sendMessage(identity, text), WRITE_REFUSAL.MESSAGE);
    },
    [ACT_KIND.SESSION_EXECUTE_CONTROL]: ({ identity, controlId }, sender) => {
      fromRow(sender);
      return written(() => writes.executeControl(identity, controlId), WRITE_REFUSAL.CONTROL);
    },
  };
}

/** What a write answers when the host could not be asked at all: the words the row draws. */
export const WRITE_REFUSAL = {
  MESSAGE: "That message could not be sent.",
  CONTROL: "That control could not be run.",
} as const;
