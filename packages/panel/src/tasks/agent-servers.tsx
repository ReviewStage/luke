import { AGENT_TOOL } from "@repo/features/agent-tools";
import {
  connectionHealth,
  type IntegrationTool,
  toolsCount,
} from "@repo/features/integration-health";
import { SIGN_IN_ACTION } from "@repo/features/integration-sign-in";
import { byName, toolTitle } from "@repo/features/integration-tool-model";
import {
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER,
  INTEGRATION_STATUS,
  integrationConnectionOf,
} from "@repo/features/integration-wire";
import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  RUN_ON_MAC_DESCRIPTION,
  RUN_ON_MAC_REASON,
  RUN_ON_MAC_REASON_WORDS,
  type RunOnMacReason,
  runOnMacDetail,
  type WorkspaceToolRow,
  workspaceToolSections,
  workspaceToolSummary,
} from "@repo/features/workspace-tools-model";
import { SETTINGS_VIEW } from "@repo/settings/settings-views";
import {
  AccountWords,
  AnchoredPopover,
  BANNER_LOOK,
  BackButton,
  Banner,
  BUTTON_VARIANT,
  Button,
  CHIP_LOOK,
  CHIP_WIDTH,
  Chip,
  GearIcon,
  GLYPH_INK,
  GlyphSlot,
  LIST_DENSITY,
  LIST_ROW_CHEVRON,
  LIST_ROW_CURRENT,
  List,
  ListMotion,
  ListRow,
  type ListRowHint,
  McpIcon,
  type MenuPanel,
  MenuSection,
  NO_BACK_KEY,
  OneLine,
  type OneLineHint,
  POPOVER_ALIGN,
  POPOVER_PANEL_LOOK,
  PopoverPanel,
  PROVIDER_MARK_SIZE,
  ProductMark,
  ProviderMark,
  QuietWords,
  RowHint,
  RowHintOptions,
  SCROLL_SIZE,
  ScrollArea,
  SEARCH_FIELD_LOOK,
  SearchField,
  Spinner,
  STATUS_TONE,
  Switch,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  Tooltip,
  VisuallyHidden,
  wholeWordsHint,
} from "@repo/ui";
import {
  namedServers,
  opensTools,
  SERVER_ACTION,
  SERVER_ROW,
  SERVER_SECTION,
  SERVERS_LABEL,
  type ServerRow,
  searchServers,
  serverGroups,
  serverRows,
  serversOnWords,
  switchedServers,
  type ToolHit,
} from "@repo/ui/agent-servers-model";
import { CircleAlertIcon, ICON_SIZE } from "@repo/ui/icons";
import { matchIntegration, shownTools } from "@repo/ui/integration-search";
import { matchesTokens, searchTokens } from "@repo/ui/search-tokens";
import { ReplayMask, ReplayUnmask } from "@repo/ui/session-replay-marks";
import type { VirtualRowsHandle } from "@repo/ui/virtual-rows";
import {
  cloneElement,
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useIntegrationGrant } from "../integration-grant.js";
import type { IntegrationStatuses } from "../integration-statuses.js";
import {
  IntegrationToolDetail,
  IntegrationToolList,
  keepInView,
} from "../integration-tool-list.js";
import { useIntegrationTools } from "../integration-tools.js";
import { OPEN_SETTINGS_LABEL, useOpenSettings } from "../open-settings.js";
import { Highlighted } from "../search-field.js";
import {
  useWorkspaceTools,
  type WorkspaceToolsDoor,
  type WorkspaceToolsRead,
} from "./agent-workspace-tools.js";
import { ServerCard } from "./server-card.js";

export interface AgentServersControl {
  readonly disabled: readonly string[];
  readonly onSwitch: (next: readonly string[]) => void;
  readonly onOpenSettings: () => void;
  readonly workspace?: WorkspaceToolsDoor | undefined;
}

const GITHUB = INTEGRATION_PROVIDER.GITHUB;

const SERVERS_SCROLL_CLASS = "flex max-h-servers-list flex-col";

const SERVER_COUNT_CLASS =
  "agent-servers-count flex-none whitespace-nowrap text-caption-inline text-muted-foreground tabular-nums";

const SERVER_END_CLASS = "ml-auto flex flex-none items-center gap-tight-gap";

export const SERVER_PAGE_HEAD_CLASS =
  "agent-servers-page-head flex h-pane-bar flex-none items-center gap-icon-gap border-b border-border pr-list-inset pl-item-gap [--ui-fold:folded]";

const SERVERS_SETTINGS = "Manage in Settings";

const SERVERS_NONE = "No integrations available";

const SEARCH = {
  PLACEHOLDER: "Search integrations and tools",
  NONE: "No integrations or tools match",
  TOOLS: "Tools",
} as const;

const PAGE = {
  NONE: "No tools match",
} as const;

const WORKSPACE_WORDS = {
  SECTION: "Built in",
  ALWAYS_ON: "Always on",
  ON: "On",
  OFF: "Off",
  READ_FAILED: `${PRODUCT_NAME}'s tools could not be read`,
  TOOLS: `${PRODUCT_NAME}'s tools`,
  READING: `Reading ${PRODUCT_NAME}'s tools…`,
  RUN_ON_MAC_OFF: `${AGENT_TOOL.RUN_ON_MAC} off`,
} as const;

