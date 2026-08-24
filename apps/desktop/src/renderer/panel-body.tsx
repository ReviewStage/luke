import {
  isSessionApplicationId,
  PROVIDER_ACT_RESULT_STATUS,
  type ProviderControlResult,
  type ProviderMessageResult,
  SESSION_APPLICATION_SCOPE,
  SESSION_CONTROL_KIND,
  SESSION_LOCATION,
  type SessionApplicationId,
} from "@sidecar/session";
import { SESSION_URGENCY } from "@sidecar/surface";
import { cssCustomProperties } from "@sidecar/surface/react-css";
import { useCallback, useRef, useState } from "react";
import { ACCOUNT_STATUS, type AccountProvider, type AccountSnapshot } from "#shared/wire/account";
import { SESSION_OPEN_RESULT_STATUS, type SessionOpenResult } from "#shared/wire/session";
import { type AskHandler, AskLuke } from "./ask-luke";
import { PANEL_TAB, type PanelTab, TabBar } from "./panel-tabs";
import { AudioBadge, CloudBadge, ProviderMark } from "./provider-marks";
import {
  type ArrangedSessions,
  actsOnWorkspace,
  type DisplaySession,
  observedAgoLabel,
  type SessionAction,
  type SessionFilter,
  type SessionListRun,
  type SessionView,
  sessionListRuns,
  sessionRunKeys,
  type WorkspaceTrayAction,
  type WorkspaceTrayChange,
  workspaceTrayActions,
  workspaceTrayChange,
} from "./session-model";
import {
  LEAVING_ATTRIBUTE,
  type RosterRow,
  SESSION_ROW_ID_ATTRIBUTE,
  useRoster,
  useSessionReorderMotion,
  WORKSPACE_TRAY_ID_ATTRIBUTE,
} from "./session-motion";
import {
  BranchGlyph,
  CheckGlyph,
  EmptyState,
  ListeningGlyph,
  SessionOptions,
  SessionOptionsButton,
  SessionsPanel,
  WorkspaceGlyph,
} from "./session-parts";
import {
  Highlighted,
  SearchEmptyState,
  SessionSearch,
  SessionSearchButton,
  widenedView,
} from "./session-search";
import { SendIcon, StopIcon } from "./settings-icons";
import { SettingsPanel, type SettingsPanelProps } from "./settings-panel";
import { SettingsSearchButton } from "./settings-search";
import { SignInGate } from "./sign-in-gate";
import { updateAvailable, updateRow } from "./update-row";
import { useMeasuredHeight } from "./use-measured-height";

/** Handed up rather than performed here: the row knows sessions, not IPC. */
export interface SessionWriteHandlers {
  sendMessage: (session: DisplaySession, text: string) => Promise<ProviderMessageResult>;
  runAction: (session: DisplaySession, actionId: string) => Promise<ProviderControlResult>;
  /**
   * Not a provider write — the address is handed to the operating system —
   * but it rides the same shape so the chip can report a refusal on the same
   * line the other acts answer on.
   */
  openChange: (session: DisplaySession) => Promise<SessionOpenResult>;
}

/**
 * What the field is for, in the words every agent chat box uses: the message
 * is a follow-up to work already under way, whoever the provider is. The
 * provider's name still identifies the field to a screen reader, where "which
 * session is this" is the question; sighted readers have the whole row.
 */
const COMPOSE_PLACEHOLDER = "Send a follow-up…";

/** One outcome line under the actions, said once and replaced by the next. */
function feedbackFor(result: ProviderMessageResult | ProviderControlResult): string | undefined {
  if (result.status === PROVIDER_ACT_RESULT_STATUS.REJECTED) return result.reason;
  if (result.status === PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED) {
    return "The session has moved on and no longer takes this.";
  }
  return undefined;
}

/**
 * One advertised action. A stop is drawn as the square glyph every chat
 * surface stops with — its label survives as what a reader hears and hover
 * shows — and anything else is drawn as a chip in the provider's own words.
 */
