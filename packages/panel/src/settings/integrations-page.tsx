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

export interface IntegrationsFilter {
  readonly query: string;
  readonly onQueryChange: (query: string) => void;
}

const FILTER_INPUT_ID = "integrations-filter-input";

const FILTER_PLACEHOLDER = "Search integrations and tools";

const PAGE_LINE = {
  SIGNED_OUT: SIGNED_OUT_WORDS,
  READ_FAILED: "Your integrations could not be read.",
  NONE_OFFERED: "No integrations available",
} as const;

const CONNECTED_SKELETON_ROWS = 2;

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

const GITHUB = INTEGRATION_PROVIDER.GITHUB;

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

interface FoundRow {
  readonly row: ServerRow;
  readonly health: ConnectionHealth;
  readonly all: readonly IntegrationTool[];
  readonly shown: readonly IntegrationTool[];
  readonly toolsFound: boolean;
}

function foundRow(
  row: ServerRow,
  health: ConnectionHealth,
  tokens: readonly string[],
): FoundRow | undefined {
  const all = health.kind === CONNECTION_HEALTH.WORKING ? health.tools : [];
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

function turned(set: ReadonlySet<string>, server: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(server)) next.add(server);
  return next;
}

function NoMatchNote({ query }: { query: string }): React.JSX.Element {
  const words = `No integrations or tools match “${query.trim()}”`;
  useAnnounceShown(ANNOUNCE.POLITE, words);
  return (
    <ReplayMask>
      <PageNote>{words}</PageNote>
    </ReplayMask>
  );
}

type SectionPlaces = readonly (readonly [string | undefined, readonly string[]])[];

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

function PageNote({ children }: { children: string }): React.JSX.Element {
  return (
    <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
      {children}
    </Text>
  );
}

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
  filter?: IntegrationsFilter | undefined;
}): React.JSX.Element {
  return signedIn ? <SearchedRows filter={filter} /> : <PageNote>{PAGE_LINE.SIGNED_OUT}</PageNote>;
}
