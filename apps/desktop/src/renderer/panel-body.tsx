import { SESSION_LOCATION, SESSION_STATE } from "@sidecar/core";
import { PANEL_TAB, type PanelTab, TabBar } from "./panel-tabs";
import { CloudBadge, ProviderMark } from "./provider-marks";
import {
  type ArrangedSessions,
  type DisplaySession,
  observedAgoLabel,
  type SessionView,
} from "./session-model";
import {
  SESSION_ROW_ID_ATTRIBUTE,
  SESSION_ROW_LEAVING_ATTRIBUTE,
  useSessionReorderMotion,
  useSessionRoster,
} from "./session-motion";
import {
  BranchGlyph,
  CheckGlyph,
  EmptyState,
  SessionOptions,
  SessionOptionsButton,
  SessionsPanel,
} from "./session-parts";
import { SettingsPanel, type SettingsPanelProps } from "./settings-panel";

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
 */
function SessionRow({
  session,
  index,
  now,
  leaving,
  onOpen,
}: {
  session: DisplaySession;
  index: number;
  now: number;
  leaving: boolean;
  onOpen: (session: DisplaySession) => void;
}): React.JSX.Element {
  const shared = {
    className: "session-row",
    "data-state": session.state,
    // How the reorder measurement finds this row again after a re-sort has
    // moved it, whichever element it is rendered as.
    [SESSION_ROW_ID_ATTRIBUTE]: session.id,
    // A leaving row holds its slot while it fades, but its session is already
    // gone from the model, so nothing may read, focus, or press it.
    [SESSION_ROW_LEAVING_ATTRIBUTE]: String(leaving),
    inert: leaving,
    style: { "--row-index": index + 1 } as React.CSSProperties,
  };
  // The identifier that tells this row from its neighbours: the branch, or the
  // repository where a provider reported no branch. The glyph belongs to the
  // branch alone — under a repository name it would say the wrong thing.
  const place = session.branch ?? session.repository;
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
        <strong>{session.title}</strong>
        <small className="row-doing">
          {session.state === SESSION_STATE.WORKING ? (
            <span className="row-spinner" aria-hidden="true" />
          ) : null}
          {session.state === SESSION_STATE.COMPLETE ? <CheckGlyph /> : null}
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
  offerOptions,
  optionsOpen,
  onOptionsToggle,
  tab,
  onTabChange,
  settings,
}: PanelBodyProps): React.JSX.Element {
  const sessionListRef = useSessionReorderMotion();
  const rows = useSessionRoster(list.sessions, sessionListRef);
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
              rows.map((row, index) => (
                <SessionRow
                  key={row.session.id}
                  session={row.session}
                  index={index}
                  now={now}
                  leaving={row.leaving}
                  onOpen={onOpenSession}
                />
              ))
            )}
          </div>
        </SessionsPanel>
      )}
    </div>
  );
}
