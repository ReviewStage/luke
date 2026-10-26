import { REPLAY_STEP_KIND, type Replay, type ReplayStep } from "@luke/features/agent-replay";
import type { CodingAgentPullRequestAnswerView } from "@luke/features/coding-agent-view";
import type { CodingAgentPullRequest, CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { CODING_AGENT_SENDER } from "@luke/features/coding-agent-wire";
import { LINK_PLACE } from "@luke/features/link-grammar";
import {
  BUTTON_VARIANT,
  Button,
  DISCLOSURE_BODY,
  Disclosure,
  DisclosureBody,
  DisclosureSummary,
  Inline,
  MESSAGE_LINE_ALIGN,
  MessageLine,
  OneLine,
  TEXT_ELEMENT,
  TEXT_LINK_LOOK,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextLink,
} from "@luke/ui";
import { ACTOR_KIND, ACTOR_STATE, type Actor, actorName } from "@luke/ui/actor-model";
import { pullRequestLabelOf, TAB_WORDS } from "@luke/ui/tab-strip-model";
import { MESSAGE_ROLE } from "@luke/wire";
import { ChevronsUpIcon, SplitIcon, TextQuoteIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ActorRef } from "../actor-ref.js";
import { Message, MessageContent, RECEIVED_MESSAGE_CLASS } from "../ai-elements/message.js";
import { PLAN_BODY_LAYOUT, Plan, PlanContent, PlanHeader, PlanIcon } from "../ai-elements/plan.js";
import { useFindOpen } from "../find-in-tab.js";
import { useMemberDirectory } from "../member-directory.js";
import { lineSender, providerOf, receivedLine } from "./coding-agent-model.js";
import { ConnectionNames, useServerName } from "./connection-names.js";
import { CopyMessageAction } from "./copy-message.js";
import { linkChip } from "./mention-chip.js";
import {
  earlierStepsLine,
  leftOutLine,
  REPLAY_PAGE,
  replayCallsServer,
  replayCount,
  replayLede,
  replayPage,
  replayVerb,
  replayWords,
  STEP_VIEW,
  type StepView,
  stepView,
  summaryLine,
} from "./replay-card-model.js";
import { useMentionDoors } from "./task-mentions.js";
import { TOOL_TARGET, type ToolTarget } from "./tool-call-model.js";
import { TranscriptTool, TranscriptWords } from "./transcript-blocks.js";
import type { CodingAgentsControl } from "./use-coding-agents.js";
import { useOpenPlace } from "./use-open-link.js";

/**
 * replay-card.tsx -- the card an agent started from another opens on after its brief: "Continued from" or "Forked from" the source agent, folded over the steps of the source's work it was handed.
 *
 * The card stands as the plan's card does, at a sent message's measure over
 * the line naming who started the agent and when, as any line sent to the
 * agent is named: a teammate by their face and name, the reader's own by
 * the time alone, and its Copy, which copies the replay as it was handed. Its summary row names the source by the chip its tab
 * wears, which opens that tab and hangs its card, and how many of the
 * source's steps were replayed, of how many where the earliest were left
 * out. Opened, it says what it holds, Luke's summary of the oldest steps
 * and how many steps were left out where either applies, then the newest
 * steps, each drawn as the live transcript draws it, a line over who sent
 * it, when, and Copy, and a call as a call of its tool, opening onto its
 * words exactly as the agent was handed them, under a row that draws the earlier ones a page at a time,
 * and a foot naming the branch and the pull request the source published,
 * where known. The source's whole transcript is a press of its chip away.
 * The model is `replay-card-model.ts`.
 */

/**
 * A chip naming what a transcript's opening came from, as the transcript
 * draws one, which cuts its own name to the line: held to the line's width
 * so a narrow line cuts the title, never the state after it.
 */
export const ORIGIN_CHIP = "agent-origin-chip inline-flex min-w-0 max-w-full";

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
function useLineSender(
  view: Extract<StepView, { kind: typeof STEP_VIEW.LINE }>,
  readerId: string | undefined,
): ReactNode {
  const { members, former } = useMemberDirectory();
  if (view.own) return undefined;
  const actor =
    view.sentBy === undefined ? undefined : lineSender(view.sentBy, readerId, members, former);
  if (actor !== undefined) return <ActorRef actor={actor} />;
  // A member's line the reader sent is theirs; one the window cannot place keeps its name.
  if (readerId !== undefined && view.sentBy?.userId === readerId) return undefined;
  return (
    <Text
      as={TEXT_ELEMENT.SPAN}
      variant={TEXT_VARIANT.INHERIT}
      truncate
      className="message-sender-words"
    >
      {view.sender}
    </Text>
  );
}

/**
 * A replayed line, drawn as a transcript draws a line sent to the agent: a
 * sent message, at the column's left where it is the other side's words
 * (Luke's, GitHub's, another agent's), under the line naming who sent it,
 * unless it is the reader's own, when, where its marker said, and Copy.
 */
function LineStep({
  view,
  readerId,
}: {
  view: Extract<StepView, { kind: typeof STEP_VIEW.LINE }>;
  readerId: string | undefined;
}): React.JSX.Element {
  const sender = useLineSender(view, readerId);
  const received = receivedLine(view.sentBy);
  return (
    <Message
      from={received ? MESSAGE_ROLE.ASSISTANT : MESSAGE_ROLE.USER}
      className={received ? RECEIVED_MESSAGE_CLASS : undefined}
      data-replay-step={REPLAY_STEP_KIND.LINE}
    >
      <MessageContent>
        <TranscriptWords text={view.words} />
      </MessageContent>
      <MessageLine
        align={received ? MESSAGE_LINE_ALIGN.START : MESSAGE_LINE_ALIGN.END}
        sender={sender}
        at={view.at}
        actions={<CopyMessageAction words={view.words} />}
      />
    </Message>
  );
}

/**
 * A replayed call, drawn as a transcript draws a call of its tool: its
 * kind's icon or its integration's mark, its command's description, the
 * server it ran on, and the agent it is about by the chip that agent's tab
 * wears, hanging its card, folded onto its input and its result.
 */
function CallStep({
  view,
  place,
}: {
  view: Extract<StepView, { kind: typeof STEP_VIEW.CALL }>;
  place: ReplayPlace;
}): React.JSX.Element {
  const call = view.view;
  const server = useServerName(call);
  const agentId = view.agent?.id;
  const listed = agentId === undefined ? undefined : place.tile(agentId);
  const title = view.agent?.title;
  const agent =
    listed ??
    (title === undefined
      ? undefined
      : {
          kind: ACTOR_KIND.AGENT,
          agentId,
          name: title,
          provider: view.agent?.model === undefined ? undefined : providerOf(view.agent.model),
          state: ACTOR_STATE.REST,
        });
  return (
    <TranscriptTool
      data-replay-step={REPLAY_STEP_KIND.TOOL}
      state={view.state}
      kind={call.kind}
      provider={call.provider}
      server={server}
      subject={call.subject}
      description={call.description}
      agent={agent}
      agentCard={agentId === undefined ? undefined : place.card(agentId)}
      input={call.input}
      output={call.output}
      errorText={view.errorText}
    />
  );
}

/**
 * One step, drawn as a transcript draws the same: a line as a sent
 * message, its sender under it unless it is the reader's own; the agent's
 * words as its words; and a call as a call's row, folded onto its input
 * and its result, which run long.
 */
function StepRow({ step, place }: { step: ReplayStep; place: ReplayPlace }): React.JSX.Element {
  const view = stepView(step);
  switch (view.kind) {
    case STEP_VIEW.LINE:
      return <LineStep view={view} readerId={place.readerId} />;
    case STEP_VIEW.SAID:
      return (
        <div data-replay-step={step.kind}>
          <TranscriptWords text={view.words} />
        </div>
      );
    case STEP_VIEW.CALL:
      return <CallStep view={view} place={place} />;
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
  place,
}: {
  steps: readonly ReplayStep[];
  place: ReplayPlace;
}): React.JSX.Element {
  const finding = useFindOpen();
  const [shown, setShown] = useState(REPLAY_PAGE);
  const list = useRef<HTMLDivElement>(null);
  const page = replayPage(steps.length, finding ? steps.length : shown);
  // Note that the replay's calls stand in its first message's words, which the transcript's own check for a server's call never reads.
  const callsServer = useMemo(() => replayCallsServer(steps), [steps]);
  const drawMore = () => {
    if (page.next === page.from) list.current?.focus({ preventScroll: true });
    setShown(steps.length - page.from + page.next);
  };
  return (
    // No ring: it is focused only by script, to keep the place when Show more is spent.
    <div
      ref={list}
      tabIndex={-1}
      className="replay-steps flex flex-col gap-block-gap outline-none"
      data-replay-steps=""
    >
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
      <ConnectionNames needed={callsServer}>
        {steps.slice(page.from).map((step, index) => (
          // Note that a step is keyed by its place among them all, because the replay never changes once handed, and a page landing above keeps the rows below as they were.
          <StepRow key={page.from + index} step={step} place={place} />
        ))}
      </ConnectionNames>
    </div>
  );
}

/** The foot: the branch and pull request the source published, where known; nothing, rule and all, where neither is. */
function ReplayFoot({
  agentId,
  place,
}: {
  agentId: string;
  place: ReplayPlace;
}): React.JSX.Element | null {
  const published = usePublished(agentId, place.readPublished);
  const doors = useMentionDoors();
  const pullRequest = published?.pullRequest ?? place.pullRequests.get(agentId);
  const branch = published?.branch ?? undefined;
  const words =
    pullRequest === undefined || pullRequest === null ? undefined : pullRequestLabelOf(pullRequest);
  if (branch === undefined && words === undefined) return null;
  return (
    // The branch and the pull request, over a dashed rule.
    <div className="flex flex-wrap items-center gap-x-block-gap gap-y-tight-gap border-t border-dashed border-border pt-row-inset text-caption text-muted-foreground *:min-w-0">
      {branch === undefined ? null : (
        <span>
          Builds on <code>{branch}</code>
        </span>
      )}
      {pullRequest === undefined || pullRequest === null || words === undefined ? null : (
        <span className={ORIGIN_CHIP}>
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
  taskId,
}: {
  replay: Replay;
  /** When the agent's first message was sent, named after who started it; none where the transcript does not know. */
  sentAt?: number | undefined;
  place: ReplayPlace;
  /** The task the agents are of, under which a message of the source is opened; none where they are of none. */
  taskId: string | undefined;
}): React.JSX.Element {
  const { agentId } = replay;
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
              taskId === undefined
                ? { kind: LINK_PLACE.AGENT, agentId }
                : { kind: LINK_PLACE.AGENT, planId: taskId, agentId },
            );
  const left = leftOutLine(replay);
  const summary = summaryLine(replay);
  return (
    <Message from={MESSAGE_ROLE.USER} className="agent-origin">
      <Plan
        data-replay-card=""
        aria-label={replayVerb(replay)}
        actions={
          <span className={ORIGIN_CHIP}>
            <ActorRef actor={tile} card={place.card(agentId)} onOpen={openSource} faceOnly />
          </span>
        }
      >
        <PlanHeader>
          <PlanIcon>
            <SplitIcon />
          </PlanIcon>
          {/* Note that the head names the source in words, its chip standing beside the head, because the head is the card's summary, which holds no control. */}
          <OneLine
            className="flex min-w-0 flex-1 items-center gap-tight-gap overflow-hidden whitespace-nowrap"
            words={`${replayVerb(replay)} ${name} · ${replayCount(replay)}`}
          >
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {replayVerb(replay)}{" "}
            </Text>
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION}>
              {name}
            </Text>
            <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
              {" "}
              · {replayCount(replay)}
            </Text>
          </OneLine>
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
          <ReplaySteps steps={replay.steps} place={place} />
          <ReplayFoot agentId={agentId} place={place} />
        </PlanContent>
      </Plan>
      <MessageLine
        sender={starter === undefined ? undefined : <ActorRef actor={starter} />}
        at={sentAt}
        wrap
        actions={<CopyMessageAction words={replayWords(replay)} />}
      />
    </Message>
  );
}
