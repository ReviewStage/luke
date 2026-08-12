export const PANEL_TAB = {
  SESSIONS: "sessions",
  SETTINGS: "settings",
} as const;

export type PanelTab = (typeof PANEL_TAB)[keyof typeof PANEL_TAB];

interface PanelTabDescriptor {
  id: PanelTab;
  label: string;
}

export const PANEL_TABS: readonly PanelTabDescriptor[] = [
  { id: PANEL_TAB.SESSIONS, label: "Sessions" },
  { id: PANEL_TAB.SETTINGS, label: "Settings" },
];

export function panelTabId(tab: PanelTab): string {
  return tab === PANEL_TAB.SETTINGS ? "panel-tab-settings" : "panel-tab-sessions";
}

export function panelPanelId(tab: PanelTab): string {
  return tab === PANEL_TAB.SETTINGS ? "panel-view-settings" : "panel-view-sessions";
}

export function TabBar({
  tab,
  onTabChange,
}: {
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
}): React.JSX.Element {
  const activeIndex = PANEL_TABS.findIndex((candidate) => candidate.id === tab);

  return (
    <div
      className="tab-bar"
      role="tablist"
      aria-label="Panel sections"
      style={
        {
          "--tab-count": PANEL_TABS.length,
          "--tab-index": Math.max(0, activeIndex),
        } as React.CSSProperties
      }
    >
      <span className="tab-thumb" aria-hidden="true" />
      {PANEL_TABS.map((candidate) => (
        <button
          type="button"
          role="tab"
          key={candidate.id}
          id={panelTabId(candidate.id)}
          className="tab"
          data-active={String(candidate.id === tab)}
          aria-selected={candidate.id === tab}
          aria-controls={panelPanelId(candidate.id)}
          onClick={() => onTabChange(candidate.id)}
        >
          {candidate.label}
        </button>
      ))}
    </div>
  );
}