const WORKSPACE_PICK = 0;

const WORKING_ACT = {
  CONNECT: "connect",
  CANCEL: "cancel",
} as const;

type WorkingAct = (typeof WORKING_ACT)[keyof typeof WORKING_ACT];

function keepFieldFocus(event: React.MouseEvent): void {
  event.preventDefault();
}

type Pick = { readonly row: ServerRow; readonly tool?: IntegrationTool };

function ServerSwitch({
  row,
  servers,
}: {
  row: ServerRow;
  servers: AgentServersControl;
}): React.JSX.Element {
  return (
    <Switch
      checked={row.on}
      label={`${row.name} for this agent`}
      onMouseDown={keepFieldFocus}
      onChange={(on, event) => {
        event.stopPropagation();
        servers.onSwitch(switchedServers(servers.disabled, row.connection, on));
      }}
    />
  );
}

function ServerName({ name }: { name: string }): React.JSX.Element {
  return <OneLine className="agent-servers-name flex-initial">{name}</OneLine>;
}

function ServerPageTitle({ name }: { name: string }): React.JSX.Element {
  return (
    <OneLine className="agent-servers-page-title text-section-inline font-ui-semibold text-foreground">
      {name}
    </OneLine>
  );
}

function problemHint(problem: string, said: string | undefined): OneLineHint {
  if (said === undefined) return wholeWordsHint(problem);
  return (line) => <Tooltip label={`${problem} ${said}`}>{line}</Tooltip>;
}

function ServerRowWords({ row }: { row: ServerRow }): React.JSX.Element {
  return (
    <span className="flex min-w-0 flex-auto items-center gap-icon-gap">
      <ServerName name={INTEGRATION_NAME[row.provider]} />
      {row.accountName !== undefined ? (
        <AccountWords words={row.accountName}>
          <ReplayMask>{row.accountName}</ReplayMask>
        </AccountWords>
      ) : null}
      {row.kind === SERVER_ROW.SIGNING_IN ? (
        <Tooltip label={row.note}>
          <span className="agent-servers-waiting flex">
            <Spinner label={row.note ?? ""} />
          </span>
        </Tooltip>
      ) : null}
      {row.problem !== undefined ? (
        <OneLine
          hint={problemHint(row.problem, row.said)}
          className="agent-servers-problem flex-auto text-caption-inline text-attention"
        >
          <ReplayMask>{row.problem}</ReplayMask>
        </OneLine>
      ) : null}
      {row.note !== undefined && row.kind !== SERVER_ROW.SIGNING_IN ? (
        <OneLine
          hint={wholeWordsHint(row.note)}
          className="agent-servers-problem flex-auto text-caption-inline text-muted-foreground"
        >
          <ReplayMask>{row.note}</ReplayMask>
        </OneLine>
      ) : null}
    </span>
  );
}

export function useServerRows(
  statuses: IntegrationStatuses,
  disabled: readonly string[],
  only?: string,
): readonly ServerRow[] {
  const reads = useIntegrationTools(
    namedServers({
      statusOf: statuses.statusOf,
      accountsOf: statuses.accountsOf,
      standing: (status) => status === INTEGRATION_STATUS.CONNECTED,
    })
      .map((server) => server.connection)
      .filter((connection) => only === undefined || connection === only),
  );
  return serverRows({
    statusOf: statuses.statusOf,
    healthOf: (server) =>
      connectionHealth(integrationConnectionOf(server)?.provider ?? GITHUB, reads[server]),
    signInOf: statuses.signInOf,
    accountsOf: statuses.accountsOf,
    readFailed: statuses.readFailed,
    disabled,
  });
}

function caretOf(event: React.KeyboardEvent<HTMLElement>): number | null | undefined {
  return event.target instanceof HTMLInputElement ? event.target.selectionStart : undefined;
}

function goesBack(event: React.KeyboardEvent<HTMLElement>): boolean {
  return event.key === "ArrowLeft" || event.key === "Backspace";
}

interface PageKeys {
  readonly filter: string;
  readonly at: number;
  readonly count: number;
  readonly back: () => void;
  readonly step: (to: number) => void;
  readonly open: (() => void) | undefined;
}

function pageFieldKey(event: React.KeyboardEvent<HTMLElement>, page: PageKeys): void {
  const caretAtEnd = caretOf(event) === page.filter.length;
  if (goesBack(event) && page.filter === "") {
    event.preventDefault();
    page.back();
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const step = event.key === "ArrowDown" ? 1 : -1;
    page.step(Math.min(Math.max(page.at + step, 0), Math.max(page.count - 1, 0)));
  } else if (
    page.open !== undefined &&
    (event.key === "Enter" || (event.key === "ArrowRight" && caretAtEnd))
  ) {
    event.preventDefault();
    page.open();
  }
}

function SearchRow({
  field,
  value,
  placeholder,
  onChange,
  onKeyDown,
}: {
  field: React.RefObject<HTMLInputElement | null>;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => void;
}): React.JSX.Element {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the keys are the field's; the box only hears them.
    <div onKeyDown={onKeyDown}>
      <SearchField
        ref={field}
        look={SEARCH_FIELD_LOOK.MENU}
        label={placeholder}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
      />
    </div>
  );
}

