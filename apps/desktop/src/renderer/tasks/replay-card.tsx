import type { Replay, ReplayStep } from "@luke/features/agent-replay";
import type { CodingAgentPullRequestAnswerView } from "@luke/features/coding-agent-view";
import type { CodingAgentPullRequest, CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { LINK_PLACE } from "@luke/features/luke-link";
import { ACTOR_KIND, ACTOR_STATE, type Actor, actorName } from "@luke/ui/actor-model";
import { TAB_WORDS } from "@luke/ui/tab-strip-model";
import { MESSAGE_ROLE } from "@luke/wire";
import { SplitIcon, TextQuoteIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { ActorLine, ActorRef } from "../actor-ref";
import { Fold, FoldBody, FoldChevron, FoldSummary } from "../ai-elements/fold";
import { Message, MessageContent } from "../ai-elements/message";
import { Plan, PlanContent, PlanHeader } from "../ai-elements/task";
import { TOOL_BLOCK } from "../ai-elements/tool";
import { useMemberDirectory, usePerson } from "../member-directory";
import { lineSender } from "./coding-agent-model";
import { linkChip } from "./mention-chip";
import { useMentionDoors } from "./plan-mentions";
import {
  leftOutLine,
  replayCount,
  replayLede,
  replayVerb,
  STEP_VIEW,
  type StepView,
  stepView,
  summaryLine,
} from "./replay-card-model";
import { TOOL_TARGET, type ToolTarget } from "./tool-call-model";
import { TranscriptTool, TranscriptWords } from "./transcript-blocks";
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

/** What a line the reader sent is named by. */
const OWN_WORD = "You";

/** What the foot's way to the source's whole transcript says. */
const FULL_TRANSCRIPT_WORDS = "Open the full transcript";

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
  /** Reads one agent by its id, as a page that lists only its own agent names the source; none where nothing reads one. */
  readonly readAgent: ((agentId: string) => Promise<CodingAgentSummary | undefined>) | undefined;
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
  control: Pick<
    CodingAgentsControl,
    "agents" | "archived" | "pullRequests" | "readPullRequest" | "readAgent"
  >;
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
    readAgent: control.readAgent,
    readPublished: control.readPullRequest,
    openGitHub,
  };
}

/** The branch and pull request an agent published, as one read answered them. */
interface Published {
  readonly branch: string | null;
  readonly pullRequest: CodingAgentPullRequest | null;
}

/** The source agent named on a card, as its chip wears it, when the place does not list it: by its title where a read found it. */
function unlistedActor(agentId: string, read: CodingAgentSummary | undefined): Actor {
  return {
    kind: ACTOR_KIND.AGENT,
    agentId,
    name: read?.title ?? TAB_WORDS.CODING_AGENT,
    provider: undefined,
    state: ACTOR_STATE.REST,
  };
}

/**
 * The source agent: as the place lists it, or, where it does not, as one
 * might be read on an agent's own page, which lists that agent alone, read
 * once; nothing until it answers, or where it cannot be read.
 */
