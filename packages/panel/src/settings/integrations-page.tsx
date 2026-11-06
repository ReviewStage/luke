import {
  CONNECTION_HEALTH,
  type ConnectionHealth,
  connectionHealth,
  type IntegrationTool,
} from "@repo/features/integration-health";
import {
  INTEGRATION_PROVIDER,
  INTEGRATION_PROVIDER_LIST,
  INTEGRATION_STATUS,
  integrationConnectionOf,
} from "@repo/features/integration-wire";
import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import { readingWords, SIGNED_OUT_WORDS } from "@repo/features/words";
import { APP_COMMAND, APP_SHORTCUTS } from "@repo/settings/shortcuts";
import {
  ANNOUNCE,
  commandKeyshortcuts,
  ErrorState,
  GAP,
  ListMotion,
  RevealArea,
  SETTINGS_ROW_MARK_WIDTH,
  SETTINGS_SKELETON_CONTROL,
  SearchField,
  SettingsLine,
  SettingsSection,
  type SettingsSectionSkeletonShape,
  SettingsSectionsSkeleton,
  Shortcut,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import {
  namedServers,
  type ServerRow,
  serverGroups,
  serverRows,
} from "@repo/ui/agent-servers-model";
import { matchIntegration, shownTools } from "@repo/ui/integration-search";
import { searchTokens } from "@repo/ui/search-tokens";
import { ReplayMask } from "@repo/ui/session-replay-marks";
import { useEffect, useRef, useState } from "react";
import { useAppCommand } from "../app-commands.js";
import { unreadShown } from "../failure-report.js";
import { IntegrationRow } from "../integration-row.js";
import { useIntegrationStatuses } from "../integration-statuses.js";
import { useIntegrationToolReads } from "../integration-tools.js";
import { focusSearchField } from "../search-field.js";
import { useAnnounceShown } from "../use-announce-shown.js";

/**
 * integrations-page.tsx -- Settings › Integrations: the services the account connects so our agents can use them.
 *
 * One row per account at a provider (two Notion workspaces are two rows,
 * "Notion · Acme" and "Notion · Personal", each its own grant, and an
 * account alone is named the same way where it carries a name, such as a
 * Google account's email: "Gmail · dean@example.com"), and one for
 * a provider where the account holds none, under Connected or Not connected as the MCP popover
 * sections its servers (`@repo/ui/agent-servers-model`), each section
 * in the order of the providers' names: its mark and name, and under it where its connection
 * stands once that needs saying — connected with the count of its server's
 * tools, a sign-in under way, or one expired. A sign-in begun waits on the
 * browser with Reopen and Cancel, and one that failed or never finished
 * says so with Try again (`integration-sign-in.ts`). A row that connects or
 * disconnects glides from one section into the other (`ListMotion`), and
 * holds still under reduced motion. A connection is said to be
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
 * The search is `@repo/ui`'s `SearchField`, each section its
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
  SIGNED_OUT: SIGNED_OUT_WORDS,
  READ_FAILED: "Your integrations could not be read.",
  NONE_OFFERED: "No integrations available",
} as const;

/** How many of the offered providers' rows stand as connected while the statuses are read; the rest stand as not. */
const CONNECTED_SKELETON_ROWS = 2;

/**
 * The sections that stand while the statuses are read, a row to each offered
 * provider: a few connected, each ending in its ⋯ under its line, and the
 * rest not, each in its Connect under the line saying what it gives agents,
 * every one led by its mark, so the rows land in the height they
 * stood in.
 */
const INTEGRATIONS_SKELETON: readonly SettingsSectionSkeletonShape[] = [
  {
    headed: true,
    rows: INTEGRATION_PROVIDER_LIST.slice(0, CONNECTED_SKELETON_ROWS).map(() => ({
      described: true,
      mark: SETTINGS_ROW_MARK_WIDTH,
      controls: [SETTINGS_SKELETON_CONTROL.MORE],
    })),
  },
  {
    headed: true,
    rows: INTEGRATION_PROVIDER_LIST.slice(CONNECTED_SKELETON_ROWS).map(() => ({
      described: true,
      mark: SETTINGS_ROW_MARK_WIDTH,
      controls: [SETTINGS_SKELETON_CONTROL.BUTTON],
    })),
  },
];

/** The provider a server name that parses as none would be drawn as; never reached, since every row's name is minted from a provider. */
const GITHUB = INTEGRATION_PROVIDER.GITHUB;

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
  const labeled =
    row.account !== undefined && tokens.every((token) => row.name.toLowerCase().includes(token));
  const match =
    matchIntegration(row.provider, all, tokens) ??
    (labeled ? { named: true, tools: [] } : undefined);
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

/** What stands where the search finds nothing, said politely as it lands and as the query changes. */
function NoMatchNote({ query }: { query: string }): React.JSX.Element {
  const words = `No integrations or tools match “${query.trim()}”`;
  useAnnounceShown(ANNOUNCE.POLITE, words);
  // Note that the note quotes the query, so it stays masked in a screen recording.
  return (
    <ReplayMask>
      <PageNote>{words}</PageNote>
    </ReplayMask>
  );
}

/** The rows each section stands, by its heading, as the connections the rows are followed by. */
type SectionPlaces = readonly (readonly [string | undefined, readonly string[]])[];

/** Whether two placings stand the same rows in the same sections, in the same order. */
function samePlaces(one: SectionPlaces, other: SectionPlaces): boolean {
  return (
    one.length === other.length &&
    one.every(([heading, rows], at) => {
      const [otherHeading, otherRows] = other[at] ?? [];
      return (
        heading === otherHeading &&
        rows.length === otherRows?.length &&
        rows.every((row, place) => row === otherRows[place])
      );
    })
  );
}

/**
 * The page's sections, which move (`ListMotion`): a row that connects or
 * disconnects glides from the section it stood in to the other, followed
 * by its connection, and the sections and rows it moved glide with it.
 * Note that only a change in where the rows stand plays here, because a row
 * opening onto its tools is the row's own `Reveal`, whose area this is
 * (`own`, since the page's outer area would leave the rows between it and
 * the tools to this root), so the rows under it glide down with its edge.
 */
function MovingSections({
  found,
  children,
}: {
  found: readonly { readonly heading: string | undefined; readonly rows: readonly FoundRow[] }[];
  children: React.ReactNode;
}): React.JSX.Element {
  const moving = useRef<HTMLElement | null>(null);
  const places: SectionPlaces = found.map((group) => [
    group.heading,
    group.rows.map((each) => each.row.connection),
  ]);
  const [placed, setPlaced] = useState(() => ({ places, change: {} }));
  // Note that the placing follows the rows as they render, React's way of keeping what an earlier render drew, so the commit that moves a row is the one that plays.
  let { change } = placed;
  if (!samePlaces(placed.places, places)) {
    change = {};
    setPlaced({ places, change });
  }
  return (
    <ListMotion root={moving} change={change}>
      <RevealArea root={moving} own>
        <Stack gap={GAP.PAGE} moves ref={moving}>
          {children}
        </Stack>
      </RevealArea>
    </ListMotion>
  );
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
  const { reads, retry } = useIntegrationToolReads(
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
    return (
      <SettingsSectionsSkeleton
        label={readingWords("the integrations")}
        sections={INTEGRATIONS_SKELETON}
      />
    );
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
    <MovingSections found={found}>
      {statuses.readFailed ? (
        <SettingsSection>
          <SettingsLine>
            <ErrorState
              failure={unreadShown(FAILURE_SURFACE.INTEGRATIONS_READ)}
              onRetry={() => void statuses.read()}
            >
              {PAGE_LINE.READ_FAILED}
            </ErrorState>
          </SettingsLine>
        </SettingsSection>
      ) : null}
      {groups.length === 0 ? <PageNote>{PAGE_LINE.NONE_OFFERED}</PageNote> : null}
      {groups.length > 0 && found.length === 0 ? <NoMatchNote query={query} /> : null}
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
              onRetryTools={() => retry(found.row.connection)}
            />
          ))}
        </SettingsSection>
      ))}
    </MovingSections>
  );
}

/** A line the page says in its sections' place, in a description's muted words. */
function PageNote({ children }: { children: string }): React.JSX.Element {
  return (
    <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
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
