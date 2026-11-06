import { REPLAY_STEP_KIND, type Replay, type ReplayStep } from "@repo/features/agent-replay";
import type { AgentPullRequest, AgentSummary, AgentTodos } from "@repo/features/agent-wire";
import { AGENT_SENDER } from "@repo/features/agent-wire";
import { LINK_PLACE } from "@repo/features/link-grammar";
import {
  BUTTON_VARIANT,
  Button,
  DISCLOSURE_BODY,
  Disclosure,
  DisclosureBody,
  DisclosureSummary,
  GlyphSlot,
  Inline,
  MESSAGE_LINE_ALIGN,
  MessageHead,
  MessageLine,
  OneLine,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { ACTOR_KIND, ACTOR_STATE, type Actor, actorName } from "@repo/ui/actor-model";
import { ICON_SIZE } from "@repo/ui/icons";
import { pullRequestLabelOf, TAB_WORDS } from "@repo/ui/tab-strip-model";
import { MESSAGE_ROLE } from "@repo/wire";
import { useQuery } from "@tanstack/react-query";
import { ChevronsUpIcon, SplitIcon, TextQuoteIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ActorRef } from "../actor-ref.js";
import { Message, MessageContent, RECEIVED_MESSAGE_CLASS } from "../ai-elements/message.js";
import { PLAN_BODY_LAYOUT, Plan, PlanContent, PlanHeader, PlanIcon } from "../ai-elements/plan.js";
import { useFindOpen } from "../find-in-tab.js";
import { pullRequestPublishedQuery } from "../live-reads.js";
import { useMemberDirectory } from "../member-directory.js";
import { lineSender, providerOf } from "./agent-model.js";
import { ConnectionNames, useServerName } from "./connection-names.js";
import { CopyMessageAction } from "./copy-message.js";
import { CHIP_OR_LINK_FRAME, ChipOrLink, ORIGIN_CHIP } from "./mention-chip.js";
import {
  earlierStepsLine,
  leftOutLine,
  REPLAY_PAGE,
  replayCallsServer,
  replayCount,
  replayPage,
  replayTaskTodos,
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
import type { AgentsControl } from "./use-agents.js";
import { useOpenPlace } from "./use-open-link.js";

export interface ReplayPlace {
  readonly agents: readonly AgentSummary[];
  readonly startedBy: AgentSummary["startedBy"];
  readonly readerId: string | undefined;
  readonly tile: (agentId: string) => Actor | undefined;
  readonly card: (agentId: string) => ReactNode;
  readonly onOpen: ((agentId: string) => void) | undefined;
  readonly pullRequests: ReadonlyMap<string, AgentPullRequest>;
  readonly readAgent: ((agentId: string) => Promise<AgentSummary | undefined>) | undefined;
  readonly openGitHub: (url: string) => void;
}

const NO_AGENTS: readonly AgentSummary[] = [];

export function replayPlace(input: {
  agent: AgentSummary;
  control: Pick<AgentsControl, "agents" | "archived" | "pullRequests" | "readAgent" | "me">;
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
    openGitHub,
  };
}

function unlistedActor(agentId: string, read: AgentSummary | undefined): Actor {
  return {
    kind: ACTOR_KIND.AGENT,
    agentId,
    name: read?.title ?? TAB_WORDS.AGENT,
    provider: read === undefined ? undefined : providerOf(read.model),
    state: ACTOR_STATE.REST,
  };
}

function useSource(agentId: string, place: ReplayPlace): AgentSummary | undefined {
  const listed = place.agents.find((each) => each.id === agentId);
  const [read, setRead] = useState<AgentSummary | undefined>(undefined);
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

function useLineSender(
  view: Extract<StepView, { kind: typeof STEP_VIEW.LINE }>,
  readerId: string | undefined,
): ReactNode {
  const { members, former } = useMemberDirectory();
  if (view.own) return undefined;
  const actor =
    view.sentBy === undefined ? undefined : lineSender(view.sentBy, readerId, members, former);
  if (actor !== undefined) return <ActorRef actor={actor} />;
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

function LineStep({
  view,
  readerId,
}: {
  view: Extract<StepView, { kind: typeof STEP_VIEW.LINE }>;
  readerId: string | undefined;
}): React.JSX.Element {
  const sender = useLineSender(view, readerId);
  const received = sender !== undefined;
  return (
    <Message
      from={received ? MESSAGE_ROLE.ASSISTANT : MESSAGE_ROLE.USER}
      className={received ? RECEIVED_MESSAGE_CLASS : undefined}
      data-replay-step={REPLAY_STEP_KIND.LINE}
    >
      {received ? <MessageHead sender={sender} /> : null}
      <MessageContent>
        <TranscriptWords text={view.words} />
      </MessageContent>
      <MessageLine
        align={received ? MESSAGE_LINE_ALIGN.START : MESSAGE_LINE_ALIGN.END}
        at={view.at}
        actions={<CopyMessageAction words={view.words} />}
      />
    </Message>
  );
}

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
      files={call.files}
      page={call.page}
      agent={agent}
      agentCard={agentId === undefined ? undefined : place.card(agentId)}
      input={call.input}
      output={call.output}
      errorText={view.errorText}
    />
  );
}

function StepRow({
  step,
  todos,
  place,
}: {
  step: ReplayStep;
  todos: AgentTodos["todos"] | undefined;
  place: ReplayPlace;
}): React.JSX.Element {
  const view = stepView(step, todos);
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

function SummaryRow({ line, text }: { line: string; text: string }): React.JSX.Element {
  return (
    <Disclosure data-replay-summary="">
      <DisclosureSummary>
        <GlyphSlot size={ICON_SIZE.MEDIUM}>
          <TextQuoteIcon />
        </GlyphSlot>
        {line}
      </DisclosureSummary>
      <DisclosureBody inset={DISCLOSURE_BODY.FLUSH}>
        <TranscriptWords text={text} />
      </DisclosureBody>
    </Disclosure>
  );
}

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
  const callsServer = useMemo(() => replayCallsServer(steps), [steps]);
  const todos = useMemo(() => replayTaskTodos(steps), [steps]);
  const drawMore = () => {
    if (page.next === page.from) list.current?.focus({ preventScroll: true });
    setShown(steps.length - page.from + page.next);
  };
  return (
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
          <StepRow
            key={page.from + index}
            step={step}
            todos={todos.get(page.from + index)}
            place={place}
          />
        ))}
      </ConnectionNames>
    </div>
  );
}