function RowActionButton({
  action,
  pendingAction,
  busy,
  onRun,
}: {
  action: SessionAction;
  pendingAction: string | undefined;
  /** Any write in flight, the composer's included, holds every control down. */
  busy: boolean;
  onRun: (actionId: string) => void;
}): React.JSX.Element {
  const held = busy;
  // The whole row opens the session; a press on a control is a press on the
  // control alone, so it must not travel up and open a window as well.
  const run = (event: React.MouseEvent) => {
    event.stopPropagation();
    onRun(action.id);
  };
  if (action.kind === SESSION_CONTROL_KIND.STOP) {
    return (
      <button
        type="button"
        className="row-stop"
        aria-label={action.label}
        title={action.label}
        disabled={held}
        onClick={run}
      >
        <StopIcon />
      </button>
    );
  }
  return (
    <button type="button" className="row-action" disabled={held} onClick={run}>
      {pendingAction === action.id ? "Asking…" : action.label}
    </button>
  );
}

/**
 * The second line a row earns only when its provider promised something: a
 * message field that is simply there, the way every chat surface keeps its
 * composer on screen, and each advertised action beside it — a stop as the
 * square glyph, anything else as a chip in the provider's own words.
 * Every outcome that needs words answers back onto the same line — sending, an
 * action's acceptance, or the provider's refusal — because a write is the
 * user's own act and its outcome may not vanish into a log. An accepted
 * message alone answers silently: the draft emptying is the confirmation, and
 * a line saying so again only holds the row taller than it needs to be.
 */
