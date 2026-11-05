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

/**
 * agent-servers.tsx -- the Integrations row of an agent box's + menu and an automation's servers field, and the popover both open that lists the servers the agent is handed with a switch for each, and each server's tools.
 *
 * The agent box's + opens a menu whose Integrations row opens the popover
 * beside the menu as its submenu (`serversMenuPanel`, `@repo/ui`'s
 * `MenuPanel`), the menu standing behind it; an automation's form opens the
 * same popover from its field's chip, hung from the chip's trailing edge
 * (`AgentServersButton`, `@repo/ui`'s `AnchoredPopover`). Either way it is
 * a `PopoverPanel`, a menu's, drawn as the searchable menu is: a search field first, then, for a
 * started agent, our own tools under Built in, then the servers under
 * Connected, which counts how many this agent has on, and Not connected
 * (`agent-servers-model.ts`), each section under `@repo/ui`'s `MenuSection`,
 * and Manage in Settings pinned at the foot. The app's row is its mark, its
 * name, how many of its tools the agent is offered (`agent-workspace-tools.ts`),
 * `run_on_mac off` in the attention tone where it is, and Always on in a
 * switch's place, since his tools cannot be turned off; pressing it turns
 * the popover into his page, his tools under their groups, each its name and
 * one line of what it does, `run_on_mac` with an On or Off badge and, off,
 * its short reason. Pressing `run_on_mac` opens its own page: what it does
 * and, off, why, in the attention tone, with Open Settings where Settings ›
 * This Mac is what turned it off. A connected server's row names how many
 * tools it offers and ends with this agent's switch; one whose server
 * answered why it lists none says why beside its name and ends with
 * Reconnect; one not connected ends with Connect, which sends the browser
 * to sign in there and then, as Settings does: the row waits on it with a
 * ring after its name, its line said only to a reader and in its title,
 * then Reopen and Cancel, and becomes the switch once the sign-in settles,
 * or says it failed or did not finish and offers Retry
 * (`../integration-sign-in.ts`). Pressing a connected server turns the popover into
 * its page, in place: back, its name, its switch, a filter, and its tools
 * in alphabetical order, each one line of its title, its name, the badge
 * its server's annotations earn it, and what it does
 * (`../integration-tool-list.tsx`). Pressing a tool turns the page into
 * the tool's own, one level further in: back, its title and name, its
 * server's hints, what it does rendered, and its parameters, the popover
 * standing open. What is typed in the home's field finds
 * servers by name and every tool by name, title, or description, and a tool found
 * opens its server's page filtered to the search. Focus stays in the field
 * on the home and a server's page, as the searchable menu keeps it: the
 * arrows move one highlight through the rows, Enter or Right opens the
 * highlighted server or tool, Space on an empty search flips its switch,
 * and on a server's page Left, or Backspace on an empty filter, goes back.
 * A tool's page hands the focus to its body, which the arrows scroll, and
 * Left or Backspace goes back to the server's page with its filter and its
 * highlight as they were. Where every
 * connection stands is the composer's read (`../integration-statuses.ts`),
 * taken as it is drawn and again when the window is focused, which is how
 * the developer comes back from the browser, so the popover stays open
 * while the window is away. A draft agent keeps its choice until its first
 * message starts it. Escape goes back one level, from a tool's page or a
 * server's, and otherwise closes the popover, or, standing as the + menu's
 * submenu, goes back to its row, and stops there so the panel behind stays
 * open; Manage in Settings closes the + menu with it. A second press of the
 * chip, and focus leaving it for another part of the window, close it too.
 * The chip, the back, a row's switch and its Connect, Reopen, Cancel or
 * Retry are `@repo/ui`'s, each pressed without taking the focus from the field.
 */

/** The servers an agent is handed, as the button changes them. */
export interface AgentServersControl {
  /** The servers switched off for this agent: the one on its way where one is, else the agent's. */
  readonly disabled: readonly string[];
  /** Switches the agent's servers, the whole list of those off. */
  readonly onSwitch: (next: readonly string[]) => void;
  /** Opens Settings on its Integrations page, where a server is disconnected. */
  readonly onOpenSettings: () => void;
  /** The started agent whose own tools, the app's, head the popover; none where no agent is started yet, as a draft's or an automation's. */
  readonly workspace?: WorkspaceToolsDoor | undefined;
}

/** The provider a server name that parses as none would be drawn as; never reached, since every row's name is minted from a provider. */
const GITHUB = INTEGRATION_PROVIDER.GITHUB;

