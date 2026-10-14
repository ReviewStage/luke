import type { IntegrationStatusView } from "@sidecar/hosted/integration-view";
import {
  INTEGRATION_NAME,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  type IntegrationProvider,
  type IntegrationStatus,
} from "@sidecar/hosted/integration-wire";
import { ChevronRightIcon, TrashIcon } from "@sidecar/panel";
import { ACTION_RESULT_STATUS, type ActionResult } from "@sidecar/wire";
import { useCallback, useId, useState } from "react";
import { ACT_KIND } from "#shared/messages/acts";
import { useAct } from "../act";
import { GRANT_OUTCOME, grantedBySignIn, useIntegrationGrant } from "../integration-grant";
import {
  CONNECTION_HEALTH,
  type ConnectionHealth,
  connectionHealth,
  type IntegrationTool,
  toolsCount,
} from "../integration-health";
import { IntegrationMark } from "../integration-marks";
import { SIGN_IN, SIGN_IN_ACTION, type SignIn, signInLine } from "../integration-sign-in";
import { type IntegrationStatuses, useIntegrationStatuses } from "../integration-statuses";
import { IntegrationToolList } from "../integration-tool-list";
import { useIntegrationTools } from "../integration-tools";
import { CONNECT_GITHUB_LABEL } from "../planning/planning-model";
import { Highlighted } from "../search-field";
import { matchesTokens, searchTokens } from "../search-tokens";
import { type SearchFieldIdentity, SettingsSearchField } from "../settings-search";
import { SPINNER_SIZE, SpinnerRing } from "../spinner";
import { ConfirmDialog, useConfirmDialog } from "./confirm-dialog";
import { MenuRow } from "./menu-row";
import { ReadFailed, SettingsGroup } from "./settings-group";

/**
 * integrations-page.tsx -- Settings › Integrations: the services the account connects so Luke's agents can use them.
 *
 * One row per provider: its mark and name, and under it where its connection
 * stands once that needs saying — connected with the count of its server's
 * tools, a sign-in under way, or one expired. A sign-in begun waits on the
 * browser with Reopen and Cancel, and one that failed or never finished
 * says so with Try again (`integration-sign-in.ts`). A connection is said to be
 * connected only once its server answered with its tools; one whose server
 * answered why it would not says why instead, and offers Reconnect where
 * that mends it (`integration-health.ts`). A Connect sends the browser to
 * sign in with the provider; a connected row's ⋯ (or a right-click on it)
 * offers Disconnect, which asks first in the confirm dialog. GitHub is
 * granted by the account's own GitHub (`integration-grant.ts`), so its row
 * offers Connect GitHub, which opens Settings › Connected accounts, and no
 * Disconnect. The window never sees a sign-in address; the
 * host opens it. Where every
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
 * (`../integration-tool-list.tsx`): run by name prefix where the names
 * clearly share them, else alphabetical, each badged only by its server's
 * own annotations. A search field heads the page, which Command-F lands in
 * while the page is open: it keeps the rows whose name holds every word,
 * and the rows with a tool whose name or description does, those opened
 * onto just the tools it found with the words marked. The arrows move a
 * highlight through the rows kept, Return opens or closes the highlighted
 * one, and Escape clears the search, then lets go of the caret.
 */

/** The page's own search field, which Command-F lands in while the page is open. */
const INTEGRATIONS_SEARCH: SearchFieldIdentity = {
  id: "integrations-search-input",
  label: "Search integrations and tools",
  placeholder: "Search integrations and tools",
};

const PAGE_LINE = {
  CONNECTED: "Connected",
  CHECKING: "Checking…",
  SIGNED_OUT: "Sign in to connect integrations.",
  READ_FAILED: "Your integrations could not be read.",
  NONE_OFFERED: "No integrations are available for this account.",
  NOT_OPENED: "Luke could not open your browser to sign in.",
  NO_MATCH: "No integrations or tools match.",
} as const;

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

/** What a row's grant button says: Connect GitHub for GitHub, Try again after a sign-in that did not connect, else Connect or Reconnect. */
function grantLabel(
  bySignIn: boolean,
  status: IntegrationStatus | undefined,
  signIn: SignIn | undefined,
): string {
  if (bySignIn) return CONNECT_GITHUB_LABEL;
  if (status === INTEGRATION_STATUS.CONNECTED) return "Reconnect";
  if (signIn !== undefined) return SIGN_IN_ACTION.TRY_AGAIN;
  return status === INTEGRATION_STATUS.EXPIRED ? "Reconnect" : "Connect";
}

