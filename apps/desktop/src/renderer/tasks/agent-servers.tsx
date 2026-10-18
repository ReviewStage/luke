import {
  connectionHealth,
  type IntegrationTool,
  toolsCount,
} from "@luke/features/integration-health";
import { SIGN_IN_ACTION } from "@luke/features/integration-sign-in";
import { byName, toolTitle } from "@luke/features/integration-tool-model";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_STATUS,
  integrationConnectionOf,
} from "@luke/features/integration-wire";
import {
  AnchoredPopover,
  ArrowLeftIcon,
  BUTTON_VARIANT,
  Button,
  CHIP_LOOK,
  ChevronRightIcon,
  Chip,
  GearIcon,
  IconButton,
  McpIcon,
  POPOVER_ALIGN,
  ProviderMark,
  SearchIcon,
  Spinner,
  Switch,
} from "@luke/ui";
import {
  namedServers,
  opensTools,
  SERVER_ACTION,
  SERVER_ROW,
  SERVERS_LABEL,
  type ServerRow,
  searchServers,
  serverGroups,
  serverRows,
  switchedServers,
  type ToolHit,
} from "@luke/ui/agent-servers-model";
import { matchIntegration, shownTools } from "@luke/ui/integration-search";
import { searchTokens } from "@luke/ui/search-tokens";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useIntegrationGrant } from "../integration-grant";
import type { IntegrationStatuses } from "../integration-statuses";
import { IntegrationToolDetail, IntegrationToolList, keepInView } from "../integration-tool-list";
import { useIntegrationTools } from "../integration-tools";
import { Highlighted } from "../search-field";
import { Tooltip } from "../tooltip";

/**
 * agent-servers.tsx -- the MCP button at an agent box's foot, and the popover that lists the servers the agent is handed with a switch for each, and each server's tools.
 *
 * Between the model chip and the context ring stands the MCP mark. A press
 * opens a popover from the button's trailing edge, as the model menu and
 * the context popover hang from theirs (`@luke/ui`'s `AnchoredPopover`), drawn
 * as the searchable menu is: a search field first, then the servers under
 * Connected and Not connected (`agent-servers-model.ts`), and Manage in
 * Settings pinned at the foot. A connected server's row names how many
 * tools it offers and ends with this agent's switch; one whose server
 * answered why it lists none says why beside its name and ends with
 * Reconnect; one not connected ends with Connect, which sends the browser
 * to sign in there and then, as Settings does: the row waits on it with a
 * ring after its name, its line said only to a reader and in its title,
 * then Reopen and Cancel, and becomes the switch once the sign-in settles,
 * or says it failed or did not finish and offers Try again
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
 * server's, and otherwise closes the popover, and stops there so the panel behind stays open; a
 * second press of the button, and focus leaving it for another part of the
 * window, close it too. The button, the back, a row's switch and its
 * Connect, Reopen, Cancel, Try again or Retry are `@luke/ui`'s, each pressed
 * without taking the focus from the field.
 */

/** The servers an agent is handed, as the button changes them. */
export interface AgentServersControl {
  /** The servers switched off for this agent: the one on its way where one is, else the agent's. */
  readonly disabled: readonly string[];
  /** Switches the agent's servers, the whole list of those off. */
  readonly onSwitch: (next: readonly string[]) => void;
  /** Opens Settings on its Integrations page, where a server is disconnected. */
  readonly onOpenSettings: () => void;
}

/** The provider a server name that parses as none would be drawn as; never reached, since every row's name is minted from a provider. */
const GITHUB = INTEGRATION_PROVIDER.GITHUB;

/** What the pinned row at the popover's foot is named, which opens Settings › Integrations. */
const SERVERS_SETTINGS = "Manage in Settings";

/** What the popover's list says where the deployment offers the account no server at all. */
const SERVERS_NONE = "No servers available";

/** What the home's field asks for, and says where nothing matches. */
const SEARCH = {
  PLACEHOLDER: "Search servers and tools",
  NONE: "No servers or tools match",
  TOOLS: "Tools",
} as const;

/** What a server's page says where its filter matches nothing, and how its back button is named. */
const PAGE = {
  NONE: "No tools match",
  BACK: "Back to MCP servers",
} as const;

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

/**
 * What a server's row says between its mark and its end, here and on the
 * card a mention of the server hangs (`server-card.tsx`): its name, how many
 * tools it offers, and where its sign-in or its server stands.
 */
