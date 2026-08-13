import { SESSION_LOCATION } from "@sidecar/core";
import { PANEL_TAB, type PanelTab, TabBar } from "./panel-tabs";
import { CloudBadge, ProviderMark } from "./provider-marks";
import type { DisplaySession } from "./session-model";
import { EmptyState, SessionsPanel, StateChip } from "./session-parts";
import { SettingsPanel, type SettingsPanelProps } from "./settings-panel";

export interface PanelBodyProps {
  sessions: readonly DisplaySession[];
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  settings: SettingsPanelProps;
}

/** Full-width rows that unfold out of the capsule, one session per line. */
export function PanelBody({
  sessions,
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
        <SessionsPanel className="session-list">
          {sessions.length === 0 ? (
            <EmptyState />
          ) : (
            sessions.map((session, index) => (
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
                  <small>
                    {session.provider} · {session.detail}
                  </small>
                </span>
                <StateChip state={session.state} label={session.label} />
              </article>
            ))
          )}
        </SessionsPanel>
      )}
    </div>
  );
}
