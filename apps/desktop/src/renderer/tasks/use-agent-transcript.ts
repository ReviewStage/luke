import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentMessagesAnswerView,
  type CodingAgentMessagesParams,
} from "@luke/features/coding-agent-view";
import {
  applyMessagesPage,
  CODING_AGENT_CURSOR_START,
  type CodingAgentContext,
  type CodingAgentFailure,
  type CodingAgentMessage,
  type CodingAgentStatus,
  type CodingAgentSubagentStanding,
  type CodingAgentUsage,
} from "@luke/features/coding-agent-wire";
import { useCallback, useEffect, useRef, useState } from "react";
import { type AgentRun, agentStillWriting, followsAgent } from "./coding-agent-model";

/**
 * use-agent-transcript.ts -- one agent's transcript, or one of its workers', as its tab draws it, read page by page on the service's held long-poll while the agent may still write.
 *
 * The service holds a read open while the agent is starting or runs and
 * nothing new stands past the cursor, and lets it go at its own hold, so
 * the loop here is one read after another with no clock of its own: each
 * answer's cursor is where the next read starts, each page joins the
 * messages held by id, and each page's status is the agent's as the page
 * was read, with why where its turn failed, which the tab's end line says,
 * what its model's context holds, which the box's ring draws, and when its
 * run and each worker it waits on began, which the working line and a
 * subagent's row count from.
 * The loop runs while the tab is on screen and the agent may
 * still write, and ends on its own when a page says the agent ended; an
 * agent that has ended is read once through, page by page, and then left
 * alone. A read that did not answer ends the loop and says so, with Try
 * again, rather than asking again at once. A worker's transcript is read
 * the same way under the agent and the delegation call that started it,
 * and where the worker stands is what its pages say.
 */

/** How one read is asked: the agent, the cursor to read past, and the worker's call where it is a worker's, answered as the view hears it. */
export type TranscriptReader = (
  params: CodingAgentMessagesParams,
) => Promise<CodingAgentMessagesAnswerView>;

/** What the tab draws of the transcript. */
export interface AgentTranscriptControl {
  messages: readonly CodingAgentMessage[];
  /** Why the agent's newest turn failed, as the last page said; nothing while it did not. */
  failure: CodingAgentFailure | undefined;
  /** What the agent has cost over every turn it settled, its workers' included, as the last page said; nothing before one settled. */
  usage: CodingAgentUsage | undefined;
  /** What the agent's model's context holds as its newest step left it, as the last page said; nothing before a step ended, and on a worker's. */
  context: CodingAgentContext | undefined;
  /** When the run under way began, as the last page said; nothing where it did not, which is where a worker's tab counts from. */
  runStartedAt: number | undefined;
  /** Where the agent, or the worker, stood as the last page said; nothing before one landed. */
  pageStatus: CodingAgentStatus | undefined;
  /** Whether the last page read came back with nothing more on it, so every message written by then is read. */
  caughtUp: boolean;
  /** How many pages have been read, which an ask counts from to know a page landed after it. */
  pages: number;
  /** What the agent, or the worker, is titled as the last page said; nothing before one landed or a title did. */
  pageTitle: string | undefined;
  /** The title of each of the agent's workers that has one, by the call that started it, as the last page said; none on a worker's. */
  subagentTitles: ReadonlyMap<string, string>;
  /** When each worker the agent's newest turn still waits on began, by the call that started it, as the last page said; none on a worker's. */
  delegations: ReadonlyMap<string, number>;
  /** Where each of the agent's workers stands, by the call that started it, as its own session reads and the last page said; none on a worker's, and from a service older than it. */
  subagents: ReadonlyMap<string, CodingAgentSubagentStanding>;
  /** Whether a read is out, with nothing held yet to draw. */
  reading: boolean;
  /** Whether the last read did not answer, so the tab offers to try again. */
  failed: boolean;
  onRetry: () => void;
}

interface Held {
  agentId: string;
  messages: readonly CodingAgentMessage[];
  cursor: string;
  failure: CodingAgentFailure | undefined;
  usage: CodingAgentUsage | undefined;
  context: CodingAgentContext | undefined;
  runStartedAt: number | undefined;
  pageStatus: CodingAgentStatus | undefined;
  /** Whether the last page read came back with nothing more on it, so every message written by then is read. */
  caughtUp: boolean;
  /** How many pages have been read, which an ask counts from to know a page landed after it. */
  pages: number;
  pageTitle: string | undefined;
  subagentTitles: ReadonlyMap<string, string>;
  delegations: ReadonlyMap<string, number>;
  subagents: ReadonlyMap<string, CodingAgentSubagentStanding>;
  failed: boolean;
}

function fresh(agentId: string): Held {
  return {
    agentId,
    messages: [],
    cursor: CODING_AGENT_CURSOR_START,
    failure: undefined,
    usage: undefined,
    context: undefined,
    runStartedAt: undefined,
    pageStatus: undefined,
    caughtUp: false,
    pages: 0,
    pageTitle: undefined,
    subagentTitles: new Map(),
    delegations: new Map(),
    subagents: new Map(),
    failed: false,
  };
}

/**
 * The map a page read, or the one held where the page read it alike: each
 * page answers the agent's workers whole, mostly as they stood, and a map
 * kept as it was asks nothing that reads it to be drawn again.
 */
