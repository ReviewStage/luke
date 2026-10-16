import type { CodingAgentPullRequestAnswerView } from "@luke/features/coding-agent-view";
import type {
  CodingAgentMessage,
  CodingAgentPullRequest,
  CodingAgentPullRequestAnswer,
  CodingAgentStatus,
  CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
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
 * The plan keeps every answer beside its agents (`useTaskPullRequests`), so
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
export interface TaskPullRequests {
  /** Each agent's pull request, by agent, of those whose latest read named one. */
  readonly pullRequests: ReadonlyMap<string, CodingAgentPullRequest>;
  /** One read of what an agent published, its answer kept here as it lands. */
  readonly read: PullRequestReader;
}

/** No agent has a pull request, one map so a render that has none hands down the same one. */
const NO_PULL_REQUESTS: ReadonlyMap<string, CodingAgentPullRequest> = new Map();

/** What one visit to a plan has read: each agent's pull request, and the asks behind them. */
interface Visit {
  readonly taskId: string | undefined;
  /** Each agent read on its own, by whether it had ended when it was asked. */
  readonly asked: Map<string, boolean>;
  /** Each agent's latest ask, numbered, whose answer alone is kept. */
  readonly latest: Map<string, number>;
}

/**
 * Which of the plan's agents have a pull request, as the side panel's "+",
 * the plan's summary, and ⌘K offer its Changes tab by: every answer `read`
 * lands is kept, an agent's own tab's reads included, and each agent is
 * read once as the list first holds it and once more as it ends, since that
 * is when what it published settles. Nothing reads on a clock. An answer the
 * service could not give leaves what was kept standing. Note that what is
 * kept is the visit's: opening the plan again reads every agent afresh, an
 * answer to an ask made on an earlier visit is let go, and of two asks of
 * one agent out at once only the later one's answer is kept, so an earlier
 * read landing late never takes back a pull request a later one found.
 */
export function useTaskPullRequests(
  taskId: string | undefined,
  agents: readonly Pick<CodingAgentSummary, "id" | "status">[] | undefined,
  readOnce: PullRequestReader,
): TaskPullRequests {
  const [held, setHeld] = useState({ taskId, pullRequests: NO_PULL_REQUESTS });
  if (held.taskId !== taskId) setHeld({ taskId, pullRequests: NO_PULL_REQUESTS });
  const latest = useRef(readOnce);
  latest.current = readOnce;
  const visit = useRef<Visit>({ taskId, asked: new Map(), latest: new Map() });
  if (visit.current.taskId !== taskId)
    visit.current = { taskId, asked: new Map(), latest: new Map() };
  const asks = useRef(0);

  const read = useCallback<PullRequestReader>((agentId) => {
    const on = visit.current;
    asks.current += 1;
    const ask = asks.current;
    on.latest.set(agentId, ask);
    return latest.current(agentId).then((answer) => {
      if ("failure" in answer || visit.current !== on || on.latest.get(agentId) !== ask) {
        return answer;
      }
      const opened = answer.pullRequest;
      setHeld((was) => {
        if (was.taskId !== on.taskId) return was;
        if (opened === null && !was.pullRequests.has(agentId)) return was;
        const next = new Map(was.pullRequests);
        if (opened === null) next.delete(agentId);
        else next.set(agentId, opened);
        return { taskId: was.taskId, pullRequests: next };
      });
      return answer;
    });
  }, []);

  useEffect(() => {
    const { asked } = visit.current;
    for (const agent of agents ?? []) {
      const ended = !agentStillWriting(agent.status);
      const before = asked.get(agent.id);
      if (before === true || before === ended) continue;
      asked.set(agent.id, ended);
      read(agent.id).catch(() => undefined);
    }
  }, [agents, read]);

  return { pullRequests: held.taskId === taskId ? held.pullRequests : NO_PULL_REQUESTS, read };
}
