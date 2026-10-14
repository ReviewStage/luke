import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { PRODUCT_SURFACE_EVENT } from "@luke/features/analytics";
import { INTEGRATION_PROVIDER_LIST } from "@luke/features/integration-wire";
import { BackIcon } from "@luke/panel";
import { SETTINGS_VIEW_COUNTED_AS } from "@luke/settings";
import { useEffect, useRef, useState } from "react";
import { APP_COMMAND, APP_SHORTCUTS } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";
import { CALL_CARD_SURFACE, CallCardDock, type CallCardInput } from "../call/call-card";
import { integrationNamed } from "../integration-search";
import type { NavigationHistory } from "../navigation-history";
import { AttentionMark } from "../settings/marks";
import { settingsPageOf } from "../settings/pages";
import { TemplateVersionHistory } from "../settings/plan-template-history";
import { PlanTemplatePage } from "../settings/plan-template-page";
import { pageResetControl } from "../settings/reset";
import {
  SettingsPanel,
  type SettingsPanelProps,
  settingsRowsInput,
  voicePageAttention,
} from "../settings/settings-panel";
import { useSettingsWrites } from "../settings/writes";
import {
  landOnSettingsRow,
  type SettingsSearchEntry,
  SettingsSearchField,
  SettingsSearchResults,
  searchSettings,
  settingsSearchEntries,
} from "../settings-search";
import { SETTINGS_PAGE_LIST, SETTINGS_VIEW, type SettingsView } from "../settings-views";
import { Shortcut } from "../shortcut";
import { commandKeyshortcuts } from "../tooltip";
import { HistoryButtons, SidebarResizeEdge, useSidebarEdge } from "./desktop-sidebar";
import type { SidebarCollapse } from "./sidebar-collapse";

/**
 * Settings as a desktop app lays them out: the sidebar turns into the list of
 * pages, with the way back to plans at its head and the search above the
 * list, and the chosen page stands beside it under its own title. The pages
 * are the panel's own, drawn by `SettingsPanel`, and this list is the one
 * index of them, the Voice row wearing its attention mark. Settings opens on
 * Account, the list's first page. The page has no top bar: its title heads
 * its column, under the window's drag strip, and a page's reset ends the
 * title's line. The plan template is the one page drawn apart from the
 * panel: it is a plan's page, document and all
 * (`../settings/plan-template-page.tsx`), and its version history takes the
 * whole window as a plan's does, Back and Escape leaving it for the page.
 *
 * A query turns the list into what it found, and only the field changes it:
 * pressing a result opens the page beside the results and leaves them
 * standing, so the next result is one press away, and clearing the field
 * brings the list back. The query lives here, so it lasts as long as Settings
 * stays open. The Integrations page has a search of its own, for its
 * integrations and their tools, whose query is held here too: a result of
 * the sidebar's that opens one of its rows hands the query down to it where
 * it finds that integration there, so the page opens on what was asked
 * for, and turning to another page clears it. Command-F lands in the page's
 * field while it shows, and in the sidebar's otherwise.
 *
 * The list is as wide as the plans' sidebar and resizes it from its own edge,
 * but never folds: a drag past the least width holds there, because Settings
 * has no other way back to its pages. Back and forward stand at the right of
 * its title-bar row, where the sidebar keeps them, and Back at the list's
 * head is the one way out a newcomer sees: it and Escape both leave as the
 * back button would.
 */
