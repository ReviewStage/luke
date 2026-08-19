import { APP_PANEL_TAB, type AppPanelTab } from "@sidecar/core";
import { cssCustomProperties } from "./css-custom-properties";
import { errandTargetProps, tabErrandTarget } from "./luke-errand";

/**
 * The panel's two tabs, aliased from the core's set rather than declared here
 * — the same rule the sort follows: a spoken ask names a tab in the same words
 * this bar does, and the two must not drift into separate vocabularies.
 */
export const PANEL_TAB = APP_PANEL_TAB;

export type PanelTab = AppPanelTab;

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
  settingsNote,
}: {
  tab: PanelTab;
  onTabChange: (tab: PanelTab) => void;
  /**
   // SAFETY: The preceding check establishes the asserted contract.
   * News the Settings tab wears as a dot while it stands — a newer release
   * waiting to be fetched. The words are the hover's and the screen
   * reader's; the dot alone is the mark.
   */
  settingsNote?: string;
}): React.JSX.Element {
  const activeIndex = PANEL_TABS.findIndex((candidate) => candidate.id === tab);

  return (
    <div
      className="tab-bar"
      role="tablist"
      aria-label="Panel sections"
      style={cssCustomProperties({
        "--tab-count": PANEL_TABS.length,
        "--tab-index": Math.max(0, activeIndex),
      })}
    >
      <span className="tab-thumb" aria-hidden="true" />
      {PANEL_TABS.map((candidate) => (
        <button
          type="button"
          role="tab"
          key={candidate.id}
          id={panelTabId(candidate.id)}
          className="tab"
          // Where an errand lands when Luke was the one who brought this tab
          // forward, so the press he made on your behalf is drawn as a press.
          {...errandTargetProps(tabErrandTarget(candidate.id))}
          data-active={String(candidate.id === tab)}
          aria-selected={candidate.id === tab}
          aria-controls={panelPanelId(candidate.id)}
          onClick={() => onTabChange(candidate.id)}
        >
          {candidate.label}
          {candidate.id === PANEL_TAB.SETTINGS && settingsNote ? (
            <span className="tab-note" title={settingsNote}>
              <span className="visually-hidden">({settingsNote})</span>
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
