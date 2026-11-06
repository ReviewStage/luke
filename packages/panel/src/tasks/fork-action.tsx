import { AGENT_MACHINE, type AgentAttachment, type AgentSummary } from "@repo/features/agent-wire";
import { LINK_PLACE } from "@repo/features/link-grammar";
import {
  CARD_CORNER,
  CARD_LOOK,
  CARD_PADDING,
  Card,
  IconButton,
  NOTE_LINE_LOOK,
  NoteLine,
  ONE_LINE_END,
  OneLine,
  TextButton,
  Tooltip,
} from "@repo/ui";
import { ACTOR_KIND, ACTOR_STATE, type Actor } from "@repo/ui/actor-model";
import { TAB_WORDS } from "@repo/ui/tab-strip-model";
import { ArrowRightIcon, SplitIcon, XIcon } from "lucide-react";
import { createContext, Fragment, type ReactNode, useContext } from "react";
import { ActorRef } from "../actor-ref.js";
import { MessageAction } from "../ai-elements/message.js";
import { agentActor, agentName, offersContinue, startsOwnAgents } from "./agent-model.js";
import type { TranscriptCards } from "./agent-tab.js";
import { type AgentFork, FORK_WORDS, type ForkCut, forksOf, messageOpening } from "./fork-model.js";
import { TOOL_TARGET, type ToolTarget } from "./tool-call-model.js";
import type { AgentsControl } from "./use-agents.js";
import { useOpenPlace } from "./use-open-link.js";

interface ForkDoors {
  readonly onFork:
    | ((messageId: string, words: string, cut: ForkCut | undefined) => void)
    | undefined;
  readonly forkedTo: (messageId: string) => readonly ReactNode[];
  readonly onContinue?: ContinueDoor | undefined;
}

export type ContinueDoor = (words: string, attachments: readonly AgentAttachment[]) => void;

const ForkContext = createContext<ForkDoors | undefined>(undefined);

const ForkOfferedContext = createContext(false);

