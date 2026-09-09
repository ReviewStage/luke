import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  ACT_RESULT_STATUS,
  type ProviderControlResult,
  type ProviderMessageResult,
  type ProviderWorkspaceRequest,
  type ProviderWorkspaceResult,
  UNSUPPORTED_BY_OBSERVATION,
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
import { boundedInvocation, INVOCATION_FAILURE, InvocationError } from "../shared/invocation.js";
import { canIgnoreFilesystemError } from "../shared/local-files.js";
import { activeOrganizationId } from "./config.js";
import type { SupersetOrganizationChoice } from "./sign-in-stage.js";
import {
  SUPERSET_CONTROL_ID,
  SUPERSET_LIMIT,
  SUPERSET_LOCAL_TARGET_ID,
  supersetFailureReason,
} from "./vocabulary.js";
import type { SupersetSessionContext } from "./wire.js";

/**
 * The stderr a failed invocation attached to what it threw, whether the runner
 * is the injected one or `execFile`. The parameter is the thrown cause itself,
 * because that attachment is the only place the CLI's own words survive.
 */
function attachedStderr(cause: unknown): UnparsedWireValue {
  if (!(cause instanceof Error) || !("stderr" in cause)) return undefined;
  // SAFETY: a command runner's failure may attach stderr; the reason reader validates it as wire.
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- The attached value is untyped; the wire reader is the validation.
  return (cause as Error & { stderr?: UnparsedWireValue }).stderr;
}

/** The values an envelope carries, whether the CLI answered a bare array or wrapped it in `data`. */
function envelopeValues(parsed: UnparsedWireValue): readonly UnparsedWireValue[] {
  if (Array.isArray(parsed)) return parsed;
  const envelope = wireRecord(parsed);
  return envelope && Array.isArray(envelope.data) ? envelope.data : [];
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
  const result = await boundedInvocation({
    binary: executable,
    arguments: arguments_,
    timeoutMs: SUPERSET_LIMIT.INVOCATION_TIMEOUT_MS,
    maximumOutputBytes: SUPERSET_LIMIT.QUERY_OUTPUT_BYTES,
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
  /** Overridable for tests through the file it reads, never through a process. */
  activeOrganizationId?: () => Promise<string | undefined>;
}

export class SupersetCli {
  readonly #homeDirectory: string;
  readonly #run: SupersetCommandRunner;
  readonly #query: SupersetQueryRunner;
  readonly #uniqueId: () => string;
  readonly #activeOrganizationId: () => Promise<string | undefined>;

  constructor(options: SupersetCliOptions) {
    this.#homeDirectory = options.homeDirectory;
    this.#run = options.run ?? defaultCommandRunner;
    this.#uniqueId = options.uniqueId ?? randomUUID;
    this.#activeOrganizationId =
      options.activeOrganizationId ?? (() => activeOrganizationId(this.#homeDirectory));
    this.#query =
      options.query ??
      (async (executable, arguments_, timeoutMs) => {
        const result = await boundedInvocation({
          binary: executable,
          arguments: arguments_,
          timeoutMs,
          maximumOutputBytes: SUPERSET_LIMIT.QUERY_OUTPUT_BYTES,
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
      return (await this.#activeOrganizationId())?.trim() || undefined;
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
      await this.#query(
        this.executable,
        ["organization", "switch", choice.slug, "--json"],
        SUPERSET_LIMIT.INVOCATION_TIMEOUT_MS,
      );
      return this.connected();
    } catch {
      return false;
    }
  }

  async organizations(): Promise<readonly SupersetOrganizationChoice[]> {
    try {
      const output = await this.#query(
        this.executable,
        ["organization", "list", "--json"],
        SUPERSET_LIMIT.INVOCATION_TIMEOUT_MS,
      );
      const values = envelopeValues(unparsedWire(JSON.parse(output)));
      return values.slice(0, SUPERSET_LIMIT.ORGANIZATIONS).flatMap((value) => {
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
      { id: SUPERSET_LOCAL_TARGET_ID, arguments_: ["--local"] },
      ...hosts.slice(0, SUPERSET_LIMIT.TARGETS).flatMap((host) => {
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
        return projectRows.slice(0, SUPERSET_LIMIT.PROJECTS).flatMap((row) => {
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
        reason: UNSUPPORTED_BY_OBSERVATION,
      };
    const branch = this.#branchName(request.name ?? request.task);
    const name = request.name ?? branch;
    const targetArguments =
      request.providerTargetId === SUPERSET_LOCAL_TARGET_ID
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
        reason: UNSUPPORTED_BY_OBSERVATION,
      };
    try {
      const output = await this.#query(
        this.executable,
        arguments_,
        SUPERSET_LIMIT.INVOCATION_TIMEOUT_MS,
      );
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
          ...(request.providerTargetId === SUPERSET_LOCAL_TARGET_ID
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
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: supersetFailureReason(
          unparsedWire({ stderr: attachedStderr(error) }),
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
    // and never advertises taking one; the CLI answers the same way
    // rather than improvising a way in.
    if (!context.terminalId)
      return {
        status: ACT_RESULT_STATUS.UNSUPPORTED,
        reason: UNSUPPORTED_BY_OBSERVATION,
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
      reason: UNSUPPORTED_BY_OBSERVATION,
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
        reason: UNSUPPORTED_BY_OBSERVATION,
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
      return {
        status: ACT_RESULT_STATUS.REJECTED,
        reason: supersetFailureReason(
          unparsedWire({ stderr: attachedStderr(error) }),
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
        reason: UNSUPPORTED_BY_OBSERVATION,
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
        JSON.parse(
          await this.#query(this.executable, arguments_, SUPERSET_LIMIT.INVOCATION_TIMEOUT_MS),
        ),
      );
      const values = envelopeValues(parsed);
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
