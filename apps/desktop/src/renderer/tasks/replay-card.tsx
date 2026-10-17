import type { Replay, ReplayStep } from "@luke/features/agent-replay";
import type { CodingAgentPullRequestAnswerView } from "@luke/features/coding-agent-view";
import type { CodingAgentPullRequest, CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { LINK_PLACE } from "@luke/features/luke-link";
import { ACTOR_KIND, ACTOR_STATE, type Actor, actorName } from "@luke/ui/actor-model";
import { TAB_WORDS } from "@luke/ui/tab-strip-model";
import { MESSAGE_ROLE } from "@luke/wire";
import { SplitIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { ActorLine, ActorRef } from "../actor-ref";
import { Fold, FoldBody, FoldSummary } from "../ai-elements/fold";
import { Message } from "../ai-elements/message";
import { Plan, PlanContent, PlanHeader } from "../ai-elements/task";
import { usePerson } from "../member-directory";
import { linkChip } from "./mention-chip";
import { useMentionDoors } from "./plan-mentions";
import {
  AGENT_WORD,
  leftOutLine,
  replayCount,
  replayLede,
  replayVerb,
  STEP_WHO,
  stepWho,
} from "./replay-card-model";
import { TOOL_TARGET, type ToolTarget } from "./tool-call-model";
import type { CodingAgentsControl } from "./use-coding-agents";
import { useOpenPlace } from "./use-open-link";

/**
 * replay-card.tsx -- the card an agent started from another opens on after its brief: "Continued from" or "Forked from" the source agent, folded over the steps of the source's work it was handed.
 *
 * The card stands as the plan's card does, at a sent message's measure over
 * the line naming who started the agent. Its summary row names the source
 * by the chip its tab wears, which opens that tab and hangs its card, and
 * how many of the source's steps were replayed, of how many where the
 * earliest were left out. Opened, it says what it holds, how many steps
 * were left out where any were, one row per step, who and its one line,
 * each opening onto its words exactly as the agent was handed them, and a
 * foot naming the branch and the pull request the source published, where
 * known, and the way to the source's whole transcript: at the message it
 * was forked at, or its tab for a continuation, whose log keeps to its end.
 * The model is `replay-card-model.ts`.
 */

/** What the foot's way to the source's whole transcript says. */
const FULL_TRANSCRIPT_WORDS = "Open the full transcript";

/** What a step's line is named by where the source's starter is not known. */
const MEMBER_WORD = "Developer";

/**
 * Where an agent's replay card stands: the agents of its task, archived ones
 * among them, which its source is found among, and the doors to that source:
 * its chip's tile and card, its tab, a message of it, and what it published.
 */
export interface ReplayPlace {
  readonly agents: readonly CodingAgentSummary[];
  /** Who started the agent, named under the card. */
  readonly startedBy: CodingAgentSummary["startedBy"];
  /** The tile an agent's tab wears; none where the place does not list it. */
  readonly tile: (agentId: string) => Actor | undefined;
  /** The card an agent's tab hangs; none where the place hangs none. */
  readonly card: (agentId: string) => ReactNode;
  /** Opens an agent's tab; none where nothing opens one. */
  readonly onOpen: ((agentId: string) => void) | undefined;
  /** Each agent's pull request, of those that have one. */
  readonly pullRequests: ReadonlyMap<string, CodingAgentPullRequest>;
  /** Reads what an agent published, its branch among it; none where nothing reads it. */
  readonly readPublished:
    | ((agentId: string) => Promise<CodingAgentPullRequestAnswerView>)
    | undefined;
  readonly openGitHub: (url: string) => void;
}

/** No agents listed yet, one array so a render before the first read hands down the same one. */
const NO_AGENTS: readonly CodingAgentSummary[] = [];

/**
 * Where an agent's tab stands its replay card: the task's agents, archived
 * ones among them, and the doors its transcript's rows open an agent by,
 * the tile and card a call about an agent wears and the press that opens
 * its tab.
 */
export function replayPlace(input: {
  agent: CodingAgentSummary;
  control: Pick<CodingAgentsControl, "agents" | "archived" | "pullRequests" | "readPullRequest">;
  tile: ((agentId: string) => Actor | undefined) | undefined;
  target: ((target: ToolTarget) => ReactNode) | undefined;
  onOpenTarget: ((target: ToolTarget) => void) | undefined;
  openGitHub: (url: string) => void;
}): ReplayPlace {
  const { agent, control, tile, target, onOpenTarget, openGitHub } = input;
  const agents = [...(control.agents ?? NO_AGENTS), ...(control.archived ?? NO_AGENTS)];
  return {
    agents,
    startedBy: agent.startedBy,
    tile: (agentId) => tile?.(agentId),
    card: (agentId) => target?.({ kind: TOOL_TARGET.AGENT, agent: agentId }),
    onOpen:
      onOpenTarget === undefined
        ? undefined
        : (agentId) => onOpenTarget({ kind: TOOL_TARGET.AGENT, agent: agentId }),
    pullRequests: control.pullRequests,
    readPublished: control.readPullRequest,
    openGitHub,
  };
}

/** The branch and pull request an agent published, as one read answered them. */
interface Published {
  readonly branch: string | null;
  readonly pullRequest: CodingAgentPullRequest | null;
}

/** The source agent named on a card, as its chip wears it, when the place does not list it. */
function unlistedActor(): Actor {
  return {
    kind: ACTOR_KIND.AGENT,
    name: TAB_WORDS.CODING_AGENT,
    provider: undefined,
    state: ACTOR_STATE.REST,
  };
}

/** What the source published, read once as the card's body is drawn; nothing until it answers, or where it cannot be read. */
function usePublished(agentId: string, read: ReplayPlace["readPublished"]): Published | undefined {
  const [published, setPublished] = useState<Published | undefined>(undefined);
  useEffect(() => {
    if (read === undefined) return;
    let current = true;
    read(agentId)
      .then((answer) => {
        if (current && !("failure" in answer)) setPublished(answer);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [agentId, read]);
  return published;
}

/** One step: who and its one line, opening onto its words exactly as they were sent. */
function StepRow({ step, member }: { step: ReplayStep; member: string }): React.JSX.Element {
  const who = stepWho(step) === STEP_WHO.MEMBER ? member : AGENT_WORD;
  return (
    <Fold className="text-[12.5px]" data-replay-step={step.kind}>
      <FoldSummary className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
        <span className="w-[4.5rem] shrink-0 font-medium text-foreground">{who}</span>
        <span className="min-w-0 flex-1 truncate">{step.summary}</span>
      </FoldSummary>
      <FoldBody>
        <pre className="m-0 mb-1 ml-[5.25rem] whitespace-pre-wrap rounded-md bg-secondary px-2 py-1.5 font-mono text-[11.5px] text-foreground [overflow-wrap:anywhere]">
          {step.words}
        </pre>
      </FoldBody>
    </Fold>
  );
}

/** The foot: the branch and pull request the source published, where known, and the way to its whole transcript. */
function ReplayFoot({
  agentId,
  place,
  onOpenTranscript,
}: {
  agentId: string;
  place: ReplayPlace;
  onOpenTranscript: (() => void) | undefined;
}): React.JSX.Element {
  const published = usePublished(agentId, place.readPublished);
  const doors = useMentionDoors();
  const pullRequest = published?.pullRequest ?? place.pullRequests.get(agentId);
  const branch = published?.branch ?? undefined;
  const words =
    pullRequest === undefined || pullRequest === null
      ? undefined
      : `#${pullRequest.number} ${pullRequest.title}`;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 border-0 border-t border-dashed border-border pt-2 text-[12.5px] text-muted-foreground">
      {branch === undefined ? null : (
        <span className="min-w-0">
          Builds on <code>{branch}</code>
        </span>
      )}
      {pullRequest === undefined || pullRequest === null || words === undefined ? null : (
        <span className="agent-origin-chip">
          {linkChip(pullRequest.url, words, doors) ?? (
            <a
              className="text-link"
              href={pullRequest.url}
              onClick={(event) => {
                event.preventDefault();
                place.openGitHub(pullRequest.url);
              }}
            >
              {words}
            </a>
          )}
        </span>
      )}
      {onOpenTranscript === undefined ? null : (
        <button
          type="button"
          className="text-link ml-auto cursor-pointer border-0 bg-transparent p-0 text-[12.5px] text-foreground"
          data-replay-open=""
          onClick={onOpenTranscript}
        >
          {FULL_TRANSCRIPT_WORDS} ›
        </button>
      )}
    </div>
  );
}

/**
 * The card: the source's chip and how many steps on its summary row, and,
 * opened, the lede, the steps left out, a row per step, and the foot; the
 * line naming who started the agent under it.
 */
export function ReplayCard({
  replay,
  place,
  planId,
}: {
  replay: Replay;
  place: ReplayPlace;
  /** The task the agents are of, under which a message of the source is opened; none where they are of none. */
  planId: string | undefined;
}): React.JSX.Element {
  const { agentId, messageId } = replay;
  const source = place.agents.find((each) => each.id === agentId);
  const tile = place.tile(agentId) ?? unlistedActor();
  const name = actorName(tile);
  const sourceStarter = usePerson(source?.startedBy);
  const member = source?.startedBy === undefined ? MEMBER_WORD : actorName(sourceStarter);
  const starter = usePerson(place.startedBy);
  const openPlace = useOpenPlace();
  const open = place.onOpen;
  const openSource = open === undefined || source === undefined ? undefined : () => open(agentId);
  const onOpenTranscript =
    messageId !== undefined && openPlace !== undefined && source !== undefined
      ? () =>
          openPlace(
            planId === undefined
              ? { kind: LINK_PLACE.MESSAGE, agentId, messageId }
              : { kind: LINK_PLACE.MESSAGE, planId, agentId, messageId },
          )
      : openSource;
  const left = leftOutLine(replay);
  return (
    <Message from={MESSAGE_ROLE.USER} className="agent-origin">
      <Plan data-replay-card="" aria-label={replayVerb(replay)} className="agent-origin-card">
        <PlanHeader>
          <SplitIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="flex min-w-0 flex-1 items-center gap-1 truncate">
            <span className="text-muted-foreground">{replayVerb(replay)} </span>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: the wrapper only keeps the chip's own press from also folding the card; the chip is the control. */}
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: the chip inside is a button, which takes the keys itself. */}
            <span className="agent-origin-chip" onClick={(event) => event.stopPropagation()}>
              <ActorRef actor={tile} card={place.card(agentId)} onOpen={openSource} />
            </span>
            <span className="text-muted-foreground"> · {replayCount(replay)}</span>
          </span>
        </PlanHeader>
        <PlanContent className="flex flex-col gap-0.5">
          <p className="m-0 mb-1.5 text-[12px] text-muted-foreground">{replayLede(name)}</p>
          {left === undefined ? null : (
            <p className="m-0 mb-1 px-1 text-[12px] italic text-muted-foreground">{left}</p>
          )}
          {replay.steps.map((step, index) => (
            // Note that a step is keyed by its place, because the replay never changes once handed.
            <StepRow key={index} step={step} member={member} />
          ))}
          <ReplayFoot agentId={agentId} place={place} onOpenTranscript={onOpenTranscript} />
        </PlanContent>
      </Plan>
      {place.startedBy === undefined ? null : (
        <div className="message-meta">
          <span className="message-sender">
            <ActorLine>
              <ActorRef actor={starter} />
            </ActorLine>
          </span>
        </div>
      )}
    </Message>
  );
}
