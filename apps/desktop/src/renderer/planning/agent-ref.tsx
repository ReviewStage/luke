import type { CodingAgentSummary } from "@sidecar/hosted/coding-agent-wire";
import type { CatalogModel } from "@sidecar/hosted/models-wire";
import type { PlanAgentLine } from "@sidecar/hosted/plan-wire";
import type { HeldTranscripts } from "../desktop/strip-tabs";
import { Tooltip } from "../tooltip";
import {
  AgentTabCard,
  type CardReading,
  cardCorner,
  heldLatest,
  lastFinished,
} from "./agent-tab-card";
import { agentStateWords, agentStillWriting, agentTabLabel } from "./coding-agent-model";
import { agentTranscript } from "./transcript-copy";
import type { CodingAgentsControl } from "./use-coding-agents";

/**
 * agent-ref.tsx -- an agent named anywhere in the window: the card its tab hangs, read from what the place naming it knows, and its mark and name as the one button that hangs that card and opens its tab.
 *
 * An agent is named in many places beside its tab: the Inbox's thread, its
 * crumbs, and its list's rows, a call's row in a transcript, the plan's
 * summary. Each hangs the agent's tab's own card (`agent-tab-card.tsx`)
 * while the pointer rests on the name, and a press or Enter opens the
 * agent's tab, as a press on the tab itself would. The card is read from what the place holds of
 * the agent: its summary, where the plan's list holds it, an archived
 * agent's among them, which says it was archived and when; the line the
 * sidebar's list names it by, which says where it stands but holds no
 * transcript; or nothing, where the plan's list was read and holds no such
 * agent, when the card says so under the name it goes by. A press on an
 * agent whose tab is not drawn, archived or gone, opens its plan, as the
 * column does for any tab whose subject is missing (`use-main-tabs.ts`).
 * A name inside a row whose press does something of its own, an Inbox
 * row's mark, hangs the card alone and leaves the press to its row.
 */

/** What a card's corner says of an archived agent, whose tab is gone. */
const ARCHIVED_WORDS = "Archived";

/** What a card's corner says of an agent the plan's list, once read, does not hold. */
const UNLISTED_WORDS = "Not found";

/** The name an agent goes by where the window holds nothing of it. */
const UNLISTED_NAME = "Coding agent";

/** What a place that draws no agent's tab holds of their transcripts: nothing, so its cards preview no step. */
export const NOTHING_HELD: HeldTranscripts = { agents: new Map(), workers: new Map() };

/** An agent as a place names it: the name it goes by, what its card says, read as the card is hung, and its summary where the plan's list holds it. */
export interface AgentSubject {
  readonly name: string;
  readonly read: () => CardReading;
  readonly agent?: CodingAgentSummary | undefined;
}

/**
 * What an agent's card says, read from what its tab last held as the card
 * is hung (`heldLatest`): where it stands and when it last moved, its pair,
 * and its latest step; an archived agent's says it was archived, and when.
 * Its tab's card and every other place naming it say it, `chosen` telling
 * whether its tab is the one shown, whose transcript follows the run. Note
 * that an agent with no turn finished in what its tab holds last moved
 * when its newest run began, the latest moment its summary knows.
 */
export function agentCardReading(
  agent: CodingAgentSummary,
  label: string,
  held: HeldTranscripts,
  chosen: boolean,
): () => CardReading {
  return () => {
    const { archivedAt } = agent;
    const writing = archivedAt === undefined && agentStillWriting(agent.status);
    const now = { writing, runStartedAt: agent.runStartedAt };
    const messages = heldLatest(held.agents.get(agent.id), now, chosen);
    const movedAt = archivedAt ?? lastFinished(messages) ?? agent.runStartedAt ?? agent.createdAt;
    return {
      corner: cardCorner({
        writing,
        startedAt: agent.runStartedAt,
        movedAt,
        state: archivedAt === undefined ? agentStateWords(agent.status) : ARCHIVED_WORDS,
      }),
      choice: { model: agent.model, effort: agent.effort },
      transcript: messages && agentTranscript({ title: label, messages, brief: agent.brief }),
    };
  };
}

/** An agent as the sidebar's list names it: where it stands and since when, and its pair, with no step to preview. */
export function lineSubject(
  line: PlanAgentLine,
  models: readonly CatalogModel[] | undefined,
): AgentSubject {
  const writing = agentStillWriting(line.status);
  const reading: CardReading = {
    corner: cardCorner({
      writing,
      startedAt: writing ? line.at : undefined,
      movedAt: writing ? undefined : line.at,
      state: agentStateWords(line.status),
    }),
    choice: { model: line.model, effort: line.effort },
    transcript: undefined,
  };
  return { name: agentTabLabel(line, models), read: () => reading };
}

/**
 * An agent named by id on the plan whose agents `agents` reads, archived
 * or not, its card read from what its tab last held; where the list holds
 * no such agent, the name it goes by, and a card saying it is not found
 * once the list has been read, and nothing more before.
 */
export function agentSubject(
  agents: Pick<CodingAgentsControl, "agents" | "archived" | "models">,
  agentId: string,
  held: HeldTranscripts,
  chosen: boolean,
): AgentSubject {
  const agent =
    agents.agents?.find((each) => each.id === agentId) ??
    agents.archived?.find((each) => each.id === agentId);
  if (agent !== undefined) {
    const name = agentTabLabel(agent, agents.models);
    return { name, agent, read: agentCardReading(agent, name, held, chosen) };
  }
  const reading: CardReading = {
    corner: cardCorner({
      writing: false,
      startedAt: undefined,
      movedAt: undefined,
      state: agents.agents === undefined ? undefined : UNLISTED_WORDS,
    }),
    choice: undefined,
    transcript: undefined,
  };
  return { name: UNLISTED_NAME, read: () => reading };
}

/** The agent's tab's card, as a place naming the agent hangs it. */
export function AgentCard({
  subject,
  models,
}: {
  subject: AgentSubject;
  models: readonly CatalogModel[] | undefined;
}): React.JSX.Element {
  return <AgentTabCard name={subject.name} models={models ?? []} read={subject.read} />;
}

/**
 * An agent named in place: what it is drawn as, its mark or its name or
 * both, as one button that hangs its tab's card while the pointer rests on
 * it and opens its tab on a press. With no `onOpen` it stands inside a row
 * whose press is the row's own, and hangs the card alone.
 */
export function AgentRef({
  subject,
  models,
  onOpen,
  className,
  children,
}: {
  subject: AgentSubject;
  /** The catalog as last read, which names the agent's model on its card. */
  models: readonly CatalogModel[] | undefined;
  /** Opens the agent's tab; none inside a row whose own press does something else. */
  onOpen: (() => void) | undefined;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const classes = className === undefined ? "agent-ref" : `agent-ref ${className}`;
  return (
    <Tooltip label={subject.name} card={<AgentCard subject={subject} models={models} />}>
      {onOpen === undefined ? (
        <span className={classes} data-agent-ref="">
          {children}
        </span>
      ) : (
        <button type="button" className={classes} data-agent-ref="" onClick={onOpen}>
          {children}
        </button>
      )}
    </Tooltip>
  );
}
