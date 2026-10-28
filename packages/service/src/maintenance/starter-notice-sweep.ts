/**
 * starter-notice-sweep.ts -- the scheduled sweep's line to an agent's starter, when the agent it started ends without finishing.
 *
 * An agent another coding agent started reports back to it by message; one
 * whose turn failed or was stopped, or that was archived, never will, and
 * the starter, which only takes a turn when a message reaches it, would wait
 * on it until a person noticed. So each such ending
 * (`@luke/database/models/starter-notices`) is handed to the starter within
 * the sweep's minute as one line from Luke naming the agent and what
 * happened, the one way a message reaches an agent (`steerAgent`).
 *
 * The line goes under the ending's own key, the turn's id or the archived
 * agent's, so one that landed is never sent again, and one refused or cut
 * off is due again next minute until the window has passed. Each call is
 * bounded so the sweep's minute holds.
 */

import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import { readAgent } from "@luke/database/models/agent-store";
import {
  type DueStarterNotice,
  dueStarterNotices,
  STARTER_NOTICE_ENDING,
} from "@luke/database/models/starter-notices";
import { LUKE_LINE_METADATA, storeWriter } from "@luke/database/models/writer";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import { AGENT_TOOL } from "@luke/features/agent-tools";
import { MENTION_KIND } from "@luke/features/mention-link";
import { agentName } from "@luke/features/model-label";
import { Duration, Effect, Option, type Schema } from "effect";
import type { HttpClient } from "effect/http";
import { steerAgent } from "../agents/coder-host/steer.js";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { workspaceStepOf, writtenMention } from "../agents/written-mentions.js";
import type { EveForAccount } from "../automations/automation-runs.js";
import type { GitHubApp } from "../github/github-app.js";

const STARTER_NOTICE_SWEEP = {
  /** How long after an ending its line is still due; an older one is left untold. */
  WINDOW: Duration.hours(1),
  /** The most lines one sweep sends; the rest wait for the next minute. */
  MAX_NOTICES: 20,
  CONCURRENCY: 5,
} as const;

/** What one sweep of the endings due came to: starters told, and lines not sent this time. */
export interface StarterNoticeSweepOutcome {
  told: number;
  failed: number;
}

/** What the line says happened, by how the run ended. */
function happened(notice: DueStarterNotice): string {
  if (notice.ending === STARTER_NOTICE_ENDING.ARCHIVED) {
    return "was archived, so it will not report back to you.";
  }
  if (notice.ending === STARTER_NOTICE_ENDING.STOPPED) {
    return "was stopped before it finished its turn, so it will not report back to you on its own.";
  }
  const why = notice.failure === null ? "" : ` (${notice.failure})`;
  return `failed its turn${why}, so it will not report back to you on its own.`;
}

/** The line that tells the starter, naming the agent and what happened, and what is its to do. */
function noticeLine(notice: DueStarterNotice, step: string): string {
  const name = agentName({
    kind: notice.agentKind,
    title: notice.agentTitle,
    model: notice.agentModel,
    automationName: notice.agentAutomationName,
  });
  const task = notice.taskId === null ? undefined : { taskId: notice.taskId };
  const mention = writtenMention(
    { kind: MENTION_KIND.AGENT, ...task, agentId: notice.agentId },
    name,
    step,
  );
  return (
    `${mention}, an agent you started, ${happened(notice)} ` +
    `${AGENT_TOOL.READ_AGENT} reads where it stands; go on from its work, or tell the developer, as your work needs.`
  );
}

/**
 * One ending's line handed to its starter; whether it is done. A starter
 * gone or archived since is told by no one, and counts as done.
 */
const tell = (eveFor: EveForAccount, due: DueStarterNotice) =>
  Effect.gen(function* () {
    const starter = yield* readAgent(due.userId, due.starterId);
    if (Option.isNone(starter) || starter.value.archivedAt !== null) return true;
    const step = yield* workspaceStepOf(due.userId, due.organizationId);
    const eve = yield* eveFor(due.userId);
    yield* steerAgent(
      eve,
      storeWriter({ tools: CODER_TOOL_SET }),
      due.userId,
      starter.value,
      {
        text: noticeLine(due, step),
        clientKey: due.key,
        sender: { kind: MESSAGE_SENDER.LUKE },
        metadata: LUKE_LINE_METADATA,
      },
    );
    return true;
  }).pipe(
    // The failure's kind alone: nothing of the agent or its member rides the line.
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning("starter notices: an ending's line was not sent", {
          failure: "error" in failure ? failure.error : failure._tag,
        }),
        false,
      ),
    ),
  );

/**
 * Tells the starters of the agents whose run ended within the window before
 * `now`, a sweep's worth, `CONCURRENCY` at a time.
 */
export const sweepStarterNotices = /* @__PURE__ */ Effect.fn("web/sweepStarterNotices")(function* (
  eveFor: EveForAccount,
  now: Date,
): Effect.fn.Return<
  StarterNoticeSweepOutcome,
  QueryError | Schema.SchemaError,
  DatabaseServices | HttpClient.HttpClient | GitHubApp
> {
  const since = new Date(now.getTime() - Duration.toMillis(STARTER_NOTICE_SWEEP.WINDOW));
  const due = yield* dueStarterNotices(since, now, STARTER_NOTICE_SWEEP.MAX_NOTICES);
  const landed = yield* Effect.forEach(due, (each) => tell(eveFor, each), {
    concurrency: STARTER_NOTICE_SWEEP.CONCURRENCY,
  });
  const told = landed.filter(Boolean).length;
  return { told, failed: landed.length - told };
});
