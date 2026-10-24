import { ACCOUNT_STATUS } from "@luke/credentials/snapshot";
import { PRODUCT_SURFACE_EVENT } from "@luke/features/analytics";
import { INTEGRATION_PROVIDER_LIST } from "@luke/features/integration-wire";
import { LINK_PLACE } from "@luke/features/link-grammar";
import type { Workspace } from "@luke/features/workspace-wire";
import {
  type HostCapability,
  SETTINGS_VIEW_COUNTED_AS,
  settingKeepWords,
  settingsPageKeep,
} from "@luke/settings";
import {
  SETTINGS_PAGE_GROUP,
  SETTINGS_VIEW,
  type SettingsPageGroup,
  type SettingsView,
} from "@luke/settings/settings-views";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import {
  BACK_BUTTON_LOOK,
  BackButton,
  Fill,
  GAP,
  GroupHeader,
  LAYOUT_ELEMENT,
  NAV_CURRENT,
  NavItem,
  ResizeEdge,
  SCROLL_FADE,
  ScrollArea,
  SettingsPage,
  Stack,
  TEXT_ELEMENT,
  TEXT_VARIANT,
  Text,
  TOOLBAR_LOOK,
  useMenu,
  useRovingKeys,
} from "@luke/ui";
import { accountActor } from "@luke/ui/actor-model";
import { integrationNamed } from "@luke/ui/integration-search";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useAppCommand } from "../app-commands.js";
import { appPlatform } from "../app-platform.js";
import { ColumnFoot } from "../call/call-card.js";
import { useListEdge, useScreenRef, useScreenSplit } from "../column-split.js";
import { LinkWorkspaceProvider, useCopyLinkItem } from "../copy-link-item.js";
import type { NavigationHistory } from "../navigation-history.js";
import { AttentionMark } from "../settings/marks.js";
import {
  settingsGroupHeadingOf,
  settingsPageOf,
  shownSettingsPageGroups,
} from "../settings/pages.js";
import { TemplateVersionHistory } from "../settings/plan-template-history.js";
import { PlanTemplatePage } from "../settings/plan-template-page.js";
import { pageResetControl } from "../settings/reset.js";
import {
  SettingsPanel,
  type SettingsPanelProps,
  voicePageAttention,
} from "../settings/settings-panel.js";
import { settingsRowsInput, shownWorkspace } from "../settings/settings-rows.js";
import { useSettingsWrites } from "../settings/writes.js";
import {
  landOnSettingsRow,
  type SettingsSearchEntry,
  SettingsSearchField,
  SettingsSearchResults,
  searchSettings,
  settingsSearchEntries,
} from "../settings-search.js";
import { hiddenColumns, SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { useExperimentChoices } from "../use-app-state.js";
import { ActionMenu } from "./action-menu.js";
import { backPlaceOf } from "./back-place.js";
import { HistoryButtons } from "./desktop-sidebar.js";
import { useNarrowFocus } from "./narrow-focus.js";
import { PhoneHead } from "./phone-head.js";
import type { SidebarCollapse } from "./sidebar-collapse.js";
import { WorkspaceTile } from "./workspace-tile.js";

/** What the way back from a page to the page list says, in a narrow room. */
const SETTINGS_LIST = "Settings";

/** Where the way back from a page to the page list leads, as a hint names it. */
const SETTINGS_PLACE = "settings";

/** Where Settings' way out leads where no step stands behind it, as a hint names it. */
const SETTINGS_EXIT_PLACE = "tasks";

/** Whether Settings stands on its page list rather than on a page, which a narrow room draws one at a time. */
export interface SettingsStep {
  readonly listed: boolean;
  /** Goes back from the page to the list. */
  readonly onList: () => void;
}

/** What a page's row's right-click menu is called. */
const PAGE_ACTIONS = "Settings page actions";

/** A page's row in the sidebar: its glyph and title, a note where one stands, and a right-click offering the page's Copy link. */
function SettingsPageRow({
  view,
  current,
  note,
  onOpen,
}: {
  view: SettingsView;
  current: boolean;
  note: string | undefined;
  onOpen: () => void;
}): React.JSX.Element {
  const page = settingsPageOf(view);
  const menu = useMenu(true);
  const copyLink = useCopyLinkItem()({ kind: LINK_PLACE.SETTINGS, page: view });
  return (
    <li>
      <NavItem
        icon={page.icon}
        current={current ? NAV_CURRENT.PAGE : undefined}
        roving
        mark={note ? <AttentionMark note={note} /> : undefined}
        onClick={onOpen}
        contextMenu={copyLink === undefined ? undefined : menu.contextMenu()}
      >
        {page.title}
      </NavItem>
      {menu.drawn === undefined || copyLink === undefined ? null : (
        <ActionMenu
          label={PAGE_ACTIONS}
          menu={menu.drawn}
          groups={[[copyLink]]}
          onClose={menu.close}
        />
      )}
    </li>
  );
}

/** The way back to the page list, which leads a page's bar in a narrow room. */
function ListBack({ onList }: { onList: () => void }): React.JSX.Element {
  return <BackButton label={SETTINGS_LIST} place={SETTINGS_PLACE} onBack={onList} />;
}

/**
 * The head of the page list: the window's drag strip, the history's Back and
 * Forward, the way out, and the list's label; or on a phone its header, the
 * way out alone and Settings centred, the history's buttons left out since
 * the way out is the one.
 */
function ListHead({
  room,
  history,
  onExit,
}: {
  room: ShellRoom;
  history: NavigationHistory;
  onExit: () => void;
}): React.JSX.Element {
  const exit = (
    <BackButton
      look={room === SHELL_ROOM.NARROW ? BACK_BUTTON_LOOK.HEADER : BACK_BUTTON_LOOK.COLUMN}
      label="Back"
      place={backPlaceOf(history, SETTINGS_EXIT_PLACE)}
      command={APP_COMMAND.EXIT_SETTINGS}
      onBack={onExit}
    />
  );
  if (room === SHELL_ROOM.NARROW) {
    return <PhoneHead place="settings-pages" start={exit} title={SETTINGS_LIST} end={null} />;
  }
  return (
    <>
      <div className="desktop-drag-strip" />
      <HistoryButtons history={history} room={room} />
      {exit}
      {/* A label for the list, no heading: the page beside it is named once, by its own header's `h1`. */}
      <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.TITLE} className="settings-pages-title">
        {SETTINGS_LIST}
      </Text>
    </>
  );
}

