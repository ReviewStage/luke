import { PRODUCT_SURFACE_EVENT } from "@sidecar/analytics";
import { ACCOUNT_STATUS } from "@sidecar/credentials/snapshot";
import { BackIcon, LaptopIcon } from "@sidecar/panel";
import { SETTINGS_VIEW_COUNTED_AS } from "@sidecar/settings";
import { useEffect, useRef, useState } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";
import { CALL_CARD_SURFACE, CallCardDock, type CallCardInput } from "../call/call-card";
import type { NavigationHistory } from "../navigation-history";
import { AttentionMark } from "../settings/marks";
import { SETTINGS_PAGE } from "../settings/pages";
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
import { SETTINGS_SUBVIEW_LIST, SETTINGS_VIEW, type SettingsView } from "../settings-views";
import { commandKeyshortcuts, ShortcutGlyphs } from "../tooltip";
import { HistoryButtons, SidebarResizeEdge, useSidebarEdge } from "./desktop-sidebar";
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
 * are the panel's own, drawn by `SettingsPanel`; its front-page index, with
 * the Voice row's attention mark, and its back buttons are this list's job
 * here, and a page's reset rides the toolbar's right edge beside the page's
 * title. The plan template is the one page drawn apart from the panel: it is
 * a plan's page, document and all (`../settings/plan-template-page.tsx`), and
 * its version history takes the whole window as a plan's does, Back and
 * Escape leaving it for the page.
 *
 * A query turns the list into what it found, and only the field changes it:
 * pressing a result opens the page beside the results and leaves them
 * standing, so the next result is one press away, and clearing the field
 * brings the list back. The query lives here, so it lasts as long as Settings
 * stays open.
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
  const [opened, setOpened] = useState<SettingsSearchEntry>();
  const [templateHistory, setTemplateHistory] = useState(false);
  // The template's history is the template page's, so a page turned another way, by a shortcut or a voice request, leaves it.
  if (templateHistory && settings.view !== SETTINGS_VIEW.PLAN_TEMPLATE) setTemplateHistory(false);
  // Note that the template's version history answers Escape itself, back to the template, so Settings does not then.
  useAppCommand(APP_COMMAND.EXIT_SETTINGS, templateHistory ? undefined : onExit);
  const pages: readonly SettingsView[] = [SETTINGS_VIEW.ROOT, ...SETTINGS_SUBVIEW_LIST];
  const shown = pageOf(settings.view);
  const voiceNote = voicePageAttention(settings.microphone);
  const writes = useSettingsWrites();
  const reset = pageResetControl(settings.view, settings.settings, writes);
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
  // The seek gives itself up after its own frame limit, and sooner when the
  // next result is pressed or Settings closes, so it never lands on a row of
  // a page it was not sent to.
  const landing = useRef<() => void>(undefined);
  useEffect(() => () => landing.current?.(), []);
  const openResult = (entry: SettingsSearchEntry) => {
    setOpened(entry);
    settings.onViewChange(entry.page);
    landing.current?.();
    landing.current = landOnSettingsRow(entry.id);
  };
  const first = search?.groups[0]?.items[0];
  // The opened result stays marked only while its page is the one showing: a
  // page turned some other way, Escape or a voice request, leaves it.
  const marked = opened?.page === settings.view ? opened.id : undefined;
  const edge = useSidebarEdge(sidebar);

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
          <ShortcutGlyphs command={APP_COMMAND.EXIT_SETTINGS} className="row-shortcut" />
        </button>
        <h1 className="settings-pages-title">Settings</h1>
        <SettingsSearchField
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
          <header className="desktop-toolbar">
            <div className="desktop-toolbar-heading">
              <h1 className="desktop-toolbar-title">{shown.title}</h1>
            </div>
            {reset ? <div className="desktop-toolbar-actions">{reset}</div> : null}
          </header>
          <div className="settings-page-scroll">
            <SettingsPanel {...settings} />
          </div>
        </section>
      )}
    </div>
  );
}