/** A row's line, with the ring before a wait's words. */
function RowLineText({ line }: { line: RowLine }): React.JSX.Element {
  return (
    <small className="settings-state" data-state={line.state}>
      {line.state === LINE_STATE.WAITING ? (
        <span className="spinner" data-size={SPINNER_SIZE.INLINE}>
          <SpinnerRing />
        </span>
      ) : null}
      {line.text}
    </small>
  );
}

/** How a row's tools are drawn: which of them, whether they show, and the search that chose them. */
interface RowTools {
  /** The tools the row opens onto: every one, or those the search found. */
  readonly shown: readonly IntegrationTool[];
  /** Every tool its server answered with; the row opens onto none when none. */
  readonly all: readonly IntegrationTool[];
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
    <small className="settings-state" data-state={LINE_STATE.CONNECTED}>
      {`${PAGE_LINE.CONNECTED} · `}
      <button
        type="button"
        className="integration-tools-toggle"
        aria-label={`${tools.expanded ? "Hide" : "Show"} ${name} tools`}
        aria-expanded={tools.expanded}
        aria-controls={tools.expanded ? panelId : undefined}
        onClick={tools.onToggle}
      >
        {toolsCount(tools.all.length)}
        <ChevronRightIcon />
      </button>
    </small>
  );
}

/** A row's tools, opened in place under it: a line saying how many a search kept, and the list. */
function RowToolsPanel({
  id,
  name,
  tools,
}: {
  id: string;
  name: string;
  tools: RowTools;
}): React.JSX.Element {
  return (
    <div id={id} className="integration-tools-panel">
      {tools.shown.length < tools.all.length ? (
        <p className="integration-tools-found">
          {`${tools.shown.length} of ${toolsCount(tools.all.length)} match`}
        </p>
      ) : null}
      <IntegrationToolList server={name} tools={tools.shown} tokens={tools.tokens} />
    </div>
  );
}

