import { SESSION_LOCATION } from "@sidecar/core";
import { PANEL_TAB, type PanelTab, TabBar } from "./panel-tabs";
import { CloudBadge, ProviderMark } from "./provider-marks";
import type { ArrangedSessions, SessionView } from "./session-model";
import {
  EmptyState,
  SessionOptions,
  SessionOptionsButton,
  SessionsPanel,
  StateChip,
} from "./session-parts";
import { SettingsPanel, type SettingsPanelProps } from "./settings-panel";

export interface PanelBodyProps {
  list: ArrangedSessions;
  view: SessionView;
  onViewChange: (view: SessionView) => void;
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
                <article
                  className="session-row"
                  key={session.id}
                  data-state={session.state}
                  style={{ "--row-index": index + 1 } as React.CSSProperties}
                >
                  <span className="row-avatar">
                    <ProviderMark providerId={session.providerId} />
                    {session.location === SESSION_LOCATION.CLOUD ? <CloudBadge /> : null}
                  </span>
                  <span className="row-copy">
                    <strong>{session.title}</strong>
                    {session.detail ? <small>{session.detail}</small> : null}
                    <small className="row-context">{session.context}</small>
                  </span>
                  <StateChip state={session.state} label={session.label} />
                </article>
              ))
            )}
          </div>
        </SessionsPanel>
      )}
    </div>
  );
}
