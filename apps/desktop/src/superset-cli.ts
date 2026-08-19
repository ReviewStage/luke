import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  isRecord,
  PROVIDER_ACT_RESULT_STATUS,
  type ProviderControlResult,
  type ProviderMessageResult,
  type ProviderWorkspaceRequest,
  type ProviderWorkspaceResult,
  SessionProviderAdapterBase,
  text,
  type UnparsedWireValue,
  type WireRecord,
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceProject,
} from "@sidecar/core";
import { Effect } from "effect";
import { canIgnoreFilesystemError } from "./local-session-adapter";
import {
  SUPERSET_WORKSPACE_PROVIDER_ID,
  type SupersetOrganizationChoice,
} from "./shared/contracts";
import type { SupersetSessionContext } from "./superset-workspaces";
import { unparsedWire, wireRecord } from "./wire-boundary";

export const SUPERSET_CONTROL_ID = {
  OPEN_WORKSPACE: "superset-open-workspace",
  CLOSE_TERMINAL: "superset-close-terminal",
} as const;

export function isSupersetControlId(controlId: string): boolean {
  return Object.values(SUPERSET_CONTROL_ID).some((candidate) => candidate === controlId);
}

const execFileAsync = promisify(execFile);
const SUPERSET_QUERY_OUTPUT_LIMIT = 64 * 1024;
const SUPERSET_ORGANIZATION_LIMIT = 20;
const SUPERSET_TARGET_LIMIT = 20;
const SUPERSET_PROJECT_LIMIT = 50;
const SUPERSET_FAILURE_REASON_LIMIT = 300;
const SUPERSET_PROJECT_REFRESH_INTERVAL_MS = 60_000;
const LOCAL_TARGET_ID = "local";
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "gu");

