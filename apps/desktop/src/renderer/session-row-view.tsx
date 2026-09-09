import { SessionRow as PanelSessionRow, ProviderMark, SendIcon, StopIcon } from "@sidecar/panel";
import {
  type AdvertisedControl,
  isSessionApplicationId,
  SESSION_APPLICATION_SCOPE,
  SESSION_CONTROL_KIND,
  SESSION_LOCATION,
  SESSION_URGENCY,
  type SessionApplicationId,
} from "@sidecar/session";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import { ACTION_RESULT_STATUS } from "@sidecar/wire";
import { useCallback, useRef, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import type { SessionOpenResult, SessionWriteResult } from "#shared/messages/session";
import { tell } from "./act";
import {
  actsOnWorkspace,
  lastActivityLabel,
  type SessionListRun,
  type SessionView,
  type WorkspaceTrayAction,
  type WorkspaceTrayChange,
} from "./session-model";
import { LEAVING_ATTRIBUTE, SESSION_ROW_ID_ATTRIBUTE } from "./session-motion";
import { Highlighted } from "./session-search";

/**
 * Handed up rather than performed here: the row knows sessions, not IPC. Two
 * of the three are provider writes — the follow-up typed into the row's
 * composer and a control its provider advertised — and each travels as one
 * act to the main process and on to the host, whose `admit()` decides it
 * against the roster it reads for itself; the row names a session and a
 * control id, never a route. The third is not a write at all: opening the
 * pull request hands an address to the operating system. All three keep the
 * action-result shape so the row can report a refusal on its own line.
 */
export interface SessionWriteHandlers {
  sendMessage: (session: SessionView, text: string) => Promise<SessionWriteResult>;
  runAction: (session: SessionView, actionId: string) => Promise<SessionWriteResult>;
  openChange: (session: SessionView) => Promise<SessionOpenResult>;
}

/**
 * The field's one hint, not a per-provider sentence: what is typed here is a
 * follow-up to work already under way, whoever the provider is. The provider's
 * name still identifies the field to a screen reader, where "which session is
 * this" is the question; sighted readers have the whole row.
 */
const COMPOSE_PLACEHOLDER = "Send a follow-up…";

/** One outcome line under the controls, said once and replaced by the next. */
function feedbackFor(result: SessionWriteResult): string | undefined {
  if (result.status === ACTION_RESULT_STATUS.REJECTED) return result.reason;
  if (result.status === ACTION_RESULT_STATUS.UNSUPPORTED) {
    return "The session has moved on and no longer takes this.";
  }
  // An unknown outcome is neither: the write was handed on and its answer
  // lost, so the line says so rather than inviting a second press.
  if (result.status !== ACTION_RESULT_STATUS.ACCEPTED) return result.reason;
  return undefined;
}

/**
 * One advertised control. A stop is drawn as the square glyph every chat
 * surface stops with — its label survives as what a reader hears and hover
 * shows — and anything else is drawn as a chip in the provider's own words.
 */
function RowActionButton({
  action,
  pendingAction,
  busy,
  onRun,
}: {
  action: AdvertisedControl;
  pendingAction: string | undefined;
  /** Any write in flight, the composer's included, holds every control down. */
  busy: boolean;
  onRun: (actionId: string) => void;
}): React.JSX.Element {
  // The whole row opens the session; a press on a control is a press on the
  // control alone, so it must not travel up and open a window as well.
  const run = (event: React.MouseEvent) => {
    event.stopPropagation();
    onRun(action.id);
  };
  if (action.controlKind === SESSION_CONTROL_KIND.STOP) {
    return (
      <button
        type="button"
        className="row-stop"
        aria-label={action.label}
        title={action.label}
        disabled={busy}
        onClick={run}
      >
        <StopIcon />
      </button>
    );
  }
  return (
    <button type="button" className="row-action" disabled={busy} onClick={run}>
      {pendingAction === action.id ? "Asking…" : action.label}
    </button>
  );
}

/**
 * The second line a row earns only when its provider promised something: a
 * message field that is simply there, the way every chat surface keeps its
 * composer on screen, each advertised control beside it — a stop as the
 * square glyph, anything else as a chip in the provider's own words — and the
 * pull-request chip where the provider reported published work. Every outcome
 * that needs words answers back onto the same line — sending, a control's
 * acceptance, or the provider's refusal — because a write is the user's own
 * act and its outcome may not vanish into a log. An accepted message alone
 * answers silently: the draft emptying is the confirmation, and a line saying
 * so again only holds the row taller than it needs to be.
 */
function SessionRowActions({
  session,
  actions,
  withChange,
  writes,
}: {
  session: SessionView;
  /** The controls this row draws itself: inside a tray, the workspace-level
   * ones live in the tray's own header. */
  actions: readonly AdvertisedControl[];
  /** Whether this row draws the pull-request chip itself: inside a tray whose
   * header carries the workspace's one change, it does not. */
  withChange: boolean;
  writes: SessionWriteHandlers;
}): React.JSX.Element {
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [feedback, setFeedback] = useState<string | undefined>(undefined);
  const composeField = useRef<HTMLInputElement | null>(null);
  /** The control in flight, which is the one drawn asking and the reason all are held. */
  const [pendingAction, setPendingAction] = useState<string | undefined>(undefined);
  /**
   * The row's one write at a time, as a ref rather than state: disabling the
   * controls only lands with the next render, and a second Enter inside that
   * window would send the same words twice. A ref answers in the same tick.
   */
  const writeInFlight = useRef(false);
  // One write at a time for the whole row: while the composer is sending, the
  // controls are held, and while a control runs, the composer is. Otherwise the
  // one not in flight stays enabled, takes a press, and does nothing — the row
  // looking clickable while only the in-flight write will run.
  const busy = sending || pendingAction !== undefined;

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || writeInFlight.current) return;
    writeInFlight.current = true;
    setSending(true);
    setFeedback(undefined);
    try {
      const result = await writes.sendMessage(session, text);
      if (result.status === ACTION_RESULT_STATUS.ACCEPTED) {
        // The draft has become the session's; the field emptying for the next
        // message is the whole confirmation, so no line repeats it.
        setDraft("");
      } else if (
        result.status === ACTION_RESULT_STATUS.REJECTED ||
        result.status === ACTION_RESULT_STATUS.UNSUPPORTED
      ) {
        // The draft stays: a refused message is still the user's words.
        setFeedback(feedbackFor(result));
      } else {
        // An unknown outcome was handed on and its answer lost: the words may
        // already be the session's, so the field empties as for an acceptance
        // — a draft left standing would be sent twice by the next Enter — and
        // the line says what is known.
        setDraft("");
        setFeedback(feedbackFor(result));
      }
    } finally {
      writeInFlight.current = false;
      setSending(false);
    }
  }, [draft, session, writes]);

  const runAction = useCallback(
    async (actionId: string) => {
      if (writeInFlight.current) return;
      writeInFlight.current = true;
      setPendingAction(actionId);
      setFeedback(undefined);
      try {
        const result = await writes.runAction(session, actionId);
        // An accepted control answers too: the session will not look different
        // until its provider is observed again, and a control that seems to have
        // done nothing would be pressed a second time.
        setFeedback(
          result.status === ACTION_RESULT_STATUS.ACCEPTED
            ? `${session.provider} accepted`
            : feedbackFor(result),
        );
      } finally {
        writeInFlight.current = false;
        setPendingAction(undefined);
      }
    },
    [session, writes],
  );

  const openChange = useCallback(async () => {
    const result = await writes.openChange(session);
    // An opened page is its own answer; only a failure needs the line.
    if (result.status === ACTION_RESULT_STATUS.ACCEPTED) return;
    setFeedback(
      result.status === ACTION_RESULT_STATUS.REJECTED
        ? result.reason
        : "The session no longer reports a pull request.",
    );
  }, [session, writes]);

  return (
    <div className="row-actions">
      {session.canMessage ? (
        // biome-ignore lint/a11y/useKeyWithClickEvents: pointer-only by design — the keyboard already lands in the field by tabbing, and the click handler only stops the row's open and places the caret.
        <form
          className="row-compose"
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
          // A press anywhere on the pill — the field, its padding, the send
          // button — is about the message, so none of it may travel up and
          // open the session mid-thought. And a pill pressed anywhere is the
          // field being asked for, so the caret lands rather than nothing.
          onClick={(event) => {
            event.stopPropagation();
            composeField.current?.focus();
          }}
        >
          <input
            ref={composeField}
            className="row-compose-input"
            aria-label={`Message ${session.provider}`}
            placeholder={COMPOSE_PLACEHOLDER}
            autoComplete="off"
            spellCheck={false}
            value={draft}
            disabled={busy}
            onChange={(event) => setDraft(event.target.value)}
            onFocus={() => {
              // The panel can be showing without its window being key, and a
              // field that cannot be typed into is worse than no field.
              tell(ACT_KIND.WINDOW_FOCUS_PANEL);
            }}
            onKeyDown={(event) => {
              // Escape lets go of the field rather than closing the panel
              // behind it. The draft survives: the field is not going anywhere.
              if (event.key === "Escape") {
                event.stopPropagation();
                event.currentTarget.blur();
              }
            }}
          />
          <button
            type="submit"
            className="row-send"
            aria-label={`Send to ${session.provider}`}
            title={`Send to ${session.provider}`}
            disabled={busy || !draft.trim()}
          >
            <SendIcon />
          </button>
        </form>
      ) : null}
      {actions.map((action) => (
        <RowActionButton
          key={action.id}
          action={action}
          pendingAction={pendingAction}
          busy={busy}
          onRun={(actionId) => void runAction(actionId)}
        />
      ))}
      {withChange ? (
        <button
          type="button"
          className="row-action"
          title="Open the pull request this session published"
          // Opening the pull request hands an address to the system, not a
          // write to a provider, so it stays offered while a provider write is
          // in flight — only the row's open-on-press must not fire with it.
          onClick={(event) => {
            event.stopPropagation();
            void openChange();
          }}
        >
          {session.changeNumber !== undefined ? `#${session.changeNumber}` : "Pull request"}
        </button>
      ) : null}
      {feedback ? <small className="row-feedback">{feedback}</small> : null}
    </div>
  );
}