function keptIfSame<V>(
  held: ReadonlyMap<string, V>,
  read: readonly (readonly [string, V])[],
  same: (a: V, b: V) => boolean,
): ReadonlyMap<string, V> {
  const unchanged =
    held.size === read.length &&
    read.every(([key, value]) => {
      const was = held.get(key);
      return was !== undefined && same(was, value);
    });
  return unchanged ? held : new Map(read);
}

/** Whether two readings of a worker say it stands alike. */
function sameStanding(a: CodingAgentSubagentStanding, b: CodingAgentSubagentStanding): boolean {
  return (
    a.callId === b.callId &&
    a.status === b.status &&
    a.model === b.model &&
    a.effort === b.effort &&
    a.startedAt === b.startedAt
  );
}

export function useAgentTranscript(input: {
  agentId: string;
  /** The delegation call whose worker's transcript this is, where it is a worker's rather than the agent's own. */
  callId?: string | undefined;
  /** The agent's, or the worker's, status as the tab knows it, which the pages read keep current through `onStatus`. */
  status: CodingAgentStatus;
  /** Whether the tab is on screen: the panel open on it, on the Tasks tab. */
  shown: boolean;
  read: TranscriptReader;
  /** A page said where the agent stands now, and since when, which is newer than the list. */
  onStatus: (agentId: string, run: AgentRun) => void;
  /** A page said what the agent is titled now, which the list may have read before the title landed. */
  onTitle: (agentId: string, title: string | null) => void;
}): AgentTranscriptControl {
  const { agentId, callId, status, shown, read, onStatus, onTitle } = input;
  const [held, setHeld] = useState<Held>(() => fresh(agentId));
  // Note that another agent's tab starts from nothing of this one's.
  if (held.agentId !== agentId) setHeld(fresh(agentId));
  const [attempt, setAttempt] = useState(0);
  const latest = useRef({ read, onStatus, onTitle });
  latest.current = { read, onStatus, onTitle };
  const cursor = useRef(CODING_AGENT_CURSOR_START);
  if (held.agentId !== agentId) cursor.current = CODING_AGENT_CURSOR_START;
  // Whether this agent has been read through once: an ended agent is read
  // once, page by page, and a running one for as long as it writes.
  const readThrough = useRef<string | undefined>(undefined);

  const following = followsAgent({ shown, status });
  const once = shown && !following && readThrough.current !== agentId;
  const active = (following || once) && !held.failed;

  useEffect(() => {
    if (!active) return;
    let live = true;
    const loop = async () => {
      while (live) {
        const answer = await latest.current
          .read({
            agentId,
            after: cursor.current,
            ...(callId === undefined ? undefined : { callId }),
          })
          .catch(
            (): CodingAgentMessagesAnswerView => ({
              failure: CODING_AGENT_CALL_FAILURE.UNANSWERED,
            }),
          );
        if (!live) return;
        if ("failure" in answer) {
          setHeld((was) => ({ ...was, failed: true }));
          return;
        }
        cursor.current = answer.cursor;
        setHeld((was) => ({
          ...was,
          messages: applyMessagesPage(was.messages, answer.messages),
          cursor: answer.cursor,
          failure: answer.failureReason,
          usage: answer.usage,
          context: answer.context,
          runStartedAt: answer.runStartedAt,
          pageStatus: answer.status,
          caughtUp: answer.messages.length === 0,
          pages: was.pages + 1,
          pageTitle: answer.title ?? undefined,
          subagentTitles: keptIfSame(
            was.subagentTitles,
            (answer.subagentTitles ?? []).map((titled) => [titled.callId, titled.title]),
            Object.is,
          ),
          delegations: keptIfSame(
            was.delegations,
            (answer.delegations ?? []).map((started) => [started.callId, started.startedAt]),
            Object.is,
          ),
          subagents: keptIfSame(
            was.subagents,
            (answer.subagents ?? []).map((standing) => [standing.callId, standing]),
            sameStanding,
          ),
        }));
        latest.current.onStatus(agentId, answer);
        latest.current.onTitle(agentId, answer.title);
        // A page with nothing on it from an agent that may still write is
        // the hold letting go: ask again. One from an agent that ended is
        // the end of the transcript, once no worker of its own session still
        // reads as working, since a worker stopped with its agent may settle
        // a look after it and its row would stand running.
        const workerStillWriting = (answer.subagents ?? []).some((standing) =>
          agentStillWriting(standing.status),
        );
        if (
          answer.messages.length === 0 &&
          !agentStillWriting(answer.status) &&
          !workerStillWriting
        ) {
          readThrough.current = agentId;
          return;
        }
      }
    };
    void loop();
    return () => {
      live = false;
    };
  }, [active, agentId, callId, attempt]);

  const onRetry = useCallback(() => {
    setHeld((was) => ({ ...was, failed: false }));
    setAttempt((count) => count + 1);
  }, []);

  return {
    messages: held.messages,
    failure: held.failure,
    usage: held.usage,
    context: held.context,
    runStartedAt: held.runStartedAt,
    pageStatus: held.pageStatus,
    caughtUp: held.caughtUp,
    pages: held.pages,
    pageTitle: held.pageTitle,
    subagentTitles: held.subagentTitles,
    delegations: held.delegations,
    subagents: held.subagents,
    reading: active && held.messages.length === 0,
    failed: held.failed,
    onRetry,
  };
}