function supersetFailureReason(error: UnparsedWireValue): string {
  const record = wireRecord(error);
  const stderr = record ? text(record.stderr) : undefined;
  if (!stderr) {
    return "Superset could not create that workspace.";
  }
  const reason = stderr
    .replace(ANSI_ESCAPE_PATTERN, "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean)
    ?.replace(/^error:\s*/iu, "")
    .split("")
    .map((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127 ? character : " ";
    })
    .join("")
    .replace(/\s+/gu, " ")
    .slice(0, SUPERSET_FAILURE_REASON_LIMIT)
    .trim();
  return reason || "Superset could not create that workspace.";
}

export type SupersetCommandRunner = (
  executable: string,
  arguments_: readonly string[],
) => Promise<void>;

export type SupersetQueryRunner = (
  executable: string,
  arguments_: readonly string[],
  timeoutMs: number,
) => Promise<string>;

async function defaultCommandRunner(
  executable: string,
  arguments_: readonly string[],
): Promise<void> {
  await execFileAsync(executable, [...arguments_], {
    timeout: 30_000,
    windowsHide: true,
  });
}

export interface SupersetCliOptions {
  homeDirectory: string;
  run?: SupersetCommandRunner;
  query?: SupersetQueryRunner;
  uniqueId?: () => string;
  organizationId?: () => Promise<string | undefined>;
}

export class SupersetCli {
  readonly #homeDirectory: string;
  readonly #run: SupersetCommandRunner;
  readonly #query: SupersetQueryRunner;
  readonly #uniqueId: () => string;
  readonly #organizationId: () => Promise<string | undefined>;

  constructor(options: SupersetCliOptions) {
    this.#homeDirectory = options.homeDirectory;
    this.#run = options.run ?? defaultCommandRunner;
    this.#uniqueId = options.uniqueId ?? randomUUID;
    this.#organizationId =
      options.organizationId ??
      (async () => {
        const { stdout } = await execFileAsync(
          "/usr/bin/plutil",
          [
            "-extract",
            "organizationId",
            "raw",
            "-o",
            "-",
            path.join(this.#homeDirectory, "config.json"),
          ],
          { timeout: 2_000, windowsHide: true },
        );
        return stdout;
      });
    this.#query =
      options.query ??
      (async (executable, arguments_, timeoutMs) => {
        const { stdout } = await execFileAsync(executable, [...arguments_], {
          maxBuffer: SUPERSET_QUERY_OUTPUT_LIMIT,
          timeout: timeoutMs,
          windowsHide: true,
        });
        return stdout;
      });
  }

  get executable(): string {
    return path.join(this.#homeDirectory, "bin", "superset");
  }

  async connected(): Promise<boolean> {
    if (!(await this.installed())) return false;
    try {
      return ((await this.#organizationId())?.trim().length ?? 0) > 0;
    } catch {
      return false;
    }
  }

  async installed(): Promise<boolean> {
    try {
      return (await fs.stat(this.executable)).isFile();
    } catch (error) {
      if (error instanceof Error && canIgnoreFilesystemError(error)) return false;
      throw error;
    }
  }

  async chooseOrganization(slug: string): Promise<boolean> {
    const choices = await this.organizations();
    const choice = choices.find((organization) => organization.slug === slug);
    if (!choice) return false;
    try {
      await this.#query(this.executable, ["organization", "switch", choice.slug, "--json"], 30_000);
      return this.connected();
    } catch {
      return false;
    }
  }

  async organizations(): Promise<readonly SupersetOrganizationChoice[]> {
    try {
      const output = await this.#query(this.executable, ["organization", "list", "--json"], 30_000);
      const parsed = unparsedWire(JSON.parse(output));
      const envelope = wireRecord(parsed);
      const values = Array.isArray(parsed)
        ? parsed
        : envelope && Array.isArray(envelope.data)
          ? envelope.data
          : [];
      return values.slice(0, SUPERSET_ORGANIZATION_LIMIT).flatMap((value) => {
        if (!isRecord(value)) return [];
        const id = text(value.id);
        const name = text(value.name);
        const slug = text(value.slug);
        return id &&
          id.length <= 128 &&
          name &&
          name.length <= 120 &&
          slug &&
          /^[a-z0-9][a-z0-9-]{0,79}$/u.test(slug)
          ? [{ id, name, slug }]
          : [];
      });
    } catch {
      return [];
    }
  }

  async workspaceProjects(defaultAgent?: string): Promise<readonly WorkspaceProject[]> {
    if (!(await this.connected())) return [];
    const remoteHosts = await this.#records(["hosts", "list", "--json"]);
    const targets = [
      { id: LOCAL_TARGET_ID, name: "This Mac", arguments_: ["--local"] as const },
      ...remoteHosts.slice(0, SUPERSET_TARGET_LIMIT).flatMap((host) => {
        const id = text(host.machineId) ?? text(host.id);
        const name = text(host.name) ?? text(host.displayName) ?? text(host.hostname) ?? id;
        return id && name ? [{ id, name, arguments_: ["--host", id] as const }] : [];
      }),
    ];
    const projects = await Promise.all(
      targets.map(async (target) => {
        const [projectRows, agentRows] = await Promise.all([
          this.#records(["projects", "list", ...target.arguments_, "--json"]),
          this.#records(["agents", "list", ...target.arguments_, "--json"]),
        ]);
        const agents = [
          ...new Set(
            agentRows.flatMap((row) => {
              const presetId = text(row.presetId);
              return presetId ? [presetId] : [];
            }),
          ),
        ];
        const selectedDefault =
          defaultAgent && agents.includes(defaultAgent) ? defaultAgent : undefined;
        return projectRows.slice(0, SUPERSET_PROJECT_LIMIT).flatMap((row) => {
          const id = text(row.id);
          const name = text(row.name);
          if (!id || !name) return [];
          const project: WorkspaceProject = {
            providerProjectId: id,
            repository: name,
            taskSupport: WORKSPACE_TASK_SUPPORT.REQUIRED,
            providerTargetId: target.id,
            targetName: target.name,
            spawnableAgents: agents,
          };
          if (selectedDefault) {
            project.defaultAgent = selectedDefault;
          }
          return [project];
        });
      }),
    );
    return projects.flat();
  }

  async createWorkspace(request: ProviderWorkspaceRequest): Promise<ProviderWorkspaceResult> {
    if (!request.providerTargetId || !request.agent || !request.task) {
      return {
        status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
        reason: "A Superset workspace needs a host, an agent, and an opening task.",
      };
    }
    const offered = (await this.workspaceProjects()).some(
      (project) =>
        project.providerProjectId === request.providerProjectId &&
        project.providerTargetId === request.providerTargetId &&
        project.spawnableAgents?.includes(request.agent ?? ""),
    );
    if (!offered) return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
    const branch = this.#branchName(request.name ?? request.task);
    const name = request.name ?? branch;
    const targetArguments =
      request.providerTargetId === LOCAL_TARGET_ID
        ? ["--local"]
        : ["--host", request.providerTargetId];
    const arguments_ = [
      "workspaces",
      "create",
      ...targetArguments,
      "--project",
      request.providerProjectId,
      "--name",
      name,
      "--branch",
      branch,
      "--agent",
      request.agent,
      "--prompt",
      request.task,
      "--json",
    ];
    if (!(await this.connected())) return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
    try {
      const output = await this.#query(this.executable, arguments_, 30_000);
      const parsed = unparsedWire(JSON.parse(output));
      const workspaceRecord = wireRecord(parsed);
      const workspaceId = workspaceRecord
        ? (text(workspaceRecord.workspaceId) ?? text(workspaceRecord.id))
        : undefined;
      if (!workspaceId) return { status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED };
      try {
        await this.#run(this.executable, [
          "workspaces",
          "open",
          workspaceId,
          ...(request.providerTargetId === LOCAL_TARGET_ID
            ? []
            : ["--host", request.providerTargetId]),
          "--json",
        ]);
        return { status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED };
      } catch {
        return {
          status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED,
          warning: "The workspace was created, but Superset could not open it.",
        };
      }
    } catch (error) {
      if (error instanceof Error && "stderr" in error) {
        return {
          status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
          reason: supersetFailureReason(
            unparsedWire({
              // SAFETY: execFile failures attach stderr to the thrown Error object.
              stderr: (error as Error & { stderr?: UnparsedWireValue }).stderr,
            }),
          ),
        };
      }
      return {
        status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
        reason: supersetFailureReason(
          unparsedWire(error instanceof Error ? error.message : String(error)),
        ),
      };
    }
  }

  async sendMessage(context: SupersetSessionContext, text: string): Promise<ProviderMessageResult> {
    return this.#act(
      [
        "terminals",
        "send",
        "--workspace",
        context.workspaceId,
        "--host",
        context.hostId,
        "--terminal",
        context.terminalId,
        "--text",
        text,
        "--json",
      ],
      "Superset could not deliver that message.",
    );
  }

  async executeControl(
    context: SupersetSessionContext,
    controlId: string,
  ): Promise<ProviderControlResult> {
    if (controlId === SUPERSET_CONTROL_ID.OPEN_WORKSPACE) {
      return this.#act(
        ["workspaces", "open", context.workspaceId, "--host", context.hostId, "--json"],
        "Superset could not open that workspace.",
      );
    }
    if (controlId === SUPERSET_CONTROL_ID.CLOSE_TERMINAL) {
      return this.#act(
        [
          "terminals",
          "close",
          "--workspace",
          context.workspaceId,
          "--host",
          context.hostId,
          "--terminal",
          context.terminalId,
          "--json",
        ],
        "Superset could not close that terminal.",
      );
    }
    return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
  }

  async createAgent(
    context: SupersetSessionContext,
    agent: string,
    task: string | undefined,
  ): Promise<ProviderWorkspaceResult> {
    if (!task) {
      return {
        status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
        reason: "A Superset agent needs an opening task.",
      };
    }
    return this.#act(
      [
        "agents",
        "create",
        "--workspace",
        context.workspaceId,
        "--host",
        context.hostId,
        "--agent",
        agent,
        "--prompt",
        task,
        "--json",
      ],
      "Superset could not start that agent.",
    );
  }

  async #act(arguments_: readonly string[], reason: string): Promise<ProviderControlResult> {
    if (!(await this.connected())) return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
    try {
      await this.#run(this.executable, arguments_);
      return { status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED };
    } catch {
      return { status: PROVIDER_ACT_RESULT_STATUS.REJECTED, reason };
    }
  }

  async #records(arguments_: readonly string[]): Promise<readonly WireRecord[]> {
    try {
      const parsed = unparsedWire(
        JSON.parse(await this.#query(this.executable, arguments_, 30_000)),
      );
      const envelope = wireRecord(parsed);
      const values = Array.isArray(parsed)
        ? parsed
        : envelope && Array.isArray(envelope.data)
          ? envelope.data
          : [];
      return values.flatMap((value) => {
        const record = wireRecord(value);
        return record ? [record] : [];
      });
    } catch {
      return [];
    }
  }

  #branchName(source: string): string {
    const slug = source
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 40)
      .replace(/-+$/gu, "");
    return `luke-${slug || "session"}-${this.#uniqueId().slice(0, 8)}`;
  }
}

