import {
  ACT_RESULT_STATUS,
  type CliConnection,
  type SessionProviderPlugin,
  type WorkspaceProject,
} from "@sidecar/session";
import type { AdapterDiagnosticCallback } from "../shared/adapter-diagnostics.js";
import { type CliRun, cliPass } from "../shared/cli-pass.js";
import {
  collectEnvironments,
  observationForTask,
  sweepEnvironments,
  tasksFromPage,
} from "./cloud-observe.js";
import { CODEX_CLI, CODEX_CLOUD_DEFAULTS, createdTaskId } from "./cloud-wire.js";
import { CODEX_PROVIDER } from "./observe.js";

export interface CodexCloudPluginOptions {
  run?: CliRun;
  now?: () => number;
  minimumRefreshIntervalMs?: number;
  /**
   * Called when an observation pass fails for a reason other than the CLI
   * being unavailable or a command failing. Unavailable and transient
   * failures never reach it.
   */
  onDiagnostic?: AdapterDiagnosticCallback;
}

/** A Codex cloud plugin, plus the login state a settings row reports. */
export interface CodexCloudPlugin extends SessionProviderPlugin {
  connection(): CliConnection;
}

/**
 * Observes Codex cloud tasks through the Codex CLI's own documented read,
 * under the ChatGPT login the user already gave that CLI — Luke reads no
 * token and stores none, and a machine whose CLI is absent or signed out is
 * observed as having nothing. The one write is the one the user asks for: a
 * new task, through the CLI's documented `cloud exec`, in an environment the
 * latest pass reported. Codex documents no way to message or steer a task
 * already running, so its sessions name no session act at all: rows say where
 * cloud tasks stand, and their address opens them where they live.
 */
export function codexCloudPlugin(options: CodexCloudPluginOptions = {}): CodexCloudPlugin {
  /**
   * The environments the latest pass's tasks ran in, which is the only place
   * the CLI reports environments at all: an account whose recent tasks are
   * empty is offered nowhere to create, honestly, until it runs one by hand.
   */
  let projects: readonly WorkspaceProject[] = [];
  let lastEnvironmentSweepAt = Number.NEGATIVE_INFINITY;

  const pass = cliPass({
    provider: CODEX_PROVIDER,
    binary: CODEX_CLI.BINARY,
    loginProbeArgv: CODEX_CLI.LOGIN_PROBE_ARGV,
    ...options,
    // Whatever was offered under one login can never be offered or acted on
    // under another.
    forget() {
      projects = [];
      lastEnvironmentSweepAt = Number.NEGATIVE_INFINITY;
    },
    async collect(request, now) {
      const body = await request(CODEX_CLI.LIST_TASKS_ARGV);
      const tasks = tasksFromPage(body);

      if (now - lastEnvironmentSweepAt >= CODEX_CLOUD_DEFAULTS.ENVIRONMENT_SWEEP_INTERVAL_MS) {
        projects = await sweepEnvironments(request, body, tasks);
        lastEnvironmentSweepAt = now;
      } else {
        // Between sweeps the newest page still joins the offer, so an
        // environment first used moments ago is offered without waiting for
        // one; only a sweep, or the login going away, removes an environment.
        const environments = new Map(
          projects.map((project) => [project.providerProjectId, project]),
        );
        collectEnvironments(environments, tasks);
        projects = [...environments.values()];
      }
      return tasks.map(observationForTask);
    },
  });

  return {
    provider: CODEX_PROVIDER,
    observe: () => pass.run(),
    latest: () => pass.latest(),
    projects: () => projects,
    connection: () => pass.connection(),
    acts: {
      async createWorkspace({ project, name, task }) {
        // Codex names tasks itself from the prompt; a name the user typed has
        // nowhere to go, and dropping it silently would honour half the ask.
        if (name !== undefined) {
          return { status: ACT_RESULT_STATUS.REJECTED, reason: "Codex names its own tasks." };
        }
        // The task is the whole creation — `cloud exec` starts nothing
        // without a prompt — so a creation without one has nothing to start.
        if (!task) {
          return {
            status: ACT_RESULT_STATUS.REJECTED,
            reason: "A Codex cloud task needs an opening task shorter than a document.",
          };
        }

        const written = await pass.write([
          ...CODEX_CLI.CREATE_TASK_ARGV,
          project.providerProjectId,
          CODEX_CLI.ARGUMENT_SEPARATOR,
          task,
        ]);
        if (written.outcome.status !== ACT_RESULT_STATUS.ACCEPTED) return written.outcome;
        const providerSessionId = createdTaskId(written.stdout ?? "");
        return {
          status: ACT_RESULT_STATUS.ACCEPTED,
          ...(providerSessionId ? { providerSessionId } : undefined),
        };
      },
    },
  };
}
