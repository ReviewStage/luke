import { connectionHealth } from "@repo/features/integration-health";
import { SIGN_IN_ACTION } from "@repo/features/integration-sign-in";
import {
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER,
  INTEGRATION_STATUS,
  integrationConnectionOf,
} from "@repo/features/integration-wire";
import {
  AccountWords,
  AnchoredPopover,
  BUTTON_VARIANT,
  Button,
  CHIP_LOOK,
  CHIP_WIDTH,
  Chip,
  GearIcon,
  LIST_DENSITY,
  LIST_ROW_CURRENT,
  List,
  ListMotion,
  ListRow,
  type ListRowHint,
  McpIcon,
  type MenuPanel,
  MenuSection,
  OneLine,
  type OneLineHint,
  POPOVER_ALIGN,
  POPOVER_PANEL_LOOK,
  PopoverPanel,
  PROVIDER_MARK_SIZE,
  ProviderMark,
  SCROLL_SIZE,
  ScrollArea,
  SEARCH_FIELD_LOOK,
  SearchField,
  Spinner,
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
} from "@repo/ui/agent-servers-model";
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
import { useIntegrationTools } from "../integration-tools.js";
import { revealWithin } from "../scroll-within.js";

/**
 * agent-servers.tsx -- the MCP servers row of an agent box's + menu and an automation's servers field, and the popover both open that lists the servers the agent is handed with a switch for each.
 *
 * The agent box's + opens a menu whose MCP servers row opens the popover
 * beside the menu as its submenu (`serversMenuPanel`, `@repo/ui`'s
 * `MenuPanel`), the menu standing behind it; an automation's form opens the
 * same popover from its field's chip, hung from the chip's trailing edge
 * (`AgentServersButton`, `@repo/ui`'s `AnchoredPopover`). Either way it is
 * a `PopoverPanel`, a menu's, drawn as the searchable menu is: a search
 * field first, then the servers under Connected, which counts how many this
 * agent has on, and Not connected (`agent-servers-model.ts`), each section
 * under `@repo/ui`'s `MenuSection`, and Manage in Settings pinned at the
 * foot. An agent is handed a server's every tool or none, so the popover
 * lists servers alone, never their tools, and our own tools, which no
 * agent can be denied, not at all. A connected server's row ends with this
 * agent's switch, which a press anywhere on the row flips; one whose server
 * answered why it lists no tools says why beside its name and ends with
 * Reconnect; one not connected ends with Connect, which sends the browser
 * to sign in there and then, as Settings does: the row waits on it with a
 * ring after its name, its line said only to a reader and in its title,
 * then Reopen and Cancel, and becomes the switch once the sign-in settles,
 * or says it failed or did not finish and offers Retry
 * (`../integration-sign-in.ts`). What is typed in the field finds servers
 * by name, account, or what they are for. Focus stays in the field, as the
 * searchable menu keeps it: the arrows move one highlight through the rows,
 * and Enter does what a press on the highlighted row does. Where every
 * connection stands is the composer's read (`../integration-statuses.ts`),
 * taken as it is drawn and again when the window is focused, which is how
 * the developer comes back from the browser, so the popover stays open
 * while the window is away. A draft agent keeps its choice until its first
 * message starts it. Escape closes the popover, or, standing as the + menu's
 * submenu, goes back to its row, and stops there so the panel behind stays
 * open; Manage in Settings closes the + menu with it. A second press of the
 * chip, and focus leaving it for another part of the window, close it too.
 * The chip, a row's switch and its Connect, Reopen, Cancel or Retry are
 * `@repo/ui`'s, each pressed without taking the focus from the field.
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

/**
 * The servers' list, taller than the searchable menu's, and never taller
 * than the window leaves above the composer once the field and the foot
 * are drawn, so the field stays on screen in the shortest window.
 */
const SERVERS_SCROLL_CLASS = "flex max-h-servers-list flex-col";

