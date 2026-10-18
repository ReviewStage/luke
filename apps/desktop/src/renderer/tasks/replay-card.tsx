import type { Replay, ReplayStep } from "@luke/features/agent-replay";
import type { CodingAgentPullRequestAnswerView } from "@luke/features/coding-agent-view";
import type { CodingAgentPullRequest, CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { CODING_AGENT_SENDER } from "@luke/features/coding-agent-wire";
import { LINK_PLACE } from "@luke/features/luke-link";
import {
  BUTTON_VARIANT,
  Button,
  DISCLOSURE_BODY,
  Disclosure,
  DisclosureBody,
  DisclosureSummary,
  Inline,
  TEXT_BUTTON_TONE,
  TEXT_ELEMENT,
  TEXT_LINK_LOOK,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextButton,
  TextLink,
} from "@luke/ui";
import { ACTOR_KIND, ACTOR_STATE, type Actor, actorName } from "@luke/ui/actor-model";
import { TAB_WORDS } from "@luke/ui/tab-strip-model";
import { MESSAGE_ROLE } from "@luke/wire";
import { ChevronsUpIcon, SplitIcon, TextQuoteIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { ActorRef } from "../actor-ref";
import { Message, MessageContent } from "../ai-elements/message";
import { PLAN_BODY_LAYOUT, Plan, PlanContent, PlanHeader, PlanIcon } from "../ai-elements/plan";
import { TOOL_BLOCK } from "../ai-elements/tool";
import { useFindOpen } from "../find-in-tab";
import { useMemberDirectory } from "../member-directory";
import { lineSender, providerOf } from "./coding-agent-model";
import { linkChip } from "./mention-chip";
import {
  earlierStepsLine,
  leftOutLine,
  REPLAY_PAGE,
  replayCount,
  replayLede,
  replayPage,
  replayVerb,
  STEP_VIEW,
  type StepView,
  stepView,
  summaryLine,
} from "./replay-card-model";
import { SentTime } from "./sent-time";
import { useMentionDoors } from "./task-mentions";
import { TOOL_TARGET, type ToolTarget } from "./tool-call-model";
import { TranscriptTool, TranscriptWords } from "./transcript-blocks";
import type { CodingAgentsControl } from "./use-coding-agents";
import { useOpenPlace } from "./use-open-link";

/**
 * replay-card.tsx -- the card an agent started from another opens on after its brief: "Continued from" or "Forked from" the source agent, folded over the steps of the source's work it was handed.
 *
 * The card stands as the plan's card does, at a sent message's measure over
 * the line naming who started the agent and when, as any line sent to the
 * agent is named: a teammate by their face and name, the reader's own by
 * the time alone. Its summary row names the source by the chip its tab
 * wears, which opens that tab and hangs its card, and how many of the
 * source's steps were replayed, of how many where the earliest were left
 * out. Opened, it says what it holds, Luke's summary of the oldest steps
 * and how many steps were left out where either applies, then the newest
 * steps, one row each, each opening onto its words exactly as the agent was
 * handed them, under a row that draws the earlier ones a page at a time,
 * and a foot naming the branch and the pull request the source published,
 * where known, and the way to the source's whole transcript: at the message
 * it was forked at, or its tab for a continuation, whose log keeps to its
 * end. The model is `replay-card-model.ts`.
 */

/** What the foot's way to the source's whole transcript says. */
const FULL_TRANSCRIPT_WORDS = "Open the full transcript";

/**
 * Where an agent's replay card stands: the agents of its task, archived ones
 * among them, which its source is found among, and the doors to that source:
 * its chip's tile and card, its tab, a message of it, and what it published.
 */
export interface ReplayPlace {
  readonly agents: readonly CodingAgentSummary[];
  /** Who started the agent, named under the card unless it is the reader. */
  readonly startedBy: CodingAgentSummary["startedBy"];
  /** The reader's own account id, whose start is named by its time alone (`lineSender`). */
  readonly readerId: string | undefined;
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
    "agents" | "archived" | "pullRequests" | "readPullRequest" | "readAgent" | "me"
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
    readerId: control.me,
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

/** The source agent named on a card, as its chip wears it, when the place does not list it: by its title and its harness's mark where a read found it, the mark of no known harness until then. */
function unlistedActor(agentId: string, read: CodingAgentSummary | undefined): Actor {
  return {
    kind: ACTOR_KIND.AGENT,
    agentId,
    name: read?.title ?? TAB_WORDS.CODING_AGENT,
    provider: read === undefined ? undefined : providerOf(read.model),
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
 * another agent by their own marks; nobody for the reader's own, as a
 * transcript names nobody over the reader's own lines; and by its name
 * alone where its step's marker named no sender the window can place.
 */
function LineSender({
  view,
  readerId,
}: {
  view: Extract<StepView, { kind: typeof STEP_VIEW.LINE }>;
  readerId: string | undefined;
}): React.JSX.Element | null {
  const { members, former } = useMemberDirectory();
  if (view.own) return null;
  const actor =
    view.sentBy === undefined ? undefined : lineSender(view.sentBy, readerId, members, former);
  if (actor !== undefined) {
    return (
      <div className="message-meta">
        <span className="message-sender">
          <ActorRef actor={actor} />
        </span>
      </div>
    );
  }
  // A member's line the reader sent is theirs; one the window cannot place keeps its name.
  if (readerId !== undefined && view.sentBy?.userId === readerId) return null;
  return (
    <div className="message-meta">
      <span className="message-sender">{view.sender}</span>
    </div>
  );
}

/**
 * One step, drawn as a transcript draws the same: a line as a sent
 * message, its sender under it unless it is the reader's own; the agent's
 * words as its words; and a call as a call's row, folded onto its input
 * and its result, which run long.
 */
function StepRow({
  step,
  readerId,
}: {
  step: ReplayStep;
  readerId: string | undefined;
}): React.JSX.Element {
  const view = stepView(step);
  switch (view.kind) {
    case STEP_VIEW.LINE:
      return (
        <Message from={MESSAGE_ROLE.USER} data-replay-step={step.kind}>
          <MessageContent>
            <TranscriptWords text={view.words} />
          </MessageContent>
          <LineSender view={view} readerId={readerId} />
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
    <Disclosure data-replay-summary="">
      <DisclosureSummary>
        <TextQuoteIcon aria-hidden="true" />
        {line}
      </DisclosureSummary>
      <DisclosureBody inset={DISCLOSURE_BODY.FLUSH}>
        <TranscriptWords text={text} />
      </DisclosureBody>
    </Disclosure>
  );
}

/**
 * The steps the opened card draws: the newest page of them, under a row
 * drawing the page before as it is pressed, until every kept step is drawn.
 * The steps land under the row, so what stands above it holds still and the
 * panel stays where it was scrolled; once the last page lands the row goes,
 * and the keys land on the steps it drew rather than on nothing. While a
 * find bar is open every step is drawn, so the find covers the whole
 * replay, as a fold's closed body is drawn for it (`fold.tsx`).
 */
function ReplaySteps({
  steps,
  readerId,
}: {
  steps: readonly ReplayStep[];
  readerId: string | undefined;
}): React.JSX.Element {
  const finding = useFindOpen();
  const [shown, setShown] = useState(REPLAY_PAGE);
  const list = useRef<HTMLDivElement>(null);
  const page = replayPage(steps.length, finding ? steps.length : shown);
  const drawMore = () => {
    if (page.next === page.from) list.current?.focus({ preventScroll: true });
    setShown(steps.length - page.from + page.next);
  };
  return (
    <div ref={list} tabIndex={-1} className="replay-steps" data-replay-steps="">
      {page.from === 0 ? null : (
        <Inline>
          <Button
            variant={BUTTON_VARIANT.QUIET}
            icon={<ChevronsUpIcon aria-hidden="true" />}
            onClick={drawMore}
          >
            {earlierStepsLine(page)}
          </Button>
        </Inline>
      )}
      {steps.slice(page.from).map((step, index) => (
        // Note that a step is keyed by its place among them all, because the replay never changes once handed, and a page landing above keeps the rows below as they were.
        <StepRow key={page.from + index} step={step} readerId={readerId} />
      ))}
    </div>
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
    <div className="replay-foot">
      {branch === undefined ? null : (
        <span>
          Builds on <code>{branch}</code>
        </span>
      )}
      {pullRequest === undefined || pullRequest === null || words === undefined ? null : (
        <span className="agent-origin-chip">
          {linkChip(pullRequest.url, words, doors) ?? (
            <TextLink
              href={pullRequest.url}
              look={TEXT_LINK_LOOK.UNDERLINED}
              onClick={(event) => {
                event.preventDefault();
                place.openGitHub(pullRequest.url);
              }}
            >
              {words}
            </TextLink>
          )}
        </span>
      )}
      {onOpenTranscript === undefined ? null : (
        <span className="ml-auto text-foreground" data-replay-open="">
          <TextButton tone={TEXT_BUTTON_TONE.LINK} onClick={onOpenTranscript}>
            {FULL_TRANSCRIPT_WORDS} ›
          </TextButton>
        </span>
      )}
    </div>
  );
}

/**
 * The card: the source's chip and how many steps on its summary row, and,
 * opened, the lede, Luke's summary and the steps left out, the newest steps
 * a page at a time, and the foot; the line naming who started the agent and
 * when under it.
 */
export function ReplayCard({
  replay,
  sentAt,
  place,
  planId,
}: {
  replay: Replay;
  /** When the agent's first message was sent, named after who started it; none where the transcript does not know. */
  sentAt?: number | undefined;
  place: ReplayPlace;
  /** The task the agents are of, under which a message of the source is opened; none where they are of none. */
  planId: string | undefined;
}): React.JSX.Element {
  const { agentId, messageId } = replay;
  const source = useSource(agentId, place);
  const listed = place.agents.some((each) => each.id === agentId);
  const tile = place.tile(agentId) ?? unlistedActor(agentId, source);
  const name = actorName(tile);
  const { members, former } = useMemberDirectory();
  const starter =
    place.startedBy === undefined
      ? undefined
      : lineSender(
          { kind: CODING_AGENT_SENDER.MEMBER, ...place.startedBy },
          place.readerId,
          members,
          former,
        );
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
      <Plan data-replay-card="" aria-label={replayVerb(replay)}>
        <PlanHeader>
          <PlanIcon>
            <SplitIcon />
          </PlanIcon>
          <span className="replay-card-title">
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {replayVerb(replay)}{" "}
            </Text>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: the wrapper only keeps the chip's own press from also folding the card; the chip is the control. */}
            {/* biome-ignore lint/a11y/useKeyWithClickEvents: the chip inside is a button, which takes the keys itself. */}
            <span className="agent-origin-chip" onClick={(event) => event.stopPropagation()}>
              <ActorRef actor={tile} card={place.card(agentId)} onOpen={openSource} />
            </span>
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {" "}
              · {replayCount(replay)}
            </Text>
          </span>
        </PlanHeader>
        <PlanContent layout={PLAN_BODY_LAYOUT.STACK}>
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            {replayLede(name)}
          </Text>
          {summary === undefined || replay.summary === undefined ? null : (
            <SummaryRow line={summary} text={replay.summary.text} />
          )}
          {left === undefined ? null : (
            <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              <em>{left}</em>
            </Text>
          )}
          <ReplaySteps steps={replay.steps} readerId={place.readerId} />
          <ReplayFoot agentId={agentId} place={place} onOpenTranscript={onOpenTranscript} />
        </PlanContent>
      </Plan>
      {starter === undefined && sentAt === undefined ? null : (
        <div className="message-meta">
          {starter === undefined ? null : (
            <span className="message-sender">
              <ActorRef actor={starter} />
            </span>
          )}
          {sentAt === undefined ? null : <SentTime at={sentAt} named={starter !== undefined} />}
        </div>
      )}
    </Message>
  );
}
