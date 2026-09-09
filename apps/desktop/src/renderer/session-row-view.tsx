import { SessionRow as PanelSessionRow, ProviderMark } from "@sidecar/panel";
import {
  isSessionApplicationId,
  SESSION_APPLICATION_SCOPE,
  SESSION_LOCATION,
  SESSION_URGENCY,
  type SessionApplicationId,
} from "@sidecar/session";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { useCallback, useState } from "react";
import type { SessionOpenResult } from "#shared/messages/session";
import {
  lastActivityLabel,
  type SessionListRun,
  type SessionView,
  type WorkspaceTrayChange,
} from "./session-model";
import { LEAVING_ATTRIBUTE, SESSION_ROW_ID_ATTRIBUTE } from "./session-motion";
import { Highlighted } from "./session-search";

/**
 * Handed up rather than performed here: the row knows sessions, not IPC. The
 * panel is read-only — a message or a control for a session is asked of Luke
 * in conversation, never typed or pressed on the row — so the one thing a row
 * hands up is not a provider write at all: opening the pull request hands an
 * address to the operating system, and it keeps the action-result shape so the
 * chip can report a refusal on its own line.
 */
export interface SessionWriteHandlers {
  openChange: (session: SessionView) => Promise<SessionOpenResult>;
}

/**
 * The second line a row earns only when its provider reported published work:
 * the pull-request chip. A failure to open answers back onto the same line,
 * because the press is the user's own action and its outcome may not vanish into
 * a log; an opened page is its own answer.
 */
function SessionRowActions({
  session,
  writes,
}: {
  session: SessionView;
  writes: SessionWriteHandlers;
}): React.JSX.Element {
  const [feedback, setFeedback] = useState<string | undefined>(undefined);

  const openChange = useCallback(async () => {
    const result = await writes.openChange(session);
    if (result.status === ACTION_RESULT_STATUS.ACCEPTED) return;
    setFeedback(
      result.status === ACTION_RESULT_STATUS.REJECTED
        ? result.reason
        : "The session no longer reports a pull request.",
    );
  }, [session, writes]);

  return (
    <div className="row-actions">
      <button
        type="button"
        className="row-action"
        title="Open the pull request this session published"
        // The whole row opens the session; a press on the chip is a press on
        // the chip alone, so it must not travel up and open a window as well.
        onClick={(event) => {
          event.stopPropagation();
          void openChange();
        }}
      >
        {session.changeNumber !== undefined ? `#${session.changeNumber}` : "Pull request"}
      </button>
      {feedback ? <small className="row-feedback">{feedback}</small> : null}
    </div>
  );
}

/**
 * The tray header's one chip: the workspace's pull request. The chats share a
 * branch, so the chip repeated on each row read as several changes; the header
 * says it once, where the workspace is named once, and its open travels
 * through the chat that reported it so it is validated against the same
 * roster row.
 */
export function WorkspaceTrayChangeChip({
  change,
  writes,
}: {
  change: WorkspaceTrayChange;
  writes: SessionWriteHandlers;
}): React.JSX.Element {
  const [feedback, setFeedback] = useState<string | undefined>(undefined);

  const openChange = useCallback(async () => {
    const result = await writes.openChange(change.session);
    if (result.status === ACTION_RESULT_STATUS.ACCEPTED) return;
    setFeedback(
      result.status === ACTION_RESULT_STATUS.REJECTED
        ? result.reason
        : "The workspace no longer reports a pull request.",
    );
  }, [change, writes]);

  return (
    <>
      <button
        type="button"
        className="row-action"
        title="Open the pull request this workspace published"
        onClick={() => void openChange()}
      >
        {change.changeNumber !== undefined ? `#${change.changeNumber}` : "Pull request"}
      </button>
      {feedback ? <small className="row-feedback">{feedback}</small> : null}
    </>
  );
}