/** A group of pages under its head, which folds them: the listed workspace's tile and name over its own group, the group's words otherwise. */
function PageGroup({
  group,
  listed,
  capabilities,
  children,
}: {
  group: SettingsPageGroup;
  listed: Workspace | undefined;
  capabilities: readonly HostCapability[];
  children: ReactNode;
}): React.JSX.Element {
  const workspace = group === SETTINGS_PAGE_GROUP.WORKSPACE ? listed : undefined;
  return (
    <section className="settings-nav-group">
      <GroupHeader
        label={workspace?.name ?? settingsGroupHeadingOf(group, capabilities)}
        glyph={workspace === undefined ? undefined : <WorkspaceTile workspace={workspace} />}
        fold={{ defaultOpen: true }}
      >
        {children}
      </GroupHeader>
    </section>
  );
}

/**
 * Settings as a desktop app lays them out: the sidebar turns into the list of
 * pages, with the way back to tasks at its head and the search above the
 * list, and the chosen page stands beside it under its own title. The pages
 * are the panel's own, drawn by `SettingsPanel`, and this list is the one
 * index of them, the Voice row wearing its attention mark. It groups them
 * under three headings, as Linear and Notion group theirs: the workspace the
 * tasks' sidebar lists, by its tile and name, over its Members and GitHub;
 * Account, over what is the account's whichever workspace is listed; and
 * This Mac. Settings opens on Profile, Account's first page, with the caret
 * in the search. The page is a document: its title heads its column, under
 * the page's bar (`SettingsPage`), which picks up the title once it scrolls
 * away, and a page's reset ends the title's line. One quiet line under the
 * title says where the page's settings are kept (`settingsPageKeep`): on this
 * Mac, in this browser on the web, or following the account or the workspace;
 * a row kept elsewhere says so under its own label. The Workspace page's title is
 * the listed workspace's name, since that is the workspace it shows. The
 * plan template is the one page drawn apart from the panel: it is a plan's
 * page, document and all
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
 * The list is as wide as the tasks' sidebar and resizes it from its own edge,
 * but never folds: a drag past the least width holds there, because Settings
 * has no other way back to its pages. Back and forward stand at the right of
 * its title-bar row, where the sidebar keeps them, and Back at the list's
 * head is the one way out a newcomer sees: it and Escape both leave as the
 * back button would.
 *
 * A narrow room, or Settings narrower than the split's line by its own
 * width (`column-split.ts`), shows the list or the page, one at a time, the
 * other column hidden (`hiddenColumns`): Settings opens on its list, a page
 * chosen there, by a search, or by a link stands alone the whole width, and a
 * way back at its head returns to the list. The list's edge resizes nothing
 * then. In a narrow room each is headed as a phone heads every page
 * (`phone-head.tsx`): the list by its way out and Settings centred, with no
 * Back and Forward; a page by the way back to the list, the name its bar
 * picks up centred, and its reset in a ⋯. Wider, the list keeps the
 * window's head, and a page standing alone the phone's, under the title
 * bar's row.
 */
