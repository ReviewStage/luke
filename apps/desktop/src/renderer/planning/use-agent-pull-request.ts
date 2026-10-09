import type { CodingAgentPullRequestAnswerView } from "@sidecar/hosted/coding-agent-view";
import type {
  CodingAgentMessage,
  CodingAgentPullRequestAnswer,
  CodingAgentStatus,
} from "@sidecar/hosted/coding-agent-wire";
import { useEffect, useRef, useState } from "react";
import { agentStillWriting, PUBLISHED_REREAD_MS } from "./coding-agent-model";

/**
 * use-agent-pull-request.ts -- what one agent published, as its tab draws it: read when the tab shows, again as its transcript lands pages, and once more as the agent ends.
 *
 * The service keeps its own answer a short while, so the reads here follow
 * what the tab already hears rather than a clock of their own: one as the
 * tab comes on screen, one as each page of the transcript lands while the
 * agent may still write, no two closer than `PUBLISHED_REREAD_MS` (the
 * next page asks again), and one the moment a page says the agent ended,
 * whatever the gap, since that is when the pull request it opened is most
 * worth showing. An answer the service could not give leaves what was
 * drawn standing; another agent's tab starts from nothing of this one's.
 */

/** How one read is asked: the agent, answered as the view hears it. */
export type PullRequestReader = (agentId: string) => Promise<CodingAgentPullRequestAnswerView>;

interface Held {
  agentId: string;
  published: CodingAgentPullRequestAnswer | undefined;
}

/** The last read out or landed: when, and for which standing of the agent. */
interface LastRead {
  at: number;
  ended: boolean;
}

export function useAgentPullRequest(input: {
  agentId: string;
  status: CodingAgentStatus;
  /** Whether the tab is on screen. */
  shown: boolean;
  /** The transcript as held, whose every change is a page landed. */
  messages: readonly CodingAgentMessage[];
  read: PullRequestReader;
  /** The clock the gap between reads is measured on. */
  now?: () => number;
}): CodingAgentPullRequestAnswer | undefined {
  const { agentId, status, shown, messages, read } = input;
  const now = input.now ?? (() => Date.now());
  const [held, setHeld] = useState<Held>({ agentId, published: undefined });
  if (held.agentId !== agentId) setHeld({ agentId, published: undefined });
  const latest = useRef({ read, now });
  latest.current = { read, now };
  const last = useRef<{ agentId: string; read: LastRead | undefined }>({
    agentId,
    read: undefined,
  });
  if (last.current.agentId !== agentId) last.current = { agentId, read: undefined };
  const ended = !agentStillWriting(status);

  useEffect(() => {
    if (!shown) return;
    const before = last.current.read;
    const forced = ended && (before === undefined || !before.ended);
    const at = latest.current.now();
    if (!forced && before !== undefined && at - before.at < PUBLISHED_REREAD_MS) return;
    last.current = { agentId, read: { at, ended } };
    let live = true;
    latest.current.read(agentId).then(
      (answer) => {
        if (live && !("failure" in answer)) {
          setHeld((was) => (was.agentId === agentId ? { agentId, published: answer } : was));
        }
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [agentId, shown, ended, messages]);

  return held.agentId === agentId ? held.published : undefined;
}