export class SupersetWorkspaceAdapter extends SessionProviderAdapterBase {
  readonly provider = { id: SUPERSET_WORKSPACE_PROVIDER_ID, displayName: "Superset" };
  readonly #cli: SupersetCli;
  #projects: readonly WorkspaceProject[] = [];
  #projectsRefreshedAt: number | undefined;
  #defaultAgent: string | undefined;

  constructor(cli: SupersetCli) {
    super();
    this.#cli = cli;
  }

  observe(): Effect.Effect<readonly never[], unknown, unknown> {
    return Effect.succeed([]);
  }

  async refresh(defaultAgent: string | undefined, connected: boolean): Promise<void> {
    if (!connected) {
      this.#projects = [];
      this.#projectsRefreshedAt = undefined;
      this.#defaultAgent = defaultAgent;
      return;
    }
    const now = Date.now();
    if (
      defaultAgent === this.#defaultAgent &&
      this.#projectsRefreshedAt !== undefined &&
      now - this.#projectsRefreshedAt < SUPERSET_PROJECT_REFRESH_INTERVAL_MS
    ) {
      return;
    }
    this.#projects = await this.#cli.workspaceProjects(defaultAgent);
    this.#defaultAgent = defaultAgent;
    this.#projectsRefreshedAt = this.#projects.length > 0 ? now : undefined;
  }

  override workspaceProjects(): readonly WorkspaceProject[] {
    return this.#projects;
  }

  override createWorkspace(
    request: ProviderWorkspaceRequest,
  ): Effect.Effect<ProviderWorkspaceResult, unknown, unknown> {
    return Effect.promise(() => this.#cli.createWorkspace(request));
  }
}