export function ServerRowWords({ row }: { row: ServerRow }): React.JSX.Element {
  return (
    <>
      <span className="task-compose-menu-name">{row.name}</span>
      {row.tools !== undefined ? (
        <span className="agent-servers-count">{toolsCount(row.tools.length)}</span>
      ) : null}
      {row.kind === SERVER_ROW.SIGNING_IN ? (
        <span className="agent-servers-waiting" title={row.note}>
          <Spinner label={row.note ?? ""} />
        </span>
      ) : null}
      {row.problem !== undefined ? (
        <span className="agent-servers-problem" title={row.problem}>
          {row.problem}
        </span>
      ) : null}
      {row.note !== undefined && row.kind !== SERVER_ROW.SIGNING_IN ? (
        <span className="agent-servers-problem" data-tone="quiet" title={row.note}>
          {row.note}
        </span>
      ) : null}
    </>
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
  onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}): React.JSX.Element {
  return (
    <div className="task-compose-menu-search">
      <SearchIcon />
      <input
        ref={field}
        type="text"
        value={value}
        placeholder={placeholder}
        aria-label={placeholder}
        spellCheck={false}
        onChange={(event) => onChange(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
    </div>
  );
}

function ServersPopover({
  id,
  servers,
  statuses,
  onClose,
  onLeave,
}: {
  id: string;
  servers: AgentServersControl;
  statuses: IntegrationStatuses;
  /** Closes the popover and hands focus back to the button. */
  onClose: () => void;
  /** Focus left the popover for `left`; the owner closes unless that is still its own. */
  onLeave: (left: EventTarget | null) => void;
}): React.JSX.Element {
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const rowsId = useId();
  const rows = useServerRows(statuses, servers.disabled);
  const [connecting, setConnecting] = useState<string | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const [opened, setOpened] = useState<string | undefined>(undefined);
  const [highlight, setHighlight] = useState(0);
  const [pageHighlight, setPageHighlight] = useState(0);
  const [openedTool, setOpenedTool] = useState<string | undefined>(undefined);
  const toolBody = useRef<HTMLDivElement>(null);
  const grant = useIntegrationGrant(statuses);

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
  const at = Math.min(highlight, Math.max(picks.length - 1, 0));

  // The field takes focus as the popover opens and as either page is drawn,
  // and a tool's page its body, so the keys and focus leaving it are heard.
  useEffect(() => {
    if (tool !== undefined) toolBody.current?.focus({ preventScroll: true });
    else field.current?.focus();
  }, [page?.connection, tool]);

  useLayoutEffect(() => {
    if (tool !== undefined) return;
    keepInView(
      list.current,
      document.getElementById(page === undefined ? `${rowsId}-${at}` : `${rowsId}-tool-${pageAt}`),
    );
  }, [at, page, pageAt, tool, rowsId]);

  /** A grant begun from the row: the browser opens, and the row waits on the window's return to read it. */
  const connect = (server: string) => {
    setConnecting(server);
    void grant.begin(server).then(() => setConnecting(undefined));
  };

  /** A sign-in waited on, ended here; a Cancel the service refused leaves it waiting, to press again. */
  const cancel = (server: string) => {
    setConnecting(server);
    void statuses.cancelSignIn(server).then(() => setConnecting(undefined));
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
    // Note that Enter on a sign-in under way reopens it, its first press, as Try again begins it again.
    if (
      row.kind === SERVER_ROW.CONNECT ||
      row.kind === SERVER_ROW.RECONNECT ||
      row.kind === SERVER_ROW.SIGNING_IN ||
      row.kind === SERVER_ROW.TRY_AGAIN
    )
      return connect(row.connection);
    if (row.kind === SERVER_ROW.RETRY) void statuses.read();
  };

  const onHomeKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const caretAtEnd = event.currentTarget.selectionStart === query.length;
    const pick = picks[at];
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlight(Math.min(Math.max(at + step, 0), Math.max(picks.length - 1, 0)));
    } else if (event.key === "Enter" || (event.key === "ArrowRight" && caretAtEnd)) {
      if (
        event.key === "ArrowRight" &&
        !(pick !== undefined && (pick.tool !== undefined || opensTools(pick.row)))
      )
        return;
      event.preventDefault();
      choose(pick);
    } else if (event.key === " " && query.trim() === "" && pick?.row.kind === SERVER_ROW.SWITCH) {
      // Note that we flip the switch only on an empty search, because a space typed after a word is part of the search.
      event.preventDefault();
      servers.onSwitch(switchedServers(servers.disabled, pick.row.connection, !pick.row.on));
    }
  };

  const onPageKey = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const caretAtEnd = event.currentTarget.selectionStart === filter.length;
    const highlighted = pageTools[pageAt];
    if ((event.key === "ArrowLeft" || event.key === "Backspace") && filter === "") {
      event.preventDefault();
      back();
    } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setPageHighlight(Math.min(Math.max(pageAt + step, 0), Math.max(pageTools.length - 1, 0)));
    } else if (
      highlighted !== undefined &&
      (event.key === "Enter" || (event.key === "ArrowRight" && caretAtEnd))
    ) {
      event.preventDefault();
      openTool(highlighted.name);
    }
  };

  const onToolKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "Backspace") return;
    event.preventDefault();
    closeTool();
  };

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    if (tool !== undefined) closeTool();
    else if (page !== undefined) back();
    else onClose();
  };

  const end = (row: ServerRow): React.JSX.Element | null => {
    switch (row.kind) {
      case SERVER_ROW.SWITCH:
        return (
          <>
            {opensTools(row) ? (
              <span className="agent-servers-chevron" aria-hidden="true">
                <ChevronRightIcon />
              </span>
            ) : null}
            <ServerSwitch row={row} servers={servers} />
          </>
        );
      case SERVER_ROW.CONNECT:
      case SERVER_ROW.RECONNECT:
        return (
          <Button
            variant={BUTTON_VARIANT.QUIET}
            keepFocus
            disabled={connecting === row.connection}
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
              disabled={connecting === row.connection}
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
              disabled={connecting === row.connection}
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
            disabled={connecting === row.connection}
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

  /** A row's place among the picks, which names its id and its highlight; a quiet row is none. */
  const pickIndex = (row: ServerRow, tool?: IntegrationTool) =>
    picks.findIndex((pick) => pick.row === row && pick.tool === tool);

  const serverRow = (row: ServerRow) => {
    const index = pickIndex(row);
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: the row's press is the field's Enter for the pointer; its switch and button are the controls.
      // biome-ignore lint/a11y/useKeyWithClickEvents: the keys reach the row through the field, which holds the focus.
      <div
        key={row.connection}
        id={index < 0 ? undefined : `${rowsId}-${index}`}
        className="menu-item agent-servers-row"
        data-highlighted={index === at ? "true" : undefined}
        data-opens={opensTools(row) ? "true" : undefined}
        aria-disabled={row.kind === SERVER_ROW.QUIET ? "true" : undefined}
        onMouseMove={() => index >= 0 && index !== at && setHighlight(index)}
        onMouseDown={keepFieldFocus}
        onClick={() => opensTools(row) && open(row)}
      >
        <ProviderMark provider={row.provider} />
        <ServerRowWords row={row} />
        <span className="agent-servers-end">{end(row)}</span>
      </div>
    );
  };

  const toolRow = ({ row, tool }: ToolHit) => {
    const index = pickIndex(row, tool);
    return (
      // biome-ignore lint/a11y/noStaticElementInteractions: as a server's row, a press is the field's Enter for the pointer.
      // biome-ignore lint/a11y/useKeyWithClickEvents: the keys reach the row through the field, which holds the focus.
      <div
        key={`${row.connection}:${tool.name}`}
        id={`${rowsId}-${index}`}
        className="menu-item agent-servers-row agent-servers-hit"
        data-highlighted={index === at ? "true" : undefined}
        onMouseMove={() => index !== at && setHighlight(index)}
        onMouseDown={keepFieldFocus}
        onClick={() => open(row, query)}
      >
        <ProviderMark provider={row.provider} />
        <span className="task-compose-menu-name integration-tool-id">
          <Highlighted text={tool.name} tokens={searchTokens(query)} />
        </span>
        <span className="agent-servers-count">{row.name}</span>
      </div>
    );
  };

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
      <div ref={list} className="task-compose-menu-list agent-servers-list">
        {rows.length === 0 ? <p className="task-compose-menu-note">{SERVERS_NONE}</p> : null}
        {rows.length > 0 && picks.length === 0 && groups.length === 0 ? (
          <p className="task-compose-menu-note">{SEARCH.NONE}</p>
        ) : null}
        {groups.map((group) => (
          // biome-ignore lint/a11y/useSemanticElements: a menu's section of rows, as the searchable menu's are, which a <fieldset> of form controls is not.
          <div key={group.heading ?? "unread"} role="group" aria-label={group.heading}>
            {group.heading !== undefined ? (
              <div className="menu-heading">{group.heading}</div>
            ) : null}
            {group.rows.map(serverRow)}
          </div>
        ))}
        {found.tools.length > 0 ? (
          // biome-ignore lint/a11y/useSemanticElements: a menu's section of rows, as the searchable menu's are, which a <fieldset> of form controls is not.
          <div role="group" aria-label={SEARCH.TOOLS}>
            <div className="menu-heading">{SEARCH.TOOLS}</div>
            {found.tools.map(toolRow)}
          </div>
        ) : null}
      </div>
    </>
  );

  const serverPage = (row: ServerRow) => {
    return (
      <>
        <div className="agent-servers-page-head">
          <Tooltip label={PAGE.BACK}>
            <IconButton icon={<ArrowLeftIcon />} label={PAGE.BACK} keepFocus onClick={back} />
          </Tooltip>
          <ProviderMark provider={row.provider} />
          <span className="agent-servers-page-title">{row.name}</span>
          <span className="agent-servers-count">{toolsCount(row.tools?.length ?? 0)}</span>
          <span className="agent-servers-end">
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
        <div ref={list} className="task-compose-menu-list agent-servers-list">
          {pageTools.length === 0 ? <p className="task-compose-menu-note">{PAGE.NONE}</p> : null}
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
      </>
    );
  };

  const toolPage = (row: ServerRow, shown: IntegrationTool) => (
    <div className="agent-servers-tool-page">
      <IntegrationToolDetail
        server={row.name}
        tool={shown}
        tokens={pageTokens}
        backLabel={`Back to ${row.name} tools`}
        onBack={closeTool}
        keepFocus
        bodyRef={toolBody}
        onBodyKeyDown={onToolKey}
      />
    </div>
  );

  return (
    <div
      id={id}
      className="menu-surface searchable-menu agent-servers-menu"
      role="dialog"
      aria-label={
        tool !== undefined
          ? toolTitle(tool)
          : page !== undefined
            ? `${page.name} tools`
            : SERVERS_LABEL
      }
      // Note that the dialog takes the focus a press on its words would
      // otherwise hand to the page, because focus leaving the popover closes
      // it: a press that selects a tool's description must not.
      tabIndex={-1}
      onKeyDown={onKey}
      onBlur={(event) => onLeave(event.relatedTarget)}
    >
      {page !== undefined && tool !== undefined
        ? toolPage(page, tool)
        : page !== undefined
          ? serverPage(page)
          : home}
      <div className="task-compose-menu-foot">
        <button
          type="button"
          className="menu-item agent-servers-manage"
          onMouseDown={keepFieldFocus}
          onClick={() => {
            onClose();
            servers.onOpenSettings();
          }}
        >
          <GearIcon />
          <span className="task-compose-menu-name">{SERVERS_SETTINGS}</span>
        </button>
      </div>
    </div>
  );
}