export function ForkProvider({
  value,
  children,
}: {
  value: ForkDoors | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  return (
    <ForkContext.Provider value={value}>
      <ForkOfferedContext.Provider value={value?.onFork !== undefined}>
        {children}
      </ForkOfferedContext.Provider>
    </ForkContext.Provider>
  );
}

export function useContinueDoor(): ContinueDoor | undefined {
  return useContext(ForkContext)?.onContinue;
}

function bareActor(
  agentId: string,
  known: AgentSummary | undefined,
  title: string | null = null,
): Actor {
  if (known !== undefined) return agentActor(known, agentName(known, undefined));
  return {
    kind: ACTOR_KIND.AGENT,
    agentId,
    name: title ?? TAB_WORDS.AGENT,
    provider: undefined,
    state: ACTOR_STATE.REST,
  };
}

function agentChip(
  agentId: string,
  known: AgentSummary | undefined,
  cards: TranscriptCards | undefined,
  open: ((agentId: string) => void) | undefined,
  title: string | null = null,
): ReactNode {
  const target: ToolTarget = { kind: TOOL_TARGET.AGENT, agent: agentId };
  const actor = cards?.agent?.(agentId) ?? bareActor(agentId, known, title);
  return (
    <ActorRef
      actor={actor}
      card={cards?.target(target)}
      onOpen={open === undefined ? undefined : () => open(agentId)}
    />
  );
}

export function agentForkDoors(input: {
  agent: AgentSummary;
  control: Pick<AgentsControl, "agents" | "archived" | "onUnarchive" | "mode">;
  onFork: ((fork: AgentFork) => void) | undefined;
  onContinue?:
    | ((agentId: string, words: string, attachments: readonly AgentAttachment[]) => void)
    | undefined;
  cards: TranscriptCards | undefined;
  onOpenTarget: ((target: ToolTarget) => void) | undefined;
}): ForkDoors {
  const { agent, control, onFork, onContinue, cards, onOpenTarget } = input;
  const standing = new Set(control.agents?.map((each) => each.id));
  const listed = [...(control.agents ?? []), ...(control.archived ?? [])];
  const forks = new Map(forksOf(listed, agent.id));
  const named = agent.continuedBy ?? [];
  for (const each of named) {
    if (each.messageId === undefined || listed.some((one) => one.id === each.agentId)) continue;
    forks.set(each.messageId, [...(forks.get(each.messageId) ?? []), each.agentId]);
  }
  const opens = (agentId: string) => standing.has(agentId) || agent.planId === null;
  const drafts = control.onUnarchive === undefined;
  const forkable =
    onFork !== undefined &&
    drafts &&
    agent.machine !== AGENT_MACHINE.DEVICE &&
    startsOwnAgents(control.mode);
  const open =
    onOpenTarget === undefined
      ? undefined
      : (agentId: string) => onOpenTarget({ kind: TOOL_TARGET.AGENT, agent: agentId });
  return {
    onFork: forkable
      ? (messageId, words, cut) =>
          onFork({ agentId: agent.id, messageId, opening: messageOpening(words), ...cut })
      : undefined,
    onContinue:
      onContinue !== undefined && drafts && offersContinue(control.mode, agent)
        ? (words, attachments) => onContinue(agent.id, words, attachments)
        : undefined,
    forkedTo: (messageId) =>
      (forks.get(messageId) ?? []).map((agentId) => (
        <Fragment key={agentId}>
          {agentChip(
            agentId,
            listed.find((each) => each.id === agentId),
            cards,
            opens(agentId) ? open : undefined,
            named.find((each) => each.agentId === agentId)?.title ?? null,
          )}
        </Fragment>
      )),
  };
}

export function useForkOffered(): boolean {
  return useContext(ForkOfferedContext);
}

export function ForkMessageAction({
  messageId,
  words,
  cut,
}: {
  messageId: string;
  words: string;
  cut?: ForkCut | undefined;
}): ReactNode {
  const onFork = useContext(ForkContext)?.onFork;
  if (onFork === undefined) return null;
  return (
    <MessageAction
      label={FORK_WORDS.ACTION}
      tooltip={FORK_WORDS.ACTION}
      onClick={() => onFork(messageId, words, cut)}
    >
      <SplitIcon />
    </MessageAction>
  );
}

export function ForkedToLine({ messageId }: { messageId: string }): ReactNode {
  const chips = useContext(ForkContext)?.forkedTo(messageId) ?? [];
  if (chips.length === 0) return null;
  return (
    <NoteLine look={NOTE_LINE_LOOK.TRAIL} glyph={<SplitIcon />} data-forked-to="">
      <span>{FORK_WORDS.TO}</span>
      {chips.map((chip, index) => (
        <span key={index} className="inline-flex items-center">
          {chip}
          {index === chips.length - 1 ? null : <span aria-hidden="true">,</span>}
        </span>
      ))}
    </NoteLine>
  );
}

export function ForkChip({
  fork,
  source,
  cards,
  onDrop,
}: {
  fork: AgentFork;
  source: AgentSummary | undefined;
  cards: TranscriptCards | undefined;
  onDrop: () => void;
}): React.JSX.Element {
  const openPlace = useOpenPlace();
  const taskId = source?.planId ?? null;
  const { agentId, messageId } = fork;
  const task = taskId === null ? undefined : { planId: taskId };
  const open =
    openPlace === undefined
      ? undefined
      : () =>
          openPlace(
            messageId === undefined
              ? { kind: LINK_PLACE.AGENT, ...task, agentId }
              : { kind: LINK_PLACE.MESSAGE, ...task, agentId, messageId },
          );
  const quote = `“${fork.opening}”`;
  const drop = messageId === undefined ? FORK_WORDS.DROP_CONTINUE : FORK_WORDS.DROP;
  return (
    <div className="draft-fork-dock">
      <Card
        look={CARD_LOOK.TINT}
        corner={CARD_CORNER.CONTROL}
        padding={CARD_PADDING.NONE}
        className="draft-fork-chip"
        data-fork-chip=""
        data-continue={messageId === undefined ? "" : undefined}
      >
        {messageId === undefined ? (
          <ArrowRightIcon className="draft-fork-glyph" aria-hidden="true" />
        ) : (
          <SplitIcon className="draft-fork-glyph" aria-hidden="true" />
        )}
        <span className="draft-fork-lead">
          {messageId === undefined ? FORK_WORDS.CONTINUE_OF : FORK_WORDS.OF}
        </span>
        {agentChip(agentId, source, cards, open === undefined ? undefined : () => open())}
        {messageId === undefined ? null : (
          <>
            <span>{FORK_WORDS.AT}</span>
            {open === undefined ? (
              <OneLine end={ONE_LINE_END.ELLIPSIS} className="draft-fork-quote">
                {quote}
              </OneLine>
            ) : (
              <OneLine
                end={ONE_LINE_END.ELLIPSIS}
                hint={(line) => <Tooltip label={FORK_WORDS.OPEN_SOURCE}>{line}</Tooltip>}
                className="draft-fork-quote"
              >
                <TextButton onClick={open}>{quote}</TextButton>
              </OneLine>
            )}
          </>
        )}
        <span className="draft-fork-drop">
          <Tooltip label={drop}>
            <IconButton icon={<XIcon />} label={drop} onClick={onDrop} />
          </Tooltip>
        </span>
      </Card>
    </div>
  );
}
