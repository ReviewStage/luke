import { PANEL_TAB, type PanelTab, TabBar } from "./panel-tabs";
import { ProviderMark } from "./provider-marks";
import type { ArrangedSessions, SessionView } from "./session-model";
import { EmptyState, SessionsPanel, SessionToolbar, StateChip } from "./session-parts";
import { SettingsPanel, type SettingsPanelProps } from "./settings-panel";

export interface PanelBodyProps {
  list: ArrangedSessions;
  view: SessionView;
  onViewChange: (view: SessionView) => void;
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  settings: SettingsPanelProps;
}

/** Full-width rows that unfold out of the capsule, one session per line. */
export function PanelBody({
  list,
  view,
  onViewChange,
  tab,
  onTabChange,
  settings,
}: PanelBodyProps): React.JSX.Element {
  return (
    <div className="body">
      <TabBar tab={tab} onTabChange={onTabChange} />
      {tab === PANEL_TAB.SETTINGS ? (
        <SettingsPanel {...settings} />
      ) : (
        <SessionsPanel className="session-view">
          {/* One session is already both the first and the last, so there is
              nothing a filter or an order could change about it. */}
          {list.total > 1 ? (
            <SessionToolbar list={list} view={view} onViewChange={onViewChange} />
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
                  style={{ "--row-index": index + 2 } as React.CSSProperties}
                >
                  <span className="row-avatar">
                    <ProviderMark providerId={session.providerId} />
                  </span>
                  <span className="row-copy">
                    <strong>{session.title}</strong>
                    <small>
                      {session.provider} · {session.detail}
                    </small>
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