function ServersNote({ words }: { words: string }): React.JSX.Element {
  return (
    <div className="flex min-h-10 items-center justify-center px-list-inset py-tight-gap text-center">
      <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        {words}
      </Text>
    </div>
  );
}

function AppMark(): React.JSX.Element {
  return (
    <GlyphSlot ink={GLYPH_INK.TEXT} size={ICON_SIZE.MEDIUM}>
      <ProductMark small />
    </GlyphSlot>
  );
}

function AlwaysOn(): React.JSX.Element {
  return (
    <span className={SERVER_END_CLASS}>
      <span className={SERVER_COUNT_CLASS}>{WORKSPACE_WORDS.ALWAYS_ON}</span>
    </span>
  );
}

function WorkspaceRowWords({ workspace }: { workspace: WorkspaceToolsRead }): React.JSX.Element {
  return (
    <span className="flex min-w-0 flex-auto items-center gap-icon-gap">
      <ServerName name={PRODUCT_NAME} />
      {workspace.answer !== undefined ? (
        <span className={SERVER_COUNT_CLASS}>{toolsCount(workspace.answer.tools.length)}</span>
      ) : null}
      {workspace.reason !== undefined ? (
        <OneLine
          hint={wholeWordsHint(RUN_ON_MAC_REASON_WORDS[workspace.reason].short)}
          className="agent-servers-problem flex-auto text-caption-inline text-attention"
        >
          {WORKSPACE_WORDS.RUN_ON_MAC_OFF}
        </OneLine>
      ) : null}
      {workspace.failed ? (
        <OneLine
          hint={wholeWordsHint(WORKSPACE_WORDS.READ_FAILED)}
          className="agent-servers-problem flex-auto text-caption-inline text-muted-foreground"
        >
          {WORKSPACE_WORDS.READ_FAILED}
        </OneLine>
      ) : null}
    </span>
  );
}

function RunOnMacWords({ workspace }: { workspace: WorkspaceToolsRead }): React.JSX.Element | null {
  if (workspace.reason !== undefined) return <QuietWords>{WORKSPACE_WORDS.OFF}</QuietWords>;
  if (workspace.answer === undefined) return null;
  return <QuietWords>{WORKSPACE_WORDS.ON}</QuietWords>;
}

function opensWorkspaceTool(tool: WorkspaceToolRow): boolean {
  return tool.name === AGENT_TOOL.RUN_ON_MAC;
}

function workspaceFound(names: readonly string[], tokens: readonly string[]): boolean {
  return (
    matchesTokens([PRODUCT_NAME], tokens) ||
    names.some((name) => matchesTokens([name, workspaceToolSummary(name) ?? ""], tokens))
  );
}

const RowHighlight = createContext<(() => void) | undefined>(undefined);

const PointerHighlight: ListRowHint = ({ label, row, children }) => {
  const highlight = useContext(RowHighlight);
  return (
    <RowHint label={label} row={row}>
      {cloneElement(children, {
        onPointerEnter: (event) => {
          children.props.onPointerEnter?.(event);
          highlight?.();
        },
      })}
    </RowHint>
  );
};

