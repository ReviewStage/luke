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
  // One session is already both the first and the last, so there is nothing a
  // filter or an order could change about it.
  const showToolbar = list.total > 1;
  // The stack the arrival stagger counts through: the tab bar is 0 and the
  // toolbar is 1, so the rows start at 1 when it is not drawn. Left at 2 they
  // would fan from an empty slot, arriving a beat late from further up than
  // any other row in the panel.
  const firstRowIndex = showToolbar ? 2 : 1;

  return (
    <div className="body">
      <TabBar tab={tab} onTabChange={onTabChange} />
      {tab === PANEL_TAB.SETTINGS ? (
        <SettingsPanel {...settings} />
      ) : (
        <SessionsPanel className="session-view">
          {showToolbar ? (
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
                  style={{ "--row-index": index + firstRowIndex } as React.CSSProperties}
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
