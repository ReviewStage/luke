import type { AgentPullRequestAnswerView } from "@luke/features/agent-view";
import type {
  AgentPullRequest,
  AgentPullRequestAnswer,
  AgentStatus,
  AgentTranscriptMessage,
} from "@luke/features/agent-wire";
import type { ListedPullRequest, TaskPullRequestLine } from "@luke/features/task-wire";
import * as Atom from "effect/reactivity/Atom";
import { useEffect, useMemo, useRef, useState } from "react";
import { APP_SLICE, useAppSlice } from "../use-app-state.js";
import { agentStillWriting, PUBLISHED_REREAD_MS } from "./agent-model.js";

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
 * The task list carries every agent's pull request beside its agents
 * (`useListedPullRequests`), so the side panel's "+", the task's summary,
 * and ⌘K offer an agent's Changes tab exactly while it has a pull request,
 * its tab open or not.
 *
 * An open Pull request tab also follows the line the task list pushes of its
 * pull request (`usePushedLineMoved`), reading again as that line moves.
 */

/** How one read is asked: the agent, answered as the view hears it. */
export type PullRequestReader = (agentId: string) => Promise<AgentPullRequestAnswerView>;

interface Held {
  agentId: string;
  published: AgentPullRequestAnswer | undefined;
}

/** What the tab draws of what the agent published. */
export interface AgentPublished {
  /** What a read answered, else the pull request the task already knows of the agent; nothing before either. */
  readonly published: AgentPullRequestAnswer | undefined;
}

/** The last read out or landed: when, and for which standing of the agent. */
interface LastRead {
  at: number;
  ended: boolean;
}

export function useAgentPullRequest(input: {
  agentId: string;
  status: AgentStatus;
  /** Whether the tab is on screen. */
  shown: boolean;
  /** The transcript as held, whose every change is a page landed. */
  messages: readonly AgentTranscriptMessage[];
  read: PullRequestReader;
  /** The pull request the task list already carries for the agent (`useListedPullRequests`), drawn until the tab's read answers. */
  known?: AgentPullRequest | undefined;
  /** The clock the gap between reads is measured on. */
  now?: () => number;
}): AgentPublished {
  const { agentId, status, shown, messages, read, known } = input;
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
    latest.current.read(agentId).then(
      (answer) => {
        if (ask !== asks.current || "failure" in answer) return;
        setHeld((was) => (was.agentId === agentId ? { agentId, published: answer } : was));
      },
      () => undefined,
    );
  }, [agentId, shown, ended, messages]);

  const own = held.agentId === agentId ? held : undefined;
  const published =
    own?.published ??
    (known === undefined ? undefined : { repository: null, branch: null, pullRequest: known });
  return { published };
}

/** No agent has a pull request, one map so a render that has none hands down the same one. */
const NO_PULL_REQUESTS: ReadonlyMap<string, AgentPullRequest> = new Map();

/** Whose agents' pull requests: a plan's, or one agent's on no task, by its id. */
export type PullRequestHolder = { readonly taskId: string } | { readonly agentId: string };

/**
 * Which of a plan's agents have a pull request, or whether the one agent on
 * no task given has, as the side panel's "+", the task's summary, and ⌘K
 * offer its Changes tab by: what the task list carries of each (`listed`),
 * as the service last read it on GitHub, archived agents among them, so
 * choosing a task, or an item of it, reads nothing. An agent's own tab still
 * reads what it published as it shows (`useAgentPullRequest`), and that read
 * is written on the agent's row, which the list then carries. Note that the
 * map is built again only as the list's pull requests move, since the
 * document keeps their identity while none does, so nothing drawn from it is
 * drawn again.
 */
export function useListedPullRequests(
  listed: readonly ListedPullRequest[] | undefined,
  holder: PullRequestHolder | undefined,
): ReadonlyMap<string, AgentPullRequest> {
  const taskId = holder !== undefined && "taskId" in holder ? holder.taskId : undefined;
  const agentId = holder !== undefined && "agentId" in holder ? holder.agentId : undefined;
  return useMemo(() => {
    const own = (listed ?? []).filter((each) =>
      taskId !== undefined ? each.taskId === taskId : each.agentId === agentId,
    );
    if (own.length === 0) return NO_PULL_REQUESTS;
    return new Map(own.map((each) => [each.agentId, each.pullRequest]));
  }, [listed, taskId, agentId]);
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
