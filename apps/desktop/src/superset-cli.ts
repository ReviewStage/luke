import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  PROVIDER_ACT_RESULT_STATUS,
  type ProviderControlResult,
  type ProviderMessageResult,
  type ProviderWorkspaceRequest,
  type ProviderWorkspaceResult,
  SessionProviderAdapterBase,
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceProject,
} from "@sidecar/core";
import { canIgnoreFilesystemError } from "./local-session-adapter";
import type { SupersetOrganizationChoice } from "./shared/contracts";
import type { SupersetSessionContext } from "./superset-workspaces";

export const SUPERSET_CONTROL_ID = {
  OPEN_WORKSPACE: "superset-open-workspace",
  CLOSE_TERMINAL: "superset-close-terminal",
} as const;

const execFileAsync = promisify(execFile);
const SUPERSET_QUERY_OUTPUT_LIMIT = 64 * 1024;
const SUPERSET_ORGANIZATION_LIMIT = 20;
const SUPERSET_TARGET_LIMIT = 20;
const SUPERSET_PROJECT_LIMIT = 50;
const SUPERSET_FAILURE_REASON_LIMIT = 300;
export const SUPERSET_WORKSPACE_PROVIDER_ID = "superset";
const LOCAL_TARGET_ID = "local";
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "gu");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function supersetFailureReason(error: unknown): string {
  if (!isRecord(error) || typeof error.stderr !== "string") {
    return "Superset could not create that workspace.";
  }
  const reason = error.stderr
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
}

export class SupersetCli {
  readonly #homeDirectory: string;
  readonly #run: SupersetCommandRunner;
  readonly #query: SupersetQueryRunner;
  readonly #uniqueId: () => string;

  constructor(options: SupersetCliOptions) {
    this.#homeDirectory = options.homeDirectory;
    this.#run = options.run ?? defaultCommandRunner;
    this.#uniqueId = options.uniqueId ?? randomUUID;
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
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  async installed(): Promise<boolean> {
    try {
      return (await fs.stat(this.executable)).isFile();
    } catch (error) {
      if (canIgnoreFilesystemError(error)) return false;
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
      const parsed: unknown = JSON.parse(output);
      const values = Array.isArray(parsed)
        ? parsed
        : isRecord(parsed) && Array.isArray(parsed.data)
          ? parsed.data
          : [];
      return values.slice(0, SUPERSET_ORGANIZATION_LIMIT).flatMap((value) => {
        if (!isRecord(value)) return [];
        const { id, name, slug } = value;
        return typeof id === "string" &&
          id.length > 0 &&
          id.length <= 128 &&
          typeof name === "string" &&
          name.length > 0 &&
          name.length <= 120 &&
          typeof slug === "string" &&
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
        const id =
          typeof host.machineId === "string"
            ? host.machineId
            : typeof host.id === "string"
              ? host.id
              : undefined;
        const name =
          typeof host.name === "string"
            ? host.name
            : typeof host.displayName === "string"
              ? host.displayName
              : typeof host.hostname === "string"
                ? host.hostname
                : id;
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
              const presetId = typeof row.presetId === "string" ? row.presetId : undefined;
              return presetId ? [presetId] : [];
            }),
          ),
        ];
        const selectedDefault =
          defaultAgent && agents.includes(defaultAgent) ? defaultAgent : undefined;
        return projectRows.slice(0, SUPERSET_PROJECT_LIMIT).flatMap((row) => {
          const id = typeof row.id === "string" ? row.id : undefined;
          const name = typeof row.name === "string" ? row.name : undefined;
          return id && name
            ? [
                {
                  providerProjectId: id,
                  repository: name,
                  taskSupport: WORKSPACE_TASK_SUPPORT.REQUIRED,
                  providerTargetId: target.id,
                  targetName: target.name,
                  spawnableAgents: agents,
                  ...(selectedDefault ? { defaultAgent: selectedDefault } : {}),
                },
              ]
            : [];
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
      const parsed: unknown = JSON.parse(output);
      const workspaceId = isRecord(parsed)
        ? typeof parsed.workspaceId === "string"
          ? parsed.workspaceId
          : typeof parsed.id === "string"
            ? parsed.id
            : undefined
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
      return {
        status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
        reason: supersetFailureReason(error),
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

  async #records(arguments_: readonly string[]): Promise<readonly Record<string, unknown>[]> {
    try {
      const parsed: unknown = JSON.parse(await this.#query(this.executable, arguments_, 30_000));
      const values = Array.isArray(parsed)
        ? parsed
        : isRecord(parsed) && Array.isArray(parsed.data)
          ? parsed.data
          : [];
      return values.filter(isRecord);
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

  constructor(cli: SupersetCli) {
    super();
    this.#cli = cli;
  }

  async observe(): Promise<readonly never[]> {
    return [];
  }

  async refresh(defaultAgent?: string): Promise<void> {
    this.#projects = await this.#cli.workspaceProjects(defaultAgent);
  }

  override workspaceProjects(): readonly WorkspaceProject[] {
    return this.#projects;
  }

  override createWorkspace(request: ProviderWorkspaceRequest): Promise<ProviderWorkspaceResult> {
    return this.#cli.createWorkspace(request);
  }
}