/** What the pinned row at the popover's foot is named, which opens Settings › Integrations. */
const SERVERS_SETTINGS = "Manage in Settings";

/** What the popover's list says where the deployment offers the account no server at all. */
const SERVERS_NONE = "No MCP servers available";

/** What the field asks for, and says where nothing matches. */
const SEARCH = {
  PLACEHOLDER: "Search MCP servers",
  NONE: "No MCP servers match",
} as const;

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
 * server hangs says them too (`server-card.tsx`).
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
 * server's tools read for as long as the caller is drawn, which says whether
 * its server works: every one's, or only the server named where the caller
 * draws that one alone.
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

/** The search field at the top of the popover, which holds the focus while it is open. */
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

/** What makes a row the highlighted one, where the pointer coming onto it moves the highlight. */
const RowHighlight = createContext<(() => void) | undefined>(undefined);

/**
 * The pointer coming onto a row's press makes it the highlighted one, as a
 * menu's highlight follows the pointer. Note that it rides the row's hint
 * slot, the one door to its press's pointer handlers, and raises no words.
 */
const PointerHighlight: ListRowHint = ({ children }) => {
  const highlight = useContext(RowHighlight);
  return cloneElement(children, {
    onPointerEnter: (event) => {
      children.props.onPointerEnter?.(event);
      highlight?.();
    },
  });
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
  /** Escape: back to the menu row that opened it, where it stands as a submenu; the close otherwise. */
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
  const [highlight, setHighlight] = useState(0);
  const grant = useIntegrationGrant(statuses);

  const groups = serverGroups(searchServers(rows, query));
  // A row the keys can land on: every row drawn but one whose standing is unread.
  const picks = groups
    .flatMap((group) => group.rows)
    .filter((row) => row.kind !== SERVER_ROW.QUIET);
  const at = Math.min(highlight, Math.max(picks.length - 1, 0));

  // The field takes focus as the popover opens, unless its owner leaves the keyboard where it was.
  useEffect(() => {
    if (takesFocus) field.current?.focus();
  }, [takesFocus]);

  useLayoutEffect(() => {
    const row = document.getElementById(`${rowsId}-${at}`);
    if (list.current !== null && row !== null) revealWithin(list.current, row);
  }, [at, rowsId]);

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

  /** What a press on a row does, as Enter on it does: flip its switch, connect it, or read again; none for a row the keys pass over. */
  const press = (row: ServerRow): (() => void) | undefined => {
    switch (row.kind) {
      case SERVER_ROW.SWITCH:
        return () => servers.onSwitch(switchedServers(servers.disabled, row.connection, !row.on));
      // Note that a sign-in under way reopens it, its first press, as Retry begins it again.
      case SERVER_ROW.CONNECT:
      case SERVER_ROW.RECONNECT:
      case SERVER_ROW.SIGNING_IN:
      case SERVER_ROW.TRY_AGAIN:
        return () => connect(row.connection);
      case SERVER_ROW.RETRY:
        return () => void statuses.read();
      case SERVER_ROW.QUIET:
        return undefined;
    }
  };

  const onKey = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHighlight(Math.min(Math.max(at + step, 0), Math.max(picks.length - 1, 0)));
    } else if (event.key === "Enter") {
      const row = picks[at];
      if (row === undefined) return;
      event.preventDefault();
      press(row)?.();
    }
  };

  /** A row's button while its server waits on an act: busy if it started that act, off if the other did. */
  const workingOn = (server: string, mine: WorkingAct, busyLabel: string) => {
    if (working?.server !== server) return {};
    return working.act === mine ? { busy: true, busyLabel } : { disabled: true };
  };

  /** A row's press-only button, which leaves the row's own press alone. */
  const rowButton = (
    label: string,
    onPress: () => void,
    waiting: ReturnType<typeof workingOn> = {},
  ) => (
    <Button
      variant={BUTTON_VARIANT.QUIET}
      keepFocus
      {...waiting}
      onClick={(event) => {
        event.stopPropagation();
        onPress();
      }}
    >
      {label}
    </Button>
  );

  const end = (row: ServerRow): React.JSX.Element | null => {
    switch (row.kind) {
      case SERVER_ROW.SWITCH:
        return <ServerSwitch row={row} servers={servers} />;
      case SERVER_ROW.CONNECT:
      case SERVER_ROW.RECONNECT:
        return rowButton(
          row.kind === SERVER_ROW.CONNECT ? SERVER_ACTION.CONNECT : SERVER_ACTION.RECONNECT,
          () => connect(row.connection),
          workingOn(row.connection, WORKING_ACT.CONNECT, "Connecting"),
        );
      case SERVER_ROW.SIGNING_IN:
        return (
          <>
            {rowButton(
              SIGN_IN_ACTION.REOPEN,
              () => connect(row.connection),
              workingOn(row.connection, WORKING_ACT.CONNECT, "Reopening the sign-in"),
            )}
            {rowButton(
              SIGN_IN_ACTION.CANCEL,
              () => cancel(row.connection),
              workingOn(row.connection, WORKING_ACT.CANCEL, "Canceling the sign-in"),
            )}
          </>
        );
      case SERVER_ROW.TRY_AGAIN:
        return rowButton(
          SIGN_IN_ACTION.TRY_AGAIN,
          () => connect(row.connection),
          workingOn(row.connection, WORKING_ACT.CONNECT, "Connecting"),
        );
      case SERVER_ROW.RETRY:
        return rowButton(SERVER_ACTION.RETRY, () => void statuses.read());
      case SERVER_ROW.QUIET:
        return null;
    }
  };

  /** A server's row: its place among the picks names its id and its highlight, and the pointer coming onto its press moves the highlight there. */
  const serverRow = (row: ServerRow) => {
    const index = picks.indexOf(row);
    return (
      <RowHighlight.Provider
        key={row.connection}
        value={index < 0 || index === at ? undefined : () => setHighlight(index)}
      >
        <ListRow
          id={index < 0 ? undefined : `${rowsId}-${index}`}
          leading={<ProviderMark provider={row.provider} size={PROVIDER_MARK_SIZE.ICON} />}
          title={<ServerRowWords row={row} />}
          actions={end(row)}
          current={index >= 0 && index === at ? LIST_ROW_CURRENT.ITEM : undefined}
          keepFocus
          tabbable={false}
          onPress={press(row)}
          // Note that a server's row is followed by its connection, because a server that connects leaves Not connected for Connected and glides across rather than leaving one list and arriving in the other.
          motionKey={row.connection}
          hint={{ Hint: PointerHighlight, label: row.name }}
        />
      </RowHighlight.Provider>
    );
  };

  return (
    <PopoverPanel
      open={standing}
      id={id}
      look={POPOVER_PANEL_LOOK.MENU}
      title={SERVERS_LABEL}
      takesFocus={takesFocus}
      onDismiss={onBack}
      onLeave={onLeave}
      onExited={onExited}
    >
      {/* Note that the searchable menu's own class rides a box drawn as its
          contents, because its rows' highlight is that menu's. */}
      <div className="agent-servers-menu contents">
        <SearchRow
          field={field}
          value={query}
          placeholder={SEARCH.PLACEHOLDER}
          onChange={(value) => {
            setQuery(value);
            setHighlight(0);
          }}
          onKeyDown={onKey}
        />
        <ReplayUnmask>
          <div className={SERVERS_SCROLL_CLASS}>
            <ScrollArea ref={list} size={SCROLL_SIZE.CONTENT}>
              <div ref={moving} className="agent-servers-list p-menu-inset">
                <ListMotion root={moving}>
                  {rows.length === 0 ? <ServersNote words={SERVERS_NONE} /> : null}
                  {rows.length > 0 && groups.length === 0 ? (
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
                </ListMotion>
              </div>
            </ScrollArea>
          </div>
        </ReplayUnmask>
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
 * The + menu's MCP servers row, which opens the popover beside the menu as
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