export function AgentServersButton({
  servers,
  statuses,
  face,
  open: heldOpen,
  onOpenChange,
}: {
  servers: AgentServersControl;
  /** Where every connection stands, as the composer around the button reads it. */
  statuses: IntegrationStatuses;
  /**
   * What a form row's button shows in place of the MCP mark, which draws it
   * as a Settings picker's field chip, chevron and all; the composer's
   * button leaves it out.
   */
  face?: React.ReactNode;
  /** Whether the popover stands, where the owner holds it, as the composer does so its ⋯ menu can open it; the button's own otherwise. */
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
}): React.JSX.Element {
  const [ownOpen, setOwnOpen] = useState(false);
  const open = heldOpen ?? ownOpen;
  const setOpen = onOpenChange ?? setOwnOpen;
  const popoverId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // Note that we hand focus back to the button, as a menu returns it to its
  // trigger, because closing takes the focused popover away with it.
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const press = {
    ref: trigger,
    "aria-haspopup": "dialog",
    "aria-expanded": open,
    "aria-controls": open ? popoverId : undefined,
    onClick: () => setOpen(!open),
  } as const;

  return (
    <div className="agent-servers" ref={root}>
      {face === undefined ? (
        // Note that the box, not the button, wears the class the composer's ⋯ finds the press by (`agent-composer.tsx`).
        <span className="agent-servers-button">
          <Tooltip label={SERVERS_LABEL}>
            <IconButton icon={<McpIcon />} label={SERVERS_LABEL} {...press} />
          </Tooltip>
        </span>
      ) : (
        <Chip look={CHIP_LOOK.FIELD} chevron aria-label={SERVERS_LABEL} {...press}>
          {face}
        </Chip>
      )}
      {open ? (
        <AnchoredPopover align={POPOVER_ALIGN.END}>
          <ServersPopover
            id={popoverId}
            servers={servers}
            statuses={statuses}
            onClose={close}
            onLeave={(left) => {
              // The window losing focus is the browser opened for a sign-in, whose outcome the popover waits to read.
              if (!document.hasFocus()) return;
              if (!(left instanceof Node && root.current?.contains(left))) setOpen(false);
            }}
          />
        </AnchoredPopover>
      ) : null}
    </div>
  );
}
