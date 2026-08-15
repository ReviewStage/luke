import type { ProviderControlResult, ProviderMessageResult } from "@sidecar/core";
import {
  PROVIDER_ACT_RESULT_STATUS,
  SESSION_CONTROL_KIND,
  SESSION_LOCATION,
  SESSION_URGENCY,
} from "@sidecar/core";
import { useCallback, useRef, useState } from "react";
import { type AskHandler, AskLuke } from "./ask-luke";
import { PANEL_TAB, type PanelTab, TabBar } from "./panel-tabs";
import { CloudBadge, ProviderMark } from "./provider-marks";
import {
  type ArrangedSessions,
  type DisplaySession,
  observedAgoLabel,
  type SessionAction,
  type SessionListRun,
  type SessionView,
  sessionListRuns,
} from "./session-model";
import {
  LEAVING_ATTRIBUTE,
  SESSION_ROW_ID_ATTRIBUTE,
  useRoster,
  useSessionReorderMotion,
  WORKSPACE_TRAY_ID_ATTRIBUTE,
} from "./session-motion";
import {
  BranchGlyph,
  CheckGlyph,
  EmptyState,
  SessionOptions,
  SessionOptionsButton,
  SessionsPanel,
  WorkspaceGlyph,
} from "./session-parts";
import { SendIcon, StopIcon } from "./settings-icons";
import { SettingsPanel, type SettingsPanelProps } from "./settings-panel";

