import type { CodingAgentPullRequestAnswerView } from "@luke/features/coding-agent-view";
import type {
  CodingAgentMessage,
  CodingAgentPullRequest,
  CodingAgentPullRequestAnswer,
  CodingAgentStatus,
  CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import type { TaskPullRequestLine } from "@luke/features/task-wire";
import { keepIdentity } from "@luke/wire";
import * as Atom from "effect/reactivity/Atom";
import { useCallback, useEffect, useRef, useState } from "react";
import { APP_SLICE, useAppSlice } from "../use-app-state.js";
import { agentStillWriting, PUBLISHED_REREAD_MS } from "./coding-agent-model.js";

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
 * The task keeps every answer beside its agents (`useTaskPullRequests`), so
 * the side panel's "+", the task's summary, and ⌘K offer an agent's Changes
 * tab exactly while it has a pull request, its tab open or not.
 *
 * An open Pull request tab also follows the line the task list pushes of its
 * pull request (`usePushedLineMoved`), reading again as that line moves.
 */

/** How one read is asked: the agent, answered as the view hears it. */
export type PullRequestReader = (agentId: string) => Promise<CodingAgentPullRequestAnswerView>;

interface Held {
  agentId: string;
  published: CodingAgentPullRequestAnswer | undefined;
  /** Whether a read for the agent has answered, a refusal among them. */
  settled: boolean;
}

/** What the tab draws of what the agent published, and whether that is settled for its first draw. */
export interface AgentPublished {
  /** What a read answered, else the pull request the task already knows of the agent; nothing before either. */
  readonly published: CodingAgentPullRequestAnswer | undefined;
  /** Whether what is drawn will not appear later: a read answered, or the task already knew the pull request. */
  readonly settled: boolean;
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
  /** The pull request the task's own read already holds for the agent (`TaskPullRequests`), drawn until the tab's read answers. */
  known?: CodingAgentPullRequest | undefined;
  /** The clock the gap between reads is measured on. */
  now?: () => number;
}): AgentPublished {
  const { agentId, status, shown, messages, read, known } = input;
  const now = input.now ?? (() => Date.now());
  const [held, setHeld] = useState<Held>({ agentId, published: undefined, settled: false });
  if (held.agentId !== agentId) setHeld({ agentId, published: undefined, settled: false });
  const latest = useRef({ read, now });
  latest.current = { read, now };
  const last = useRef<{ agentId: string; read: LastRead | undefined }>({
    agentId,
    read: undefined,
  });
  if (last.current.agentId !== agentId) last.current = { agentId, read: undefined };
  // Each read asked, numbered, so only the latest one's answer is kept.
  const asks = useRef(0);
  const ended = !agentStillWriting(status);

  useEffect(() => {
    // A tab put out of sight lets go of the read it has out, whose answer may
    // land after a newer one the plan read, and asks afresh when it is next
    // shown, whatever the gap, so it never comes back on the older answer.
    if (!shown) {
      asks.current += 1;
      last.current = { agentId, read: undefined };
      return;
    }
    const before = last.current.read;
    const forced = ended && (before === undefined || !before.ended);
    const at = latest.current.now();
    if (!forced && before !== undefined && at - before.at < PUBLISHED_REREAD_MS) return;
    last.current = { agentId, read: { at, ended } };
    asks.current += 1;
    const ask = asks.current;
    // Note that the answer is kept by its ask, never dropped as the effect
    // runs again, because a transcript page landing while the read is out
    // runs it again inside the gap, which asks nothing, and the answer
    // dropped would leave the chip unshown until the next page.
    // Note that a refusal settles the read too, so a tab waiting on it to draw never waits for good.
    const refused = () =>
      setHeld((was) => (was.agentId === agentId && !was.settled ? { ...was, settled: true } : was));
    latest.current.read(agentId).then((answer) => {
      if (ask !== asks.current) return;
      if ("failure" in answer) return refused();
      setHeld((was) =>
        was.agentId === agentId ? { agentId, published: answer, settled: true } : was,
      );
    }, refused);
  }, [agentId, shown, ended, messages]);

  const own = held.agentId === agentId ? held : undefined;
  const published =
    own?.published ??
    (known === undefined ? undefined : { repository: null, branch: null, pullRequest: known });
  return { published, settled: own?.settled === true || known !== undefined };
}

/** The task's agents' pull requests, and the reader that keeps them as its answers land. */
export interface TaskPullRequests {
  /** Each agent's pull request, by agent, of those whose latest read named one. */
  readonly pullRequests: ReadonlyMap<string, CodingAgentPullRequest>;
  /** One read of what an agent published, its answer kept here as it lands. */
  readonly read: PullRequestReader;
}

/** No agent has a pull request, one map so a render that has none hands down the same one. */
const NO_PULL_REQUESTS: ReadonlyMap<string, CodingAgentPullRequest> = new Map();