export function DesktopSettings({
  sidebar,
  history,
  settings,
  call,
  onExit,
}: {
  sidebar: SidebarCollapse;
  history: NavigationHistory;
  settings: SettingsPanelProps;
  /** The call card, at the page list's foot, as the plans' sidebar draws it above its account row. */
  call: CallCardInput | undefined;
  /** Leaves Settings for wherever it was opened from. */
  onExit: () => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [integrationsQuery, setIntegrationsQuery] = useState("");
  const [opened, setOpened] = useState<SettingsSearchEntry>();
  const [templateHistory, setTemplateHistory] = useState(false);
  // The template's history is the template page's, so a page turned another way, by a shortcut or a voice request, leaves it.
  if (templateHistory && settings.view !== SETTINGS_VIEW.PLAN_TEMPLATE) setTemplateHistory(false);
  // The Integrations page's search is the page's, so turning to another page leaves it.
  if (integrationsQuery !== "" && settings.view !== SETTINGS_VIEW.INTEGRATIONS) {
    setIntegrationsQuery("");
  }
  // Note that the template's version history answers Escape itself, back to the template, so Settings does not then.
  useAppCommand(APP_COMMAND.EXIT_SETTINGS, templateHistory ? undefined : onExit);
  const shown = settingsPageOf(settings.view);
  const voiceNote = voicePageAttention(settings.microphone);
  const writes = useSettingsWrites();
  const reset = pageResetControl(settings.view, settings.settings, writes);
  const rows = settingsRowsInput(settings);
  // Built only while a query stands: an empty field searches nothing.
  const search =
    rows && query !== "" ? searchSettings(settingsSearchEntries(rows), query) : undefined;
  const open = (view: SettingsView) => {
    window.luke.recordSurfaceEvent(PRODUCT_SURFACE_EVENT.SETTINGS_VIEW_OPEN, {
      settings_view: SETTINGS_VIEW_COUNTED_AS[view],
    });
    settings.onViewChange(view);
  };
  const changeQuery = (next: string) => {
    setQuery(next);
    setOpened(undefined);
  };
  // The page the result named opens and the view follows to the row itself.
  // The seek gives itself up after its own frame limit, and sooner when the
  // next result is pressed or Settings closes, so it never lands on a row of
  // a page it was not sent to.
  const landing = useRef<() => void>(undefined);
  useEffect(() => () => landing.current?.(), []);
  const openResult = (entry: SettingsSearchEntry) => {
    setOpened(entry);
    // An integration opens with the query handed down where the page's own
    // search finds it by those words, else with that search cleared, so the
    // row the landing seeks is drawn either way.
    const provider = INTEGRATION_PROVIDER_LIST.find((each) => each === entry.id);
    if (entry.page === SETTINGS_VIEW.INTEGRATIONS && provider) {
      setIntegrationsQuery(integrationNamed(provider, query) ? query : "");
    }
    settings.onViewChange(entry.page);
    landing.current?.();
    landing.current = landOnSettingsRow(entry.id);
  };
  const first = search?.groups[0]?.items[0];
  // The opened result stays marked only while its page is the one showing: a
  // page turned some other way, Escape or a voice request, leaves it.
  const marked = opened?.page === settings.view ? opened.id : undefined;
  const edge = useSidebarEdge(sidebar);
  // The page with a search of its own takes Command-F while it shows.
  const pageSearched =
    settings.view === SETTINGS_VIEW.INTEGRATIONS &&
    settings.account.status === ACCOUNT_STATUS.SIGNED_IN;

  // The template's version history takes the whole window as a plan's does, and leaves for the template.
  // Note that the call card floats while it does, as over a plan's history, since the page list it rides is gone.
  if (templateHistory) {
    return (
      <>
        <TemplateVersionHistory
          sidebar={sidebar}
          history={history}
          account={settings.account}
          onExit={() => setTemplateHistory(false)}
        />
        <CallCardDock call={call} surface={CALL_CARD_SURFACE.FLOATING} />
      </>
    );
  }
  return (
    <div className="desktop-settings">
      <nav className="settings-pages" aria-label="Settings pages">
        <div className="desktop-drag-strip" />
        <HistoryButtons history={history} />
        <button
          type="button"
          className="sidebar-item settings-pages-back"
          aria-keyshortcuts={commandKeyshortcuts(APP_COMMAND.EXIT_SETTINGS)}
          onClick={onExit}
        >
          <BackIcon />
          Back
          <Shortcut
            chord={APP_SHORTCUTS[APP_COMMAND.EXIT_SETTINGS].chord}
            className="row-shortcut"
          />
        </button>
        <h1 className="settings-pages-title">Settings</h1>
        <SettingsSearchField
          find={!pageSearched}
          query={query}
          onQueryChange={changeQuery}
          onSubmit={() => {
            if (first) openResult(first);
          }}
        />
        <div className="sidebar-section">
          {search ? (
            <SettingsSearchResults search={search} opened={marked} onOpen={openResult} />
          ) : (
            <ul>
              {SETTINGS_PAGE_LIST.map((view) => {
                const page = settingsPageOf(view);
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
                      {view === SETTINGS_VIEW.VOICE && voiceNote ? (
                        <AttentionMark note={voiceNote} />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="sidebar-foot">
          <CallCardDock call={call} surface={CALL_CARD_SURFACE.SIDEBAR} />
        </div>
        {/* Last, so the drag strip above the way back does not take the edge's top from it. */}
        <SidebarResizeEdge edge={edge} />
      </nav>
      {settings.view === SETTINGS_VIEW.PLAN_TEMPLATE ? (
        <PlanTemplatePage
          signedIn={settings.account.status === ACCOUNT_STATUS.SIGNED_IN}
          onShowHistory={() => setTemplateHistory(true)}
        />
      ) : (
        <section className="settings-page" aria-label={shown.title}>
          <div className="desktop-drag-strip" />
          {/* Keyed to the page, so a page turned to opens at its top rather than where the last one was scrolled. */}
          <div key={settings.view} className="settings-page-scroll">
            <header className="settings-page-head">
              <h1 className="settings-page-title">{shown.title}</h1>
              {reset}
            </header>
            <SettingsPanel
              {...settings}
              integrationsFilter={{ query: integrationsQuery, onQueryChange: setIntegrationsQuery }}
            />
          </div>
        </section>
      )}
    </div>
  );
}
