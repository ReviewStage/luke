import type { AgentStatus, AgentSummary, TasklessAgent } from "@repo/features/agent-wire";
import { LINK_PLACE } from "@repo/features/link-grammar";
import type { CatalogModel } from "@repo/features/models-wire";
import type { TaskAgentLine } from "@repo/features/task-wire";
import {
  HoverCard,
  HoverCardHead,
  HoverCardSkeleton,
  INLINE_REF_LOOK,
  InlineRef,
  Tooltip,
} from "@repo/ui";
import { ACTOR_KIND, ACTOR_STATE, type Actor } from "@repo/ui/actor-model";
import { TAB_WORDS } from "@repo/ui/tab-strip-model";
import { ACTOR_SIZE, ActorMark, ActorRef } from "../actor-ref.js";
import type { HeldTranscripts } from "../desktop/strip-tabs.js";
import {
  agentActor,
  agentName,
  agentStateWords,
  agentStillWriting,
  archivedByReading,
  providerOf,
  teammateRef,
} from "./agent-model.js";
import {
  AgentTabCard,
  type CardFoot,
  type CardReading,
  cardCorner,
  heldLatest,
  lastFinished,
} from "./agent-tab-card.js";
import { MentionedAgentCard } from "./mentioned-agent-card.js";
import { agentTranscript } from "./transcript-copy.js";
import type { AgentsControl } from "./use-agents.js";
import { useOpenPlace } from "./use-open-link.js";

const ARCHIVED_WORDS = "Archived";

const UNLISTED_WORDS = "Not found";

export const NOTHING_HELD: HeldTranscripts = { agents: new Map(), workers: new Map() };

export interface AgentSubject {
  readonly name: string;
  readonly tile: Actor;
  readonly read: () => CardReading;
  readonly agent?: AgentSummary | undefined;
}

export function agentCardReading(
  agent: AgentSummary,
  label: string,
  held: HeldTranscripts,
  chosen: boolean,
  agents: Pick<AgentsControl, "me" | "pullRequests">,
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
      transcript:
        messages &&
        agentTranscript({
          title: label,
          messages,
          brief: agent.brief,
        }),
      startedBy: teammateRef(agent.startedBy, agents.me),
      automationId: agent.automationId,
      startedAt: agent.createdAt,
      tile: agentActor(agent, label),
      pullRequest: agents.pullRequests.get(agent.id),
      archivedBy:
        archivedAt === undefined || agent.archivedBy === undefined
          ? undefined
          : archivedByReading(agent.archivedBy, agents.me),
    };
  };
}

