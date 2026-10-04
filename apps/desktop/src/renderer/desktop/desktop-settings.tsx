import { PRODUCT_SURFACE_EVENT } from "@sidecar/analytics";
import { BackIcon, LaptopIcon, SearchIcon } from "@sidecar/panel";
import { SETTINGS_VIEW_COUNTED_AS } from "@sidecar/settings";
import { SETTINGS_PAGE } from "../settings/pages";
import { SettingsPanel, type SettingsPanelProps } from "../settings/settings-panel";
import { SETTINGS_SUBVIEW_LIST, SETTINGS_VIEW, type SettingsView } from "../settings-views";

/** The front page's name here, where it is one page among the others rather than their index. */
const GENERAL_PAGE = { title: "General", icon: <LaptopIcon /> } as const;

function pageOf(view: SettingsView): { title: string; icon: React.JSX.Element } {
  return view === SETTINGS_VIEW.ROOT ? GENERAL_PAGE : SETTINGS_PAGE[view];
}

/**
 * Settings as a desktop app lays them out: the sidebar turns into the list of
 * pages, with the way back to plans at its head and the search above the
 * list, and the chosen page stands beside it under its own title. The pages
 * are the panel's own, drawn by `SettingsPanel`; its front-page index and its
 * back buttons are this list's job here.
 */
export function DesktopSettings({
  settings,
  searchOpen,
  onSearchToggle,
  onBack,
}: {
  settings: SettingsPanelProps;
  searchOpen: boolean;
  onSearchToggle: () => void;
  /** Leaves Settings for the plans. */
  onBack: () => void;
}): React.JSX.Element {
  const pages: readonly SettingsView[] = [SETTINGS_VIEW.ROOT, ...SETTINGS_SUBVIEW_LIST];
  const shown = pageOf(settings.view);
  const open = (view: SettingsView) => {
    if (view !== SETTINGS_VIEW.ROOT) {
      window.sidecar.recordSurfaceEvent(PRODUCT_SURFACE_EVENT.SETTINGS_VIEW_OPEN, {
        settings_view: SETTINGS_VIEW_COUNTED_AS[view],
      });
    }
    if (searchOpen) settings.onSearchClose();
    settings.onViewChange(view);
  };

  return (
    <div className="desktop-settings">
      <nav className="settings-pages" aria-label="Settings pages">
        <div className="desktop-drag-strip" />
        <button type="button" className="sidebar-item settings-pages-back" onClick={onBack}>
          <BackIcon />
          Back to plans
        </button>
        <h1 className="settings-pages-title">Settings</h1>
        <button
          type="button"
          className="settings-pages-search"
          aria-pressed={searchOpen}
          onClick={onSearchToggle}
        >
          <SearchIcon />
          Search settings
        </button>
        <ul>
          {pages.map((view) => {
            const page = pageOf(view);
            return (
              <li key={view}>
                <button
                  type="button"
                  className="sidebar-item"
                  aria-current={view === settings.view && !searchOpen ? "page" : undefined}
                  onClick={() => open(view)}
                >
                  {page.icon}
                  {page.title}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
      <section className="settings-page" aria-label={shown.title}>
        <header className="desktop-toolbar">
          <div className="desktop-toolbar-heading">
            <h1 className="desktop-toolbar-title">{searchOpen ? "Search" : shown.title}</h1>
          </div>
        </header>
        <div className="settings-page-scroll">
          <SettingsPanel {...settings} searchOpen={searchOpen} />
        </div>
      </section>
    </div>
  );
}
