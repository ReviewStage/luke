import type { CodingAgentSummary } from "@luke/features/coding-agent-wire";
import type { CatalogModel } from "@luke/features/models-wire";
import type { PlanAgentLine } from "@luke/features/plan-wire";
import { ACTOR_KIND, ACTOR_STATE, type Actor } from "@luke/ui/actor-model";
import { TAB_WORDS } from "@luke/ui/tab-strip-model";
import { ActorRef } from "../actor-ref";
import type { HeldTranscripts } from "../desktop/strip-tabs";
import { Tooltip } from "../tooltip";
import {
  AgentTabCard,
  type CardReading,
  cardCorner,
  heldLatest,
  lastFinished,
} from "./agent-tab-card";
import {
  agentActor,
  agentStateWords,
  agentStillWriting,
  agentTabLabel,
  providerOf,
  teammateRef,
} from "./coding-agent-model";
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

/** What a place that draws no agent's tab holds of their transcripts: nothing, so its cards preview no step. */
export const NOTHING_HELD: HeldTranscripts = { agents: new Map(), workers: new Map() };

/** An agent as a place names it: the name it goes by, its tile, what its card says, read as the card is hung, and its summary where the plan's list holds it. */
export interface AgentSubject {
  readonly name: string;
  /** The agent's tile, as every place naming an actor draws it (`actor-ref.tsx`). */
  readonly tile: Actor;
  readonly read: () => CardReading;
  readonly agent?: CodingAgentSummary | undefined;
}

/**
 * What an agent's card says, read from what its tab last held as the card
 * is hung (`heldLatest`): where it stands and when it last moved, its pair,
 * and its latest step; an archived agent's says it was archived, and when.
 * It wears the agent's tile, names the automation whose run started it, or
 * a teammate who did, as the reader `agents.me` tells them apart, and leads its corner with the pull
 * request the plan holds for it. Its tab's card and every other place naming it say it, `chosen` telling
 * whether its tab is the one shown, whose transcript follows the run. Note
 * that an agent with no turn finished in what its tab holds last moved
 * when its newest run began, the latest moment its summary knows.
 */
export function agentCardReading(
  agent: CodingAgentSummary,
  label: string,
  held: HeldTranscripts,
  chosen: boolean,
  agents: Pick<CodingAgentsControl, "me" | "pullRequests">,
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
      startedBy: teammateRef(agent.startedBy, agents.me),
      automationId: agent.automationId,
      tile: agentActor(agent, label),
      pullRequest: agents.pullRequests.get(agent.id),
    };
  };
}

/** An agent as the sidebar's list names it: its tile, where it stands and since when, its pair, and the automation or teammate who started it, as `readerId` reads it, with no step or pull request to preview. */
export function lineSubject(
  line: PlanAgentLine,
  models: readonly CatalogModel[] | undefined,
  readerId: string | undefined,
): AgentSubject {
  const writing = agentStillWriting(line.status);
  const name = agentTabLabel(line, models);
  const reading: CardReading = {
    corner: cardCorner({
      writing,
      startedAt: writing ? line.at : undefined,
      movedAt: writing ? undefined : line.at,
      state: agentStateWords(line.status),
    }),
    choice: { model: line.model, effort: line.effort },
    transcript: undefined,
    startedBy: teammateRef(line.startedBy, readerId),
    automationId: line.automationId,
    tile: agentActor(line, name),
  };
  return { name, tile: agentActor(line, name), read: () => reading };
}

/**
 * An agent with no plan as main's read of what waits on the developer names
 * it: its title, else its automation's name, else its model, its harness's tile at rest, and the
 * automation whose run started it. Note that the line says nothing of
 * where the agent stands, so its card's corner says nothing either.
 */
export function planlessSubject(
  line: {
    readonly title: string | null;
    readonly model: string;
    readonly automationId: string | null;
    /** The name of the automation whose run started it, which an untitled agent goes by; none where the line names none. */
    readonly automationName?: string | undefined;
  },
  models: readonly CatalogModel[] | undefined,
): AgentSubject {
  const name = agentTabLabel(
    { title: line.title, model: line.model, automationName: line.automationName },
    models,
  );
  const tile: Actor = {
    kind: ACTOR_KIND.AGENT,
    name,
    provider: providerOf(line.model),
    state: ACTOR_STATE.REST,
  };
  const reading: CardReading = {
    corner: cardCorner({
      writing: false,
      startedAt: undefined,
      movedAt: undefined,
      state: undefined,
    }),
    choice: undefined,
    transcript: undefined,
    automationId: line.automationId ?? undefined,
    tile,
  };
  return { name, tile, read: () => reading };
}

/**
 * An agent named by id on the plan whose agents `agents` reads, archived
 * or not, its card read from what its tab last held; where the list holds
 * no such agent, the name it goes by, and a card saying it is not found
 * once the list has been read, and nothing more before.
 */
export function agentSubject(
  agents: Pick<CodingAgentsControl, "agents" | "archived" | "models" | "me" | "pullRequests">,
  agentId: string,
  held: HeldTranscripts,
  chosen: boolean,
): AgentSubject {
  const agent =
    agents.agents?.find((each) => each.id === agentId) ??
    agents.archived?.find((each) => each.id === agentId);
  if (agent !== undefined) {
    const name = agentTabLabel(agent, agents.models);
    const tile = agentActor(agent, name);
    return { name, tile, agent, read: agentCardReading(agent, name, held, chosen, agents) };
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
  const name = TAB_WORDS.CODING_AGENT;
  const tile: Actor = {
    kind: ACTOR_KIND.AGENT,
    name,
    provider: undefined,
    state: ACTOR_STATE.REST,
  };
  return { name, tile, read: () => reading };
}

/** The agent's tab's card, as a place naming the agent hangs it: what it says, with no way to the tab, since the name it hangs from is that way. */
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

/**
 * An agent named in a line as every actor is: its tile and its name as one
 * button (`ActorRef`), hanging its tab's card and opening its tab on a
 * press.
 */
export function AgentActorRef({
  subject,
  models,
  onOpen,
}: {
  subject: AgentSubject;
  /** The catalog as last read, which names the agent's model on its card. */
  models: readonly CatalogModel[] | undefined;
  onOpen: () => void;
}): React.JSX.Element {
  return (
    <ActorRef
      actor={subject.tile}
      card={<AgentCard subject={subject} models={models} />}
      onOpen={onOpen}
    />
  );
}
