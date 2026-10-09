import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentMessagesAnswerView,
} from "@sidecar/hosted/coding-agent-view";
import {
  CODING_AGENT_CURSOR_START,
  type CodingAgentMessage,
  type CodingAgentStatus,
} from "@sidecar/hosted/coding-agent-wire";
import { useCallback, useEffect, useRef, useState } from "react";
import { agentStillWriting, applyMessagesPage, followsAgent } from "./coding-agent-model";

/**
 * use-agent-transcript.ts -- one agent's transcript as its tab draws it, read page by page on the service's held long-poll while the agent may still write.
 *
 * The service holds a read open while the agent is starting or runs and
 * nothing new stands past the cursor, and lets it go at its own hold, so
 * the loop here is one read after another with no clock of its own: each
 * answer's cursor is where the next read starts, each page joins the
 * messages held by id, and each page's status is the agent's as the page
 * was read. The loop runs while the tab is on screen and the agent may
 * still write, and ends on its own when a page says the agent ended; an
 * agent that has ended is read once through, page by page, and then left
 * alone. A read that did not answer ends the loop and says so, with Try
 * again, rather than asking again at once.
 */

/** How one read is asked: the agent and the cursor to read past, answered as the view hears it. */
export type TranscriptReader = (
  agentId: string,
  after: string,
) => Promise<CodingAgentMessagesAnswerView>;

/** What the tab draws of the transcript. */
export interface AgentTranscriptControl {
  messages: readonly CodingAgentMessage[];
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
  failed: boolean;
}

function fresh(agentId: string): Held {
  return { agentId, messages: [], cursor: CODING_AGENT_CURSOR_START, failed: false };
}

export function useAgentTranscript(input: {
  agentId: string;
  /** The agent's status as the tab knows it, which the pages read keep current through `onStatus`. */
  status: CodingAgentStatus;
  /** Whether the tab is on screen: the panel open on it, on the Plans tab. */
  shown: boolean;
  read: TranscriptReader;
  /** A page said where the agent stands now, which is newer than the list. */
  onStatus: (agentId: string, status: CodingAgentStatus) => void;
}): AgentTranscriptControl {
  const { agentId, status, shown, read, onStatus } = input;
  const [held, setHeld] = useState<Held>(() => fresh(agentId));
  // Note that another agent's tab starts from nothing of this one's.
  if (held.agentId !== agentId) setHeld(fresh(agentId));
  const [attempt, setAttempt] = useState(0);
  const latest = useRef({ read, onStatus });
  latest.current = { read, onStatus };
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
        const answer = await latest.current.read(agentId, cursor.current).catch(
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
        }));
        latest.current.onStatus(agentId, answer.status);
        // A page with nothing on it from an agent that may still write is
        // the hold letting go: ask again. One from an agent that ended is
        // the end of the transcript.
        if (answer.messages.length === 0 && !agentStillWriting(answer.status)) {
          readThrough.current = agentId;
          return;
        }
      }
    };
    void loop();
    return () => {
      live = false;
    };
  }, [active, agentId, attempt]);

  const onRetry = useCallback(() => {
    setHeld((was) => ({ ...was, failed: false }));
    setAttempt((count) => count + 1);
  }, []);

  return {
    messages: held.messages,
    reading: active && held.messages.length === 0,
    failed: held.failed,
    onRetry,
  };
}