/**
 * The servers' list, taller than the searchable menu's, as tall as a
 * server's page, so going in and back keeps the popover's size, and never
 * taller than the window leaves above the composer once the field and the
 * foot are drawn, so the field stays on screen in the shortest window.
 */
const SERVERS_SCROLL_CLASS = "flex max-h-servers-list flex-col";

/** How many tools a server offers, in the muted detail type. */
const SERVER_COUNT_CLASS =
  "agent-servers-count flex-none whitespace-nowrap text-caption-inline text-muted-foreground tabular-nums";

/** What stands at a server's row's end: its switch, or Connect, as Settings › Integrations draws them. */
const SERVER_END_CLASS = "ml-auto flex flex-none items-center gap-tight-gap";

/**
 * A page's head in the popover's place: back, folded to its glyph, its mark
 * and name, its count, and its switch at the end, over a hairline, at the
 * search field's height; a narrowed mention list's crumb stands as one.
 */
export const SERVER_PAGE_HEAD_CLASS =
  "agent-servers-page-head flex h-pane-bar flex-none items-center gap-icon-gap border-b border-border pr-list-inset pl-item-gap [--ui-fold:folded]";

/** What the pinned row at the popover's foot is named, which opens Settings › Integrations. */
const SERVERS_SETTINGS = "Manage in Settings";

/** What the popover's list says where the deployment offers the account no server at all. */
const SERVERS_NONE = "No integrations available";

/** What the home's field asks for, and says where nothing matches. */
const SEARCH = {
  PLACEHOLDER: "Search integrations and tools",
  NONE: "No integrations or tools match",
  TOOLS: "Tools",
} as const;

/** What a server's page says where its filter matches nothing. */
const PAGE = {
  NONE: "No tools match",
} as const;

/** What the app's own row and pages say. */
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

/** Where the home's highlight stands while the app's row heads it: before every server's row. */
const WORKSPACE_PICK = 0;

/** What a row's buttons can be waiting on: the browser sign-in begun, or the one under way ended. */
const WORKING_ACT = {
  CONNECT: "connect",
  CANCEL: "cancel",
} as const;

type WorkingAct = (typeof WORKING_ACT)[keyof typeof WORKING_ACT];

/**
 * A pointer's press that leaves the focus in the field, so the keys the
 * field hears go on working after a row, a switch, or a button is clicked;
 * Tab still reaches every control, which takes the focus as it should.
 */
function keepFieldFocus(event: React.MouseEvent): void {
  event.preventDefault();
}

/** One thing the home's highlight can land on: a server's row, or a tool a search found. */
type Pick = { readonly row: ServerRow; readonly tool?: IntegrationTool };

/** The switch that hands the agent a server or takes it away. */
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

/** A server's name in its row, faded where the row cuts it short. */
function ServerName({ name }: { name: string }): React.JSX.Element {
  return <OneLine className="agent-servers-name flex-initial">{name}</OneLine>;
}

/** A server's name heading its own page, faded where the head cuts it short. */
function ServerPageTitle({ name }: { name: string }): React.JSX.Element {
  return (
    <OneLine className="agent-servers-page-title text-section-inline font-ui-semibold text-foreground">
      {name}
    </OneLine>
  );
}

/**
 * The hint over a row's problem: its whole words where the row cut them,
 * and where the server or the sign-in said words of its own, those after
 * ours, quoted and named, whether cut or not. Note that the row's one line
 * holds our sentence alone, because their words are no sentence of ours.
 */
function problemHint(problem: string, said: string | undefined): OneLineHint {
  if (said === undefined) return wholeWordsHint(problem);
  return (line) => <Tooltip label={`${problem} ${said}`}>{line}</Tooltip>;
}

/**
 * What a server's row says between its mark and its end: its provider's
 * name, the account's beside it in the muted ink where the row names one,
 * and where its sign-in or its server stands, as the card a mention of the
 * server hangs says them too (`server-card.tsx`). How many tools it offers
 * is the row's metadata, at its end beside its switch.
 */
