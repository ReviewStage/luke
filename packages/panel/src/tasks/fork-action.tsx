import type { CodingAgentAttachment, CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { LINK_PLACE } from "@luke/features/link-grammar";
import {
  CARD_CORNER,
  CARD_LOOK,
  CARD_PADDING,
  Card,
  IconButton,
  ONE_LINE_END,
  OneLine,
  TextButton,
  Tooltip,
} from "@luke/ui";
import { ACTOR_KIND, ACTOR_STATE, type Actor } from "@luke/ui/actor-model";
import { TAB_WORDS } from "@luke/ui/tab-strip-model";
import { ArrowRightIcon, SplitIcon, XIcon } from "lucide-react";
import { createContext, Fragment, type ReactNode, useContext } from "react";
import { ActorRef } from "../actor-ref.js";
import { MessageAction } from "../ai-elements/message.js";
import type { TranscriptCards } from "./agent-tab.js";
import { agentActor, agentName } from "./coding-agent-model.js";
import { type AgentFork, FORK_WORDS, type ForkCut, forksOf, messageOpening } from "./fork-model.js";
import { TOOL_TARGET, type ToolTarget } from "./tool-call-model.js";
import type { CodingAgentsControl } from "./use-coding-agents.js";
import { useOpenPlace } from "./use-open-link.js";

/**
 * fork-action.tsx -- a coding agent forked at one of its messages: the message's Fork to new agent, the draft's chip naming what it forks, and the line under a message saying which agents it was forked to.
 *
 * An agent's tab hands its messages what forking takes (`ForkProvider`):
 * the press that forks one into the task's draft, offered only on an
 * agent's tab of a task that is not archived, and the agents each message
 * was forked to, read off the task's agents (`fork-model.ts`). A worker's
 * tab and an agent of no task hand none, so their messages
 * offer no fork and name none. The draft's chip names the source by its
 * chip and the message by its opening words, either one opening the
 * source's tab at that message (`message-links.tsx`), and its × lets the
 * fork go, leaving an ordinary draft with its words.
 */

/** What an agent's tab hands its messages: the press that forks one, none where forking is not offered, the chips of the agents each was forked to, and the press that opens the agent's continue as a draft, none where no draft opens. */
interface ForkDoors {
  readonly onFork:
    | ((messageId: string, words: string, cut: ForkCut | undefined) => void)
    | undefined;
  readonly forkedTo: (messageId: string) => readonly ReactNode[];
  readonly onContinue?: ContinueDoor | undefined;
}

/** Opens the task's draft as a continue of the agent, prefilled with the words and files given. */
export type ContinueDoor = (words: string, attachments: readonly CodingAgentAttachment[]) => void;

const ForkContext = createContext<ForkDoors | undefined>(undefined);

/**
 * Whether the tab offers to fork, apart from the doors themselves, which
 * the window hands anew on every draw: every message reads it, and a
 * message kept as it was is not drawn again for a new set of doors.
 */
const ForkOfferedContext = createContext(false);

/** Hands an agent's messages what forking takes. */
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

/** The press that opens the agent's continue as the task's draft, where its tab hands one. */
export function useContinueDoor(): ContinueDoor | undefined {
  return useContext(ForkContext)?.onContinue;
}

/** An agent as its chip wears it where the place hands no cards: by its tab's name where the task lists it, else by the title its source's summary names, and else as a coding agent. */
function bareActor(
  agentId: string,
  known: CodingAgentSummary | undefined,
  title: string | null = null,
): Actor {
  if (known !== undefined) return agentActor(known, agentName(known, undefined));
  return {
    kind: ACTOR_KIND.AGENT,
    agentId,
    name: title ?? TAB_WORDS.CODING_AGENT,
    provider: undefined,
    state: ACTOR_STATE.REST,
  };
}

/** One of the task's agents as a chip, hanging its card, its press `open`, none where it opens nothing. */
function agentChip(
  agentId: string,
  known: CodingAgentSummary | undefined,
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

/**
 * What an agent's tab hands its messages for forking: the press, where
 * what the agent stands under, its task or, with none, the agent itself, is
 * not archived and the place opens a draft, and the agents started from
 * each of its messages as chips.
 */
export function agentForkDoors(input: {
  agent: CodingAgentSummary;
  control: Pick<CodingAgentsControl, "agents" | "archived" | "onUnarchive">;
  onFork: ((fork: AgentFork) => void) | undefined;
  /** Opens the draft, the task's or the agent page's, as a continue of an agent, by its id, with the words and files given; none where no draft opens. */
  onContinue?:
    | ((agentId: string, words: string, attachments: readonly CodingAgentAttachment[]) => void)
    | undefined;
  cards: TranscriptCards | undefined;
  onOpenTarget: ((target: ToolTarget) => void) | undefined;
}): ForkDoors {
  const { agent, control, onFork, onContinue, cards, onOpenTarget } = input;
  const standing = new Set(control.agents?.map((each) => each.id));
  const listed = [...(control.agents ?? []), ...(control.archived ?? [])];
  const forks = new Map(forksOf(listed, agent.id));
  // An agent's page lists that agent alone, so the forks its own summary names stand beside the list's.
  const named = agent.continuedBy ?? [];
  for (const each of named) {
    if (each.messageId === undefined || listed.some((one) => one.id === each.agentId)) continue;
    forks.set(each.messageId, [...(forks.get(each.messageId) ?? []), each.agentId]);
  }
  // An agent with no task opens on its own page, listed or not; on a task, an unlisted one is archived.
  const opens = (agentId: string) => standing.has(agentId) || agent.planId === null;
  // Note that an agent with no task is forked and continued as a task's is, its draft on its own page.
  const drafts = control.onUnarchive === undefined;
  const forkable = onFork !== undefined && drafts;
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
      onContinue !== undefined && drafts
        ? (words, attachments) => onContinue(agent.id, words, attachments)
        : undefined,
    forkedTo: (messageId) =>
      (forks.get(messageId) ?? []).map((agentId) => (
        <Fragment key={agentId}>
          {agentChip(
            agentId,
            listed.find((each) => each.id === agentId),
            cards,
            // An archived agent of a task is named alone, since no tab of the task draws it.
            opens(agentId) ? open : undefined,
            named.find((each) => each.agentId === agentId)?.title ?? null,
          )}
        </Fragment>
      )),
  };
}

/** Whether the tab a message is drawn in offers to fork it. */
export function useForkOffered(): boolean {
  return useContext(ForkOfferedContext);
}

/** A message's Fork to new agent, after its Copy and Copy link; nothing where its tab offers no fork. */
export function ForkMessageAction({
  messageId,
  words,
  cut,
}: {
  messageId: string;
  words: string;
  /** Where the fork cuts the message, where it is a reply still being written (`forkCutOf`); none for a settled one, kept whole. */
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

/** The quiet line under a message naming the agents forked at it; nothing where none was. */
export function ForkedToLine({ messageId }: { messageId: string }): ReactNode {
  const chips = useContext(ForkContext)?.forkedTo(messageId) ?? [];
  if (chips.length === 0) return null;
  return (
    <p
      className="mx-0 mt-list-gap mb-0 flex flex-wrap items-center gap-tight-gap text-caption-inline text-muted-foreground"
      data-forked-to=""
    >
      <SplitIcon className="size-control-icon flex-none" aria-hidden="true" />
      <span>{FORK_WORDS.TO}</span>
      {chips.map((chip, index) => (
        // Note that each chip holds the comma after it, so no gap opens before the comma.
        <span key={index} className="inline-flex items-center">
          {chip}
          {index === chips.length - 1 ? null : <span aria-hidden="true">,</span>}
        </span>
      ))}
    </p>
  );
}

/**
 * The draft's chip over its box naming what it forks: the source's chip and
 * the message's opening words, either opening the source's tab at that
 * message where the window can, and an × that lets the fork go. A continue
 * names no message, so its chip says Continue of the source's chip alone,
 * behind the arrow Continue in new agent and Continued in wear, the chip
 * opening the source's tab.
 */
export function ForkChip({
  fork,
  source,
  cards,
  onDrop,
}: {
  fork: AgentFork;
  /** The source as the task lists it, whose task its message is opened under; none where the list does not hold it. */
  source: CodingAgentSummary | undefined;
  cards: TranscriptCards | undefined;
  onDrop: () => void;
}): React.JSX.Element {
  const openPlace = useOpenPlace();
  const taskId = source?.planId ?? null;
  const { agentId, messageId } = fork;
  // A source with no task, or none the list holds, is opened on its own page.
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
