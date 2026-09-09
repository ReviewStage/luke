import {
  type ProviderSessionObservation,
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceProject,
} from "@sidecar/session";
import type { WireRecord } from "@sidecar/wire";
import type { CliReadRequest } from "../shared/cli-pass.js";
import { isDefined, recordsFromPage } from "../shared/cloud-wire.js";
import {
  CODEX_CLI,
  CODEX_CLOUD_DEFAULTS,
  CODEX_TASK_FIELD,
  type CodexCloudTask,
  sweepCursor,
  taskFromRecord,
} from "./cloud-wire.js";

/** One page of the CLI's task list, newest first. */
export function tasksFromPage(body: WireRecord): readonly CodexCloudTask[] {
  return recordsFromPage(body, CODEX_TASK_FIELD.TASKS)
    .map(taskFromRecord)
    .filter(isDefined)
    .sort((first, second) => second.lastActivityAt - first.lastActivityAt);
}

/**
 * One creation target per environment, newest task first — the same recency
 * the roster reads in, so the environments offered are the ones the account
 * actually uses. The identifier a creation names the environment by is the id
 * when the list reported one and the label otherwise: the CLI's creation
 * command documents taking either, and real accounts routinely carry only the
 * label — keyed on the id alone, they would be offered nowhere.
 */
export function collectEnvironments(
  environments: Map<string, WorkspaceProject>,
  tasks: readonly CodexCloudTask[],
): void {
  for (const task of tasks) {
    const target = task.environmentId ?? task.environmentLabel;
    if (!target || environments.has(target)) continue;
    environments.set(target, {
      providerProjectId: target,
      repository: task.repositoryLabel,
      taskSupport: WORKSPACE_TASK_SUPPORT.REQUIRED,
      namesItself: true,
    });
  }
}

/**
 * Walks a bounded few pages further into the task history for the
 * environments in recent use, so one older than the newest page is still
 * offered for creation. The cursor is the one value a read hands back into an
 * invocation: bounded, and passed as a single `--cursor=` token so it can
 * never read as a flag of its own. A page that fails mid-sweep keeps what the
 * sweep has — the offer grows by what was actually read, and the pages beyond
 * it wait for the next sweep rather than costing the whole pass.
 */
export async function sweepEnvironments(
  request: CliReadRequest,
  firstPage: WireRecord,
  firstTasks: readonly CodexCloudTask[],
): Promise<readonly WorkspaceProject[]> {
  const environments = new Map<string, WorkspaceProject>();
  collectEnvironments(environments, firstTasks);
  let cursor = sweepCursor(firstPage);
  try {
    for (
      let page = 1;
      page < CODEX_CLOUD_DEFAULTS.ENVIRONMENT_SWEEP_MAXIMUM_PAGES && cursor;
      page += 1
    ) {
      const body = await request([
        ...CODEX_CLI.LIST_TASKS_ARGV,
        `${CODEX_CLI.CURSOR_FLAG}${cursor}`,
      ]);
      collectEnvironments(environments, tasksFromPage(body));
      cursor = sweepCursor(body);
    }
  } catch {
    // Deliberately swallowed: the roster page already succeeded, and a
    // shallower environment offer is better than losing the pass whole.
  }
  return [...environments.values()];
}

export function observationForTask(task: CodexCloudTask): ProviderSessionObservation {
  return {
    providerSessionId: task.id,
    // The provider is already on the row as its mark, so the title carries
    // only what tells one Codex cloud task from another.
    title: task.repositoryLabel,
    status: task.status,
    lastActivityAt: task.lastActivityAt,
    detail: {
      repository: task.repositoryLabel,
      ...(task.link ? { link: task.link } : undefined),
      ...(task.diff ? { diff: task.diff } : undefined),
    },
  };
}
