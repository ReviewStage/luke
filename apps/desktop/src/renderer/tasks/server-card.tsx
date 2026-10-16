import type { IntegrationTool } from "@luke/features/integration-health";
import { byName } from "@luke/features/integration-tool-model";
import { INTEGRATION_NAME, type IntegrationProvider } from "@luke/features/integration-wire";
import { moreText } from "@luke/features/task-agents-model";
import { ProviderMark } from "@luke/ui";
import {
  SERVER_HANDED,
  SERVER_ROW,
  type ServerHanded,
  type ServerRow,
  serverMentionNote,
} from "@luke/ui/agent-servers-model";
import { createContext, type ReactNode, useContext } from "react";
import { CardNote, CardRule, HoverCard } from "../hover-card";
import { useIntegrationStatuses } from "../integration-statuses";
import { IntegrationToolList } from "../integration-tool-list";
import { Switch } from "../switch";
import { ServerRowWords, useServerRows } from "./agent-servers";

/**
 * server-card.tsx -- the card a mention of an MCP server or of one of its tools hangs: the server's row as the MCP popover draws it, what the mention does for the agent the words go to, and the server's tools.
 *
 * The card's head is the popover's own row for the server
 * (`agent-servers.tsx`): its mark, its name, how many tools it offers, and,
 * where the words are an agent's, that agent's switch for it, drawn as it
 * stands and pressed nowhere but the popover. A note under it says what
 * the mention does (`serverMentionNote`): an agent with the server on is
 * handed it anyway; one with it off is handed it by the developer's words
 * for one turn alone, the one they open, or, where they reached a turn
 * already under way, the next, and the switch stays off; a server not
 * connected is handed to no agent. Under a rule stand the server's tools
 * as the popover's page lists them, a few and a count of the rest, and a
 * tool's mention its one tool's line, of those the server answered with. Where the words are no agent's, as a
 * plan's or Luke's are, the row has no switch and the note says nothing of
 * one.
 *
 * Where the words stand is told by the place drawing them
 * (`MentionedServers`): the agent's tab names the servers it has off and
 * which of the developer's lines reached a turn under way, as each one's
 * row says (`arrivedIn`) or, for a line not yet read back, as the agent
 * stood when it went; and its composer says whether a send now opens a
 * turn or steers one. Everything else is read as the popover reads it,
 * where every connection stands and the one server's tools, while the card
 * hangs.
 */

/** The most tools a server's card lists before it counts the rest. */
const CARD_TOOLS = 5;

/** The agent words are written to, as a server's chip in them reads it. */
export interface MentionedServersPlace {
  /** The servers switched off for the agent, as its MCP button holds them. */
  readonly disabled: readonly string[];
  /** The developer's lines this window sent into a turn under way that the transcript has not read back yet. */
  readonly steering?: ReadonlySet<string> | undefined;
  /** How the words drawn here reach the agent; none where they are not the developer's words to it, as its own replies are. */
  readonly handed?: ServerHanded | undefined;
}

const MentionedServersContext = createContext<MentionedServersPlace | undefined>(undefined);

/** Hands every server's chip under it the agent its words are written to. */
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

/**
 * One of the developer's lines to the agent, as a server's chip in it reads
 * it: handed to the turn it opened, or to a turn under way, as its row says
 * it arrived or, not yet read back, as the place says it went; nothing
 * changes where no agent's place stands around it.
 */
export function SentToAgent({
  id,
  arrived,
  children,
}: {
  id: string;
  /** Whether its row says it arrived in a turn under way (`arrivedIn`). */
  arrived: boolean;
  children: ReactNode;
}): ReactNode {
  const place = useContext(MentionedServersContext);
  if (place === undefined) return children;
  const steered = arrived || place.steering?.has(id) === true;
  const handed = steered ? SERVER_HANDED.STEERS : SERVER_HANDED.OPENS;
  return <MentionedServers value={{ ...place, handed }}>{children}</MentionedServers>;
}

/** The row a server stands as before where it stands is read, or where the deployment does not offer it: its mark and name alone. */
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

/**
 * The tools the card lists, of those the server answered with: the one a
 * tool's mention names, else the first few. Note that a tool the server
 * does not list, or a server not read, lists nothing, because a name the
 * mention kept is no tool the server offers now.
 */
function shownTools(row: ServerRow, tool: string | undefined): readonly IntegrationTool[] {
  const tools = row.tools ?? [];
  if (tool !== undefined) return tools.filter((each) => each.name === tool);
  return byName(tools).slice(0, CARD_TOOLS);
}

/** The card a mention of a server, or of one of its tools, hangs. */
export function ServerCard({
  provider,
  connection = provider,
  tool,
}: {
  provider: IntegrationProvider;
  /** The account at the provider by its connection name, where it is not the provider's first. */
  connection?: string | undefined;
  /** The tool the mention names, where it names one. */
  tool?: string | undefined;
}): React.JSX.Element {
  const place = useContext(MentionedServersContext);
  const statuses = useIntegrationStatuses();
  const rows = useServerRows(statuses, place?.disabled ?? [], connection);
  const row =
    rows.find((each) => each.connection === connection) ?? unreadRow(provider, connection);
  const note = serverMentionNote(row, place === undefined ? undefined : { handed: place.handed });
  const tools = shownTools(row, tool);
  const more = tool === undefined ? moreText(row.tools?.length ?? 0, tools.length) : undefined;
  return (
    <HoverCard data-server-card="">
      <div className="task-card-line agent-servers-row">
        <span className="task-card-glyph">
          <ProviderMark provider={row.provider} />
        </span>
        <ServerRowWords row={row} />
        {place !== undefined && row.kind === SERVER_ROW.SWITCH ? (
          <span className="agent-servers-end">
            <Switch checked={row.on} />
          </span>
        ) : null}
      </div>
      {note === undefined ? null : <CardNote>{note}</CardNote>}
      {tools.length === 0 ? null : (
        <>
          <CardRule />
          <IntegrationToolList server={row.name} tools={tools} tokens={[]} current={undefined} />
          {more === undefined ? null : <CardNote>{more}</CardNote>}
        </>
      )}
    </HoverCard>
  );
}