function IntegrationRow({
  provider,
  status,
  health,
  statuses,
  tools,
  highlighted,
}: {
  provider: IntegrationProvider;
  /** Where the connection stands, or nothing while it has not been read; the row offers nothing until it has. */
  status: IntegrationStatus | undefined;
  /** How a connected provider's server answered when asked for its tools. */
  health: ConnectionHealth;
  statuses: IntegrationStatuses;
  tools: RowTools;
  /** The row holds the page search's highlight. */
  highlighted: boolean;
}): React.JSX.Element {
  const panelId = useId();
  const { act } = useAct();
  const name = INTEGRATION_NAME[provider];
  const { settle, cancelSignIn } = statuses;
  const grant = useIntegrationGrant(statuses);
  const bySignIn = grantedBySignIn(provider);
  const signIn = statuses.signInOf(provider);
  const [connecting, setConnecting] = useState(false);
  const [rejection, setRejection] = useState<string | undefined>(undefined);

  const connect = useCallback(() => {
    setConnecting(true);
    setRejection(undefined);
    void grant.begin(provider).then((outcome) => {
      setConnecting(false);
      if (outcome === GRANT_OUTCOME.NOT_OPENED) setRejection(PAGE_LINE.NOT_OPENED);
      if (outcome === GRANT_OUTCOME.REFUSED) {
        setRejection(`Luke could not start connecting ${name}. Try again in a moment.`);
      }
    });
  }, [grant, provider, name]);

  const cancel = useCallback(() => {
    setConnecting(true);
    setRejection(undefined);
    void cancelSignIn(provider).then((cancelled) => {
      setConnecting(false);
      if (!cancelled)
        setRejection(`Luke could not cancel connecting ${name}. Try again in a moment.`);
    });
  }, [cancelSignIn, provider, name]);

  const connected = status === INTEGRATION_STATUS.CONNECTED;
  const disconnect = useConfirmDialog(
    { subject: connected, surfaceOpen: true },
    async (): Promise<ActionResult> => {
      const answer: IntegrationStatusView | undefined = await act(
        ACT_KIND.INTEGRATIONS_DISCONNECT,
        { provider },
      ).catch(() => undefined);
      if (answer === undefined || "failure" in answer) {
        return {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: `Luke could not disconnect ${name}. Try again in a moment.`,
        };
      }
      settle(provider, answer.status);
      return { status: ACTION_RESULT_STATUS.ACCEPTED };
    },
  );

  const line = rowLine(provider, status, health, signIn);
  const broken = connected && health.kind === CONNECTION_HEALTH.BROKEN && health.reconnect;
  const waiting = !connected && signIn?.kind === SIGN_IN.WAITING;
  // A grant that is the account's GitHub sign-in ends with that sign-in, never here.
  const actions =
    connected && !bySignIn
      ? [{ label: "Disconnect", icon: <TrashIcon />, danger: true, onSelect: disconnect.ask }]
      : [];
  return (
    <>
      <MenuRow
        label={`${name} actions`}
        actions={actions}
        anchor={provider}
        highlighted={highlighted}
      >
        <span className="settings-row-mark">
          <IntegrationMark provider={provider} />
        </span>
        <span className="settings-copy">
          <strong>
            <Highlighted text={name} tokens={tools.tokens} />
          </strong>
          {connected && tools.all.length > 0 ? (
            <ToolsLine name={name} panelId={panelId} tools={tools} />
          ) : line === undefined ? null : (
            <RowLineText line={line} />
          )}
        </span>
        {waiting ? (
          <>
            <button
              type="button"
              className="toolbar-button quiet-button"
              disabled={connecting}
              title={`Open the ${name} sign-in in your browser again`}
              onClick={connect}
            >
              {SIGN_IN_ACTION.REOPEN}
            </button>
            <button
              type="button"
              className="toolbar-button bordered-button"
              disabled={connecting}
              onClick={cancel}
            >
              {SIGN_IN_ACTION.CANCEL}
            </button>
          </>
        ) : status === undefined ||
          status === INTEGRATION_STATUS.UNAVAILABLE ||
          (connected && !broken) ? null : (
          <button
            type="button"
            className="toolbar-button bordered-button"
            disabled={connecting}
            title={
              bySignIn ? "Connect GitHub in your browser" : `Sign in to ${name} in your browser`
            }
            onClick={connect}
          >
            {grantLabel(bySignIn, status, signIn)}
          </button>
        )}
      </MenuRow>
      {connected && tools.expanded && tools.shown.length > 0 ? (
        <RowToolsPanel id={panelId} name={name} tools={tools} />
      ) : null}
      {rejection === undefined ? null : (
        <p className="error-message" role="alert">
          {rejection}
        </p>
      )}
      <ConfirmDialog
        confirm={disconnect}
        question={{
          title: `Disconnect ${name}?`,
          body: "What Luke already did there stays.",
          verb: "Disconnect",
          running: "Disconnecting…",
        }}
      />
    </>
  );
}

/** One provider the page draws, and the tools a search found among its server's. */
interface FoundRow {
  readonly provider: IntegrationProvider;
  readonly health: ConnectionHealth;
  readonly all: readonly IntegrationTool[];
  /** Every tool where nothing is searched or the name matched, else those the search found. */
  readonly shown: readonly IntegrationTool[];
  /** The search found some of its tools, so the row opens onto them by itself. */
  readonly toolsFound: boolean;
}

/**
 * The offered providers a search keeps, in the provider list's order: every
 * one where nothing is searched; else each whose name holds every word,
 * with all its tools, and each with a tool whose name or description does,
 * with just those.
 */
function foundRows(
  offered: readonly IntegrationProvider[],
  healthOf: (provider: IntegrationProvider) => ConnectionHealth,
  tokens: readonly string[],
): readonly FoundRow[] {
  return offered.flatMap((provider) => {
    const health = healthOf(provider);
    const all = health.kind === CONNECTION_HEALTH.WORKING ? health.tools : [];
    if (tokens.length === 0) return [{ provider, health, all, shown: all, toolsFound: false }];
    const hits = all.filter((tool) => matchesTokens([tool.name, tool.description], tokens));
    const named = matchesTokens([INTEGRATION_NAME[provider]], tokens);
    if (!named && hits.length === 0) return [];
    const toolsFound = hits.length > 0;
    return [{ provider, health, all, shown: toolsFound ? hits : all, toolsFound }];
  });
}