/**
 * One session, drawn the same way whether or not it can be opened. A row whose
 * provider gave an address is a button and nothing else changes: the panel is
 * five rows of dense text, and a second permanent mark on some of them would be
 * read as a state before it was read as an affordance. The pointer is what
 * separates them — a row that can be opened lifts and takes the hand cursor,
 * one that cannot stays flat under it, which is the honest answer to whether
 * pressing would do anything.
 *
 * The state rides the sentence under the title rather than a control-shaped
 * chip beside it: a spinner leads a working row, a check a finished one, and a
 * session that needs a person says so in the attention colour — the one colour
 * on the row, spent only where someone is needed. The label is still spoken to
 * a screen reader ahead of a sentence that would not otherwise carry it.
 *
 * The provider is its mark, and only its mark: naming it again in words was the
 * subtitle saying what the row's left edge already says. The mark's hover
 * answers with the name — and the model, which identifies the session to nobody
 * and so earns a hover rather than a line.
 *
 * A row whose provider reported a pull request grows a second line for its
 * chip. The press target for opening shrinks to the row's first line, so a
 * mispress near the chip cannot open a window, and the whole row stays one
 * article for a reader. Nothing else on the row writes: a message or a control
 * for the session is asked of Luke in conversation, not pressed here.
 */
export function SessionRow({
  session,
  index,
  now,
  leaving,
  inWorkspaceTray = false,
  changeInTrayHeader = false,
  highlight,
  onOpen,
  onOpenApplication,
  writes,
}: {
  session: SessionView;
  index: number;
  now: number;
  leaving: boolean;
  /** Whether this row is drawn inside its workspace's tray. */
  inWorkspaceTray?: boolean;
  /** Whether the tray's header carries the workspace's one pull-request chip,
   * so this row leaves its own report unsaid. */
  changeInTrayHeader?: boolean;
  /** The search's words, marked on the row's lines so it says why it matched. */
  highlight?: readonly string[] | undefined;
  onOpen: (session: SessionView) => void;
  onOpenApplication: (session: SessionView, applicationId: SessionApplicationId) => void;
  writes: SessionWriteHandlers;
}): React.JSX.Element {
  // The workspace's pull request is the tray header's chip: repeated on every
  // chat of the branch it read as several changes. A lone chat is its
  // workspace here too: with no tray to carry the chip, the row does.
  const withChange = session.hasChange && !changeInTrayHeader;
  const shared = {
    className: "session-row",
    "data-state": session.urgency,
    // How the reorder measurement finds this row again after a re-sort has
    // moved it, whichever element it is rendered as.
    [SESSION_ROW_ID_ATTRIBUTE]: session.id,
    // A leaving row holds its slot while it fades, but its session is already
    // gone from the model, so nothing may read, focus, or press it.
    [LEAVING_ATTRIBUTE]: String(leaving),
    inert: leaving,
    style: cssCustomProperties({ "--row-index": index + 1 }),
  };
  // The identifier that tells this row from its neighbours: the branch, or the
  // repository where a provider reported no branch. The glyph belongs to the
  // branch alone — under a repository name it would say the wrong thing. A row
  // inside a tray leaves a bare repository unsaid: the tray's own header has
  // already named it, once, for every chat it holds.
  const place = session.branch ?? (inWorkspaceTray ? undefined : session.repository);
  // The chat's own name titles the row even where no tray names the
  // workspace: it is the most specific fact the row has, and a provider whose
  // chat has no name of its own already falls the title back to something
  // workspace-shaped. The workspace's name still matches a search, and the
  // actions aimed at the whole workspace still collapse onto this row.
  const title = session.title;
  const applications = session.applications.filter(
    (application) =>
      !inWorkspaceTray ||
      application.scope === SESSION_APPLICATION_SCOPE.SESSION ||
      // A workspace manager is already named once in the tray header, unless
      // its exact per-chat route is an alternative to the row's preferred
      // destination. In that case the mark stays on this row as the only
      // honest way to offer both places without making a second session.
      (application.openable && application.name !== session.openApplication),
  );
  const hasOpenableApplication = applications.some(
    (application) => application.openable && isSessionApplicationId(application.id),
  );
  const openLabel = session.openApplication ?? session.provider;
  // The mark is the agent having the conversation; the provider only stands
  // in where a host did not say which agent runs the chat.
  const markName = session.agent ?? session.provider;
  const applicationMarks =
    applications.length > 0 ? (
      <span className="row-applications">
        {applications.map((application) => {
          const applicationId = application.id;
          return application.openable && isSessionApplicationId(applicationId) ? (
            <button
              type="button"
              className="row-application row-application-button"
              title={`Open in ${application.name}`}
              aria-label={`Open in ${application.name}`}
              key={applicationId}
              onClick={(event) => {
                event.stopPropagation();
                onOpenApplication(session, applicationId);
              }}
            >
              <ProviderMark providerId={applicationId} />
            </button>
          ) : (
            <span
              className="row-application"
              role="img"
              aria-label={`Also in ${application.name}`}
              title={application.name}
              key={applicationId}
            >
              <ProviderMark providerId={applicationId} />
            </span>
          );
        })}
      </span>
    ) : undefined;
  const content = (
    <PanelSessionRow
      providerId={session.agentId ?? session.providerId}
      cloud={session.location === SESSION_LOCATION.CLOUD}
      realtimeVoice={session.realtimeVoice}
      markName={markName}
      model={session.model}
      title={
        session.openable && hasOpenableApplication ? (
          <button
            type="button"
            className="row-title-open"
            title={`Open in ${openLabel}`}
            onClick={(event) => {
              event.stopPropagation();
              onOpen(session);
            }}
          >
            <Highlighted text={title} tokens={highlight} />
          </button>
        ) : (
          <Highlighted text={title} tokens={highlight} />
        )
      }
      detail={<Highlighted text={session.detail} tokens={highlight} />}
      detailTitle={session.detail}
      detailPrefix={
        session.detail === session.label ? undefined : (
          <span className="visually-hidden">{session.label}. </span>
        )
      }
      working={session.urgency === SESSION_URGENCY.WORKING}
      complete={session.urgency === SESSION_URGENCY.COMPLETE}
      place={place ? <Highlighted text={place} tokens={highlight} /> : undefined}
      placeTitle={place ?? session.diff}
      branch={Boolean(session.branch)}
      diff={session.diff}
      when={lastActivityLabel(session.lastActivityAt, now)}
      applications={applicationMarks}
    />
  );

  if (!withChange && !hasOpenableApplication) {
    if (!session.openable) return <article {...shared}>{content}</article>;
    return (
      <button
        {...shared}
        type="button"
        // The row's own lines are its accessible name, which already reads as
        // the session; the title says what pressing it does, and names the agent
        // because that is the window you are about to be in.
        title={`Open in ${openLabel}`}
        onClick={() => onOpen(session)}
      >
        {content}
      </button>
    );
  }

  if (!withChange) {
    return (
      <article
        {...shared}
        data-application-controls="true"
        {...(session.openable
          ? { "data-openable": "true", onClick: () => onOpen(session) }
          : undefined)}
      >
        {content}
      </article>
    );
  }

  return (
    // The row is the press target, chip and all: the gaps beside the chip are
    // still the session, and a press there must not be a press on nothing.
    // Ordinarily the first line is its keyboard button; when an app mark is
    // independently pressable, the title becomes that button instead so
    // interactive controls are siblings rather than invalidly nested.
    <article
      {...shared}
      data-actions="true"
      {...(hasOpenableApplication ? { "data-application-controls": "true" } : undefined)}
      {...(session.openable
        ? { "data-openable": "true", onClick: () => onOpen(session) }
        : undefined)}
    >
      {session.openable && !hasOpenableApplication ? (
        <button type="button" className="row-main" title={`Open in ${openLabel}`}>
          {content}
        </button>
      ) : (
        <div className="row-main">{content}</div>
      )}
      <SessionRowActions session={session} writes={writes} />
    </article>
  );
}

/** Whether a run draws the tray: only several chats earn its chrome. */
export function runDrawsTray(run: SessionListRun): boolean {
  return run.workspace !== undefined && run.indexes.length > 1;
}