function SessionRowActions({
  session,
  actions,
  withChange,
  writes,
}: {
  session: DisplaySession;
  /** The actions this row draws itself: inside a tray, the workspace-level
   * ones live in the tray's own header. */
  actions: readonly SessionAction[];
  /** Whether this row draws the pull-request chip itself: inside a tray whose
   * header carries the workspace's one change, it does not. */
  withChange: boolean;
  writes: SessionWriteHandlers;
}): React.JSX.Element {
  const [sending, setSending] = useState(false);
  const [draft, setDraft] = useState("");
  const [feedback, setFeedback] = useState<string | undefined>(undefined);
  const composeField = useRef<HTMLInputElement | null>(null);
  /** The action in flight, which is the one drawn asking and the reason all are held. */
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
      if (result.status === PROVIDER_ACT_RESULT_STATUS.ACCEPTED) {
        // The draft has become the session's; the field emptying for the next
        // message is the whole confirmation, so no line repeats it.
        setDraft("");
      } else {
        // The draft stays: a refused message is still the user's words.
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
        // An accepted action answers too: the session will not look different
        // until its provider is observed again, and a control that seems to have
        // done nothing would be pressed a second time.
        setFeedback(
          result.status === PROVIDER_ACT_RESULT_STATUS.ACCEPTED
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
    if (result.status === SESSION_OPEN_RESULT_STATUS.OPENED) return;
    setFeedback(
      result.status === SESSION_OPEN_RESULT_STATUS.REJECTED
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
              window.sidecar.focusPanel();
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
 * The tray header's own acts: every workspace-level action the tray's chats
 * advertise, drawn once where the workspace is named once. Archiving files
 * away every chat in the tray, so the same chip repeated on each row read as
 * several different acts when any press did the whole thing. The press still
 * travels as a session write — through the first chat that advertised the act
 * — so it is validated against the same roster row that promised it, and its
 * outcome answers on the header's own line the way a row's writes do. The
 * workspace's one pull request rides here on the same reasoning: the chats
 * share a branch, so the chip repeated on each row read as several changes,
 * and its open travels through the chat that reported it the way an act does.
 */
function WorkspaceTrayActs({
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
        // An accepted act answers too: the tray will not look different until
        // its provider is observed again, and a control that seems to have
        // done nothing would be pressed a second time.
        setFeedback(
          result.status === PROVIDER_ACT_RESULT_STATUS.ACCEPTED
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
    if (result.status === SESSION_OPEN_RESULT_STATUS.OPENED) return;
    setFeedback(
      result.status === SESSION_OPEN_RESULT_STATUS.REJECTED
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
 * A row whose provider promised writes — a message it will take, an action it
 * advertised — grows a second line for them. The press target for opening
 * shrinks to the row's first line, so a mispress near the field cannot open a
 * window, and the whole row stays one article for a reader.
 */
function SessionRow({
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
  session: DisplaySession;
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
  onOpen: (session: DisplaySession) => void;
  onOpenApplication: (session: DisplaySession, applicationId: SessionApplicationId) => void;
  writes: SessionWriteHandlers;
}): React.JSX.Element {
  // Inside a tray, an action aimed at the whole workspace is the tray
  // header's to offer — drawn beside every chat it would file away, it read
  // as several different acts — so the row keeps only the actions that are
  // its own. A lone chat is its workspace here too: with no tray to carry the
  // act, the row does.
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
  // acts aimed at the whole workspace still collapse onto this row.
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
  const content = (
    <>
      <span
        className={
          session.realtimeVoice && session.location === SESSION_LOCATION.CLOUD
            ? "row-mark row-mark-audio"
            : "row-mark"
        }
        title={session.model ? `${markName} · ${session.model}` : markName}
      >
        <span className="visually-hidden">{markName}</span>
        <ProviderMark providerId={session.agentId ?? session.providerId} />
        {session.location === SESSION_LOCATION.CLOUD ? <CloudBadge /> : null}
        {session.realtimeVoice ? <AudioBadge /> : null}
      </span>
      <span className="row-copy">
        <strong>
          {session.openable && hasOpenableApplication ? (
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
          )}
        </strong>
        <small className="row-doing">
          {session.urgency === SESSION_URGENCY.WORKING ? (
            <span className="row-spinner" aria-hidden="true" />
          ) : null}
          {session.urgency === SESSION_URGENCY.COMPLETE ? <CheckGlyph /> : null}
          {/* The line truncates without a disclosure, so the hover is the one
              way the rest of a long sentence can be read at all. */}
          <span className="row-doing-text" title={session.detail}>
            {session.detail === session.label ? null : (
              <span className="visually-hidden">{session.label}. </span>
            )}
            <Highlighted text={session.detail} tokens={highlight} />
          </span>
        </small>
        {place || session.diff ? (
          <small className="row-place" title={place ?? session.diff}>
            {session.branch ? <BranchGlyph /> : null}
            {place ? (
              <span>
                <Highlighted text={place} tokens={highlight} />
              </span>
            ) : null}
            {/* The change's size rides the place line: both say what the work
                touched, and a session with neither spends no line on it. */}
            {session.diff ? <span className="row-diff">{session.diff}</span> : null}
          </small>
        ) : null}
      </span>
      <span className="row-side">
        <small className="row-when">
          {session.noticeAsk ? <ListeningGlyph ask={session.noticeAsk} /> : null}
          {observedAgoLabel(session.observedAt, now)}
        </small>
        {applications.length > 0 ? (
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
        ) : null}
      </span>
    </>
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

/**
 * One run of the list, tray or not. Several of one workspace's chats sit in
 * the tray: a single card that visibly contains them, named once at its top —
 * the workspace's name on the left, and at the far end the glyph leading the
 * repository — with the chats divided by hairlines inside.
 * A workspace holding one chat earns no tray — its one row carries the
 * workspace's acts and mark itself — and an ungrouped session never does;
 * either way the wrapper stays, drawing as nothing. It has to: a workspace crosses
 * between one chat and several as siblings come and go, and if that crossing
 * changed the row's parent element, React would remount the row and wipe a
 * follow-up someone was typing into it. The chrome is a class, never a
 * different tree.
 *
 * The header opens nothing — the rows are what press through to a provider's
 * window — but it does carry the acts that belong to the workspace rather
 * than to any one chat: an archive files away every chat in the tray, so its
 * chip sits where the workspace is named once instead of on each row it
 * would empty, and the one pull request the chats share sits beside it on the
 * same reasoning. The header names the tray in the reading order the same way
 * it does on screen: the workspace once, then its chats. A tray is a member of the
 * arrival stack in its rows' stead: it fans in at its lead row's turn, and
 * the rows ride it rather than fanning a second time inside it. A wrapper
 * that draws as nothing leaves its row in the stack exactly as before.
 */
function SessionRun({
  run,
  sessions,
  change,
  highlight,
  writes,
  children,
}: {
  run: SessionListRun;
  /** The tray's living chats, in drawn order — what the header's acts are
   * read from and carried through. A leaving row's session is already gone
   * from the model, so it can neither offer an act nor carry one. */
  sessions: readonly DisplaySession[];
  /** The workspace's one pull request, when the header carries it. Handed in
   * rather than read here, because the rows suppressing their own chips must
   * answer to the same reading. */
  change?: WorkspaceTrayChange | undefined;
  /** The search's words, marked on the tray's own header lines too. */
  highlight?: readonly string[] | undefined;
  writes: SessionWriteHandlers;
  children: React.ReactNode;
}): React.JSX.Element {
  const tray = runDrawsTray(run);
  const acts = tray ? workspaceTrayActions(sessions) : [];
  return (
    <section
      className={tray ? "workspace-tray" : "session-run"}
      {...(tray && run.workspace
        ? {
            // The tray is a slot of the list in its own right: measured by
            // this id, it travels to a re-sorted seat carrying its rows,
            // which are translated only by their movement within it.
            [WORKSPACE_TRAY_ID_ATTRIBUTE]: run.workspace.id,
            style: cssCustomProperties({ "--row-index": (run.indexes[0] ?? 0) + 1 }),
          }
        : undefined)}
    >
      {/* Held in its slot by the null, so the header appearing or leaving can
          never reseat the keyed rows beside it. */}
      {tray ? (
        <header className="workspace-tray-header">
          <span className="workspace-tray-name">
            <Highlighted text={run.workspace?.name ?? ""} tokens={highlight} />
          </span>
          <span className="workspace-tray-meta">
            {run.workspace?.scopeId && run.workspace.managerName ? (
              <span
                className="workspace-manager-mark"
                title={`${run.workspace.managerName} workspace`}
              >
                <ProviderMark providerId={run.workspace.scopeId} />
                <span className="visually-hidden">{run.workspace.managerName}</span>
              </span>
            ) : (
              <WorkspaceGlyph />
            )}
            {run.repository ? (
              <span>
                <Highlighted text={run.repository} tokens={highlight} />
              </span>
            ) : null}
          </span>
          {acts.length > 0 || change ? (
            <WorkspaceTrayActs acts={acts} {...(change ? { change } : undefined)} writes={writes} />
          ) : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export interface PanelBodyProps {
  accountRequired: boolean;
  account: AccountSnapshot;
  /** Starts a sign-in; the app stands the panel down to the waiting popup. */
  onBeginSignIn: (provider: AccountProvider) => void;
  /** Why the last sign-in ended without landing, for the gate to show. */
  signInFailure?: string;
  list: ArrangedSessions;
  view: SessionView;
  onViewChange: (view: SessionView) => void;
  /** Carries a toggled filter selection; unlike a view change it leaves the sheet open. */
  onFiltersChange: (filters: readonly SessionFilter[]) => void;
  /**
   * The instant the rows' ages are read against. Passed down rather than read
   * here, because only the app knows which clock is honest: the wall clock for
   * live sessions, the fixture's own epoch for fixture rows.
   */
  now: number;
  /** Sends the pressed session to its provider, wherever the provider keeps it. */
  onOpenSession: (session: DisplaySession) => void;
  /** Opens one exact app association without exposing its address to the renderer. */
  onOpenSessionApplication: (session: DisplaySession, applicationId: SessionApplicationId) => void;
  /** Carries a typed reply or an advertised action to the session's provider. */
  writes: SessionWriteHandlers;
  /** Carries a typed ask to Luke's own conversation, answering why it could not go. */
  ask: AskHandler;
  /** Reports someone being part-way through an ask, so the panel holds for them. */
  onAskEngaged: (engaged: boolean) => void;
  /** The registered summon key the field should teach, if the system granted one. */
  askShortcut?: string;
  /**
   * Whether there is anything for the sheet to decide. Decided by the panel
   * rather than here, because whoever offers the button also has to be the one
   * that closes the sheet when it stops offering it.
   */
  offerOptions: boolean;
  optionsOpen: boolean;
  onOptionsToggle: () => void;
  /** Whether there is anything to search, on the same terms as the options. */
  offerSearch: boolean;
  searchOpen: boolean;
  /** Opens the field focused, or closes it and lets go of its query. */
  onSearchToggle: () => void;
  /** The field's own way out — Escape on an empty query — which also clears. */
  onSearchClose: () => void;
  /** The settings search's field state, on the sessions search's own terms. */
  settingsSearchOpen: boolean;
  onSettingsSearchToggle: () => void;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  /**
   * The settings tab's controls, grouped the way a credential's is. Forwarded
   * untouched: this body chooses which tab is showing, not what a row writes.
   */
  settings: SettingsPanelProps;
}

/** Full-width rows that unfold out of the capsule, one session per line. */
export function PanelBody({
  accountRequired,
  account,
  onBeginSignIn,
  signInFailure,
  list,
  view,
  onViewChange,
  onFiltersChange,
  now,
  onOpenSession,
  onOpenSessionApplication,
  writes,
  ask,
  onAskEngaged,
  askShortcut,
  offerOptions,
  optionsOpen,
  onOptionsToggle,
  offerSearch,
  searchOpen,
  onSearchToggle,
  onSearchClose,
  settingsSearchOpen,
  onSettingsSearchToggle,
  tab,
  onTabChange,
  settings,
}: PanelBodyProps): React.JSX.Element {
  const sessionListRef = useSessionReorderMotion();
  const rows = useRoster(list.sessions, sessionListRef);
  // The sheet floats over the list, so its height never reaches the panel's
  // measurement — and a list of one row measures shorter than the sheet over
  // it, cropping the sheet at the surface's clipped edge. Measured here and
  // reserved on the view below, so the surface grows to hold whichever of the
  // two is taller.
  const [optionsElement, optionsHeight] = useMeasuredHeight();
  const optionsRoom =
    optionsOpen && optionsHeight !== undefined
      ? cssCustomProperties({ "--options-height": `${optionsHeight}px` })
      : undefined;
  if (accountRequired && account.status !== ACCOUNT_STATUS.SIGNED_IN) {
    return (
      <div className="body">
        <SignInGate
          account={account}
          {...(signInFailure ? { failure: signInFailure } : undefined)}
          onBegin={onBeginSignIn}
          onQuit={settings.onQuit}
        />
      </div>
    );
  }
  const highlight = list.search?.tokens;
  const runs = sessionListRuns(rows.map((row) => row.item));
  const runKeys = sessionRunKeys(runs, rows);
  // The tab wears the update row's own words, so the dot's hover and the row
  // it leads to can never tell two different stories about the same release.
  const settingsNote = updateAvailable(settings.updates.update)
    ? updateRow(settings.updates.update).detail
    : undefined;
  return (
    <div className="body">
      {/* The tab bar says what you are looking at; the buttons beside it say
          how it is being shown. One line, because the second is only ever a
          qualifier on the first. */}
      <div className="panel-header">
        <TabBar
          tab={tab}
          onTabChange={onTabChange}
          {...(settingsNote ? { settingsNote } : undefined)}
        />
        {offerSearch || offerOptions || tab === PANEL_TAB.SETTINGS ? (
          <span className="header-controls">
            {offerSearch ? (
              <SessionSearchButton open={searchOpen} onToggle={onSearchToggle} />
            ) : null}
            {/* The settings' own magnifier, in the sessions magnifier's spot:
                each tab's search is opened from the same place, and only the
                showing tab's is offered. */}
            {tab === PANEL_TAB.SETTINGS ? (
              <SettingsSearchButton open={settingsSearchOpen} onToggle={onSettingsSearchToggle} />
            ) : null}
            {offerOptions ? (
              <SessionOptionsButton
                list={list}
                open={optionsOpen}
                onToggle={onOptionsToggle}
                onClear={() => onFiltersChange([])}
              />
            ) : null}
          </span>
        ) : null}
      </div>
      {tab === PANEL_TAB.SETTINGS ? (
        <SettingsPanel {...settings} />
      ) : (
        <SessionsPanel
          className="session-view"
          {...(optionsRoom ? { style: optionsRoom } : undefined)}
        >
          {offerOptions && optionsOpen ? (
            <SessionOptions
              list={list}
              view={view}
              onViewChange={onViewChange}
              onFiltersChange={onFiltersChange}
              measure={optionsElement}
            />
          ) : null}
          {searchOpen ? (
            <SessionSearch
              list={list}
              view={view}
              onViewChange={onViewChange}
              onClose={onSearchClose}
              onEngagedChange={onAskEngaged}
            />
          ) : null}
          <div className="session-list" ref={sessionListRef}>
            {rows.length === 0 ? (
              list.search ? (
                <SearchEmptyState
                  beyondFilter={list.search.beyondFilter}
                  onWiden={() => onViewChange(widenedView(view))}
                />
              ) : (
                <EmptyState />
              )
            ) : (
              // Runs are read over the drawn order, leaving rows and all: a
              // fading chat still holds its slot in its tray, and the tray
              // may not close around it until it has gone. Keys are resolved
              // over the whole list at once, because a run's key depends on
              // the other runs of its workspace.
              runs.map((run, at) => {
                const tray = runDrawsTray(run);
                const living = run.indexes
                  .map((index) => rows[index])
                  .filter(
                    (row): row is RosterRow<DisplaySession> => row !== undefined && !row.leaving,
                  )
                  .map((row) => row.item);
                const change = tray ? workspaceTrayChange(living) : undefined;
                return (
                  <SessionRun
                    key={runKeys[at]}
                    run={run}
                    sessions={living}
                    {...(change ? { change } : undefined)}
                    highlight={highlight}
                    writes={writes}
                  >
                    {run.indexes.map((index) => {
                      const row = rows[index];
                      return row ? (
                        <SessionRow
                          key={row.item.id}
                          session={row.item}
                          index={index}
                          now={now}
                          leaving={row.leaving}
                          inWorkspaceTray={tray}
                          changeInTrayHeader={change !== undefined}
                          highlight={highlight}
                          onOpen={onOpenSession}
                          onOpenApplication={onOpenSessionApplication}
                          writes={writes}
                        />
                      ) : null;
                    })}
                  </SessionRun>
                );
              })
            )}
          </div>
          {/* Luke's own composer holds the panel's foot, under whatever the
              list shows — even an empty one, because "what needs me?" is a
              question worth typing before any session has appeared. It arrives
              at the tail of the same fan the rows ride. */}
          <AskLuke
            ask={ask}
            onEngagedChange={onAskEngaged}
            rowIndex={rows.length + 1}
            {...(askShortcut ? { shortcut: askShortcut } : undefined)}
          />
        </SessionsPanel>
      )}
    </div>
  );
}
