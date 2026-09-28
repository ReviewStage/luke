import { APP_PANEL_TAB, type AppPanelTab } from "@sidecar/guide";
import { cssCustomProperties } from "@sidecar/surface/react-css";

/**
 * The tabs the bar offers, aliased from the core's set rather than declared
 * here: a counted tab change names a tab in the same words this bar does, and
 * the two must not drift into separate vocabularies. Every way into a tab — a
 * press, a key, a composer's return — takes one of these, so a tab outside
 * the set is one nothing can navigate to.
 */
export type ShownPanelTab = AppPanelTab;

/**
 * The two tabs hidden for now (LUKE-350). The body still draws them, so they
 * come back by returning them to the guide's set and to {@link PANEL_TABS};
 * until then no bar, key, or press can reach them, since none takes a
 * {@link PanelTab} wider than {@link ShownPanelTab}.
 */
const HIDDEN_PANEL_TAB = {
  SESSIONS: "sessions",
  CONVERSATION: "conversation",
} as const;

/** Every tab the body can draw: the shown ones and the hidden ones. */
export const PANEL_TAB = { ...APP_PANEL_TAB, ...HIDDEN_PANEL_TAB } as const;

export type PanelTab = (typeof PANEL_TAB)[keyof typeof PANEL_TAB];

interface PanelTabDescriptor {
  id: ShownPanelTab;
  label: string;
}

const PANEL_TABS: readonly PanelTabDescriptor[] = [
  { id: PANEL_TAB.PLANS, label: "Plans" },
  { id: PANEL_TAB.SETTINGS, label: "Settings" },
];

export function panelTabId(tab: PanelTab): string {
  return `panel-tab-${tab}`;
}

export function panelPanelId(tab: PanelTab): string {
  return `panel-view-${tab}`;
}

/** The horizontal tablist's roving-focus destination for one keyboard key. */
export function panelTabForKey(tab: ShownPanelTab, key: string): ShownPanelTab | undefined {
  if (key === "Home") return PANEL_TABS[0]?.id;
  if (key === "End") return PANEL_TABS.at(-1)?.id;
  if (key !== "ArrowLeft" && key !== "ArrowRight") return undefined;
  const current = PANEL_TABS.findIndex((candidate) => candidate.id === tab);
  const offset = key === "ArrowRight" ? 1 : -1;
  return PANEL_TABS[(current + offset + PANEL_TABS.length) % PANEL_TABS.length]?.id;
}

export function TabBar({
  tab,
  onTabChange,
  settingsNote,
}: {
  tab: PanelTab;
  onTabChange: (tab: ShownPanelTab) => void;
  /**
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
          data-active={String(candidate.id === tab)}
          aria-selected={candidate.id === tab}
          aria-controls={panelPanelId(candidate.id)}
          tabIndex={candidate.id === tab ? 0 : -1}
          onClick={() => onTabChange(candidate.id)}
          onKeyDown={(event) => {
            const next = panelTabForKey(candidate.id, event.key);
            if (!next) return;
            event.preventDefault();
            onTabChange(next);
            event.currentTarget.ownerDocument.getElementById(panelTabId(next))?.focus();
          }}
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
