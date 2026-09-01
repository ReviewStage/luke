import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { INVOCATION_FAILURE, InvocationError, runBoundedInvocation } from "@sidecar/process";
import { canIgnoreFilesystemError } from "@sidecar/providers";
import {
  ACT_RESULT_STATUS,
  type ProviderControlResult,
  type ProviderMessageResult,
  type ProviderSessionObservation,
  type ProviderWorkspaceRequest,
  type ProviderWorkspaceResult,
  SessionProviderAdapterBase,
  SUPERSET_WORKSPACE_PROVIDER_ID,
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceProject,
} from "@sidecar/session";
import {
  isRecord,
  text,
  type UnparsedWireValue,
  unparsedWire,
  type WireRecord,
  wireRecord,
} from "@sidecar/wire";
import type { SupersetOrganizationChoice } from "./sign-in-stage.js";
import type { SupersetSessionContext } from "./workspaces.js";

export const SUPERSET_CONTROL_ID = {
  DELETE_WORKSPACE: "superset-delete-workspace",
} as const;

export function isSupersetControlId(controlId: string): boolean {
  return Object.values(SUPERSET_CONTROL_ID).some((candidate) => candidate === controlId);
}

const SUPERSET_QUERY_OUTPUT_LIMIT = 64 * 1024;
const SUPERSET_ORGANIZATION_LIMIT = 20;
const SUPERSET_TARGET_LIMIT = 20;
const SUPERSET_PROJECT_LIMIT = 50;
const SUPERSET_FAILURE_REASON_LIMIT = 300;
const SUPERSET_PROJECT_REFRESH_INTERVAL_MS = 60_000;
const LOCAL_TARGET_ID = "local";
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "gu");

function supersetFailureReason(error: UnparsedWireValue, fallback: string): string {
  const record = wireRecord(error);
  const stderr = record ? text(record.stderr) : undefined;
  if (!stderr) return fallback;
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
  return reason || fallback;
}