function ReplayFoot({
  agentId,
  place,
}: {
  agentId: string;
  place: ReplayPlace;
}): React.JSX.Element | null {
  const held = useQuery(pullRequestPublishedQuery({ agentId })).data;
  const published = held === undefined || "failure" in held ? undefined : held;
  const doors = useMentionDoors();
  const pullRequest = place.pullRequests.get(agentId) ?? published?.pullRequest;
  const branch = published?.branch ?? undefined;
  const words =
    pullRequest === undefined || pullRequest === null ? undefined : pullRequestLabelOf(pullRequest);
  if (branch === undefined && words === undefined) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-block-gap gap-y-tight-gap border-t border-dashed border-border pt-row-inset text-caption text-muted-foreground *:min-w-0">
      {branch === undefined ? null : (
        <span>
          Builds on <code>{branch}</code>
        </span>
      )}
      {pullRequest === undefined || pullRequest === null || words === undefined ? null : (
        <ChipOrLink
          href={pullRequest.url}
          words={words}
          doors={doors}
          onOpen={place.openGitHub}
          frame={CHIP_OR_LINK_FRAME.ORIGIN}
        />
      )}
    </div>
  );
}

export function ReplayCard({
  replay,
  sentAt,
  place,
  taskId,
}: {
  replay: Replay;
  sentAt?: number | undefined;
  place: ReplayPlace;
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
          { kind: AGENT_SENDER.MEMBER, ...place.startedBy },
          place.readerId,
          members,
          former,
        );
  const openPlace = useOpenPlace();
  const open = place.onOpen;
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
