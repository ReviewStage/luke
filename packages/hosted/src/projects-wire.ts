import {
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceAgentModels,
  type WorkspaceProject,
} from "@sidecar/session";
import { RECORD_EXTRA_KEYS, type Schema, s, TEXT_ENDS } from "@sidecar/wire";
import { writtenText } from "./service-wire.js";

/**
 * What the projects endpoint answers: where the caller's keys can create a
 * workspace, and which agents each such provider takes. A malformed entry is
 * skipped rather than failing the list; a half-read agent row is not, because
 * an agent offered without the models it runs under is a choice that cannot
 * be made.
 */

/**
 * One place a new workspace can be created, as the projects endpoint reports
 * it: a project the named provider itself listed on the fresh observation
 * pass that answered the request. The creation act re-observes and validates
 * the id against the provider's own list again, so this entry can offer a
 * project but can never conjure one.
 */
export interface HostedWorkspaceProject
  extends Pick<
    WorkspaceProject,
    "namesItself" | "providerProjectId" | "repository" | "targetName" | "taskSupport"
  > {
  /** The cloud-agent provider id that reported this project. */
  providerId: string;
}

/**
 * One agent kind a provider's creation endpoint takes, with the models and
 * effort levels the build's table lists for it — a `WORKSPACE_AGENT_MODELS`
 * entry from `@sidecar/session`, carried onto the wire with its provider id.
 * Extending the table's own row type means the wire cannot drift from the
 * table it exists to flatten, and the workspace act validates a chosen
 * selection against the same table again server-side.
 */
export interface HostedWorkspaceAgentModels extends WorkspaceAgentModels {
  providerId: string;
}

/** The projects endpoint answer: where the caller's keys can create a workspace. */
export interface HostedProjectsAnswer {
  projects: HostedWorkspaceProject[];
  /** Agent choices for providers in `projects` whose creation takes one. */
  agentModels: HostedWorkspaceAgentModels[];
}

const workspaceProjectSchema: Schema<HostedWorkspaceProject> = s.record(
  {
    providerId: s.text(),
    providerProjectId: s.text(),
    repository: s.text(),
    taskSupport: s.enumOf(Object.values(WORKSPACE_TASK_SUPPORT), { ends: TEXT_ENDS.TRIM }),
    targetName: s.dropRefused(s.text()),
    namesItself: s.dropRefused(s.literal(true)),
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

const workspaceAgentModelsSchema: Schema<HostedWorkspaceAgentModels> = s.record(
  {
    providerId: s.text(),
    agent: s.text(),
    models: s.array(
      s.record({ id: s.text(), label: s.text() }, { extraKeys: RECORD_EXTRA_KEYS.IGNORE }),
      { minimum: 1 },
    ),
    // An effort this build cannot read is one choice missing from a row that
    // still offers its models, so the entry stands with the rest; a row that
    // named no efforts at all is one whose agent runs under none.
    efforts: s.array(writtenText, { skipRefused: true }),
  },
  { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
);

/** A malformed project or agent entry is skipped, not fatal. */
export const hostedProjectsAnswerSchema: Schema<HostedProjectsAnswer> = s.map(
  s.record(
    {
      projects: s.array(workspaceProjectSchema, { skipRefused: true }),
      agentModels: s.dropRefused(s.array(workspaceAgentModelsSchema, { skipRefused: true })),
    },
    { extraKeys: RECORD_EXTRA_KEYS.IGNORE },
  ),
  (answer) => ({ projects: answer.projects, agentModels: answer.agentModels ?? [] }),
);