/** Handed up rather than performed here: the row knows sessions, not IPC. */
export interface SessionWriteHandlers {
  sendMessage: (session: DisplaySession, text: string) => Promise<ProviderMessageResult>;
  runAction: (session: DisplaySession, actionId: string) => Promise<ProviderControlResult>;
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
 * Everything here answers back onto the same line — sending, sent, or the
 * provider's refusal — because a write is the user's own act and its outcome
 * may not vanish into a log.
 */
function SessionRowActions({
  session,
  writes,
}: {
  session: DisplaySession;
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
        // The draft has become the session's; the field empties for the next.
        setDraft("");
        setFeedback(`Sent to ${session.provider}`);
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

  return (
    <div className="row-actions">
      {session.canMessage ? (
        // biome-ignore lint/a11y/noStaticElementInteractions: the click is swallowed, not handled — the pill is where the row's open-on-press must not reach.
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
      {session.actions.map((action) => (
        <RowActionButton
          key={action.id}
          action={action}
          pendingAction={pendingAction}
          busy={busy}
          onRun={(actionId) => void runAction(actionId)}
        />
      ))}
      {feedback ? <small className="row-feedback">{feedback}</small> : null}
    </div>
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
  onOpen,
  writes,
}: {
  session: DisplaySession;
  index: number;
  now: number;
  leaving: boolean;
  /** Whether this row is drawn inside its workspace's tray. */
  inWorkspaceTray?: boolean;
  onOpen: (session: DisplaySession) => void;
  writes: SessionWriteHandlers;
}): React.JSX.Element {
  const withActions = session.canMessage || session.actions.length > 0;
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
    style: { "--row-index": index + 1 } as React.CSSProperties,
  };
  // The identifier that tells this row from its neighbours: the branch, or the
  // repository where a provider reported no branch. The glyph belongs to the
  // branch alone — under a repository name it would say the wrong thing. A row
  // inside a tray leaves a bare repository unsaid: the tray's own header has
  // already named it, once, for every chat it holds.
  const place = session.branch ?? (inWorkspaceTray ? undefined : session.repository);
  // A lone chat is its workspace: with no tray to name it, the row takes the
  // workspace's name — the name the user knows the work by — because the
  // chat's own generated name only earns a line once there is a sibling to
  // tell it from.
  const title = !inWorkspaceTray && session.workspace ? session.workspace.name : session.title;
  const content = (
    <>
      <span
        className="row-mark"
        title={session.model ? `${session.provider} · ${session.model}` : session.provider}
      >
        <span className="visually-hidden">{session.provider}</span>
        <ProviderMark providerId={session.providerId} />
        {session.location === SESSION_LOCATION.CLOUD ? <CloudBadge /> : null}
      </span>
      <span className="row-copy">
        <strong>{title}</strong>
        <small className="row-doing">
          {session.urgency === SESSION_URGENCY.WORKING ? (
            <span className="row-spinner" aria-hidden="true" />
          ) : null}
          {session.urgency === SESSION_URGENCY.COMPLETE ? <CheckGlyph /> : null}
          <span className="row-doing-text">
            {session.detail === session.label ? null : (
              <span className="visually-hidden">{session.label}. </span>
            )}
            {session.detail}
          </span>
        </small>
        {place ? (
          <small className="row-place">
            {session.branch ? <BranchGlyph /> : null}
            <span>{place}</span>
          </small>
        ) : null}
      </span>
      <small className="row-when">{observedAgoLabel(session.observedAt, now)}</small>
    </>
  );

  if (!withActions) {
    if (!session.openable) return <article {...shared}>{content}</article>;
    return (
      <button
        {...shared}
        type="button"
        // The row's own lines are its accessible name, which already reads as
        // the session; the title says what pressing it does, and names the agent
        // because that is the window you are about to be in.
        title={`Open in ${session.provider}`}
        onClick={() => onOpen(session)}
      >
        {content}
      </button>
    );
  }

  return (
    // The row is the press target, controls and all: the gaps beside the
    // composer are still the session, and a press there must not be a press on
    // nothing. The first line stays a real button — it is what the keyboard
    // and a reader press, and its click bubbles here rather than opening twice
    // — while every control below swallows its own click, so the only presses
    // that open are the ones that meant the session itself.
    // biome-ignore lint/a11y/useKeyWithClickEvents: the row's keyboard path is the first line's real button, whose activation bubbles to this handler.
    // biome-ignore lint/a11y/noStaticElementInteractions: same press target as the button it wraps, widened to the row's own surface.
    <article
      {...shared}
      data-actions="true"
      {...(session.openable ? { "data-openable": "true", onClick: () => onOpen(session) } : {})}
    >
      {session.openable ? (
        <button type="button" className="row-main" title={`Open in ${session.provider}`}>
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

/**
 * One run of the list, tray or not. Several of one workspace's chats sit in
 * the tray: a single card that visibly contains them, named once at its top —
 * the workspace's name on the left, and at the far end the glyph leading the
 * repository — with the chats divided by hairlines inside.
 * A workspace holding one chat earns no tray — its row already says
 * everything the tray would — and an ungrouped session never does; either
 * way the wrapper stays, drawing as nothing. It has to: a workspace crosses
 * between one chat and several as siblings come and go, and if that crossing
 * changed the row's parent element, React would remount the row and wipe a
 * follow-up someone was typing into it. The chrome is a class, never a
 * different tree.
 *
 * The header is furniture rather than a session — it opens nothing and takes
 * nothing — and it names the tray in the reading order the same way it does
 * on screen: the workspace once, then its chats. A tray is a member of the
 * arrival stack in its rows' stead: it fans in at its lead row's turn, and
 * the rows ride it rather than fanning a second time inside it. A wrapper
 * that draws as nothing leaves its row in the stack exactly as before.
 */
function SessionRun({
  run,
  children,
}: {
  run: SessionListRun;
  children: React.ReactNode;
}): React.JSX.Element {
  const tray = runDrawsTray(run);
  return (
    <section
      className={tray ? "workspace-tray" : "session-run"}
      {...(tray && run.workspace
        ? {
            // The tray is a slot of the list in its own right: measured by
            // this id, it travels to a re-sorted seat carrying its rows,
            // which are translated only by their movement within it.
            [WORKSPACE_TRAY_ID_ATTRIBUTE]: run.workspace.id,
            style: { "--row-index": (run.indexes[0] ?? 0) + 1 } as React.CSSProperties,
          }
        : {})}
    >
      {/* Held in its slot by the null, so the header appearing or leaving can
          never reseat the keyed rows beside it. */}
      {tray ? (
        <header className="workspace-tray-header">
          <span className="workspace-tray-name">{run.workspace?.name}</span>
          <span className="workspace-tray-meta">
            <WorkspaceGlyph />
            {run.repository ? <span>{run.repository}</span> : null}
          </span>
        </header>
      ) : null}
      {children}
    </section>
  );
}

export interface PanelBodyProps {
  list: ArrangedSessions;
  view: SessionView;
  onViewChange: (view: SessionView) => void;
  /**
   * The instant the rows' ages are read against. Passed down rather than read
   * here, because only the app knows which clock is honest: the wall clock for
   * live sessions, the fixture's own epoch for fixture rows.
   */
  now: number;
  /** Sends the pressed session to its provider, wherever the provider keeps it. */
  onOpenSession: (session: DisplaySession) => void;
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
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  settings: SettingsPanelProps;
}

/** Full-width rows that unfold out of the capsule, one session per line. */
export function PanelBody({
  list,
  view,
  onViewChange,
  now,
  onOpenSession,
  writes,
  ask,
  onAskEngaged,
  askShortcut,
  offerOptions,
  optionsOpen,
  onOptionsToggle,
  tab,
  onTabChange,
  settings,
}: PanelBodyProps): React.JSX.Element {
  const sessionListRef = useSessionReorderMotion();
  const rows = useRoster(list.sessions, sessionListRef);
  return (
    <div className="body">
      {/* The tab bar says what you are looking at; the options button says how
          it is being shown. One line, because the second is only ever a
          qualifier on the first. */}
      <div className="panel-header">
        <TabBar tab={tab} onTabChange={onTabChange} />
        {offerOptions ? (
          <SessionOptionsButton list={list} open={optionsOpen} onToggle={onOptionsToggle} />
        ) : null}
      </div>
      {tab === PANEL_TAB.SETTINGS ? (
        <SettingsPanel {...settings} />
      ) : (
        <SessionsPanel className="session-view">
          {offerOptions && optionsOpen ? (
            <SessionOptions list={list} view={view} onViewChange={onViewChange} />
          ) : null}
          <div className="session-list" ref={sessionListRef}>
            {rows.length === 0 ? (
              <EmptyState />
            ) : (
              // Runs are read over the drawn order, leaving rows and all: a
              // fading chat still holds its slot in its tray, and the tray
              // may not close around it until it has gone.
              sessionListRuns(rows.map((row) => row.item)).map((run) => {
                const tray = runDrawsTray(run);
                const lead = rows[run.indexes[0] ?? 0];
                // A workspace run is keyed by the workspace however many chats
                // it holds, so crossing between one and several keeps the same
                // wrapper — and the rows inside it — mounted. An ungrouped
                // session is its own run, keyed by itself.
                const runKey = run.workspace?.id ?? lead?.item.id ?? "";
                return (
                  <SessionRun key={runKey} run={run}>
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
                          onOpen={onOpenSession}
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
            {...(askShortcut ? { shortcut: askShortcut } : {})}
          />
        </SessionsPanel>
      )}
    </div>
  );
}
