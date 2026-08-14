import { SESSION_LOCATION } from "@sidecar/core";
import { PANEL_TAB, type PanelTab, TabBar } from "./panel-tabs";
import { CloudBadge, ProviderMark } from "./provider-marks";
import type { ArrangedSessions, DisplaySession, SessionView } from "./session-model";
import {
  EmptyState,
  SessionOptions,
  SessionOptionsButton,
  SessionsPanel,
  StateChip,
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
 */
function SessionRow({
  session,
  index,
  onOpen,
}: {
  session: DisplaySession;
  index: number;
  onOpen: (session: DisplaySession) => void;
}): React.JSX.Element {
  const shared = {
    className: "session-row",
    "data-state": session.state,
    style: { "--row-index": index + 1 } as React.CSSProperties,
  };
  const content = (
    <>
      <span className="row-avatar">
        <ProviderMark providerId={session.providerId} />
        {session.location === SESSION_LOCATION.CLOUD ? <CloudBadge /> : null}
      </span>
      <span className="row-copy">
        <strong>{session.title}</strong>
        {session.detail ? <small>{session.detail}</small> : null}
        {/* Only for a user who asked to see it, and only ever the last line:
            the row is a place to recognise a session, not to read it. */}
        {session.transcript ? <small className="row-transcript">{session.transcript}</small> : null}
        <small className="row-context">{session.context}</small>
      </span>
      <StateChip state={session.state} label={session.label} />
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
  onOpenSession,
  offerOptions,
  optionsOpen,
  onOptionsToggle,
  tab,
  onTabChange,
  settings,
}: PanelBodyProps): React.JSX.Element {
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
          <div className="session-list">
            {list.sessions.length === 0 ? (
              <EmptyState />
            ) : (
              list.sessions.map((session, index) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  index={index}
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