export function lineSubject(
  line: TaskAgentLine,
  models: readonly CatalogModel[] | undefined,
  readerId: string | undefined,
): AgentSubject {
  const writing = agentStillWriting(line.status);
  const name = agentName(line, models);
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

export function tasklessRowSubject(
  agent: TasklessAgent,
  agents: Pick<AgentsControl, "models" | "me" | "pullRequests">,
): AgentSubject {
  const { automationId, pullRequest, ...rest } = agent;
  const summary: AgentSummary = automationId === null ? rest : { ...rest, automationId };
  const name = agentName(summary, agents.models);
  const tile = agentActor(summary, name);
  const base = agentCardReading(summary, name, NOTHING_HELD, false, agents);
  const { archivedAt } = agent;
  const writing = archivedAt === undefined && agentStillWriting(agent.status);
  const read = (): CardReading => {
    const reading = base();
    return {
      ...reading,
      corner: cardCorner({
        writing,
        startedAt: agent.runStartedAt,
        movedAt: archivedAt ?? agent.activityAt,
        state: archivedAt === undefined ? agentStateWords(agent.status) : ARCHIVED_WORDS,
      }),
      pullRequest: reading.pullRequest ?? pullRequest,
    };
  };
  return { name, tile, agent: summary, read };
}

export function tasklessSubject(
  line: {
    readonly agentTitle: string | null;
    readonly agentModel: string;
    readonly automationId: string | null;
    readonly automationName: string | null;
  },
  models: readonly CatalogModel[] | undefined,
): AgentSubject {
  const name = agentName(
    {
      title: line.agentTitle,
      model: line.agentModel,
      automationName: line.automationId === null ? null : line.automationName,
    },
    models,
  );
  const tile: Actor = {
    kind: ACTOR_KIND.AGENT,
    name,
    provider: providerOf(line.agentModel),
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

export interface AgentLine {
  readonly title: string | null;
  readonly model: string;
  readonly automationName?: string | undefined;
  readonly status?: AgentStatus | undefined;
}

export function agentSubject(
  agents: Pick<AgentsControl, "agents" | "archived" | "models" | "me" | "pullRequests">,
  agentId: string,
  held: HeldTranscripts,
  chosen: boolean,
  line?: AgentLine | undefined,
): AgentSubject {
  const agent =
    agents.agents?.find((each) => each.id === agentId) ??
    agents.archived?.find((each) => each.id === agentId);
  if (agent !== undefined) {
    const name = agentName(agent, agents.models);
    const tile = agentActor(agent, name);
    return { name, tile, agent, read: agentCardReading(agent, name, held, chosen, agents) };
  }
  const reading: CardReading = {
    corner: cardCorner({
      writing: false,
      startedAt: undefined,
      movedAt: undefined,
      state: agents.agents === undefined || line !== undefined ? undefined : UNLISTED_WORDS,
    }),
    choice: undefined,
    transcript: undefined,
  };
  const name = line === undefined ? TAB_WORDS.AGENT : agentName(line, agents.models);
  const tile: Actor =
    line === undefined
      ? { kind: ACTOR_KIND.AGENT, name, provider: undefined, state: ACTOR_STATE.REST }
      : agentActor(line, name);
  return { name, tile, read: () => reading };
}

export function AgentCard({
  subject,
  models,
  foot,
}: {
  subject: AgentSubject;
  models: readonly CatalogModel[] | undefined;
  foot?: CardFoot | undefined;
}): React.JSX.Element {
  return <AgentTabCard name={subject.name} models={models ?? []} read={subject.read} foot={foot} />;
}

export function AgentRef({
  subject,
  models,
  onOpen,
  glyph,
  label,
}: {
  subject: AgentSubject;
  models: readonly CatalogModel[] | undefined;
  onOpen: (() => void) | undefined;
  glyph: React.ReactNode;
  label: string;
}): React.JSX.Element {
  return (
    <InlineRef
      look={INLINE_REF_LOOK.LINK}
      glyph={glyph}
      label={label}
      onPress={onOpen === undefined ? undefined : () => onOpen()}
      hintLabel={subject.name}
      card={<AgentCard subject={subject} models={models} />}
      data-agent-ref=""
    />
  );
}

export function AgentMarkRef({
  subject,
  models,
}: {
  subject: AgentSubject;
  models: readonly CatalogModel[] | undefined;
}): React.JSX.Element {
  return (
    <Tooltip label={subject.name} card={<AgentCard subject={subject} models={models} />}>
      <span className="flex" data-agent-ref="">
        <ActorMark actor={subject.tile} />
      </span>
    </Tooltip>
  );
}

export function AgentActorRef({
  subject,
  models,
  onOpen,
  nameOnly = false,
}: {
  subject: AgentSubject;
  models: readonly CatalogModel[] | undefined;
  onOpen: (() => void) | undefined;
  nameOnly?: boolean;
}): React.JSX.Element {
  return (
    <ActorRef
      actor={subject.tile}
      card={<AgentCard subject={subject} models={models} />}
      onOpen={onOpen}
      nameOnly={nameOnly}
    />
  );
}

export function AgentHoverCard({
  actor,
  agentId,
}: {
  actor: Extract<Actor, { kind: typeof ACTOR_KIND.AGENT }>;
  agentId: string;
}): React.ReactNode {
  const mark = <ActorMark actor={actor} size={ACTOR_SIZE.CARD} />;
  const fallback = (
    <HoverCard data-agent-card="">
      <HoverCardHead mark={mark} name={actor.name} />
    </HoverCard>
  );
  return (
    <MentionedAgentCard
      agentId={agentId}
      reading={<HoverCardSkeleton mark={mark} name={actor.name} sub data-agent-card="" />}
      fallback={fallback}
    />
  );
}

export function SendingAgent({
  actor,
  agentId,
  nameOnly = false,
}: {
  actor: Extract<Actor, { kind: typeof ACTOR_KIND.AGENT }>;
  agentId: string;
  nameOnly?: boolean;
}): React.JSX.Element {
  const openPlace = useOpenPlace();
  const { taskId } = actor;
  const card = <AgentHoverCard actor={actor} agentId={agentId} />;
  const open =
    openPlace === undefined
      ? undefined
      : () =>
          openPlace({
            kind: LINK_PLACE.AGENT,
            ...(taskId === undefined ? undefined : { planId: taskId }),
            agentId,
          });
  return <ActorRef actor={actor} card={card} onOpen={open} nameOnly={nameOnly} />;
}