/** A set with `provider` turned: taken out where it stood, put in where it did not. */
function turned(
  set: ReadonlySet<IntegrationProvider>,
  provider: IntegrationProvider,
): ReadonlySet<IntegrationProvider> {
  const next = new Set(set);
  if (!next.delete(provider)) next.add(provider);
  return next;
}

/**
 * Every offered provider's row, once where they stand has been read, so each
 * row is drawn whole at once; a read that failed draws them all, offering
 * nothing, and says so above them, with the way to read again. A provider
 * read as unavailable is not offered to the account and has no row. Note
 * that a row opened or closed while nothing is searched keeps that through a
 * search, and one turned during a search is turned against how the search
 * opened it, forgotten when the search changes.
 */
function IntegrationRows(): React.JSX.Element {
  const statuses = useIntegrationStatuses();
  const reads = useIntegrationTools(
    INTEGRATION_PROVIDER_LIST.filter(
      (provider) => statuses.statusOf(provider) === INTEGRATION_STATUS.CONNECTED,
    ),
  );
  const [query, setQuery] = useState("");
  const [opened, setOpened] = useState<ReadonlySet<IntegrationProvider>>(new Set());
  const [turnedInSearch, setTurnedInSearch] = useState<ReadonlySet<IntegrationProvider>>(new Set());
  const [highlight, setHighlight] = useState<number | undefined>(undefined);
  const read = INTEGRATION_PROVIDER_LIST.some((provider) => statuses.statusOf(provider));
  if (!read && !statuses.readFailed) return <div className="settings-reading" aria-busy="true" />;
  const offered = INTEGRATION_PROVIDER_LIST.filter(
    (provider) => statuses.statusOf(provider) !== INTEGRATION_STATUS.UNAVAILABLE,
  );
  const tokens = searchTokens(query);
  const rows = foundRows(
    offered,
    (provider) => connectionHealth(provider, reads[provider]),
    tokens,
  );
  const at = highlight === undefined ? undefined : Math.min(highlight, rows.length - 1);
  const expanded = (row: FoundRow) =>
    tokens.length === 0
      ? opened.has(row.provider)
      : row.toolsFound !== turnedInSearch.has(row.provider);
  const toggle = (provider: IntegrationProvider) =>
    tokens.length === 0
      ? setOpened((now) => turned(now, provider))
      : setTurnedInSearch((now) => turned(now, provider));
  return (
    <>
      {statuses.readFailed ? (
        <SettingsGroup>
          <ReadFailed line={PAGE_LINE.READ_FAILED} onRetry={() => void statuses.read()} />
        </SettingsGroup>
      ) : null}
      {offered.length === 0 ? (
        <p className="settings-note">{PAGE_LINE.NONE_OFFERED}</p>
      ) : (
        <>
          <div className="integrations-search">
            <SettingsSearchField
              identity={INTEGRATIONS_SEARCH}
              query={query}
              onQueryChange={(next) => {
                setQuery(next);
                setTurnedInSearch(new Set());
                setHighlight(searchTokens(next).length === 0 ? undefined : 0);
              }}
              onMove={(step) =>
                setHighlight(Math.min(Math.max((at ?? -1) + step, 0), rows.length - 1))
              }
              onSubmit={() => {
                const row = rows[at ?? 0];
                if (row !== undefined && row.all.length > 0) toggle(row.provider);
              }}
            />
          </div>
          {rows.length === 0 ? (
            <p className="settings-note">{PAGE_LINE.NO_MATCH}</p>
          ) : (
            <SettingsGroup>
              {rows.map((row, index) => (
                <IntegrationRow
                  key={row.provider}
                  provider={row.provider}
                  status={statuses.statusOf(row.provider)}
                  health={row.health}
                  statuses={statuses}
                  highlighted={index === at}
                  tools={{
                    shown: row.shown,
                    all: row.all,
                    expanded: expanded(row),
                    onToggle: () => toggle(row.provider),
                    tokens,
                  }}
                />
              ))}
            </SettingsGroup>
          )}
        </>
      )}
    </>
  );
}

export function IntegrationsSection({ signedIn }: { signedIn: boolean }): React.JSX.Element {
  return signedIn ? <IntegrationRows /> : <p className="settings-note">{PAGE_LINE.SIGNED_OUT}</p>;
}
