import { randomUUID } from "node:crypto";
import path from "node:path";
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
import { CLI_FAILURE, CliFailure } from "@sidecar/core/effect-errors";
import { Effect } from "effect";
import { Cli } from "./services/cli";
import { Files } from "./services/files";
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

const SUPERSET_QUERY_OUTPUT_LIMIT = 64 * 1024;
const SUPERSET_ORGANIZATION_LIMIT = 20;
const SUPERSET_TARGET_LIMIT = 20;
const SUPERSET_PROJECT_LIMIT = 50;
const SUPERSET_FAILURE_REASON_LIMIT = 300;
const SUPERSET_PROJECT_REFRESH_INTERVAL_MS = 60_000;
const SUPERSET_COMMAND_TIMEOUT_MS = 30_000;
const LOCAL_TARGET_ID = "local";
const ANSI_ESCAPE_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, "gu");
const SUPERSET_PROVIDER = "superset";

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
) => Effect.Effect<void, CliFailure, Cli>;

export type SupersetQueryRunner = (
  executable: string,
  arguments_: readonly string[],
  timeoutMs: number,
) => Effect.Effect<string, CliFailure, Cli>;

function defaultCommandRunner(
  executable: string,
  arguments_: readonly string[],
): Effect.Effect<void, CliFailure, Cli> {
  return Effect.gen(function* () {
    const cli = yield* Cli;
    const result = yield* cli.run(executable, arguments_, {
      timeoutMs: SUPERSET_COMMAND_TIMEOUT_MS,
      maximumOutputBytes: SUPERSET_QUERY_OUTPUT_LIMIT,
      provider: SUPERSET_PROVIDER,
    });
    if (result.exitCode !== 0) {
      return yield* Effect.fail(
        new CliFailure({ failure: CLI_FAILURE.TRANSIENT, provider: SUPERSET_PROVIDER }),
      );
    }
  });
}

function defaultQueryRunner(
  executable: string,
  arguments_: readonly string[],
  timeoutMs: number,
): Effect.Effect<string, CliFailure, Cli> {
  return Effect.gen(function* () {
    const cli = yield* Cli;
    const result = yield* cli.run(executable, arguments_, {
      timeoutMs,
      maximumOutputBytes: SUPERSET_QUERY_OUTPUT_LIMIT,
      provider: SUPERSET_PROVIDER,
    });
    if (result.exitCode !== 0) {
      return yield* Effect.fail(
        new CliFailure({
          failure: CLI_FAILURE.TRANSIENT,
          exitCode: result.exitCode,
          provider: SUPERSET_PROVIDER,
        }),
      );
    }
    return result.stdout;
  });
}

export interface SupersetCliOptions {
  homeDirectory: string;
  run?: SupersetCommandRunner;
  query?: SupersetQueryRunner;
  uniqueId?: () => string;
  organizationId?: () => Effect.Effect<string | undefined, never, Cli>;
}

export class SupersetCli {
  readonly #homeDirectory: string;
  readonly #run: SupersetCommandRunner;
  readonly #query: SupersetQueryRunner;
  readonly #uniqueId: () => string;
  readonly #organizationId: () => Effect.Effect<string | undefined, never, Cli>;

  constructor(options: SupersetCliOptions) {
    this.#homeDirectory = options.homeDirectory;
    this.#run = options.run ?? defaultCommandRunner;
    this.#uniqueId = options.uniqueId ?? randomUUID;
    this.#organizationId =
      options.organizationId ??
      (() =>
        Effect.gen(function* () {
          const cli = yield* Cli;
          const result = yield* cli
            .run(
              "/usr/bin/plutil",
              [
                "-extract",
                "organizationId",
                "raw",
                "-o",
                "-",
                path.join(options.homeDirectory, "config.json"),
              ],
              {
                timeoutMs: 2_000,
                maximumOutputBytes: SUPERSET_QUERY_OUTPUT_LIMIT,
                provider: SUPERSET_PROVIDER,
              },
            )
            .pipe(Effect.catchAll(() => Effect.succeed({ exitCode: 1, stdout: "" })));
          return result.exitCode === 0 ? result.stdout : undefined;
        }));
    this.#query = options.query ?? defaultQueryRunner;
  }

  get executable(): string {
    return path.join(this.#homeDirectory, "bin", "superset");
  }

  connected(): Effect.Effect<boolean, never, Cli | Files> {
    return Effect.gen(this, function* () {
      if (!(yield* this.installed())) return false;
      const organization = yield* this.#organizationId().pipe(
        Effect.catchAll(() => Effect.succeed(undefined)),
      );
      return (organization?.trim().length ?? 0) > 0;
    });
  }

  installed(): Effect.Effect<boolean, never, Files> {
    return Effect.gen(this, function* () {
      const files = yield* Files;
      const stats = yield* files
        .stat(this.executable)
        .pipe(Effect.catchAll(() => Effect.succeed(undefined)));
      return stats?.isFile() ?? false;
    });
  }