/** What one visit to a task has read: each agent's pull request, and the asks behind them. */
interface Visit {
  readonly taskId: string | undefined;
  /** Each agent read on its own, by whether it had ended when it was asked. */
  readonly asked: Map<string, boolean>;
  /** Each agent's latest ask, numbered, whose answer alone is kept. */
  readonly latest: Map<string, number>;
}

/**
 * Which of the task's agents have a pull request, as the side panel's "+",
 * the task's summary, and ⌘K offer its Changes tab by: every answer `read`
 * lands is kept, an agent's own tab's reads included, and each agent is
 * read once as the list first holds it and once more as it ends, since that
 * is when what it published settles. Nothing reads on a clock. An answer the
 * service could not give leaves what was kept standing. Note that what is
 * kept is the visit's: opening the task again reads every agent afresh, an
 * answer to an ask made on an earlier visit is let go, and of two asks of
 * one agent out at once only the later one's answer is kept, so an earlier
 * read landing late never takes back a pull request a later one found. An
 * agent of another task, asked through `read` as a card naming it may, is
 * answered but never kept, and an answer naming the pull request already
 * kept leaves what is kept as it stood, so neither redraws the task.
 */
export function useTaskPullRequests(
  taskId: string | undefined,
  agents: readonly Pick<CodingAgentSummary, "id" | "status">[] | undefined,
  readOnce: PullRequestReader,
  /** Every agent of the task, an archived one among them, which alone its pull requests are kept for; `agents` where left out. */
  owned: readonly Pick<CodingAgentSummary, "id">[] | undefined = agents,
): TaskPullRequests {
  const [held, setHeld] = useState({ taskId, pullRequests: NO_PULL_REQUESTS });
  if (held.taskId !== taskId) setHeld({ taskId, pullRequests: NO_PULL_REQUESTS });
  const latest = useRef(readOnce);
  latest.current = readOnce;
  // The task's own agents, by id, which alone its pull requests are kept for.
  const own = useRef<ReadonlySet<string>>(new Set());
  own.current = new Set((owned ?? []).map((agent) => agent.id));
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
      // Note that an agent of another task is answered but never kept, so
      // the task's pull requests name its own agents alone.
      if (!own.current.has(agentId)) return answer;
      const opened = answer.pullRequest;
      setHeld((was) => {
        if (was.taskId !== on.taskId) return was;
        const kept = was.pullRequests.get(agentId);
        if (opened === null && kept === undefined) return was;
        // Note that an answer naming the pull request already kept keeps the
        // map as it stood, so nothing drawn from it is drawn again.
        if (opened !== null && kept !== undefined && keepIdentity(kept, opened) === kept) {
          return was;
        }
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

/**
 * The line the task list holds of the pull request at `url`, as the service
 * last pushed it, on whichever task names it; none where no task does. The
 * document keeps a line's identity while it does not move, so its reader is
 * drawn again only as it does.
 */
const pushedLineAtom = Atom.family((url: string) =>
  Atom.map(APP_SLICE.TASKS, (tasks): TaskPullRequestLine | undefined => {
    for (const task of tasks?.tasks ?? []) {
      const line = task.agents?.pullRequests.find((each) => each.url === url);
      if (line !== undefined) return line;
    }
    return undefined;
  }),
);

/** No pull request is known yet, whose line no task holds. */
const NO_URL = "";

/** Whether two pushes of one pull request's line say the same of where it stands: open or not, its checks, and the merge queue. */
function samePushed(was: TaskPullRequestLine, now: TaskPullRequestLine): boolean {
  return was.state === now.state && was.checks === now.checks && was.queued === now.queued;
}

/**
 * Runs `reread` as the pushed line of the pull request at `url` moves, its
 * state, checks, or place in the merge queue, or its leaving the list, so an open tab draws what
 * GitHub says now rather than what it read as it was first shown. The first
 * line seen is where the tab's own reads started from, and asks nothing; a
 * line that moved while the tab was out of sight asks once it is shown
 * again. Note that it follows the push rather than a clock, because the
 * service keeps its answer a short while and a read sooner would only
 * repeat it.
 */
export function usePushedLineMoved(
  url: string | undefined,
  shown: boolean,
  reread: () => void,
): void {
  const line = useAppSlice(pushedLineAtom(url ?? NO_URL));
  const latest = useRef(reread);
  latest.current = reread;
  // The line as the tab last read on it.
  const seen = useRef<TaskPullRequestLine | undefined>(undefined);

  useEffect(() => {
    if (!shown) return;
    const was = seen.current;
    seen.current = line;
    // Note that a line gone from the list moved too, because the list holds
    // only a few, the open first, so a pull request that merged can fall out
    // of it as it merges.
    if (was === undefined || was.url !== url) return;
    if (line !== undefined && samePushed(was, line)) return;
    latest.current();
  }, [shown, line, url]);
}
