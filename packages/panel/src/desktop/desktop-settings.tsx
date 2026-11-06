import { ACCOUNT_STATUS } from "@repo/credentials/snapshot";
import { PRODUCT_SURFACE_EVENT } from "@repo/features/analytics";
import { INTEGRATION_PROVIDER_LIST } from "@repo/features/integration-wire";
import { LINK_PLACE } from "@repo/features/link-grammar";
import { PRODUCT_NAME } from "@repo/features/product-name";
import type { Workspace } from "@repo/features/workspace-wire";
import { type HostCapability, NO_EXPERIMENTS, SETTINGS_VIEW_COUNTED_AS } from "@repo/settings";
import {
  SETTINGS_PAGE_GROUP,
  SETTINGS_VIEW,
  type SettingsPageGroup,
  type SettingsView,
} from "@repo/settings/settings-views";
import { APP_COMMAND } from "@repo/settings/shortcuts";
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
  TEXT_FONT,
  TEXT_VARIANT,
  Text,
  TOOLBAR_LOOK,
  useMenu,
  useRovingKeys,
} from "@repo/ui";
import { integrationNamed } from "@repo/ui/integration-search";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useAppCommand } from "../app-commands.js";
import { appPlatform } from "../app-platform.js";
import { useListEdge, useScreenRef, useScreenSplit } from "../column-split.js";
import { LinkWorkspaceProvider, useCopyLinkItem } from "../copy-link-item.js";
import type { NavigationHistory } from "../navigation-history.js";
import { SettingsPageLink } from "../open-settings.js";
import { revealWithin, scrollerOf } from "../scroll-within.js";
import {
  settingsGroupHeadingOf,
  settingsPageOf,
  shownSettingsPageGroups,
} from "../settings/pages.js";
import { pageResetControl } from "../settings/reset.js";
import { SettingsPanel, type SettingsPanelProps } from "../settings/settings-panel.js";
import { settingsRowsInput, shownWorkspace } from "../settings/settings-rows.js";
import { useSettingsWrites } from "../settings/writes.js";
import {
  bestSettingsStop,
  landOnSettingsRow,
  SettingsSearchField,
  SettingsSearchResults,
  type SettingsSearchStop,
  searchSettings,
  settingsSearchCorpus,
  settingsSearchStopId,
  settingsSearchStops,
} from "../settings-search.js";
import { hiddenColumns, SHELL_ROOM, type ShellRoom } from "../shell-room.js";
import { appStateQuery, selectExperimentChoices } from "../use-app-state.js";
import { ActionMenu } from "./action-menu.js";
import { backPlaceOf } from "./back-place.js";
import { HistoryButtons } from "./desktop-sidebar.js";
import { useNarrowFocus } from "./narrow-focus.js";
import { PhoneHead } from "./phone-head.js";
import { PLACE_LIST, PLACE_LIST_TITLE, PLACE_PAGE, PLACE_SPLIT } from "./place-columns.js";
import type { SidebarCollapse } from "./sidebar-collapse.js";
import { WorkspaceTile } from "./workspace-tile.js";

const SETTINGS_LIST = "Settings";

const SETTINGS_PLACE = "settings";

const SETTINGS_EXIT_PLACE = "tasks";

export interface SettingsStep {
  readonly listed: boolean;
  readonly onList: () => void;
}

function pageDescription(view: SettingsView): ReactNode {
  switch (view) {
    case SETTINGS_VIEW.INTEGRATIONS:
      return (
        <ReplayUnmask>
          Services your {PRODUCT_NAME} agents can use. To use {PRODUCT_NAME} from Claude Code,
          Cursor, or another agent, go to <SettingsPageLink page={SETTINGS_VIEW.MCP} />.
        </ReplayUnmask>
      );
    case SETTINGS_VIEW.MCP:
      return (
        <ReplayUnmask>
          Use {PRODUCT_NAME} from Claude Code, Codex, Cursor, ChatGPT, and other agents. To give
          your {PRODUCT_NAME} agents tools like Linear or Sentry, go to{" "}
          <SettingsPageLink page={SETTINGS_VIEW.INTEGRATIONS} />. For the command line, go to{" "}
          <SettingsPageLink page={SETTINGS_VIEW.CLI} />.
        </ReplayUnmask>
      );
    case SETTINGS_VIEW.CLI:
      return (
        <ReplayUnmask>
          Use {PRODUCT_NAME} from your terminal and your agents with the{" "}
          <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.INHERIT} font={TEXT_FONT.MONO}>
            {PRODUCT_NAME.toLowerCase()}
          </Text>{" "}
          command.
        </ReplayUnmask>
      );
    case SETTINGS_VIEW.HOSTS:
      return (
        <ReplayUnmask>
          Macs and Linux servers of yours that run your agents instead of the cloud. Pick one under
          a task's Runs on.
        </ReplayUnmask>
      );
    default:
      return undefined;
  }
}

