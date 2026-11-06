import { type IntegrationTool, toolsCount } from "@repo/features/integration-health";
import { byName, toolBadge, toolSummary, toolTitle } from "@repo/features/integration-tool-model";
import { INTEGRATION_NAME, type IntegrationProvider } from "@repo/features/integration-wire";
import {
  HoverCard,
  HoverCardHead,
  HoverCardList,
  HoverCardNote,
  HoverCardRow,
  HoverCardRule,
  ProviderMark,
  Tooltip,
  VisuallyHidden,
} from "@repo/ui";
import {
  SERVER_HANDED,
  SERVER_ROW,
  type ServerHanded,
  type ServerRow,
  serverMentionNote,
} from "@repo/ui/agent-servers-model";
import { createContext, type ReactNode, useContext } from "react";
import { useIntegrationStatuses } from "../integration-statuses.js";
import { useServerRows } from "./agent-servers.js";

export interface MentionedServersPlace {
  readonly disabled: readonly string[];
  readonly steering?: ReadonlySet<string> | undefined;
  readonly handed?: ServerHanded | undefined;
}

const MentionedServersContext = createContext<MentionedServersPlace | undefined>(undefined);

export function MentionedServers({
  value,
  children,
}: {
  value: MentionedServersPlace;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <MentionedServersContext.Provider value={value}>{children}</MentionedServersContext.Provider>
  );
}

export function SentToAgent({
  id,
  arrived,
  children,
}: {
  id: string;
  arrived: boolean;
  children: ReactNode;
}): ReactNode {
  const place = useContext(MentionedServersContext);
  if (place === undefined) return children;
  const steered = arrived || place.steering?.has(id) === true;
  const handed = steered ? SERVER_HANDED.STEERS : SERVER_HANDED.OPENS;
  return <MentionedServers value={{ ...place, handed }}>{children}</MentionedServers>;
}

function unreadRow(provider: IntegrationProvider, connection: string): ServerRow {
  return {
    provider,
    connection,
    accounts: 0,
    name: INTEGRATION_NAME[provider],
    kind: SERVER_ROW.QUIET,
    on: true,
  };
}

function shownTools(row: ServerRow, tool: string | undefined): readonly IntegrationTool[] {
  const tools = row.tools ?? [];
  if (tool !== undefined) return tools.filter((each) => each.name === tool);
  return byName(tools);
}

const SERVER_SWITCHED = {
  ON: "On",
  OFF: "Off",
} as const;

function serverSub(row: ServerRow): React.JSX.Element | undefined {
  const parts = [
    row.tools === undefined ? undefined : toolsCount(row.tools.length),
    row.problem,
    row.note,
  ].filter((part) => part !== undefined);
  if (parts.length === 0) return undefined;
  return <span>{parts.join(" · ")}</span>;
}

function ToolLine({ tool }: { tool: IntegrationTool }): React.JSX.Element {
  const title = toolTitle(tool);
  const name = title === tool.name ? undefined : tool.name;
  const summary = tool.description === "" ? undefined : toolSummary(tool.description);
  const more = [name, summary].filter((part) => part !== undefined).join(". ");
  const row = (
    <HoverCardRow
      glyph={null}
      label={
        <>
          {title}
          {more === "" ? null : <VisuallyHidden>{`, ${more}`}</VisuallyHidden>}
        </>
      }
      end={toolBadge(tool.annotations)}
    />
  );
  if (more === "") return <li>{row}</li>;
  const card = (
    <HoverCard data-tool-card="">
      <HoverCardHead name={title} sub={name} />
      {summary === undefined ? null : <HoverCardNote>{summary}</HoverCardNote>}
    </HoverCard>
  );
  return (
    <li>
      <Tooltip label={title} card={card}>
        {row}
      </Tooltip>
    </li>
  );
}

export function ServerCard({
  provider,
  connection = provider,
  tool,
}: {
  provider: IntegrationProvider;
  connection?: string | undefined;
  tool?: string | undefined;
}): React.JSX.Element {
  const place = useContext(MentionedServersContext);
  const statuses = useIntegrationStatuses();
  const rows = useServerRows(statuses, place?.disabled ?? [], connection);
  const row =
    rows.find((each) => each.connection === connection) ?? unreadRow(provider, connection);
  const note = serverMentionNote(row, place === undefined ? undefined : { handed: place.handed });
  const tools = shownTools(row, tool);
  return (
    <HoverCard data-server-card="">
      <HoverCardHead
        glyph={<ProviderMark provider={row.provider} />}
        name={row.name}
        sub={serverSub(row)}
        corner={
          place !== undefined && row.kind === SERVER_ROW.SWITCH
            ? row.on
              ? SERVER_SWITCHED.ON
              : SERVER_SWITCHED.OFF
            : undefined
        }
      />
      {note === undefined ? null : <HoverCardNote>{note}</HoverCardNote>}
      {row.said === undefined ? null : <HoverCardNote>{row.said}</HoverCardNote>}
      {tools.length === 0 ? null : (
        <>
          <HoverCardRule />
          <HoverCardList label={`${row.name} tools`}>
            {tools.map((each) => (
              <ToolLine key={each.name} tool={each} />
            ))}
          </HoverCardList>
        </>
      )}
    </HoverCard>
  );
}