function useSource(agentId: string, place: ReplayPlace): CodingAgentSummary | undefined {
  const listed = place.agents.find((each) => each.id === agentId);
  const [read, setRead] = useState<CodingAgentSummary | undefined>(undefined);
  const reader = place.readAgent;
  const unlisted = listed === undefined;
  useEffect(() => {
    if (!unlisted || reader === undefined) return;
    let current = true;
    reader(agentId)
      .then((answer) => {
        if (current) setRead(answer);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [agentId, reader, unlisted]);
  return listed ?? (read?.id === agentId ? read : undefined);
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

/**
 * Who sent a replayed line, as a transcript names a line's sender: a
 * member by their face and name, Luke, an automation, GitHub's login, or
 * another agent by their own marks, and the reader's own as "You"; by its
 * name alone where its step's marker named no sender.
 */
function LineSender({
  view,
}: {
  view: Extract<StepView, { kind: typeof STEP_VIEW.LINE }>;
}): React.JSX.Element {
  const { members, former, readerId } = useMemberDirectory();
  const actor =
    view.sentBy === undefined ? undefined : lineSender(view.sentBy, readerId, members, former);
  if (actor !== undefined) return <ActorRef actor={actor} />;
  // A member's line the reader sent is theirs, as the developer's own is; one the window cannot place keeps its name.
  const mine = readerId !== undefined && view.sentBy?.userId === readerId;
  return <>{view.own || mine ? OWN_WORD : view.sender}</>;
}

/**
 * One step, drawn as a transcript draws the same: a line as a sent
 * message, its sender under it; the agent's words as its words; and a
 * call as a call's row, folded onto its input and its result, which run
 * long.
 */
function StepRow({ step }: { step: ReplayStep }): React.JSX.Element {
  const view = stepView(step);
  switch (view.kind) {
    case STEP_VIEW.LINE:
      return (
        <Message from={MESSAGE_ROLE.USER} data-replay-step={step.kind}>
          <MessageContent>
            <TranscriptWords text={view.words} />
          </MessageContent>
          <div className="message-meta">
            <span className="message-sender">
              <LineSender view={view} />
            </span>
          </div>
        </Message>
      );
    case STEP_VIEW.SAID:
      return (
        <div data-replay-step={step.kind}>
          <TranscriptWords text={view.words} />
        </div>
      );
    case STEP_VIEW.CALL:
      return (
        <TranscriptTool
          data-replay-step={step.kind}
          state={view.state}
          kind={view.call}
          subject={view.subject}
          input={{ kind: TOOL_BLOCK.TEXT, text: view.input }}
          output={
            view.output === undefined ? undefined : { kind: TOOL_BLOCK.TEXT, text: view.output }
          }
          errorText={view.errorText}
        />
      );
  }
}

/**
 * The summary Luke wrote of the oldest steps the replay could not keep,
 * folded under one quiet line saying how many it stands for and whose
 * words they are, as a webhook's body folds inside a run's prompt; its
 * words drawn as a transcript's are, once opened.
 */
function SummaryRow({ line, text }: { line: string; text: string }): React.JSX.Element {
  return (
    <Fold className="text-[12.5px]" data-replay-summary="">
      <FoldSummary className="flex h-7 cursor-pointer items-center gap-2 rounded-md px-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
        <FoldChevron />
        <TextQuoteIcon className="size-4 shrink-0" aria-hidden="true" />
        {line}
      </FoldSummary>
      <FoldBody className="px-1 py-1">
        <TranscriptWords text={text} />
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-0 border-t border-dashed border-border pt-2 text-[12.5px] text-muted-foreground">
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
  const source = useSource(agentId, place);
  const listed = place.agents.some((each) => each.id === agentId);
  const tile = place.tile(agentId) ?? unlistedActor(agentId, source);
  const name = actorName(tile);
  const starter = usePerson(place.startedBy);
  const openPlace = useOpenPlace();
  const open = place.onOpen;
  // Note that a source the place does not list, as on an agent's own page, opens as a link to it would.
  const openSource =
    listed && open !== undefined
      ? () => open(agentId)
      : openPlace === undefined
        ? undefined
        : () =>
            openPlace(
              planId === undefined
                ? { kind: LINK_PLACE.AGENT, agentId }
                : { kind: LINK_PLACE.AGENT, planId, agentId },
            );
  const onOpenTranscript =
    messageId !== undefined && openPlace !== undefined
      ? () =>
          openPlace(
            planId === undefined
              ? { kind: LINK_PLACE.MESSAGE, agentId, messageId }
              : { kind: LINK_PLACE.MESSAGE, planId, agentId, messageId },
          )
      : openSource;
  const left = leftOutLine(replay);
  const summary = summaryLine(replay);
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
        <PlanContent className="flex flex-col gap-3">
          <p className="m-0 text-[12px] text-muted-foreground">{replayLede(name)}</p>
          {summary === undefined || replay.summary === undefined ? null : (
            <SummaryRow line={summary} text={replay.summary.text} />
          )}
          {left === undefined ? null : (
            <p className="m-0 text-[12px] italic text-muted-foreground">{left}</p>
          )}
          {replay.steps.map((step, index) => (
            // Note that a step is keyed by its place, because the replay never changes once handed.
            <StepRow key={index} step={step} />
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