const PAGE_ACTIONS = "Settings page actions";

function SettingsPageRow({
  view,
  current,
  onOpen,
}: {
  view: SettingsView;
  current: boolean;
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
          replayUnmasked
          onClose={menu.close}
        />
      )}
    </li>
  );
}

function ListBack({ onList }: { onList: () => void }): React.JSX.Element {
  return <BackButton label={SETTINGS_LIST} place={SETTINGS_PLACE} onBack={onList} />;
}

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
    return (
      <PhoneHead
        place="settings-pages"
        start={exit}
        title={SETTINGS_LIST}
        titleReplayUnmasked
        end={null}
      />
    );
  }
  return (
    <>
      <div className="desktop-drag-strip" />
      <HistoryButtons history={history} room={room} />
      {exit}
      <Text
        as={TEXT_ELEMENT.DIV}
        variant={TEXT_VARIANT.TITLE}
        className={`settings-pages-title ${PLACE_LIST_TITLE}`}
      >
        <ReplayUnmask>{SETTINGS_LIST}</ReplayUnmask>
      </Text>
    </>
  );
}

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
    <section className="settings-nav-group [.settings-nav-group+&]:mt-section-gap">
      <GroupHeader
        label={
          workspace === undefined ? (
            settingsGroupHeadingOf(group, capabilities)
          ) : (
            <ReplayMask>{workspace.name}</ReplayMask>
          )
        }
        glyph={
          workspace === undefined ? undefined : (
            <ReplayMask>
              <WorkspaceTile workspace={workspace} />
            </ReplayMask>
          )
        }
      >
        {children}
      </GroupHeader>
    </section>
  );
}

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
  onExit: () => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [integrationsQuery, setIntegrationsQuery] = useState("");
  const [active, setActive] = useState(-1);
  const listId = useId();
  const page = useRef<HTMLElement>(null);
  const experiments =
    useQuery({ ...appStateQuery, select: selectExperimentChoices }).data ?? NO_EXPERIMENTS;
  const roving = useRovingKeys<HTMLDivElement>();
  if (integrationsQuery !== "" && settings.view !== SETTINGS_VIEW.INTEGRATIONS) {
    setIntegrationsQuery("");
  }
  useAppCommand(APP_COMMAND.EXIT_SETTINGS, onExit);
  const shown = settingsPageOf(settings.view);
  const listed =
    settings.account.status === ACCOUNT_STATUS.SIGNED_IN && settings.workspace
      ? shownWorkspace(settings.workspace)
      : undefined;
  const named = settings.view === SETTINGS_VIEW.WORKSPACE && listed !== undefined;
  const title = named ? listed.name : shown.title;
  const writes = useSettingsWrites();
  const rows = settingsRowsInput(settings);
  const split = useScreenSplit(room);
  const reset = pageResetControl(
    settings.view,
    settings.settings,
    writes,
    rows,
    split.single ? title : undefined,
  );
  const search =
    rows && query !== "" ? searchSettings(settingsSearchCorpus(rows), query) : undefined;
  const stops = search ? settingsSearchStops(search) : [];
  const open = (view: SettingsView) => {
    appPlatform().recordSurfaceEvent(PRODUCT_SURFACE_EVENT.SETTINGS_VIEW_OPEN, {
      settings_view: SETTINGS_VIEW_COUNTED_AS[view],
    });
    settings.onViewChange(view);
  };
  const changeQuery = (next: string) => {
    setQuery(next);
    setActive(-1);
  };
  const landing = useRef<() => void>(undefined);
  useEffect(() => () => landing.current?.(), []);
  const showStop = (stop: SettingsSearchStop, keyboard: boolean) => {
    landing.current?.();
    landing.current = undefined;
    const { entry } = stop;
    if (entry === undefined) {
      const heading = page.current?.querySelector<HTMLElement>("h1");
      if (stop.page === settings.view && heading) scrollerOf(heading)?.scrollTo({ top: 0 });
      settings.onViewChange(stop.page);
      return;
    }
    const provider = INTEGRATION_PROVIDER_LIST.find((each) => each === entry.id);
    if (entry.page === SETTINGS_VIEW.INTEGRATIONS && provider) {
      setIntegrationsQuery(integrationNamed(provider, query) ? query : "");
    }
    settings.onViewChange(entry.page);
    landing.current = landOnSettingsRow(entry.id, keyboard);
  };
  const stepTo = (index: number) => {
    const stop = stops[index];
    if (stop === undefined) return;
    setActive(index);
    const row = document.getElementById(settingsSearchStopId(listId, index));
    const lines = row === null ? undefined : scrollerOf(row);
    if (row !== null && lines !== undefined) revealWithin(lines, row);
    if (!split.single) showStop(stop, false);
  };
  const choose = (index: number) => {
    const at = index < 0 && search ? bestSettingsStop(search) : index;
    const stop = stops[at];
    if (stop === undefined) return;
    setActive(at);
    showStop(stop, true);
  };
  const edge = useListEdge(sidebar);
  const hidden = hiddenColumns(split.columns, step.listed);
  const screen = useScreenRef(useNarrowFocus(split.columns, step.listed), split.ref);
  const onList = split.single ? step.onList : undefined;
  const pageSearched =
    settings.view === SETTINGS_VIEW.INTEGRATIONS &&
    settings.account.status === ACCOUNT_STATUS.SIGNED_IN &&
    !hidden.item;

  return (
    <div
      ref={screen}
      className={`desktop-settings ${PLACE_SPLIT}`}
      data-single={String(split.single)}
    >
      <nav
        className={`settings-pages ${PLACE_LIST}`}
        aria-label="Settings pages"
        hidden={hidden.list}
      >
        <ListHead room={room} history={history} onExit={onExit} />
        <SettingsSearchField
          find={!pageSearched}
          onFind={hidden.list ? step.onList : undefined}
          query={query}
          onQueryChange={changeQuery}
          results={{
            count: stops.length,
            active,
            listId,
            activeId: active < 0 ? undefined : settingsSearchStopId(listId, active),
            onStep: stepTo,
            onChoose: choose,
          }}
        />
        <LinkWorkspaceProvider value={listed?.slug ?? listed?.id}>
          <Fill className="sidebar-section -m-ring-reach">
            <ScrollArea fade={SCROLL_FADE.BOTH}>
              <div
                className="sidebar-section-body flex min-h-list-held flex-col p-ring-reach"
                {...roving}
              >
                <ReplayUnmask>
                  {search ? (
                    <SettingsSearchResults
                      search={search}
                      listId={listId}
                      active={active}
                      shown={settings.view}
                      onOpen={choose}
                    />
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
                                onOpen={() => open(view)}
                              />
                            ))}
                          </Stack>
                        </PageGroup>
                      ),
                    )
                  )}
                </ReplayUnmask>
              </div>
            </ScrollArea>
          </Fill>
        </LinkWorkspaceProvider>
        {split.single ? null : <ResizeEdge edge={edge} />}
      </nav>
      <section
        ref={page}
        className={`settings-page ${PLACE_PAGE}`}
        aria-label={title}
        hidden={hidden.item}
      >
        <SettingsPage
          key={settings.view}
          title={
            onList === undefined ? (
              <ReplayUnmask>{named ? <ReplayMask>{title}</ReplayMask> : title}</ReplayUnmask>
            ) : (
              title
            )
          }
          titleReplayUnmasked={!named}
          description={pageDescription(settings.view)}
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
    </div>
  );
}