function ServerRowWords({ row }: { row: ServerRow }): React.JSX.Element {
  return (
    // Note that the words stand in a line of their own, because a list row's
    // title would otherwise clip the reason behind a long name.
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

/**
 * Every offered server's row as the popover draws it, from where each
 * connection stands and the servers the agent switched off, each connected
 * server's tools read for as long as the caller is drawn: every one's, or
 * only the server named where the caller draws that one alone.
 */
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

/** Where the caret stands in the field a key was pressed in, heard where it bubbles. */
function caretOf(event: React.KeyboardEvent<HTMLElement>): number | null | undefined {
  return event.target instanceof HTMLInputElement ? event.target.selectionStart : undefined;
}

/** Whether a key on a tool's page goes back to the page it was opened from: Left, or Backspace. */
function goesBack(event: React.KeyboardEvent<HTMLElement>): boolean {
  return event.key === "ArrowLeft" || event.key === "Backspace";
}

/** A page's list as its field's keys move through it: its filter, its highlight, how many rows it draws, and what back, a step, and opening the highlighted row do. */
interface PageKeys {
  readonly filter: string;
  readonly at: number;
  readonly count: number;
  readonly back: () => void;
  readonly step: (to: number) => void;
  /** Opens the highlighted row; none where it opens nothing. */
  readonly open: (() => void) | undefined;
}

/**
 * What a key in a page's field does, a server's or the app's: Left or
 * Backspace on an empty filter goes back, the arrows step the highlight,
 * and Enter, or Right with the caret at the end, opens the highlighted row.
 */
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

/** The search field at the top of either page, which holds the focus while the popover is open. */
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
    // Note that the field's keys are heard as they bubble out of it, because
    // the popover steers its rows by keys of its own.
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

/** What the popover's list says in its rows' place. */
function ServersNote({ words }: { words: string }): React.JSX.Element {
  return (
    <div className="flex min-h-10 items-center justify-center px-list-inset py-tight-gap text-center">
      <Text as={TEXT_ELEMENT.P} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
        {words}
      </Text>
    </div>
  );
}

/** The product's mark, at a provider mark's seat. */
function AppMark(): React.JSX.Element {
  return (
    <GlyphSlot ink={GLYPH_INK.TEXT} size={ICON_SIZE.MEDIUM}>
      <ProductMark small />
    </GlyphSlot>
  );
}

/** What stands at the end of the app's row and its page's head in a switch's place: its tools cannot be turned off. */
function AlwaysOn(): React.JSX.Element {
  return (
    <span className={SERVER_END_CLASS}>
      <span className={SERVER_COUNT_CLASS}>{WORKSPACE_WORDS.ALWAYS_ON}</span>
    </span>
  );
}

/** What the app's row says between its mark and its end: its name, how many tools it offers once read, and whether `run_on_mac` is off. */
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

/** Whether `run_on_mac` is on for the agent, once that is known, as quiet words: On or Off. */
function RunOnMacWords({ workspace }: { workspace: WorkspaceToolsRead }): React.JSX.Element | null {
  if (workspace.reason !== undefined) return <QuietWords>{WORKSPACE_WORDS.OFF}</QuietWords>;
  if (workspace.answer === undefined) return null;
  return <QuietWords>{WORKSPACE_WORDS.ON}</QuietWords>;
}

/** Whether a row of the app's page opens a page of its own: `run_on_mac` alone, whose page says why it is off. */
function opensWorkspaceTool(tool: WorkspaceToolRow): boolean {
  return tool.name === AGENT_TOOL.RUN_ON_MAC;
}

/** Whether a search finds the app's row: by its name, or by a tool's name or what it does. */
function workspaceFound(names: readonly string[], tokens: readonly string[]): boolean {
  return (
    matchesTokens([PRODUCT_NAME], tokens) ||
    names.some((name) => matchesTokens([name, workspaceToolSummary(name) ?? ""], tokens))
  );
}

/** What makes a row the highlighted one, where the pointer coming onto it moves the highlight. */
const RowHighlight = createContext<(() => void) | undefined>(undefined);

/**
 * The pointer coming onto a row's press makes it the highlighted one, as a
 * menu's highlight follows the pointer, and the press hangs the card its
 * row's `RowHintOptions` hand it (`RowHint`). Note that it rides the row's
 * hint slot, the one door to its press's pointer handlers.
 */
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
  /** Whether it stands; closed, it fades out, then tells its owner it is gone. */
  open: boolean;
  id: string;
  servers: AgentServersControl;
  statuses: IntegrationStatuses;
  /** Closes the popover, and the menu it stands beside, handing focus back to what opened it. */
  onClose: () => void;
  /** Escape on the home: back to the menu row that opened it, where it stands as a submenu; the close otherwise. */
  onBack?: (() => void) | undefined;
  /** Whether its field takes the focus as it opens: not where the pointer resting on the + menu's row opened it, which leaves the keyboard in the menu until the pointer arrives. */
  takesFocus?: boolean | undefined;
  /** Focus left the popover for `left`; the owner closes unless that is still its own. */
  onLeave: (left: EventTarget | null) => void;
  onExited: () => void;
}): React.JSX.Element {
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
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

  // The app's page stands only while the popover draws an agent's; its tool's page only over its.
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

  // A server's page stands only while its server still answers with tools; otherwise the home is drawn.
  const page = rows.find((row) => row.connection === opened && opensTools(row));
  // Note that the page's filter reads as the home's search does, so a query
  // handed down that found a tool by its server's name ("vercel get") still
  // finds it here.
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
  // A tool's page stands only while its server still lists it.
  const tool = page?.tools?.find((each) => each.name === openedTool);
  const found = searchServers(rows, query);
  const groups = serverGroups(found.rows);
  const picks: Pick[] = [
    ...groups.flatMap((group) => group.rows).filter((row) => row.kind !== SERVER_ROW.QUIET),
    ...found.tools,
  ].map((each) => ("tool" in each ? each : { row: each }));
  // The app's row heads the home's picks while it stands: for an agent, and found by the search.
  const homeTokens = searchTokens(query);
  const workspaceShown =
    servers.workspace !== undefined && workspaceFound(workspaceNames, homeTokens);
  const workspaceOffset = workspaceShown ? 1 : 0;
  const at = Math.min(highlight, Math.max(picks.length + workspaceOffset - 1, 0));
  const onWorkspaceRow = workspaceShown && at === WORKSPACE_PICK;
  // A search that found one of his tools opens his page filtered to it, as a server's does.
  const workspaceSearch = workspaceNames.some((name) =>
    matchesTokens([name, workspaceToolSummary(name) ?? ""], homeTokens),
  )
    ? query
    : "";

  // The field takes focus as the popover opens, unless its owner leaves the
  // keyboard where it was, and as any page with one is drawn, and a tool's
  // page its body, so the keys and focus leaving it are heard.
  const opening = useRef(true);
  useEffect(() => {
    const first = opening.current;
    opening.current = false;
    if (first && !takesFocus) return;
    if (tool !== undefined || onRunOnMac) toolBody.current?.focus({ preventScroll: true });
    else field.current?.focus();
  }, [page?.connection, tool, onWorkspace, onRunOnMac, takesFocus]);

  useLayoutEffect(() => {
    if (tool !== undefined || onRunOnMac) return;
    const highlighted = onWorkspace
      ? `${rowsId}-workspace-${workspaceAt}`
      : page === undefined
        ? `${rowsId}-${at}`
        : `${rowsId}-tool-${pageAt}`;
    keepInView(list.current, document.getElementById(highlighted));
  }, [at, page, pageAt, tool, rowsId, onWorkspace, onRunOnMac, workspaceAt]);

  /** A grant begun from the row: the browser opens, and the row waits on the window's return to read it. */
  const connect = (server: string) => {
    setWorking({ server, act: WORKING_ACT.CONNECT });
    void grant.begin(server).then(() => setWorking(undefined));
  };

  /** A sign-in waited on, ended here; a Cancel the service refused leaves it waiting, to press again. */
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

  /** Back from a tool's page to its server's, the filter and the highlight as they were. */
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

  /** Back from a tool's page to the app's, the filter and the highlight as they were. */
  const closeWorkspaceTool = () => setWorkspaceTool(undefined);

  /**
   * What a pick does when chosen: a server opens or connects, and a tool
   * opens its server's page, filtered to the search, as does a server the
   * search found tools of, as Settings › Integrations opens its row onto them.
   */
  const choose = (pick: Pick | undefined) => {
    if (pick === undefined) return;
    const { row } = pick;
    if (pick.tool !== undefined) return open(row, query);
    if (opensTools(row)) {
      return open(row, found.tools.some((hit) => hit.row === row) ? query : "");
    }
    // Note that Enter on a sign-in under way reopens it, its first press, as Retry begins it again.
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
      // Note that we flip the switch only on an empty search, because a space typed after a word is part of the search.
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

  // Escape goes back one level, and closes the popover only from its home.
  const dismiss = () => {
    if (onRunOnMac) closeWorkspaceTool();
    else if (onWorkspace) backFromWorkspace();
    else if (tool !== undefined) closeTool();
    else if (page !== undefined) back();
    else onBack();
  };

  /** A row's button while its server waits on an act: busy if it started that act, off if the other did. */
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

  /** A row's place among the home's picks, after the app's where it stands, which names its id and its highlight; a quiet row is none. */
  const pickIndex = (row: ServerRow, tool?: IntegrationTool) => {
    const index = picks.findIndex((pick) => pick.row === row && pick.tool === tool);
    return index < 0 ? index : index + workspaceOffset;
  };

  /** A row of the home: its place among the picks names its id and its highlight, and the pointer coming onto its press moves the highlight there. */
  const homeRow = (input: {
    key: string;
    index: number;
    row: ServerRow;
    title: React.ReactNode;
    meta?: React.ReactNode;
    actions?: React.ReactNode;
    /** The server's card, or the card of the tool a search found, hung beside the row. */
    card: React.ReactNode;
    /** Whether the press opens a further page, which a chevron says. */
    opens: boolean;
    /** The key the list's motion follows the row by, out of one section and into another. */
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
            // Note that the chevron takes the metadata's place while the row is in hand, as a sidebar row's ⋯ takes its count's, so a server's account fades to its count rather than short of room kept for the chevron.
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

  /** What a press on a server's row does: open its page, flip a switch with no page to open, or what Enter does; none for a row the keys pass over. */
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
      // Note that the count is the row's metadata, beside its switch, so every row's counts form one column, and the chevron takes its place while the row is in hand.
      meta: row.tools !== undefined ? toolsCount(row.tools.length) : undefined,
      card: <ServerCard provider={row.provider} connection={row.connection} />,
      actions: end(row),
      opens: opensTools(row),
      // Note that a server's row is followed by its connection, because a server that connects leaves Not connected for Connected and glides across rather than leaving one list and arriving in the other.
      motionKey: row.connection,
      // Note that a row the keys can choose takes the press as Enter does, because a row hangs its card from its press and a row with none would hang nothing.
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

  /** The app's own row, heading the home: its mark, its name, its count, `run_on_mac` where it is off, and Always on, opening its page. */
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

  /** One of the app's tools on its page: its name in mono and what it does, `run_on_mac` with whether it is on and, where it is off, why. */
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

  /** The app's page in the popover's place: back, its mark and name, its count, Always on, a filter, and its tools under their groups. */
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

  /** `run_on_mac`'s page over the app's: back, its name, whether it is on, what it does, and where it is off, why, and the fix where there is one. */
  const runOnMacPage = (reason: RunOnMacReason | undefined) => {
    const detail =
      reason === undefined ? undefined : runOnMacDetail(reason, workspace.answer?.runOnMac);
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
        {/* The page's one scroller, focused by script so its keys scroll it as any focused scroller's do. */}
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
      {/* Note that the searchable menu's own class rides a box drawn as its
          contents, because its rows' highlight is that menu's. */}
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

/** The popover as a menu's submenu, drawn while it stands and gone at once as it goes back. */
function ServersMenuPanel({
  servers,
  statuses,
  entered,
  onBack,
  onClose,
}: {
  servers: AgentServersControl;
  statuses: IntegrationStatuses;
  /** Whether a press or a key opened it, which takes the keyboard into its field. */
  entered: boolean;
  onBack: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const id = useId();
  // Note that focus leaving the popover is the menu's to hear, which closes unless it went to the menu itself.
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

/**
 * The + menu's Integrations row, which opens the popover beside the menu as
 * its submenu: the same popover the chip hangs, Escape on its home going
 * back to the row.
 */
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

/** The popover hung from a form's field chip, as an automation's servers are picked. */
export function AgentServersButton({
  servers,
  statuses,
  face,
}: {
  servers: AgentServersControl;
  /** Where every connection stands, as the form around the chip reads it. */
  statuses: IntegrationStatuses;
  /** What the chip shows, as a Settings picker's field chip draws it, chevron and all. */
  face: React.ReactNode;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const popoverId = useId();
  const labelId = useId();
  const faceId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  // Note that the popover is drawn from its opening until its fade has run, and no longer, because its search, its page and its reads of every server's tools are its own and start afresh each time it opens.
  const [drawn, setDrawn] = useState(open);
  if (open && !drawn) setDrawn(true);

  // Note that we hand focus back to the chip, as a menu returns it to its
  // trigger, because closing takes the focused popover away with it.
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <div className="agent-servers relative flex min-w-0" ref={root}>
      {/* A face is a form's field, at least the column its pickers share. */}
      <VisuallyHidden id={labelId}>{SERVERS_LABEL}</VisuallyHidden>
      {/* Note that the chip is named by its field's name and then the words its face draws ("None", "+2"), through its own id, because a name that left them out would not match the screen. */}
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
              // The window losing focus is the browser opened for a sign-in, whose outcome the popover waits to read.
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
