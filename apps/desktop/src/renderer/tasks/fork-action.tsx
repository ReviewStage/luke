import type { CodingAgentSummary } from "@luke/features/coding-agent-wire";
import { LINK_PLACE } from "@luke/features/luke-link";
import { ACTOR_KIND, ACTOR_STATE, type Actor } from "@luke/ui/actor-model";
import { TAB_WORDS } from "@luke/ui/tab-strip-model";
import { SplitIcon, XIcon } from "lucide-react";
import { createContext, Fragment, type ReactNode, useContext } from "react";
import { ActorRef } from "../actor-ref";
import { MessageAction } from "../ai-elements/message";
import { Tooltip } from "../tooltip";
import type { TranscriptCards } from "./agent-tab";
import { agentActor, agentTabLabel } from "./coding-agent-model";
import { type AgentFork, FORK_WORDS, forksOf, messageOpening } from "./fork-model";
import { TOOL_TARGET, type ToolTarget } from "./tool-call-model";
import type { CodingAgentsControl } from "./use-coding-agents";
import { useOpenPlace } from "./use-open-link";

/**
 * fork-action.tsx -- a coding agent forked at one of its messages: the message's Fork to new agent, the draft's chip naming what it forks, and the line under a message saying which agents it was forked to.
 *
 * An agent's tab hands its messages what forking takes (`ForkProvider`):
 * the press that forks one into the task's draft, offered only on an
 * agent's tab of a task that is not archived, and the agents each message
 * was forked to, read off the task's agents (`fork-model.ts`). A worker's
 * tab, an agent of no task, and the Call tab hand none, so their messages
 * offer no fork and name none. The draft's chip names the source by its
 * chip and the message by its opening words, either one opening the
 * source's tab at that message (`message-links.tsx`), and its × lets the
 * fork go, leaving an ordinary draft with its words.
 */

/** What an agent's tab hands its messages: the press that forks one, none where forking is not offered, and the chips of the agents each was forked to. */
interface ForkDoors {
  readonly onFork: ((messageId: string, words: string) => void) | undefined;
  readonly forkedTo: (messageId: string) => readonly ReactNode[];
}

const ForkContext = createContext<ForkDoors | undefined>(undefined);

/** Hands an agent's messages what forking takes. */
export const ForkProvider = ForkContext.Provider;

/** An agent as its chip wears it where the place hands no cards: by its tab's name where the task lists it, and else as a coding agent. */
function bareActor(agentId: string, known: CodingAgentSummary | undefined): Actor {
  if (known !== undefined) return agentActor(known, agentTabLabel(known, undefined));
  return {
    kind: ACTOR_KIND.AGENT,
    agentId,
    name: TAB_WORDS.CODING_AGENT,
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
): ReactNode {
  const target: ToolTarget = { kind: TOOL_TARGET.AGENT, agent: agentId };
  const actor = cards?.agent?.(agentId) ?? bareActor(agentId, known);
  return (
    <ActorRef
      actor={actor}
      card={cards?.target(target)}
      onOpen={open === undefined ? undefined : () => open(agentId)}
    />
  );
}

/**
 * What an agent's tab hands its messages for forking: the press, where the
 * agent works on a task that is not archived and the place opens a draft,
 * and the agents of the task started from each of its messages as chips.
 */
export function agentForkDoors(input: {
  agent: CodingAgentSummary;
  control: Pick<CodingAgentsControl, "agents" | "archived" | "onUnarchive">;
  onFork: ((fork: AgentFork) => void) | undefined;
  cards: TranscriptCards | undefined;
  onOpenTarget: ((target: ToolTarget) => void) | undefined;
}): ForkDoors {
  const { agent, control, onFork, cards, onOpenTarget } = input;
  const standing = new Set(control.agents?.map((each) => each.id));
  const listed = [...(control.agents ?? []), ...(control.archived ?? [])];
  const forks = forksOf(listed, agent.id);
  const forkable =
    onFork !== undefined && agent.planId !== null && control.onUnarchive === undefined;
  const open =
    onOpenTarget === undefined
      ? undefined
      : (agentId: string) => onOpenTarget({ kind: TOOL_TARGET.AGENT, agent: agentId });
  return {
    onFork: forkable
      ? (messageId, words) =>
          onFork({ agentId: agent.id, messageId, opening: messageOpening(words) })
      : undefined,
    forkedTo: (messageId) =>
      (forks.get(messageId) ?? []).map((agentId) => (
        <Fragment key={agentId}>
          {agentChip(
            agentId,
            listed.find((each) => each.id === agentId),
            cards,
            // An archived agent is named alone, since no tab of the task draws it.
            standing.has(agentId) ? open : undefined,
          )}
        </Fragment>
      )),
  };
}

/** A message's Fork to new agent, after its Copy and Copy link; nothing where its tab offers no fork. */
export function ForkMessageAction({
  messageId,
  words,
}: {
  messageId: string;
  words: string;
}): ReactNode {
  const onFork = useContext(ForkContext)?.onFork;
  if (onFork === undefined) return null;
  return (
    <MessageAction
      label={FORK_WORDS.ACTION}
      tooltip={FORK_WORDS.ACTION}
      className="[&_svg]:size-4"
      data-fork-action=""
      onClick={() => onFork(messageId, words)}
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
    <p className="agent-forked-to" data-forked-to="">
      <SplitIcon className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{FORK_WORDS.TO}</span>
      {chips.map((chip, index) => (
        // Note that each chip holds the comma after it, so no gap opens before the comma.
        <span key={index} className="agent-forked-to-item">
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
 * message where the window can, and an × that lets the fork go.
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
  const planId = source?.planId ?? null;
  const open =
    openPlace === undefined || planId === null
      ? undefined
      : () =>
          openPlace({
            kind: LINK_PLACE.MESSAGE,
            planId,
            agentId: fork.agentId,
            messageId: fork.messageId,
          });
  const quote = `“${fork.opening}”`;
  return (
    <div className="draft-fork-dock">
      <div className="draft-fork-chip" data-fork-chip="">
        <SplitIcon className="size-3.5 shrink-0" aria-hidden="true" />
        <span>{FORK_WORDS.OF}</span>
        {agentChip(fork.agentId, source, cards, open === undefined ? undefined : () => open())}
        <span>{FORK_WORDS.AT}</span>
        {open === undefined ? (
          <span className="draft-fork-quote">{quote}</span>
        ) : (
          <Tooltip label={FORK_WORDS.OPEN_SOURCE}>
            <button type="button" className="draft-fork-quote" onClick={open}>
              {quote}
            </button>
          </Tooltip>
        )}
        <Tooltip label={FORK_WORDS.DROP}>
          <button
            type="button"
            className="draft-fork-drop"
            aria-label={FORK_WORDS.DROP}
            onClick={onDrop}
          >
            <XIcon className="size-3.5" aria-hidden="true" />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