function ServersPopover({
  open: standing,
  id,
  servers,
  statuses,
  onClose,
  onBack = onClose,
  takesFocus = true,
  onLeave,
  onExited,
}: {
  open: boolean;
  id: string;
  servers: AgentServersControl;
  statuses: IntegrationStatuses;
  onClose: () => void;
  onBack?: (() => void) | undefined;
  takesFocus?: boolean | undefined;
  onLeave: (left: EventTarget | null) => void;
  onExited: () => void;
}): React.JSX.Element {
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const toolRun = useRef<VirtualRowsHandle>(null);
  const moving = useRef<HTMLDivElement>(null);
  const rowsId = useId();
  const rows = useServerRows(statuses, servers.disabled);
  const [working, setWorking] = useState<{ server: string; act: WorkingAct } | undefined>(
    undefined,
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [opened, setOpened] = useState<string | undefined>(undefined);
  const [highlight, setHighlight] = useState(0);
  const [pageHighlight, setPageHighlight] = useState(0);
  const [openedTool, setOpenedTool] = useState<string | undefined>(undefined);
  const toolBody = useRef<HTMLDivElement>(null);
  const grant = useIntegrationGrant(statuses);
  const workspace = useWorkspaceTools(servers.workspace);
  const openSettings = useOpenSettings();
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [workspaceTool, setWorkspaceTool] = useState<string | undefined>(undefined);
  const [workspaceFilter, setWorkspaceFilter] = useState("");
  const [workspaceHighlight, setWorkspaceHighlight] = useState(0);

  const workspaceNames = workspace.answer?.tools ?? [];
  const onWorkspace = servers.workspace !== undefined && workspaceOpen;
  const onRunOnMac = onWorkspace && workspaceTool === AGENT_TOOL.RUN_ON_MAC;
  const workspaceTokens = searchTokens(workspaceFilter);
  const workspaceSections = workspaceToolSections(
    workspaceNames.filter((name) =>
      matchesTokens([name, workspaceToolSummary(name) ?? ""], workspaceTokens),
    ),
  );
  const workspaceRows = workspaceSections.flatMap((section) => section.tools);
  const workspaceAt = Math.min(workspaceHighlight, Math.max(workspaceRows.length - 1, 0));

  const page = rows.find((row) => row.connection === opened && opensTools(row));
  const pageTokens = searchTokens(filter);
  const pageTools =
    page === undefined
      ? []
      : byName(
          shownTools(
            matchIntegration(page.provider, page.tools ?? [], pageTokens),
            page.tools ?? [],
          ),
        );
  const pageAt = Math.min(pageHighlight, Math.max(pageTools.length - 1, 0));
  const tool = page?.tools?.find((each) => each.name === openedTool);
  const found = searchServers(rows, query);
  const groups = serverGroups(found.rows);
  const picks: Pick[] = [
    ...groups.flatMap((group) => group.rows).filter((row) => row.kind !== SERVER_ROW.QUIET),
    ...found.tools,
  ].map((each) => ("tool" in each ? each : { row: each }));
  const homeTokens = searchTokens(query);
  const workspaceShown =
    servers.workspace !== undefined && workspaceFound(workspaceNames, homeTokens);
  const workspaceOffset = workspaceShown ? 1 : 0;
  const at = Math.min(highlight, Math.max(picks.length + workspaceOffset - 1, 0));
  const onWorkspaceRow = workspaceShown && at === WORKSPACE_PICK;
  const workspaceSearch = workspaceNames.some((name) =>
    matchesTokens([name, workspaceToolSummary(name) ?? ""], homeTokens),
  )
    ? query
    : "";

  const opening = useRef(true);
  useEffect(() => {
    const first = opening.current;
    opening.current = false;
    if (first && !takesFocus) return;
    if (tool !== undefined || onRunOnMac) toolBody.current?.focus({ preventScroll: true });
    else field.current?.focus();
  }, [page?.connection, tool, onWorkspace, onRunOnMac, takesFocus]);

  const highlightedTool = page === undefined ? undefined : pageTools[pageAt]?.name;
  useLayoutEffect(() => {
    if (tool !== undefined || onRunOnMac) return;
    const highlighted = onWorkspace
      ? `${rowsId}-workspace-${workspaceAt}`
      : page === undefined
        ? `${rowsId}-${at}`
        : `${rowsId}-tool-${pageAt}`;
    const row = document.getElementById(highlighted);
    if (row === null && !onWorkspace && highlightedTool !== undefined) {
      toolRun.current?.bringIn(highlightedTool);
    } else keepInView(list.current, row);
  }, [at, page, pageAt, highlightedTool, tool, rowsId, onWorkspace, onRunOnMac, workspaceAt]);

  const connect = (server: string) => {
    setWorking({ server, act: WORKING_ACT.CONNECT });
    void grant.begin(server).then(() => setWorking(undefined));
  };

  const cancel = (server: string) => {
    setWorking({ server, act: WORKING_ACT.CANCEL });
    void statuses.cancelSignIn(server).then(() => setWorking(undefined));
  };

  const open = (row: ServerRow, search = "") => {
    setOpened(row.connection);
    setFilter(search);
    setPageHighlight(0);
    setOpenedTool(undefined);
  };

  const back = () => {
    setOpened(undefined);
    setFilter("");
  };

  const openTool = (name: string) => {
    setPageHighlight(
      Math.max(
        pageTools.findIndex((each) => each.name === name),
        0,
      ),
    );
    setOpenedTool(name);
  };

  const closeTool = () => setOpenedTool(undefined);

  const openWorkspace = (search: string) => {
    setWorkspaceOpen(true);
    setWorkspaceFilter(search);
    setWorkspaceHighlight(0);
    setWorkspaceTool(undefined);
  };

  const backFromWorkspace = () => {
    setWorkspaceOpen(false);
    setWorkspaceFilter("");
  };

  const openWorkspaceTool = (name: string) => {
    setWorkspaceHighlight(
      Math.max(
        workspaceRows.findIndex((each) => each.name === name),
        0,
      ),
    );
    setWorkspaceTool(name);
  };

  const closeWorkspaceTool = () => setWorkspaceTool(undefined);

  const choose = (pick: Pick | undefined) => {
    if (pick === undefined) return;
    const { row } = pick;
    if (pick.tool !== undefined) return open(row, query);
    if (opensTools(row)) {
      return open(row, found.tools.some((hit) => hit.row === row) ? query : "");
    }
    if (
      row.kind === SERVER_ROW.CONNECT ||
      row.kind === SERVER_ROW.RECONNECT ||
      row.kind === SERVER_ROW.SIGNING_IN ||
      row.kind === SERVER_ROW.TRY_AGAIN
    )
      return connect(row.connection);
    if (row.kind === SERVER_ROW.RETRY) void statuses.read();
  };

  const onHomeKey = (event: React.KeyboardEvent<HTMLElement>) => {
    const caretAtEnd = caretOf(event) === query.length;
    const pick = onWorkspaceRow ? undefined : picks[at - workspaceOffset];
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlight(
        Math.min(Math.max(at + step, 0), Math.max(picks.length + workspaceOffset - 1, 0)),
      );
    } else if (event.key === "Enter" || (event.key === "ArrowRight" && caretAtEnd)) {
      if (
        !onWorkspaceRow &&
        event.key === "ArrowRight" &&
        !(pick !== undefined && (pick.tool !== undefined || opensTools(pick.row)))
      )
        return;
      event.preventDefault();
      if (onWorkspaceRow) openWorkspace(workspaceSearch);
      else choose(pick);
    } else if (event.key === " " && query.trim() === "" && pick?.row.kind === SERVER_ROW.SWITCH) {
      event.preventDefault();
      servers.onSwitch(switchedServers(servers.disabled, pick.row.connection, !pick.row.on));
    }
  };

  const onPageKey = (event: React.KeyboardEvent<HTMLElement>) => {
    const highlighted = pageTools[pageAt];
    pageFieldKey(event, {
      filter,
      at: pageAt,
      count: pageTools.length,
      back,
      step: setPageHighlight,
      open: highlighted === undefined ? undefined : () => openTool(highlighted.name),
    });
  };

  const onToolKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!goesBack(event)) return;
    event.preventDefault();
    closeTool();
  };

  const onWorkspaceKey = (event: React.KeyboardEvent<HTMLElement>) => {
    const highlighted = workspaceRows[workspaceAt];
    pageFieldKey(event, {
      filter: workspaceFilter,
      at: workspaceAt,
      count: workspaceRows.length,
      back: backFromWorkspace,
      step: setWorkspaceHighlight,
      open:
        highlighted === undefined || !opensWorkspaceTool(highlighted)
          ? undefined
          : () => openWorkspaceTool(highlighted.name),
    });
  };

  const onWorkspaceToolKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!goesBack(event)) return;
    event.preventDefault();
    closeWorkspaceTool();
  };

  const dismiss = () => {
    if (onRunOnMac) closeWorkspaceTool();
    else if (onWorkspace) backFromWorkspace();
    else if (tool !== undefined) closeTool();
    else if (page !== undefined) back();
    else onBack();
  };

  const workingOn = (server: string, mine: WorkingAct, busyLabel: string) => {
    if (working?.server !== server) return {};
    return working.act === mine ? { busy: true, busyLabel } : { disabled: true };
  };

  const end = (row: ServerRow): React.JSX.Element | null => {
    switch (row.kind) {
      case SERVER_ROW.SWITCH:
        return <ServerSwitch row={row} servers={servers} />;
      case SERVER_ROW.CONNECT:
      case SERVER_ROW.RECONNECT:
        return (
          <Button
            variant={BUTTON_VARIANT.QUIET}
            keepFocus
            {...workingOn(row.connection, WORKING_ACT.CONNECT, "Connecting")}
            onClick={(event) => {
              event.stopPropagation();
              connect(row.connection);
            }}
          >
            {row.kind === SERVER_ROW.CONNECT ? SERVER_ACTION.CONNECT : SERVER_ACTION.RECONNECT}
          </Button>
        );
      case SERVER_ROW.SIGNING_IN:
        return (
          <>
            <Button
              variant={BUTTON_VARIANT.QUIET}
              keepFocus
              {...workingOn(row.connection, WORKING_ACT.CONNECT, "Reopening the sign-in")}
              onClick={(event) => {
                event.stopPropagation();
                connect(row.connection);
              }}
            >
              {SIGN_IN_ACTION.REOPEN}
            </Button>
            <Button
              variant={BUTTON_VARIANT.QUIET}
              keepFocus
              {...workingOn(row.connection, WORKING_ACT.CANCEL, "Canceling the sign-in")}
              onClick={(event) => {
                event.stopPropagation();
                cancel(row.connection);
              }}
            >
              {SIGN_IN_ACTION.CANCEL}
            </Button>
          </>
        );
      case SERVER_ROW.TRY_AGAIN:
        return (
          <Button
            variant={BUTTON_VARIANT.QUIET}
            keepFocus
            {...workingOn(row.connection, WORKING_ACT.CONNECT, "Connecting")}
            onClick={(event) => {
              event.stopPropagation();
              connect(row.connection);
            }}
          >
            {SIGN_IN_ACTION.TRY_AGAIN}
          </Button>
        );
      case SERVER_ROW.RETRY:
        return (
          <Button
            variant={BUTTON_VARIANT.QUIET}
            keepFocus
            onClick={(event) => {
              event.stopPropagation();
              void statuses.read();
            }}
          >
            {SERVER_ACTION.RETRY}
          </Button>
        );
      case SERVER_ROW.QUIET:
        return null;
    }
  };

  const pickIndex = (row: ServerRow, tool?: IntegrationTool) => {
    const index = picks.findIndex((pick) => pick.row === row && pick.tool === tool);
    return index < 0 ? index : index + workspaceOffset;
  };

  const homeRow = (input: {
    key: string;
    index: number;
    row: ServerRow;
    title: React.ReactNode;
    meta?: React.ReactNode;
    actions?: React.ReactNode;
    card: React.ReactNode;
    opens: boolean;
    motionKey?: string;
    onPress: (() => void) | undefined;
  }) => {
    const { index } = input;
    return (
      <RowHighlight.Provider
        key={input.key}
        value={index < 0 || index === at ? undefined : () => setHighlight(index)}
      >
        <RowHintOptions card={input.card}>
          <ListRow
            id={index < 0 ? undefined : `${rowsId}-${index}`}
            leading={<ProviderMark provider={input.row.provider} size={PROVIDER_MARK_SIZE.ICON} />}
            title={input.title}
            meta={input.meta}
            actions={input.actions}
            current={index >= 0 && index === at ? LIST_ROW_CURRENT.ITEM : undefined}
            chevron={input.opens}
            chevronAt={LIST_ROW_CHEVRON.META}
            keepFocus
            tabbable={false}
            onPress={input.onPress}
            motionKey={input.motionKey}
            hint={{ Hint: PointerHighlight, label: input.row.name }}
          />
        </RowHintOptions>
      </RowHighlight.Provider>
    );
  };

  const rowPress = (row: ServerRow): (() => void) | undefined => {
    if (opensTools(row)) return () => open(row);
    if (row.kind === SERVER_ROW.SWITCH) {
      return () => servers.onSwitch(switchedServers(servers.disabled, row.connection, !row.on));
    }
    return pickIndex(row) < 0 ? undefined : () => choose({ row });
  };

  const serverRow = (row: ServerRow) =>
    homeRow({
      key: row.connection,
      index: pickIndex(row),
      row,
      title: <ServerRowWords row={row} />,
      meta: row.tools !== undefined ? toolsCount(row.tools.length) : undefined,
      card: <ServerCard provider={row.provider} connection={row.connection} />,
      actions: end(row),
      opens: opensTools(row),
      motionKey: row.connection,
      onPress: rowPress(row),
    });

  const toolRow = ({ row, tool }: ToolHit) =>
    homeRow({
      key: `${row.connection}:${tool.name}`,
      index: pickIndex(row, tool),
      row,
      title: (
        <OneLine className="integration-tool-id" words={tool.name}>
          <ReplayMask>
            <Highlighted text={tool.name} tokens={searchTokens(query)} />
          </ReplayMask>
        </OneLine>
      ),
      meta: <ReplayMask>{row.name}</ReplayMask>,
      card: <ServerCard provider={row.provider} connection={row.connection} tool={tool.name} />,
      opens: true,
      onPress: () => open(row, query),
    });

  const workspaceRow = (
    <RowHighlight.Provider
      value={at === WORKSPACE_PICK ? undefined : () => setHighlight(WORKSPACE_PICK)}
    >
      <ListRow
        id={`${rowsId}-${WORKSPACE_PICK}`}
        leading={<AppMark />}
        title={<WorkspaceRowWords workspace={workspace} />}
        actions={<AlwaysOn />}
        current={onWorkspaceRow ? LIST_ROW_CURRENT.ITEM : undefined}
        chevron
        keepFocus
        tabbable={false}
        onPress={() => openWorkspace(workspaceSearch)}
        hint={{ Hint: PointerHighlight, label: PRODUCT_NAME }}
      />
    </RowHighlight.Provider>
  );

  const home = (
    <>
      <SearchRow
        field={field}
        value={query}
        placeholder={SEARCH.PLACEHOLDER}
        onChange={(value) => {
          setQuery(value);
          setHighlight(0);
        }}
        onKeyDown={onHomeKey}
      />
      <ReplayUnmask>
        <div className={SERVERS_SCROLL_CLASS}>
          <ScrollArea ref={list} size={SCROLL_SIZE.CONTENT}>
            <div ref={moving} className="agent-servers-list p-menu-inset">
              <ListMotion root={moving}>
                {workspaceShown ? (
                  <MenuSection heading={WORKSPACE_WORDS.SECTION}>
                    <List label={WORKSPACE_WORDS.SECTION} density={LIST_DENSITY.COMPACT}>
                      {workspaceRow}
                    </List>
                  </MenuSection>
                ) : null}
                {rows.length === 0 ? <ServersNote words={SERVERS_NONE} /> : null}
                {rows.length > 0 && picks.length === 0 && groups.length === 0 && !workspaceShown ? (
                  <ServersNote words={SEARCH.NONE} />
                ) : null}
                {groups.map((group) =>
                  group.heading === undefined ? (
                    <List key="unread" label={SERVERS_LABEL} density={LIST_DENSITY.COMPACT} moves>
                      {group.rows.map(serverRow)}
                    </List>
                  ) : (
                    <MenuSection
                      key={group.heading}
                      heading={group.heading}
                      count={
                        group.heading === SERVER_SECTION.CONNECTED
                          ? serversOnWords(group.rows)
                          : undefined
                      }
                    >
                      <List label={group.heading} density={LIST_DENSITY.COMPACT} moves>
                        {group.rows.map(serverRow)}
                      </List>
                    </MenuSection>
                  ),
                )}
                {found.tools.length > 0 ? (
                  <MenuSection heading={SEARCH.TOOLS}>
                    <List label={SEARCH.TOOLS} density={LIST_DENSITY.COMPACT}>
                      {found.tools.map(toolRow)}
                    </List>
                  </MenuSection>
                ) : null}
              </ListMotion>
            </div>
          </ScrollArea>
        </div>
      </ReplayUnmask>
    </>
  );

  const serverPage = (row: ServerRow) => {
    return (
      <>
        <div className={SERVER_PAGE_HEAD_CLASS}>
          <BackButton
            label={SERVERS_LABEL}
            place={SERVERS_LABEL}
            command={NO_BACK_KEY}
            onBack={back}
          />
          <ProviderMark provider={row.provider} size={PROVIDER_MARK_SIZE.ICON} />
          <ServerPageTitle name={row.name} />
          <span className={SERVER_COUNT_CLASS}>{toolsCount(row.tools?.length ?? 0)}</span>
          <span className={SERVER_END_CLASS}>
            <ServerSwitch row={row} servers={servers} />
          </span>
        </div>
        <SearchRow
          field={field}
          value={filter}
          placeholder={`Filter ${toolsCount(row.tools?.length ?? 0)}`}
          onChange={(value) => {
            setFilter(value);
            setPageHighlight(0);
          }}
          onKeyDown={onPageKey}
        />
        <div className={SERVERS_SCROLL_CLASS}>
          <ScrollArea ref={list} size={SCROLL_SIZE.CONTENT}>
            <div className="agent-servers-list p-menu-inset">
              {pageTools.length === 0 ? <ServersNote words={PAGE.NONE} /> : null}
              <IntegrationToolList
                scroller={list}
                handle={toolRun}
                server={row.name}
                tools={pageTools}
                tokens={pageTokens}
                current={pageTools[pageAt]?.name}
                idOf={(each) => `${rowsId}-tool-${pageTools.indexOf(each)}`}
                onCurrent={(each) => setPageHighlight(pageTools.indexOf(each))}
                onOpen={(each) => openTool(each.name)}
                keepFocus
              />
            </div>
          </ScrollArea>
        </div>
      </>
    );
  };

  const workspaceToolRow = (shown: WorkspaceToolRow) => {
    const index = workspaceRows.indexOf(shown);
    const runOnMac = shown.name === AGENT_TOOL.RUN_ON_MAC;
    const description =
      runOnMac && workspace.reason !== undefined
        ? RUN_ON_MAC_REASON_WORDS[workspace.reason].short
        : shown.summary;
    return (
      <RowHighlight.Provider
        key={shown.name}
        value={index === workspaceAt ? undefined : () => setWorkspaceHighlight(index)}
      >
        <ListRow
          id={`${rowsId}-workspace-${index}`}
          title={
            <OneLine
              className="integration-tool-title integration-tool-code flex-initial font-mono text-caption-inline"
              words={shown.name}
            >
              <Highlighted text={shown.name} tokens={workspaceTokens} />
            </OneLine>
          }
          description={
            description === undefined ? undefined : (
              <Highlighted text={description} tokens={workspaceTokens} />
            )
          }
          actions={runOnMac ? <RunOnMacWords workspace={workspace} /> : undefined}
          current={index === workspaceAt ? LIST_ROW_CURRENT.ITEM : undefined}
          chevron={opensWorkspaceTool(shown)}
          keepFocus
          tabbable={false}
          onPress={opensWorkspaceTool(shown) ? () => openWorkspaceTool(shown.name) : undefined}
          hint={{ Hint: PointerHighlight, label: shown.name }}
        />
      </RowHighlight.Provider>
    );
  };

  const workspacePage = (
    <>
      <div className={SERVER_PAGE_HEAD_CLASS}>
        <BackButton
          label={SERVERS_LABEL}
          place={SERVERS_LABEL}
          command={NO_BACK_KEY}
          onBack={backFromWorkspace}
        />
        <AppMark />
        <ServerPageTitle name={PRODUCT_NAME} />
        {workspace.answer !== undefined ? (
          <span className={SERVER_COUNT_CLASS}>{toolsCount(workspaceNames.length)}</span>
        ) : null}
        <AlwaysOn />
      </div>
      <SearchRow
        field={field}
        value={workspaceFilter}
        placeholder={`Filter ${toolsCount(workspaceNames.length)}`}
        onChange={(value) => {
          setWorkspaceFilter(value);
          setWorkspaceHighlight(0);
        }}
        onKeyDown={onWorkspaceKey}
      />
      <div className={SERVERS_SCROLL_CLASS}>
        <ScrollArea ref={list} size={SCROLL_SIZE.CONTENT}>
          <div className="agent-servers-list p-menu-inset">
            {workspace.answer === undefined ? (
              <ServersNote
                words={workspace.failed ? WORKSPACE_WORDS.READ_FAILED : WORKSPACE_WORDS.READING}
              />
            ) : workspaceRows.length === 0 ? (
              <ServersNote words={PAGE.NONE} />
            ) : null}
            {workspaceSections.map((section) => (
              <MenuSection
                key={section.heading}
                heading={section.heading}
                count={toolsCount(section.tools.length)}
              >
                <List label={section.heading} density={LIST_DENSITY.COMPACT}>
                  {section.tools.map(workspaceToolRow)}
                </List>
              </MenuSection>
            ))}
          </div>
        </ScrollArea>
      </div>
    </>
  );

  const runOnMacPage = (reason: RunOnMacReason | undefined) => {
    const detail = reason === undefined ? undefined : runOnMacDetail(reason);
    return (
      <div className="agent-servers-tool-page flex min-h-0 flex-col">
        <div className={SERVER_PAGE_HEAD_CLASS}>
          <BackButton
            label={WORKSPACE_WORDS.TOOLS}
            place={WORKSPACE_WORDS.TOOLS}
            command={NO_BACK_KEY}
            keepFocus
            onBack={closeWorkspaceTool}
          />
          <OneLine
            className="agent-servers-page-title font-mono text-caption-inline text-foreground"
            words={AGENT_TOOL.RUN_ON_MAC}
          >
            {AGENT_TOOL.RUN_ON_MAC}
          </OneLine>
          <span className={SERVER_END_CLASS}>
            <RunOnMacWords workspace={workspace} />
          </span>
        </div>
        <ScrollArea ref={toolBody} tabIndex={-1} onKeyDown={onWorkspaceToolKey}>
          <div className="flex flex-col gap-block-gap px-list-inset pt-row-inset pb-list-inset">
            <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {RUN_ON_MAC_DESCRIPTION}
            </Text>
            {reason === undefined ? null : (
              <Banner
                look={BANNER_LOOK.CARD}
                tone={STATUS_TONE.ATTENTION}
                glyph={<CircleAlertIcon />}
                actions={
                  reason === RUN_ON_MAC_REASON.SETTINGS_OFF ? (
                    <Button
                      variant={BUTTON_VARIANT.OUTLINE}
                      keepFocus
                      onClick={() => {
                        onClose();
                        openSettings({ page: SETTINGS_VIEW.THIS_MAC });
                      }}
                    >
                      {OPEN_SETTINGS_LABEL}
                    </Button>
                  ) : undefined
                }
              >
                <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.LABEL}>
                  {RUN_ON_MAC_REASON_WORDS[reason].short}
                </Text>
                {detail === undefined ? null : (
                  <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                    {detail}
                  </Text>
                )}
              </Banner>
            )}
          </div>
        </ScrollArea>
      </div>
    );
  };

  const toolPage = (row: ServerRow, shown: IntegrationTool) => (
    <div className="agent-servers-tool-page">
      <IntegrationToolDetail
        server={row.name}
        tool={shown}
        tokens={pageTokens}
        backPlace={`${row.name} tools`}
        onBack={closeTool}
        keepFocus
        bodyRef={toolBody}
        onBodyKeyDown={onToolKey}
      />
    </div>
  );

  return (
    <PopoverPanel
      open={standing}
      id={id}
      look={POPOVER_PANEL_LOOK.MENU}
      title={
        onRunOnMac
          ? AGENT_TOOL.RUN_ON_MAC
          : onWorkspace
            ? WORKSPACE_WORDS.TOOLS
            : tool !== undefined
              ? toolTitle(tool)
              : page !== undefined
                ? `${page.name} tools`
                : SERVERS_LABEL
      }
      takesFocus={takesFocus}
      onDismiss={dismiss}
      onLeave={onLeave}
      onExited={onExited}
    >
      <div className="agent-servers-menu contents">
        {onRunOnMac
          ? runOnMacPage(workspace.reason)
          : onWorkspace
            ? workspacePage
            : page !== undefined && tool !== undefined
              ? toolPage(page, tool)
              : page !== undefined
                ? serverPage(page)
                : home}
        <div className="task-compose-menu-foot block flex-none border-t border-border p-menu-inset">
          <Button
            variant={BUTTON_VARIANT.QUIET}
            icon={<GearIcon />}
            keepFocus
            onClick={() => {
              onClose();
              servers.onOpenSettings();
            }}
          >
            <ReplayUnmask>{SERVERS_SETTINGS}</ReplayUnmask>
          </Button>
        </div>
      </div>
    </PopoverPanel>
  );
}

