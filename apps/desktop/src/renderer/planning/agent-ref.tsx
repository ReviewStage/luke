import type { CodingAgentSummary } from "@sidecar/hosted/coding-agent-wire";
import type { CatalogModel } from "@sidecar/hosted/models-wire";
import type { HeldTranscripts } from "../desktop/strip-tabs";
import {
  AgentTabCard,
  type CardReading,
  cardCorner,
  heldLatest,
  lastFinished,
} from "./agent-tab-card";
import { agentStateWords, agentStillWriting, agentTabLabel } from "./coding-agent-model";
import { TAB_WORDS } from "./tab-strip-model";
import { agentTranscript } from "./transcript-copy";
import type { CodingAgentsControl } from "./use-coding-agents";

/**
 * agent-ref.tsx -- an agent named anywhere in the window: the card its tab hangs, read from what the place naming it knows.
 *
 * An agent is named in many places beside its tab: a call's row in a
 * transcript, the plan's summary, the side panel's "+", ⌘K, and the
 * archived agents' fold. Each hangs the agent's tab's own card
 * (`agent-tab-card.tsx`) while the pointer rests on the name. The card is
 * read from what the place holds of the agent: its summary, where the
 * plan's list holds it, an archived agent's among them, which says it was
 * archived and when; or nothing, where the plan's list was read and holds
 * no such agent, when the card says so under the name it goes by.
 */

/** What a card's corner says of an archived agent, whose tab is gone. */
const ARCHIVED_WORDS = "Archived";

/** What a card's corner says of an agent the plan's list, once read, does not hold. */
const UNLISTED_WORDS = "Not found";

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
  return { name: TAB_WORDS.CODING_AGENT, read: () => reading };
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