/**
 * The tray header's own acts: every workspace-level control the tray's chats
 * advertise, drawn once where the workspace is named once. Archiving files
 * away every chat in the tray, so the same chip repeated on each row read as
 * several different acts when any press did the whole thing. The press still
 * travels as a session write — through the first chat that advertised the
 * control — so it is admitted against the same roster row that promised it,
 * and its outcome answers on the header's own line the way a row's writes do.
 * The workspace's one pull request rides here on the same reasoning: the
 * chats share a branch, so the chip repeated on each row read as several
 * changes, and its open travels through the chat that reported it.
 */
export function WorkspaceTrayActs({
  acts,
  change,
  writes,
}: {
  acts: readonly WorkspaceTrayAction[];
  change?: WorkspaceTrayChange | undefined;
  writes: SessionWriteHandlers;
}): React.JSX.Element {
  const [pendingAction, setPendingAction] = useState<string | undefined>(undefined);
  const [feedback, setFeedback] = useState<string | undefined>(undefined);
  /** One write at a time for the header, in a ref for the same same-tick
   * reason a row keeps one: disabling only lands with the next render. */
  const writeInFlight = useRef(false);

  const run = useCallback(
    async (act: WorkspaceTrayAction) => {
      if (writeInFlight.current) return;
      writeInFlight.current = true;
      setPendingAction(act.action.id);
      setFeedback(undefined);
      try {
        const result = await writes.runAction(act.session, act.action.id);
        // An accepted control answers too: the tray will not look different
        // until its provider is observed again, and a control that seems to
        // have done nothing would be pressed a second time.
        setFeedback(
          result.status === ACTION_RESULT_STATUS.ACCEPTED
            ? `${act.session.provider} accepted`
            : feedbackFor(result),
        );
      } finally {
        writeInFlight.current = false;
        setPendingAction(undefined);
      }
    },
    [writes],
  );

  const openChange = useCallback(async () => {
    if (!change) return;
    const result = await writes.openChange(change.session);
    // An opened page is its own answer; only a failure needs the line.
    if (result.status === ACTION_RESULT_STATUS.ACCEPTED) return;
    setFeedback(
      result.status === ACTION_RESULT_STATUS.REJECTED
        ? result.reason
        : "The workspace no longer reports a pull request.",
    );
  }, [change, writes]);

  return (
    <>
      {acts.map((act) => (
        <RowActionButton
          key={act.action.id}
          action={act.action}
          pendingAction={pendingAction}
          busy={pendingAction !== undefined}
          onRun={() => void run(act)}
        />
      ))}
      {change ? (
        <button
          type="button"
          className="row-action"
          title="Open the pull request this workspace published"
          // Opening the pull request hands an address to the system, not a
          // write to a provider, so it stays offered while a provider write is
          // in flight.
          onClick={() => void openChange()}
        >
          {change.changeNumber !== undefined ? `#${change.changeNumber}` : "Pull request"}
        </button>
      ) : null}
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
 * A row whose provider promised writes — a message it will take, a control it
 * advertised — or reported a pull request grows a second line for them. The
 * press target for opening shrinks to the row's first line, so a mispress
 * near the field cannot open a window, and the whole row stays one article
 * for a reader.
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
  // Inside a tray, a control aimed at the whole workspace is the tray
  // header's to offer — drawn beside every chat it would file away, it read
  // as several different acts — so the row keeps only the controls that are
  // its own. A lone chat is its workspace here too: with no tray to carry the
  // control, the row does.
  const actions = inWorkspaceTray
    ? session.actions.filter((action) => !actsOnWorkspace(session, action))
    : session.actions;
  // The workspace's pull request is the tray header's chip on the same terms:
  // repeated on every chat of the branch it read as several changes.
  const withChange = session.hasChange && !changeInTrayHeader;
  const withActions = session.canMessage || actions.length > 0 || withChange;
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
  // controls aimed at the whole workspace still collapse onto this row.
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

  if (!withActions && !hasOpenableApplication) {
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

  if (!withActions) {
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
    // The row is the press target, controls and all: the gaps beside the
    // composer are still the session, and a press there must not be a press on
    // nothing. Ordinarily the first line is its keyboard button; when an app
    // mark is independently pressable, the title becomes that button instead
    // so interactive controls are siblings rather than invalidly nested.
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
      <SessionRowActions
        session={session}
        actions={actions}
        withChange={withChange}
        writes={writes}
      />
    </article>
  );
}

/** Whether a run draws the tray: only several chats earn its chrome. */
export function runDrawsTray(run: SessionListRun): boolean {
  return run.workspace !== undefined && run.indexes.length > 1;
}
