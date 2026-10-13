import type { CodingAgentPullRequestAnswerView } from "@sidecar/hosted/coding-agent-view";
import type {
  CodingAgentMessage,
  CodingAgentPullRequest,
  CodingAgentPullRequestAnswer,
  CodingAgentStatus,
  CodingAgentSummary,
} from "@sidecar/hosted/coding-agent-wire";
import { useCallback, useEffect, useRef, useState } from "react";
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
 *
 * The plan keeps every answer beside its agents (`usePlanPullRequests`), so
 * the side panel's "+", the plan's summary, and ⌘K offer an agent's Changes
 * tab exactly while it has a pull request, its tab open or not.
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

/** The plan's agents' pull requests, and the reader that keeps them as its answers land. */
export interface PlanPullRequests {
  /** Each agent's pull request, by agent, of those whose last read named one. */
  readonly pullRequests: ReadonlyMap<string, CodingAgentPullRequest>;
  /** One read of what an agent published, its answer kept here as it lands. */
  readonly read: PullRequestReader;
}

/** No agent has a pull request, one map so a render that has none hands down the same one. */
const NO_PULL_REQUESTS: ReadonlyMap<string, CodingAgentPullRequest> = new Map();

/**
 * Which of the plan's agents have a pull request, as the side panel's "+",
 * the plan's summary, and ⌘K offer its Changes tab by: every answer `read`
 * lands is kept, an agent's own tab's reads included, and each agent is
 * read once as the list first holds it and once more as it ends, since that
 * is when what it published settles. Nothing reads on a clock. An answer the
 * service could not give leaves what was kept standing.
 */
export function usePlanPullRequests(
  agents: readonly Pick<CodingAgentSummary, "id" | "status">[] | undefined,
  readOnce: PullRequestReader,
): PlanPullRequests {
  const [pullRequests, setPullRequests] = useState(NO_PULL_REQUESTS);
  const latest = useRef(readOnce);
  latest.current = readOnce;
  // Each agent read, by whether it had ended when it was asked.
  const asked = useRef(new Map<string, boolean>());

  const read = useCallback<PullRequestReader>(
    (agentId) =>
      latest.current(agentId).then((answer) => {
        if ("failure" in answer) return answer;
        const opened = answer.pullRequest;
        setPullRequests((was) => {
          if (opened === null && !was.has(agentId)) return was;
          const next = new Map(was);
          if (opened === null) next.delete(agentId);
          else next.set(agentId, opened);
          return next;
        });
        return answer;
      }),
    [],
  );

  useEffect(() => {
    for (const agent of agents ?? []) {
      const ended = !agentStillWriting(agent.status);
      const before = asked.current.get(agent.id);
      if (before === true || before === ended) continue;
      asked.current.set(agent.id, ended);
      read(agent.id).catch(() => undefined);
    }
  }, [agents, read]);

  return { pullRequests, read };
}