export function DesktopSettings({
  sidebar,
  room,
  step,
  history,
  settings,
  onExit,
}: {
  sidebar: SidebarCollapse;
  room: ShellRoom;
  step: SettingsStep;
  history: NavigationHistory;
  settings: SettingsPanelProps;
  /** Leaves Settings for wherever it was opened from. */
  onExit: () => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [integrationsQuery, setIntegrationsQuery] = useState("");
  const [opened, setOpened] = useState<SettingsSearchEntry>();
  const [templateHistory, setTemplateHistory] = useState(false);
  const experiments = useExperimentChoices();
  // The pages, or the results of a search, are one Tab stop that ↑↓ walk.
  const roving = useRovingKeys<HTMLDivElement>();
  // The template's history is the template page's, so a page turned another way, by a shortcut or a voice request, leaves it.
  if (templateHistory && settings.view !== SETTINGS_VIEW.PLAN_TEMPLATE) setTemplateHistory(false);
  // The Integrations page's search is the page's, so turning to another page leaves it.
  if (integrationsQuery !== "" && settings.view !== SETTINGS_VIEW.INTEGRATIONS) {
    setIntegrationsQuery("");
  }
  // Note that the template's version history answers Escape itself, back to the template, so Settings does not then.
  useAppCommand(APP_COMMAND.EXIT_SETTINGS, templateHistory ? undefined : onExit);
  const shown = settingsPageOf(settings.view);
  // The workspace the tasks' sidebar lists, which heads the first group and is the one the Workspace page shows.
  const listed =
    settings.account.status === ACCOUNT_STATUS.SIGNED_IN && settings.workspace
      ? shownWorkspace(settings.workspace)
      : undefined;
  const title = settings.view === SETTINGS_VIEW.WORKSPACE && listed ? listed.name : shown.title;
  const voiceNote = voicePageAttention(settings.microphone);
  const writes = useSettingsWrites();
  const rows = settingsRowsInput(settings);
  // A page standing alone is headed as a phone's, whose ⋯ holds its reset.
  const split = useScreenSplit(room);
  const reset = pageResetControl(
    settings.view,
    settings.settings,
    writes,
    rows,
    split.single ? title : undefined,
  );
  // Where the page's settings are kept, one quiet line under its title; none before the settings arrive or on a page keeping nothing.
  const pageKeep = rows ? settingsPageKeep(settings.view, rows) : undefined;
  const keepLine =
    pageKeep === undefined ? undefined : settingKeepWords(pageKeep, settings.capabilities);
  // Built only while a query stands: an empty field searches nothing.
  const search =
    rows && query !== "" ? searchSettings(settingsSearchEntries(rows), query) : undefined;
  const open = (view: SettingsView) => {
    appPlatform().recordSurfaceEvent(PRODUCT_SURFACE_EVENT.SETTINGS_VIEW_OPEN, {
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
  const edge = useListEdge(sidebar);
  const hidden = hiddenColumns(split.columns, step.listed);
  const screen = useScreenRef(useNarrowFocus(split.columns, step.listed), split.ref);
  const onList = split.single ? step.onList : undefined;
  // The page with a search of its own takes Command-F while it shows; a page hidden behind the list does not.
  const pageSearched =
    settings.view === SETTINGS_VIEW.INTEGRATIONS &&
    settings.account.status === ACCOUNT_STATUS.SIGNED_IN &&
    !hidden.item;

  // The template's version history takes the whole window as a plan's does, and leaves for the template,
  // the call card at the foot of its versions as it was at the page list's.
  if (templateHistory) {
    return (
      <TemplateVersionHistory
        sidebar={sidebar}
        room={room}
        history={history}
        account={settings.account}
        onExit={() => setTemplateHistory(false)}
      />
    );
  }
  return (
    <div ref={screen} className="desktop-settings" data-single={String(split.single)}>
      <nav className="settings-pages" aria-label="Settings pages" hidden={hidden.list}>
        <ListHead room={room} history={history} onExit={onExit} />
        <SettingsSearchField
          find={!pageSearched}
          onFind={hidden.list ? step.onList : undefined}
          query={query}
          onQueryChange={changeQuery}
          onSubmit={() => {
            if (first) openResult(first);
          }}
        />
        <LinkWorkspaceProvider value={listed?.slug ?? listed?.id}>
          <Fill className="sidebar-section">
            <ScrollArea fade={SCROLL_FADE.BOTH}>
              <div className="sidebar-section-body" {...roving}>
                {search ? (
                  <SettingsSearchResults search={search} opened={marked} onOpen={openResult} />
                ) : (
                  shownSettingsPageGroups(settings.capabilities, experiments).map(
                    ({ group, pages }) => (
                      <PageGroup
                        key={group}
                        group={group}
                        listed={listed}
                        capabilities={settings.capabilities}
                      >
                        <Stack as={LAYOUT_ELEMENT.UL} gap={GAP.ROW}>
                          {pages.map((view) => (
                            <SettingsPageRow
                              key={view}
                              view={view}
                              current={view === settings.view}
                              note={view === SETTINGS_VIEW.VOICE ? voiceNote : undefined}
                              onOpen={() => open(view)}
                            />
                          ))}
                        </Stack>
                      </PageGroup>
                    ),
                  )
                )}
              </div>
            </ScrollArea>
          </Fill>
        </LinkWorkspaceProvider>
        <ColumnFoot />
        {/* Last, so the drag strip above the way back does not take the edge's top from it. */}
        {split.single ? null : <ResizeEdge edge={edge} />}
      </nav>
      {settings.view === SETTINGS_VIEW.PLAN_TEMPLATE ? (
        <PlanTemplatePage
          account={
            settings.account.status === ACCOUNT_STATUS.SIGNED_IN
              ? accountActor(settings.account)
              : undefined
          }
          keep={keepLine}
          lead={onList === undefined ? undefined : <ListBack onList={onList} />}
          hidden={hidden.item}
          onShowHistory={() => setTemplateHistory(true)}
        />
      ) : (
        <section className="settings-page" aria-label={title} hidden={hidden.item}>
          {/* Keyed to the page, so a page turned to opens at its top rather than where the last one was scrolled. */}
          <SettingsPage
            key={settings.view}
            title={title}
            description={keepLine}
            actions={reset}
            lead={onList === undefined ? undefined : <ListBack onList={onList} />}
            look={onList === undefined ? TOOLBAR_LOOK.WINDOW : TOOLBAR_LOOK.PHONE}
          >
            <SettingsPanel
              {...settings}
              integrationsFilter={{ query: integrationsQuery, onQueryChange: setIntegrationsQuery }}
            />
          </SettingsPage>
        </section>
      )}
    </div>
  );
}