function ServersMenuPanel({
  servers,
  statuses,
  entered,
  onBack,
  onClose,
}: {
  servers: AgentServersControl;
  statuses: IntegrationStatuses;
  entered: boolean;
  onBack: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const id = useId();
  return (
    <ServersPopover
      open
      id={id}
      servers={servers}
      statuses={statuses}
      onClose={onClose}
      onBack={onBack}
      takesFocus={entered}
      onLeave={() => undefined}
      onExited={() => undefined}
    />
  );
}

export function serversMenuPanel(
  servers: AgentServersControl,
  statuses: IntegrationStatuses,
): MenuPanel {
  return {
    label: SERVERS_LABEL,
    icon: <McpIcon />,
    panel: ({ back, close, entered }) => (
      <ServersMenuPanel
        servers={servers}
        statuses={statuses}
        entered={entered}
        onBack={back}
        onClose={close}
      />
    ),
  };
}

export function AgentServersButton({
  servers,
  statuses,
  face,
}: {
  servers: AgentServersControl;
  statuses: IntegrationStatuses;
  face: React.ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const labelId = useId();
  const faceId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [drawn, setDrawn] = useState(open);
  if (open && !drawn) setDrawn(true);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div className="agent-servers relative flex min-w-0" ref={root}>
      <VisuallyHidden id={labelId}>{SERVERS_LABEL}</VisuallyHidden>
      <Chip
        ref={trigger}
        look={CHIP_LOOK.FIELD}
        width={CHIP_WIDTH.MIN_FIELD}
        chevron
        id={faceId}
        aria-labelledby={`${labelId} ${faceId}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        onClick={() => setOpen(!open)}
      >
        {face}
      </Chip>
      <AnchoredPopover open={open} align={POPOVER_ALIGN.END}>
        {drawn ? (
          <ServersPopover
            open={open}
            id={popoverId}
            servers={servers}
            statuses={statuses}
            onClose={close}
            onLeave={(left) => {
              if (!document.hasFocus()) return;
              if (!(left instanceof Node && root.current?.contains(left))) setOpen(false);
            }}
            onExited={() => setDrawn(false)}
          />
        ) : null}
      </AnchoredPopover>
    </div>
  );
}