function failedSupersetInvocation(binary: string, stderr: string): InvocationError {
  return Object.assign(new InvocationError(INVOCATION_FAILURE.FAILED, binary), { stderr });
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
  const result = await runBoundedInvocation({
    binary: executable,
    arguments: arguments_,
    timeoutMs: 30_000,
    maximumOutputBytes: SUPERSET_QUERY_OUTPUT_LIMIT,
  });
  if (result.exitCode !== 0) {
    throw failedSupersetInvocation(executable, result.stderr);
  }
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
        const result = await runBoundedInvocation({
          binary: "/usr/bin/plutil",
          arguments: [
            "-extract",
            "organizationId",
            "raw",
            "-o",
            "-",
            path.join(this.#homeDirectory, "config.json"),
          ],
          timeoutMs: 2_000,
          maximumOutputBytes: SUPERSET_QUERY_OUTPUT_LIMIT,
        });
        if (result.exitCode !== 0) return undefined;
        return result.stdout;
      });
    this.#query =
      options.query ??
      (async (executable, arguments_, timeoutMs) => {
        const result = await runBoundedInvocation({
          binary: executable,
          arguments: arguments_,
          timeoutMs,
          maximumOutputBytes: SUPERSET_QUERY_OUTPUT_LIMIT,
        });
        if (result.exitCode !== 0) {
          throw failedSupersetInvocation(executable, result.stderr);
        }
        return result.stdout;
      });
  }

  get executable(): string {
    return path.join(this.#homeDirectory, "bin", "superset");
  }

  async connected(): Promise<boolean> {
    return (await this.activeOrganization()) !== undefined;
  }

  async activeOrganization(): Promise<string | undefined> {
    if (!(await this.installed())) return undefined;
    try {
      return (await this.#organizationId())?.trim() || undefined;
    } catch {
      return undefined;
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

  /**
   * The CLI's own documented sign-out, `auth logout`, which clears the login
   * the connect flow's `auth login` stored — the same consent withdrawn by
   * the same hands, through the same binary. True only once the CLI itself
   * reports the login gone, so a logout that silently failed cannot read as
   * a disconnect.
   */
  async signOut(): Promise<boolean> {
    try {
      await this.#run(this.executable, ["auth", "logout", "--json"]);
    } catch {
      return false;
    }
    return !(await this.connected());
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
    const hosts = await this.#records(["hosts", "list", "--json"]);
    // Only a remote host names itself on a project: the local target is the
    // machine the user is sitting at, which the rows already say by wearing
    // no cloud badge, so annotating it would state the default.
    const targets: readonly { id: string; name?: string; arguments_: readonly string[] }[] = [
      { id: LOCAL_TARGET_ID, arguments_: ["--local"] },
      ...hosts.slice(0, SUPERSET_TARGET_LIMIT).flatMap((host) => {
        const id = text(host.id);
        const name = text(host.name) ?? id;
        return id && name ? [{ id, name, arguments_: ["--host", id] }] : [];
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
            spawnableAgents: agents,
          };
          if (target.name) {
            project.targetName = target.name;
          }
          if (selectedDefault) {
            project.defaultAgent = selectedDefault;
          }
          return [project];
        });
      }),
    );
    // The hosts list includes this machine's own host row, so the local
    // target's projects come back a second time under that row's id. A
    // project id names one project on one host, so the first target to list
    // it keeps it — the local target leads, and a creation ask lands on
    // `--local` rather than on this machine's host id.
    const seen = new Set<string>();
    const deduped: WorkspaceProject[] = [];
    for (const project of projects.flat()) {
      if (seen.has(project.providerProjectId)) continue;
      seen.add(project.providerProjectId);
      deduped.push(project);
    }
    return deduped;
  }

  async createWorkspace(request: ProviderWorkspaceRequest): Promise<ProviderWorkspaceResult> {
    if (!request.providerTargetId || !request.agent || !request.task) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "A Superset workspace needs a host, an agent, and an opening task.",
      };
    }
    const offered = (await this.workspaceProjects()).some(
      (project) =>
        project.providerProjectId === request.providerProjectId &&
        project.providerTargetId === request.providerTargetId &&
        project.spawnableAgents?.includes(request.agent ?? ""),
    );
    if (!offered)
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: "That act is not supported by the latest observation.",
      };
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
    if (!(await this.connected()))
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: "That act is not supported by the latest observation.",
      };
    try {
      const output = await this.#query(this.executable, arguments_, 30_000);
      const parsed = unparsedWire(JSON.parse(output));
      const envelope = wireRecord(parsed);
      // The CLI answers a creation with `{ workspace, alreadyExists }`, so the
      // one thing read out of it — the id the follow-through open names — sits
      // a level down on the workspace itself.
      const workspaceRecord = envelope ? wireRecord(envelope.workspace) : undefined;
      const workspaceId = workspaceRecord ? text(workspaceRecord.id) : undefined;
      if (!workspaceId) return { status: ACT_RESULT_STATUS.ACCEPTED };
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
        return { status: ACT_RESULT_STATUS.ACCEPTED };
      } catch {
        return {
          status: ACT_RESULT_STATUS.ACCEPTED,
          warning: "The workspace was created, but Superset could not open it.",
        };
      }
    } catch (error) {
      const stderr =
        error instanceof Error && "stderr" in error
          ? // SAFETY: injected command-runner failures may attach stderr.
            (error as Error & { stderr?: UnparsedWireValue }).stderr
          : undefined;
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: supersetFailureReason(
          unparsedWire({ stderr }),
          "Superset could not create that workspace.",
        ),
      };
    }
  }

  // The acts on a bound terminal name no `--host`: the CLI's default is this
  // machine, which is the only machine the observed host state describes, and
  // the flag takes a machineId the state does not carry — passing the state
  // directory's organization name there is what made every act fail.
  async sendMessage(context: SupersetSessionContext, text: string): Promise<ProviderMessageResult> {
    // A chatless workspace row carries no terminal for a message to land in,
    // and never advertises taking one; the adapter answers the same way
    // rather than improvising a way in.
    if (!context.terminalId)
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: "That act is not supported by the latest observation.",
      };
    return this.#act(
      [
        "terminals",
        "send",
        "--workspace",
        context.workspaceId,
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
    // The one deletion the agent guide authorizes: the observed workspace id
    // as the command's single argument, nothing else ever deleted.
    if (controlId === SUPERSET_CONTROL_ID.DELETE_WORKSPACE) {
      return this.#act(
        ["workspaces", "delete", context.workspaceId, "--json"],
        "Superset could not delete that workspace.",
      );
    }
    return {
      status: ACT_RESULT_STATUS.UNSUPPORTED,
      reason: "That act is not supported by the latest observation.",
    };
  }

  /**
   * Renames one observed workspace through the CLI's documented
   * `workspaces update` command, carrying only the observed identifiers and
   * the developer's own name behind `--name` — never the command's other
   * flags, which link and unlink tasks this integration does not touch, and
   * no `--json`, which `workspaces update` does not document and whose
   * output nothing here would read. A failure answers with the CLI's own
   * bounded error line, because a rename the CLI refused is something the
   * developer can often fix by rewording.
   */
  async renameWorkspace(
    context: SupersetSessionContext,
    name: string,
  ): Promise<ProviderControlResult> {
    if (!(await this.connected()))
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: "That act is not supported by the latest observation.",
      };
    try {
      await this.#run(this.executable, [
        "workspaces",
        "update",
        context.workspaceId,
        "--name",
        name,
      ]);
      return { status: ACT_RESULT_STATUS.ACCEPTED };
    } catch (error) {
      const stderr =
        error instanceof Error && "stderr" in error
          ? // SAFETY: execFile failures attach stderr to the thrown Error object.
            (error as Error & { stderr?: UnparsedWireValue }).stderr
          : undefined;
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: supersetFailureReason(
          unparsedWire({ stderr }),
          "Superset could not rename that workspace.",
        ),
      };
    }
  }

  async createAgent(
    context: SupersetSessionContext,
    agent: string,
    task: string | undefined,
  ): Promise<ProviderWorkspaceResult> {
    if (!task) {
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: "A Superset agent needs an opening task.",
      };
    }
    return this.#act(
      [
        "agents",
        "create",
        "--workspace",
        context.workspaceId,
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
    if (!(await this.connected()))
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: "That act is not supported by the latest observation.",
      };
    try {
      await this.#run(this.executable, arguments_);
      return { status: ACT_RESULT_STATUS.ACCEPTED };
    } catch {
      return { status: ACT_RESULT_STATUS.REJECTED, reason };
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
  #workspaceRows: readonly ProviderSessionObservation[] = [];

  constructor(cli: SupersetCli) {
    super();
    this.#cli = cli;
  }

  /**
   * The chatless workspaces the latest host-state read reported, exactly as
   * the snapshot decorated them. They are handed in by `refresh` rather than
   * read here so that this adapter observes the same pass everything else
   * validated against — and so a plain registry refresh after an act commits
   * the same decorated shape the observation loop does.
   */
  async observe(): Promise<readonly ProviderSessionObservation[]> {
    return this.#workspaceRows;
  }

  async refresh(
    defaultAgent: string | undefined,
    connected: boolean,
    workspaceRows: readonly ProviderSessionObservation[],
  ): Promise<void> {
    // The rows are observation, not an act: host state reads without a login,
    // so they stand — undecorated with acts — however the connection looks.
    this.#workspaceRows = workspaceRows;
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

  override createWorkspace(request: ProviderWorkspaceRequest): Promise<ProviderWorkspaceResult> {
    return this.#cli.createWorkspace(request);
  }
}
