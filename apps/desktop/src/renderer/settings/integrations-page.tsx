import {
  CONNECTION_HEALTH,
  type ConnectionHealth,
  connectionHealth,
  type IntegrationTool,
  toolsCount,
} from "@luke/features/integration-health";
import {
  SIGN_IN,
  SIGN_IN_ACTION,
  type SignIn,
  signInLine,
} from "@luke/features/integration-sign-in";
import { byName } from "@luke/features/integration-tool-model";
import type { IntegrationStatusView } from "@luke/features/integration-view";
import {
  INTEGRATION_ACCOUNTS_MAX,
  INTEGRATION_LABEL_MAX,
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
  integrationAccountLabel,
  integrationConnectionOf,
} from "@luke/features/integration-wire";
import { ACT_KIND } from "@luke/host/acts";
import { APP_COMMAND, APP_SHORTCUTS } from "@luke/settings/shortcuts";
import {
  BUTTON_VARIANT,
  Button,
  ChevronRightIcon,
  ConfirmDialog,
  ErrorState,
  ProviderMark,
  SETTINGS_LINE_KIND,
  SearchField,
  SettingsLine,
  SettingsSection,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TrashIcon,
  useConfirmDialog,
} from "@luke/ui";
import {
  namedServers,
  type ServerRow,
  serverGroups,
  serverRows,
} from "@luke/ui/agent-servers-model";
import { matchIntegration, shownTools } from "@luke/ui/integration-search";
import { searchTokens } from "@luke/ui/search-tokens";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { PencilIcon, PlusIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { type ActHandle, useAct } from "../act";
import { useAppCommand } from "../app-commands";
import { type NameEdit, TaskNameField } from "../desktop/task-name-field";
import { type GitHubConnectControl, useGitHubConnection } from "../github-connect";
import { GRANT_OUTCOME, grantedBySignIn, useIntegrationGrant } from "../integration-grant";
import { type IntegrationStatuses, useIntegrationStatuses } from "../integration-statuses";
import { IntegrationToolDetail, IntegrationToolList, keepInView } from "../integration-tool-list";
import { useIntegrationTools } from "../integration-tools";
import { focusSearchField, Highlighted } from "../search-field";
import { Shortcut } from "../shortcut";
import { SPINNER_SIZE, SpinnerRing } from "../spinner";
import { commandKeyshortcuts } from "../tooltip";
import { MenuRow } from "./menu-row";

/**
 * integrations-page.tsx -- Settings › Integrations: the services the account connects so Luke's agents can use them.
 *
 * One row per account at a provider (two Notion workspaces are two rows,
 * "Notion · Acme" and "Notion · Personal", each its own grant), and one for
 * a provider where the account holds none, under Connected or Not connected as the MCP popover
 * sections its servers (`../planning/agent-servers-model.ts`), each section
 * in the order of the providers' names: its mark and name, and under it where its connection
 * stands once that needs saying — connected with the count of its server's
 * tools, a sign-in under way, or one expired. A sign-in begun waits on the
 * browser with Reopen and Cancel, and one that failed or never finished
 * says so with Try again (`integration-sign-in.ts`). A connection is said to be
 * connected only once its server answered with its tools; one whose server
 * answered why it would not says why instead (`integration-health.ts`). A
 * row's button is for the problem state alone: Connect while none stands,
 * and Reconnect where a sign-in expired or a broken connection is mended by
 * one. A connected row that works stands quiet, and its ⋯ (or a right-click
 * on it) keeps Reconnect, which signs in with the provider again, beside
 * Disconnect, which asks first in the confirm dialog and ends that account
 * alone. Where the provider offers more than one account, the ⋯ keeps Add
 * another account, which begins a sign-in for a new one that stands pending
 * as a row of its own until it settles; and where it holds more than one,
 * Rename, which names the account in place. GitHub is granted by the
 * account's own GitHub (`integration-grant.ts`), which lets agents use
 * GitHub's tools as the developer and is linked nowhere else, as its ⋯ says
 * over its acts: its Connect links that GitHub in the browser, and its
 * Disconnect unlinks it under the Mac's session, a refusal saying why in a
 * toast. A workspace's repositories are not this; they come from the GitHub
 * connected in Settings › Workspace. The window never sees a sign-in
 * address; the host opens it. Where every
 * connection stands is read once for the page (`integration-statuses.ts`),
 * when it is drawn and whenever the window is focused, which is how the
 * developer comes back from the browser. A provider this deployment does not
 * offer the account has no row, as its agents are never handed it. Every
 * line is fixed by the build, but for the one-line reason a provider's
 * server gave, which the service passes on only where it carries no
 * credential, and its tools' names and descriptions, which its server gave.
 *
 * A connected row whose server answered with its tools opens in place onto
 * them, drawn as the MCP popover draws a server's page
 * (`../integration-tool-list.tsx`): alphabetical, one line each, badged only
 * by its server's own annotations, and beside the list the page of the tool
 * it holds, drawn as the popover draws a tool's page: the first at first,
 * then whichever a press or the arrows move to. The list is one stop for
 * Tab, whose arrows, Home, and End move through the tools; Return or Right
 * hands the focus to the tool's page, whose arrows scroll it, and Escape or
 * Left hands it back.
 *
 * The page has a search of its own above its rows, for the integrations and
 * their tools, apart from Settings' search in the sidebar, which finds pages
 * and rows: it finds what the MCP popover's search finds, by the same words
 * (`../integration-search.ts`). Command-F lands in it while the page shows,
 * and Escape clears it, then lets go of the caret. While a query stands, the
 * page keeps only the rows it found, in their sections, and a row with a
 * tool it found opens by itself onto just those, the words marked and the
 * count of them on its line; a query that finds nothing says so. Settings'
 * own search hands its query down when one of its results opens a row here
 * (`../desktop/desktop-settings.tsx`).
 *
 * The search is `@luke/ui`'s `SearchField`, each section its
 * `SettingsSection`, and each row `MenuRow`'s `SettingsRow`, led by the
 * provider's mark, its line the row's description. A row's Connect,
 * Reconnect, Try again, and Cancel are the outline `Button`, and Reopen the
 * quiet one beside Cancel.
 */

/** The page's search: the query standing in its field, held by Settings so its own search can hand one down. */
export interface IntegrationsFilter {
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
}

/** How the page's search field is found by the seek that lands Command-F's caret in it. */
const FILTER_INPUT_ID = "integrations-filter-input";

/** What the page's search field asks for. */
const FILTER_PLACEHOLDER = "Search integrations and tools";

const PAGE_LINE = {
  CONNECTED: "Connected",
  CHECKING: "Checking…",
  SIGNED_OUT: "Sign in to connect integrations.",
  READ_FAILED: "Your integrations could not be read.",
  NONE_OFFERED: "No integrations are available for this account.",
  NOT_OPENED: "Luke could not open your browser to sign in.",
  GITHUB_SIGN_IN: "Uses your GitHub sign-in",
} as const;

/** What a row offers to mend its connection, on its button or in its ⋯. */
const ROW_ACT = {
  RECONNECT: "Reconnect",
  ADD_ACCOUNT: "Add another account",
  RENAME: "Rename",
} as const;

const ACCEPTED: ActionResult = { status: ACTION_RESULT_STATUS.ACCEPTED };

/** The provider a server name that parses as none would be drawn as; never reached, since every row's name is minted from a provider. */
const GITHUB = INTEGRATION_PROVIDER.GITHUB;

/** What a row's line looks like: connected with its dot, a problem in the attention tint, a wait with its ring, or plain. */
const LINE_STATE = {
  CONNECTED: "connected",
  ATTENTION: "attention",
  WAITING: "waiting",
  PLAIN: "plain",
} as const;

type LineState = (typeof LINE_STATE)[keyof typeof LINE_STATE];

/** The line under a row's name, and how it looks. */
interface RowLine {
  readonly text: string;
  readonly state: LineState;
}

/** A connected row's line, from how its server answered. */
function connectedLine(health: ConnectionHealth): RowLine {
  switch (health.kind) {
    case CONNECTION_HEALTH.WORKING:
      return {
        text: `${PAGE_LINE.CONNECTED} · ${toolsCount(health.tools.length)}`,
        state: LINE_STATE.CONNECTED,
      };
    case CONNECTION_HEALTH.BROKEN:
      return { text: health.problem, state: LINE_STATE.ATTENTION };
    case CONNECTION_HEALTH.CHECKING:
      return { text: PAGE_LINE.CHECKING, state: LINE_STATE.PLAIN };
    case CONNECTION_HEALTH.UNKNOWN:
      return { text: PAGE_LINE.CONNECTED, state: LINE_STATE.CONNECTED };
  }
}

/** A sign-in's line: its wait with the ring, a failure in the attention tint, or one unfinished, plain. */
function signInRowLine(provider: IntegrationProvider, signIn: SignIn): RowLine {
  const { text, problem } = signInLine(provider, signIn);
  if (signIn.kind === SIGN_IN.WAITING) return { text, state: LINE_STATE.WAITING };
  return { text, state: problem ? LINE_STATE.ATTENTION : LINE_STATE.PLAIN };
}

/**
 * The line under a row's name: a sign-in the window waits on or last waited
 * on, else where the connection stands, or nothing where the row's own
 * control already says it — a Connect, or a row whose status has not been
 * read. A connection that stands outranks a sign-in, which a read that
 * finds it connected ends anyway.
 */
function rowLine(
  provider: IntegrationProvider,
  status: IntegrationStatus | undefined,
  health: ConnectionHealth,
  signIn: SignIn | undefined,
): RowLine | undefined {
  if (status === INTEGRATION_STATUS.CONNECTED) return connectedLine(health);
  if (signIn !== undefined) return signInRowLine(provider, signIn);
  switch (status) {
    case INTEGRATION_STATUS.PENDING:
      return undefined;
    case INTEGRATION_STATUS.EXPIRED:
      return { text: "Sign-in expired.", state: LINE_STATE.ATTENTION };
    case INTEGRATION_STATUS.DISCONNECTED:
    case undefined:
    case INTEGRATION_STATUS.UNAVAILABLE:
      return undefined;
  }
}

/**
 * What a row's grant button says: Reconnect over a connection that broke,
 * GitHub's included, else Try again after a sign-in that did not connect,
 * else Connect or Reconnect.
 */
function grantLabel(status: IntegrationStatus | undefined, signIn: SignIn | undefined): string {
  if (status === INTEGRATION_STATUS.CONNECTED) return ROW_ACT.RECONNECT;
  if (signIn !== undefined) return SIGN_IN_ACTION.TRY_AGAIN;
  return status === INTEGRATION_STATUS.EXPIRED ? ROW_ACT.RECONNECT : "Connect";
}

/** A row's line, with the ring before a wait's words. */
function RowLineText({ line }: { line: RowLine }): React.JSX.Element {
  return (
    <span className="settings-state" data-state={line.state}>
      {line.state === LINE_STATE.WAITING ? (
        <span className="luke-spinner" data-size={SPINNER_SIZE.INLINE}>
          <SpinnerRing />
        </span>
      ) : null}
      {line.text}
    </span>
  );
}

/** How a row's tools are drawn: which of them, whether they show, and the search that chose them. */
interface RowTools {
  /** The tools the row opens onto: every one, or those the search found. */
  readonly shown: readonly IntegrationTool[];
  /** Every tool its server answered with; the row opens onto none when none. */
  readonly all: readonly IntegrationTool[];
  /** The search found some of its tools, which are those shown. */
  readonly found: boolean;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  /** The words searched, marked where they landed. */
  readonly tokens: readonly string[];
}

/**
 * A connected row's line once its server answered with tools: Connected,
 * and the count of them as the press that opens the row onto them, its
 * chevron turning down while they show.
 */
function ToolsLine({
  name,
  panelId,
  tools,
}: {
  name: string;
  panelId: string;
  tools: RowTools;
}): React.JSX.Element {
  return (
    <span className="settings-state integration-tools-line" data-state={LINE_STATE.CONNECTED}>
      {`${PAGE_LINE.CONNECTED} · `}
      <button
        type="button"
        className="integration-tools-toggle"
        aria-label={`${tools.expanded ? "Hide" : "Show"} ${name} tools`}
        aria-expanded={tools.expanded}
        aria-controls={tools.expanded ? panelId : undefined}
        onClick={tools.onToggle}
      >
        {tools.found
          ? `${tools.shown.length} of ${toolsCount(tools.all.length)} match`
          : toolsCount(tools.all.length)}
        <ChevronRightIcon />
      </button>
    </span>
  );
}

/** The keys that move the list's tool, by how far each moves it in a list of `count`. */
function movedTo(key: string, at: number, count: number): number | undefined {
  if (key === "ArrowDown") return Math.min(at + 1, count - 1);
  if (key === "ArrowUp") return Math.max(at - 1, 0);
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return undefined;
}

/** A row's tools, opened in place under it: the list, and beside it the page of the tool it holds. */
function RowToolsPanel({
  id,
  name,
  tools,
}: {
  id: string;
  name: string;
  tools: RowTools;
}): React.JSX.Element {
  const shown = byName(tools.shown);
  const [held, setHeld] = useState<string | undefined>(undefined);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const body = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // A tool the search no longer finds hands its place to the first that it does.
  const current = shown.find((tool) => tool.name === held) ?? shown[0];

  const hold = (tool: IntegrationTool | undefined) => {
    if (tool === undefined) return;
    setHeld(tool.name);
    const row = rows.current.get(tool.name);
    row?.focus({ preventScroll: true });
    keepInView(list.current, row?.closest(".integration-tool") ?? null);
  };

  const onRowKey = (event: React.KeyboardEvent<HTMLButtonElement>, tool: IntegrationTool) => {
    const at = shown.indexOf(tool);
    const to = movedTo(event.key, at, shown.length);
    if (to !== undefined) {
      event.preventDefault();
      hold(shown[to]);
    } else if (event.key === "Enter" || event.key === "ArrowRight") {
      event.preventDefault();
      setHeld(tool.name);
      body.current?.focus();
    }
  };

  const onBodyKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" && event.key !== "ArrowLeft") return;
    // Note that Escape stops here, because it hands the focus back to the list rather than leaving Settings.
    event.preventDefault();
    event.stopPropagation();
    if (current !== undefined) rows.current.get(current.name)?.focus({ preventScroll: true });
  };

  return (
    <div id={id} className="integration-tools-panel">
      <div className="integration-tools-split">
        <div ref={list} className="integration-tools-list">
          <IntegrationToolList
            server={name}
            tools={shown}
            tokens={tools.tokens}
            current={current?.name}
            onOpen={hold}
            onKeyDown={onRowKey}
            rowRef={(tool, button) => {
              if (button === null) rows.current.delete(tool.name);
              else rows.current.set(tool.name, button);
            }}
          />
        </div>
        {current !== undefined ? (
          <IntegrationToolDetail
            // Note that a tool held is a page of its own, so it opens at its top rather than where the last was scrolled.
            key={current.name}
            server={name}
            tool={current}
            tokens={tools.tokens}
            bodyRef={body}
            onBodyKeyDown={onBodyKey}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * The page's search field: a magnifier, the field, and a clear button while
 * a query stands, else Command-F's chord, which lands the caret here while
 * the page shows. Escape clears a query, then lets go of the caret, kept in
 * the field either way so it never leaves Settings behind it.
 */
function FilterField({ filter }: { filter: IntegrationsFilter }): React.JSX.Element {
  const field = useRef<HTMLInputElement | null>(null);
  const { query, onQueryChange } = filter;
  useAppCommand(APP_COMMAND.FIND, () => focusSearchField(FILTER_INPUT_ID));
  return (
    <search>
      <SearchField
        ref={field}
        id={FILTER_INPUT_ID}
        label={FILTER_PLACEHOLDER}
        placeholder={FILTER_PLACEHOLDER}
        keyShortcuts={commandKeyshortcuts(APP_COMMAND.FIND)}
        value={query}
        onChange={onQueryChange}
        shortcut={<Shortcut chord={APP_SHORTCUTS[APP_COMMAND.FIND].chord} />}
        onClear={() => onQueryChange("")}
        onEscape={() => {
          if (query.length > 0) onQueryChange("");
          else field.current?.blur();
        }}
      />
    </search>
  );
}

/**
 * Disconnects one account: a Connect grant at the service, and GitHub by
 * unlinking the account's GitHub under the Mac's session, whose refusal is
 * the window's toast, so the dialog closes either way. The integrations
 * are read again after, so an account past the provider's first leaves the
 * page with its row.
 */
function disconnectAccount(
  act: ActHandle["act"],
  github: GitHubConnectControl,
  row: ServerRow,
  statuses: IntegrationStatuses,
): Promise<ActionResult> {
  const { provider, connection, name } = row;
  const refused: ActionResult = {
    status: ACTION_RESULT_STATUS.REJECTED,
    reason: `Luke could not disconnect ${name}. Try again in a moment.`,
  };
  if (grantedBySignIn(provider)) {
    return github.disconnect().then((disconnected) => {
      if (disconnected) statuses.settle(provider, INTEGRATION_STATUS.DISCONNECTED);
      return ACCEPTED;
    });
  }
  return act(ACT_KIND.INTEGRATIONS_DISCONNECT, {
    provider,
    ...(connection === provider ? undefined : { connection }),
  }).then(
    (answer: IntegrationStatusView) => {
      if ("failure" in answer) return refused;
      statuses.settle(connection, answer.status);
      void statuses.read();
      return ACCEPTED;
    },
    () => refused,
  );
}

function IntegrationRow({
  row,
  status,
  health,
  statuses,
  tools,
}: {
  row: ServerRow;
  /** Where the connection stands, or nothing while it has not been read; the row offers nothing until it has. */
  status: IntegrationStatus | undefined;
  /** How a connected account's server answered when asked for its tools. */
  health: ConnectionHealth;
  statuses: IntegrationStatuses;
  tools: RowTools;
}): React.JSX.Element {
  const panelId = useId();
  const { act } = useAct();
  const { provider, connection, name, account } = row;
  const { cancelSignIn } = statuses;
  const grant = useIntegrationGrant(statuses);
  const bySignIn = grantedBySignIn(provider);
  const github = useGitHubConnection();
  const signIn = statuses.signInOf(connection);
  const [connecting, setConnecting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [rejection, setRejection] = useState<string | undefined>(undefined);
  // Several accounts at a provider each name themselves; one alone is the provider, as ever.
  const several = row.accounts > 1 && account !== undefined;

  /** How a grant begun went, said under the row where it could not begin. */
  const began = (outcome: (typeof GRANT_OUTCOME)[keyof typeof GRANT_OUTCOME]) => {
    setConnecting(false);
    if (outcome === GRANT_OUTCOME.NOT_OPENED) setRejection(PAGE_LINE.NOT_OPENED);
    if (outcome === GRANT_OUTCOME.REFUSED) {
      setRejection(`Luke could not start connecting ${name}. Try again in a moment.`);
    }
  };

  const connect = useCallback(() => {
    setConnecting(true);
    setRejection(undefined);
    void grant.begin(connection).then(began);
  }, [grant, connection, name]);

  const addAccount = () => {
    setConnecting(true);
    setRejection(undefined);
    void grant.add(provider).then(began);
  };

  const cancel = useCallback(() => {
    setConnecting(true);
    setRejection(undefined);
    void cancelSignIn(connection).then((cancelled) => {
      setConnecting(false);
      if (!cancelled)
        setRejection(`Luke could not cancel connecting ${name}. Try again in a moment.`);
    });
  }, [cancelSignIn, connection, name]);

  /** A rename ended: a new label asked of the service, and the integrations read again so every surface draws it. */
  const renamed = ({ name: label }: NameEdit) => {
    setEditing(false);
    if (label === undefined || label === account?.label) return;
    setRejection(undefined);
    void act(ACT_KIND.INTEGRATIONS_RENAME, { provider, connection, label }).then(
      (answer) => {
        if ("failure" in answer)
          setRejection(`Luke could not rename ${name}. Try again in a moment.`);
        void statuses.read();
      },
      () => setRejection(`Luke could not rename ${name}. Try again in a moment.`),
    );
  };

  const connected = status === INTEGRATION_STATUS.CONNECTED;
  const disconnect = useConfirmDialog({ subject: connected, surfaceOpen: true }, () =>
    disconnectAccount(act, github, row, statuses),
  );

  const line = rowLine(provider, status, health, signIn);
  const broken = connected && health.kind === CONNECTION_HEALTH.BROKEN && health.reconnect;
  const waiting = !connected && signIn?.kind === SIGN_IN.WAITING;
  // A broken connection's Reconnect is the row's button, so its ⋯ keeps it
  // only while the connection stands quiet.
  const reconnect = {
    label: ROW_ACT.RECONNECT,
    icon: <RefreshCwIcon />,
    disabled: connecting,
    onSelect: connect,
  };
  const leave = {
    label: "Disconnect",
    icon: <TrashIcon />,
    danger: true,
    onSelect: disconnect.ask,
  };
  const naming = several
    ? [{ label: ROW_ACT.RENAME, icon: <PencilIcon />, onSelect: () => setEditing(true) }]
    : [];
  const adding =
    !bySignIn && statuses.canAdd(provider) && row.accounts < INTEGRATION_ACCOUNTS_MAX
      ? [
          {
            label: ROW_ACT.ADD_ACCOUNT,
            icon: <PlusIcon />,
            disabled: connecting,
            onSelect: addAccount,
          },
        ]
      : [];
  const actions = connected
    ? [
        [...naming, ...adding],
        [...(broken ? [] : [reconnect]), leave],
      ].filter((group) => group.length > 0)
    : [];
  return (
    <div className="integration-row">
      <MenuRow
        label={`${name} actions`}
        actions={actions}
        anchor={connection}
        {...(bySignIn ? { heading: PAGE_LINE.GITHUB_SIGN_IN } : undefined)}
        row={{
          leading: (
            <span className="settings-row-mark">
              <ProviderMark provider={provider} />
            </span>
          ),
          label:
            editing && account !== undefined ? (
              <TaskNameField
                name={integrationAccountLabel(account)}
                className="settings-input"
                label={`${name} account name`}
                maxLength={INTEGRATION_LABEL_MAX}
                onEnd={renamed}
              />
            ) : (
              <Highlighted text={name} tokens={tools.tokens} />
            ),
          description:
            connected && tools.all.length > 0 ? (
              <ToolsLine name={name} panelId={panelId} tools={tools} />
            ) : line === undefined ? null : (
              <RowLineText line={line} />
            ),
          error: rejection,
          control: waiting ? (
            <>
              <Button variant={BUTTON_VARIANT.QUIET} disabled={connecting} onClick={connect}>
                {SIGN_IN_ACTION.REOPEN}
              </Button>
              <Button variant={BUTTON_VARIANT.OUTLINE} disabled={connecting} onClick={cancel}>
                {SIGN_IN_ACTION.CANCEL}
              </Button>
            </>
          ) : status === undefined ||
            status === INTEGRATION_STATUS.UNAVAILABLE ||
            (connected && !broken) ? null : (
            <Button variant={BUTTON_VARIANT.OUTLINE} disabled={connecting} onClick={connect}>
              {grantLabel(status, signIn)}
            </Button>
          ),
        }}
      />
      {connected && tools.expanded && tools.shown.length > 0 ? (
        <RowToolsPanel id={panelId} name={name} tools={tools} />
      ) : null}
      <ConfirmDialog
        confirm={disconnect}
        question={{
          title: `Disconnect ${name}?`,
          ...(bySignIn
            ? { body: "Coding agents lose GitHub until you connect it again." }
            : several
              ? {
                  body: `Agents lose this account. Your other ${INTEGRATION_NAME[provider]} accounts stay connected.`,
                }
              : undefined),
          verb: "Disconnect",
          running: "Disconnecting…",
        }}
      />
    </div>
  );
}

/** One account the page draws, and the tools a search found among its server's. */
interface FoundRow {
  readonly row: ServerRow;
  readonly health: ConnectionHealth;
  readonly all: readonly IntegrationTool[];
  /** The tools the search found, else every one. */
  readonly shown: readonly IntegrationTool[];
  /** The search found some of its tools, so the row opens onto them by itself. */
  readonly toolsFound: boolean;
}

/**
 * A provider's row as a query finds it (`../integration-search.ts`), or
 * nothing where it finds neither the integration nor any of its tools:
 * opened onto the tools it found, else onto every one.
 */
function foundRow(
  row: ServerRow,
  health: ConnectionHealth,
  tokens: readonly string[],
): FoundRow | undefined {
  const all = health.kind === CONNECTION_HEALTH.WORKING ? health.tools : [];
  // An account's label finds its row too, so "personal" finds Notion · Personal.
  const labelled =
    row.accounts > 1 && tokens.every((token) => row.name.toLowerCase().includes(token));
  const match =
    matchIntegration(row.provider, all, tokens) ??
    (labelled ? { named: true, tools: [] } : undefined);
  if (match === undefined) return undefined;
  return {
    row,
    health,
    all,
    shown: shownTools(match, all),
    toolsFound: match.tools.length > 0,
  };
}

/** A set with `server` turned: taken out where it stood, put in where it did not. */
function turned(set: ReadonlySet<string>, server: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(server)) next.add(server);
  return next;
}

/**
 * Every offered provider's row, once where they stand has been read, so each
 * row is drawn whole at once, under the page's search; a read that failed
 * draws them all, offering nothing, and says so above them, with the way to
 * read again. A provider read as unavailable is not offered to the account
 * and has no row. Note that a row opened or closed while nothing is searched
 * keeps that through a search, and one turned during a search is turned
 * against how the search opened it, forgotten when the search changes.
 */
function IntegrationRows({ filter }: { filter: IntegrationsFilter }): React.JSX.Element {
  const statuses = useIntegrationStatuses();
  const reads = useIntegrationTools(
    namedServers({
      statusOf: statuses.statusOf,
      accountsOf: statuses.accountsOf,
      standing: (status) => status === INTEGRATION_STATUS.CONNECTED,
    }).map((server) => server.connection),
  );
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  const [turnedInSearch, setTurnedInSearch] = useState<{
    readonly query: string;
    readonly providers: ReadonlySet<string>;
  }>({ query: "", providers: new Set() });
  const { query } = filter;

  // A turn belongs to the search it was made in: a query that changes, even back to an earlier one, starts afresh.
  useEffect(() => {
    setTurnedInSearch({ query, providers: new Set() });
  }, [query]);

  const read = INTEGRATION_PROVIDER_LIST.some((provider) => statuses.statusOf(provider));
  if (!read && !statuses.readFailed) {
    return <SettingsLine kind={SETTINGS_LINE_KIND.LOADING}>Loading the integrations</SettingsLine>;
  }
  const healthOf = (server: string) =>
    connectionHealth(integrationConnectionOf(server)?.provider ?? GITHUB, reads[server]);
  // Note that the rows stand in the order of their names within each
  // section, so no provider is pinned above the rest by the order its value
  // set happens to list it in.
  const groups = serverGroups(
    serverRows({
      statusOf: statuses.statusOf,
      healthOf,
      signInOf: statuses.signInOf,
      accountsOf: statuses.accountsOf,
      readFailed: statuses.readFailed,
      disabled: [],
    }).toSorted((one, other) => one.name.localeCompare(other.name, "en")),
  );
  const tokens = searchTokens(query);
  const found = groups
    .map((group) => ({
      heading: group.heading,
      rows: group.rows.flatMap((row) => {
        const kept = foundRow(row, healthOf(row.connection), tokens);
        return kept === undefined ? [] : [kept];
      }),
    }))
    .filter((group) => group.rows.length > 0);
  // A turn made under an older query is forgotten with it.
  const turnedNow: ReadonlySet<string> =
    turnedInSearch.query === query ? turnedInSearch.providers : new Set();
  const expanded = (found: FoundRow) =>
    tokens.length === 0
      ? opened.has(found.row.connection)
      : found.toolsFound !== turnedNow.has(found.row.connection);
  const toggle = (server: string) =>
    tokens.length === 0
      ? setOpened((now) => turned(now, server))
      : setTurnedInSearch({ query, providers: turned(turnedNow, server) });
  return (
    <>
      {statuses.readFailed ? (
        <SettingsSection>
          <SettingsLine>
            <ErrorState onRetry={() => void statuses.read()}>{PAGE_LINE.READ_FAILED}</ErrorState>
          </SettingsLine>
        </SettingsSection>
      ) : null}
      {groups.length === 0 ? <PageNote>{PAGE_LINE.NONE_OFFERED}</PageNote> : null}
      {groups.length > 0 && found.length === 0 ? (
        <div role="status">
          <PageNote>{`No integrations or tools match “${query.trim()}”`}</PageNote>
        </div>
      ) : null}
      {found.map((group) => (
        <SettingsSection key={group.heading ?? "unread"} title={group.heading}>
          {group.rows.map((found) => (
            <IntegrationRow
              key={found.row.connection}
              row={found.row}
              status={statuses.statusOf(found.row.connection)}
              health={found.health}
              statuses={statuses}
              tools={{
                shown: found.shown,
                all: found.all,
                found: found.toolsFound,
                expanded: expanded(found),
                onToggle: () => toggle(found.row.connection),
                tokens,
              }}
            />
          ))}
        </SettingsSection>
      ))}
    </>
  );
}

/** A line the page says in its sections' place, in a description's muted words. */
function PageNote({ children }: { children: string }): React.JSX.Element {
  return (
    <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.SUBTLE}>
      {children}
    </Text>
  );
}

/** The page's rows under its own search, the query held here where Settings does not hand the page one. */
function SearchedRows({ filter }: { filter: IntegrationsFilter | undefined }): React.JSX.Element {
  const [query, setQuery] = useState("");
  const shown = filter ?? { query, onQueryChange: setQuery };
  return (
    <>
      <FilterField filter={shown} />
      <IntegrationRows filter={shown} />
    </>
  );
}

export function IntegrationsSection({
  signedIn,
  filter,
}: {
  signedIn: boolean;
  /** The page's search, where Settings holds its query. */
  filter?: IntegrationsFilter | undefined;
}): React.JSX.Element {
  return signedIn ? <SearchedRows filter={filter} /> : <PageNote>{PAGE_LINE.SIGNED_OUT}</PageNote>;
}
