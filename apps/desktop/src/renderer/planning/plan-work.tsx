import type { TurnRecord } from "@sidecar/hosted/coding-agent-wire";
import type { CatalogModel } from "@sidecar/hosted/models-wire";
import { PLAN_WORK_STATE } from "@sidecar/hosted/planning-view";
import { AgentTranscriptView, WORKER_LEAD } from "./agent-tab";
import { workerLines } from "./coding-agent-model";
import { type WorkWorkerBlock, workerJob, workFailed } from "./work-model";

/**
 * plan-work.tsx -- a planning subagent's tab: the session of a worker Luke started on a call, drawn with a coding agent's own transcript.
 *
 * Luke's turns themselves are drawn in the Call tab (`plan-call.tsx`), each
 * worker there the subagent's row an agent's delegation is, one button that
 * opens its session in a tab of the panel's own, or chooses that tab where
 * it is open. That tab is a worker's transcript as an agent's worker's tab
 * draws it (`AgentTranscriptView`): the task a card at the top, a
 * shimmering line at the end while the subagent runs, a quiet one where it
 * stopped or failed, and follows it while the subagent runs. Everything
 * here is the planning model's or the developer's repository's, a command's
 * output included, so the root is left out of the screen recording
 * (`ph-no-capture`) as a second line behind its text masking.
 */

/** What a subagent's session that ended without answering says, by whether it failed (`workFailed`). */
const ENDED_WORD = {
  STOPPED: "Stopped",
  FAILED: "Failed",
} as const;

/** What a subagent's session that ended having recorded nothing says in place of its rows. */
const NOTHING_RECORDED = "Nothing recorded.";

/** What work that ended without answering says it did, as its record says it ended. */
function endedWord(record: TurnRecord | undefined): string {
  return workFailed(record) ? ENDED_WORD.FAILED : ENDED_WORD.STOPPED;
}

/**
 * A subagent's session in a tab of the panel's own, drawn as an agent's
 * worker's tab draws its transcript (`AgentTranscriptView`): the task it was
 * handed as a card at the top, its job on the card's line and the whole
 * message once opened; its session as one of its messages; and at the end a
 * shimmering line while it runs, "Starting…" until its session draws its
 * first part and "Working…" after, counting from when its task began, or
 * once it has finished a quiet line saying how long it worked and when it
 * ended, and one saying so where it stopped or failed, or that it recorded
 * nothing. The tab's own label names the task, so no head repeats it. The
 * worker is read from the plan's work on every frame, so the tab follows
 * the session while the subagent runs.
 */
export function SubagentTab({
  worker,
  shown,
  models,
}: {
  worker: WorkWorkerBlock;
  /** Whether the tab is on screen, which is when a running subagent's line counts how long it has worked. */
  shown: boolean;
  /** The catalog as last read, which names the model its finished line's card says; none before the first read lands. */
  models?: readonly CatalogModel[] | undefined;
}): React.JSX.Element {
  const { call, task, session } = worker;
  const recorded = session !== undefined && session.message.parts.length > 0;
  // A session that ended is drawn even with nothing recorded, so its end still says how long it worked and on what.
  const drawn = recorded || session?.message.finishedAt !== undefined ? session : undefined;
  // A session whose own task failed says so even where the planning model answered its call and went on.
  const ended =
    call.running || (call.state !== PLAN_WORK_STATE.FAILED && !workFailed(session?.record))
      ? undefined
      : endedWord(session?.record);
  return (
    <section className="agent-tab ph-no-capture" aria-label={workerJob(call)}>
      <AgentTranscriptView
        briefTitle={workerJob(call)}
        messages={workerLines(task, drawn === undefined ? [] : [drawn.message])}
        lead={WORKER_LEAD}
        delegation={{ models }}
        reading={false}
        failed={false}
        working={call.running}
        startedAt={shown ? session?.startedAt : undefined}
        ended={ended ?? (call.running || recorded ? undefined : NOTHING_RECORDED)}
        onRetry={() => undefined}
        earlierOmitted={session?.earlierOmitted ?? false}
      />
    </section>
  );
}
