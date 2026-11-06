import { INTEGRATION_NAME, type IntegrationProvider } from "@repo/features/integration-wire";
import { HoverCard, HoverCardHead, HoverCardNote, ProviderMark } from "@repo/ui";
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

/**
 * server-card.tsx -- the card a mention of an MCP server or of one of its tools hangs: the server as the MCP popover reads it, and what the mention does for the agent the words go to.
 *
 * The card's head is the server as the popover's row reads it
 * (`agent-servers.tsx`): its mark, its name, and under it where its sign-in
 * or its server stands, the server's own words behind a problem in a note
 * of their own; where the words are an agent's, its corner says whether
 * that agent has it on or off, a word rather than the popover's switch,
 * which only the popover presses. A note under it says what the mention
 * does where the corner cannot (`serverMentionNote`): an agent with it off
 * is handed it by the developer's words for one turn alone, the one they
 * open, or, where they reached a turn already under way, the next, and the
 * switch stays off; a server not connected is handed to no agent. Where the
 * words are no agent's, as a description's or the app's are, the corner is
 * empty and the note says nothing of a switch.
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

/** On or off for the agent, as the card's corner says where the words are an agent's. */
const SERVER_SWITCHED = {
  ON: "On",
  OFF: "Off",
} as const;

/** What the head says under the server's name: why its server lists no tools, or where its sign-in stands. */
function serverSub(row: ServerRow): React.JSX.Element | undefined {
  const parts = [row.problem, row.note].filter((part) => part !== undefined);
  if (parts.length === 0) return undefined;
  return <span>{parts.join(" · ")}</span>;
}

/** The card a mention of a server, or of one of its tools, hangs. */
export function ServerCard({
  provider,
  connection = provider,
}: {
  provider: IntegrationProvider;
  /** The account at the provider by its connection name, where it is not the provider's first. */
  connection?: string | undefined;
}): React.JSX.Element {
  const place = useContext(MentionedServersContext);
  const statuses = useIntegrationStatuses();
  const rows = useServerRows(statuses, place?.disabled ?? [], connection);
  const row =
    rows.find((each) => each.connection === connection) ?? unreadRow(provider, connection);
  const note = serverMentionNote(row, place === undefined ? undefined : { handed: place.handed });
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
    </HoverCard>
  );
}