  chooseOrganization(slug: string): Effect.Effect<boolean, never, Cli | Files> {
    return Effect.gen(this, function* () {
      const choices = yield* this.organizations();
      const choice = choices.find((organization) => organization.slug === slug);
      if (!choice) return false;
      yield* this.#query(
        this.executable,
        ["organization", "switch", choice.slug, "--json"],
        30_000,
      ).pipe(Effect.catchAll(() => Effect.void));
      return yield* this.connected();
    });
  }

  organizations(): Effect.Effect<readonly SupersetOrganizationChoice[], never, Cli> {
    return Effect.gen(this, function* () {
      const output = yield* this.#query(
        this.executable,
        ["organization", "list", "--json"],
        30_000,
      ).pipe(Effect.catchAll(() => Effect.succeed("")));
      if (!output) return [];
      try {
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
    });
  }

  workspaceProjects(
    defaultAgent?: string,
  ): Effect.Effect<readonly WorkspaceProject[], never, Cli | Files> {
    return Effect.gen(this, function* () {
      if (!(yield* this.connected())) return [];
      const remoteHosts = yield* this.#records(["hosts", "list", "--json"]);
      const targets = [
        { id: LOCAL_TARGET_ID, name: "This Mac", arguments_: ["--local"] as const },
        ...remoteHosts.slice(0, SUPERSET_TARGET_LIMIT).flatMap((host) => {
          const id = text(host.machineId) ?? text(host.id);
          const name = text(host.name) ?? text(host.displayName) ?? text(host.hostname) ?? id;
          return id && name ? [{ id, name, arguments_: ["--host", id] as const }] : [];
        }),
      ];
      const projects = yield* Effect.all(
        targets.map((target) =>
          Effect.gen(this, function* () {
            const [projectRows, agentRows] = yield* Effect.all([
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
        ),
      );
      return projects.flat();
    });
  }

  createWorkspace(
    request: ProviderWorkspaceRequest,
  ): Effect.Effect<ProviderWorkspaceResult, never, Cli | Files> {
    return Effect.gen(this, function* () {
      if (!request.providerTargetId || !request.agent || !request.task) {
        return {
          status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
          reason: "A Superset workspace needs a host, an agent, and an opening task.",
        };
      }
      const offered = (yield* this.workspaceProjects()).some(
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
      if (!(yield* this.connected())) return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
      const queryOutcome = yield* Effect.either(this.#query(this.executable, arguments_, 30_000));
      if (queryOutcome._tag === "Left") {
        const left = queryOutcome.left;
        const stderr = left.stderr;
        return {
          status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
          reason: supersetFailureReason(
            stderr !== undefined
              ? unparsedWire({ stderr })
              : unparsedWire(
                  `Superset exited with status ${
                    left instanceof CliFailure ? (left.exitCode ?? "unknown") : "unknown"
                  }.`,
                ),
          ),
        };
      }
      const output = queryOutcome.right;
      const parsed = (() => {
        try {
          return unparsedWire(JSON.parse(output));
        } catch {
          return undefined;
        }
      })();
      if (!parsed) {
        return {
          status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED,
          warning: "The workspace was created, but Superset could not open it.",
        };
      }
      const workspaceRecord = wireRecord(parsed);
      const workspaceId = workspaceRecord
        ? (text(workspaceRecord.workspaceId) ?? text(workspaceRecord.id))
        : undefined;
      if (!workspaceId) return { status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED };
      const opened = yield* this.#run(this.executable, [
        "workspaces",
        "open",
        workspaceId,
        ...(request.providerTargetId === LOCAL_TARGET_ID
          ? []
          : ["--host", request.providerTargetId]),
        "--json",
      ]).pipe(
        Effect.as(true),
        Effect.catchAll(() => Effect.succeed(false)),
      );
      if (opened) return { status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED };
      return {
        status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED,
        warning: "The workspace was created, but Superset could not open it.",
      };
    });
  }

  sendMessage(
    context: SupersetSessionContext,
    messageText: string,
  ): Effect.Effect<ProviderMessageResult, never, Cli | Files> {
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
        messageText,
        "--json",
      ],
      "Superset could not deliver that message.",
    );
  }

  executeControl(
    context: SupersetSessionContext,
    controlId: string,
  ): Effect.Effect<ProviderControlResult, never, Cli | Files> {
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
    return Effect.succeed({ status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED });
  }

  createAgent(
    context: SupersetSessionContext,
    agent: string,
    task: string | undefined,
  ): Effect.Effect<ProviderWorkspaceResult, never, Cli | Files> {
    if (!task) {
      return Effect.succeed({
        status: PROVIDER_ACT_RESULT_STATUS.REJECTED,
        reason: "A Superset agent needs an opening task.",
      });
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

  #act(
    arguments_: readonly string[],
    reason: string,
  ): Effect.Effect<ProviderControlResult, never, Cli | Files> {
    return Effect.gen(this, function* () {
      if (!(yield* this.connected())) return { status: PROVIDER_ACT_RESULT_STATUS.UNSUPPORTED };
      yield* this.#run(this.executable, arguments_);
      return { status: PROVIDER_ACT_RESULT_STATUS.ACCEPTED };
    }).pipe(
      Effect.catchAll(() =>
        Effect.succeed({ status: PROVIDER_ACT_RESULT_STATUS.REJECTED, reason }),
      ),
    );
  }

  #records(arguments_: readonly string[]): Effect.Effect<readonly WireRecord[], never, Cli> {
    return Effect.gen(this, function* () {
      const output = yield* this.#query(this.executable, arguments_, 30_000).pipe(
        Effect.catchAll(() => Effect.succeed("")),
      );
      if (!output) return [];
      try {
        const parsed = unparsedWire(JSON.parse(output));
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
    });
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

  observe(): Effect.Effect<readonly never[], never, never> {
    return Effect.succeed([]);
  }

  refresh(
    defaultAgent: string | undefined,
    connected: boolean,
  ): Effect.Effect<void, never, Cli | Files> {
    return Effect.gen(this, function* () {
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
      this.#projects = yield* this.#cli.workspaceProjects(defaultAgent);
      this.#defaultAgent = defaultAgent;
      this.#projectsRefreshedAt = this.#projects.length > 0 ? now : undefined;
    });
  }

  override workspaceProjects(): readonly WorkspaceProject[] {
    return this.#projects;
  }

  override createWorkspace(
    request: ProviderWorkspaceRequest,
  ): Effect.Effect<ProviderWorkspaceResult, never, Cli | Files> {
    return this.#cli.createWorkspace(request);
  }
}
