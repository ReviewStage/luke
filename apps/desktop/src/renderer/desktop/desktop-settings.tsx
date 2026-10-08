import { PRODUCT_SURFACE_EVENT } from "@sidecar/analytics";
import { BackIcon, LaptopIcon } from "@sidecar/panel";
import { SETTINGS_VIEW_COUNTED_AS } from "@sidecar/settings";
import { useState } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";
import { SETTINGS_PAGE } from "../settings/pages";
import {
  SettingsPanel,
  type SettingsPanelProps,
  settingsRowsInput,
} from "../settings/settings-panel";
import {
  landOnSettingsRow,
  type SettingsSearchEntry,
  SettingsSearchField,
  SettingsSearchResults,
  searchSettings,
  settingsSearchEntries,
} from "../settings-search";
import { SETTINGS_SUBVIEW_LIST, SETTINGS_VIEW, type SettingsView } from "../settings-views";
import { commandKeyshortcuts, ShortcutGlyphs } from "../tooltip";
import { SidebarResizeEdge, useSidebarEdge } from "./desktop-sidebar";
import type { SidebarCollapse } from "./sidebar-collapse";

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
 *
 * A query turns the list into what it found, and only the field changes it:
 * pressing a result opens the page beside the results and leaves them
 * standing, so the next result is one press away, and clearing the field
 * brings the list back. The query lives here, so it lasts as long as Settings
 * stays open.
 *
 * The list is as wide as the plans' sidebar and resizes it from its own edge,
 * but never folds: a drag past the least width holds there, because Settings
 * has no other way back to its pages.
 */
export function DesktopSettings({
  sidebar,
  settings,
  onSearchEngaged,
  onBack,
}: {
  sidebar: SidebarCollapse;
  settings: SettingsPanelProps;
  /** The caret entering or leaving the search field, which holds the panel open. */
  onSearchEngaged: (engaged: boolean) => void;
  /** Leaves Settings for the plans. */
  onBack: () => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState<SettingsSearchEntry>();
  useAppCommand(APP_COMMAND.BACK, onBack);
  const pages: readonly SettingsView[] = [SETTINGS_VIEW.ROOT, ...SETTINGS_SUBVIEW_LIST];
  const shown = pageOf(settings.view);
  const rows = settingsRowsInput(settings);
  // Built only while a query stands: an empty field searches nothing.
  const search =
    rows && query !== "" ? searchSettings(settingsSearchEntries(rows), query) : undefined;
  const open = (view: SettingsView) => {
    if (view !== SETTINGS_VIEW.ROOT) {
      window.sidecar.recordSurfaceEvent(PRODUCT_SURFACE_EVENT.SETTINGS_VIEW_OPEN, {
        settings_view: SETTINGS_VIEW_COUNTED_AS[view],
      });
    }
    settings.onViewChange(view);
  };
  const changeQuery = (next: string) => {
    setQuery(next);
    setOpened(undefined);
  };
  // The page the result named opens and the view follows to the row itself.
  // Fire-and-forget: the seek gives itself up after its own frame limit.
  const openResult = (entry: SettingsSearchEntry) => {
    setOpened(entry);
    settings.onViewChange(entry.page);
    landOnSettingsRow(entry.id);
  };
  const first = search?.groups[0]?.items[0];
  // The opened result stays marked only while its page is the one showing: a
  // page turned some other way, Escape or a voice request, leaves it.
  const marked = opened?.page === settings.view ? opened.id : undefined;
  const edge = useSidebarEdge(sidebar);

  return (
    <div className="desktop-settings">
      <nav className="settings-pages" aria-label="Settings pages">
        <div className="desktop-drag-strip" />
        <button
          type="button"
          className="sidebar-item settings-pages-back"
          aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.BACK)}
          onClick={onBack}
        >
          <BackIcon />
          Back to plans
          <ShortcutGlyphs command={APP_COMMAND.BACK} className="row-shortcut" />
        </button>
        <h1 className="settings-pages-title">Settings</h1>
        <SettingsSearchField
          query={query}
          onQueryChange={changeQuery}
          onSubmit={() => {
            if (first) openResult(first);
          }}
          onEngagedChange={onSearchEngaged}
        />
        <div className="sidebar-section">
          {search ? (
            <SettingsSearchResults search={search} opened={marked} onOpen={openResult} />
          ) : (
            <ul>
              {pages.map((view) => {
                const page = pageOf(view);
                return (
                  <li key={view}>
                    <button
                      type="button"
                      className="sidebar-item"
                      aria-current={view === settings.view ? "page" : undefined}
                      onClick={() => open(view)}
                    >
                      {page.icon}
                      {page.title}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {/* Last, so the drag strip above the way back does not take the edge's top from it. */}
        <SidebarResizeEdge edge={edge} />
      </nav>
      <section className="settings-page" aria-label={shown.title}>
        <header className="desktop-toolbar">
          <div className="desktop-toolbar-heading">
            <h1 className="desktop-toolbar-title">{shown.title}</h1>
          </div>
        </header>
        <div className="settings-page-scroll">
          <SettingsPanel {...settings} />
        </div>
      </section>
    </div>
  );
}
