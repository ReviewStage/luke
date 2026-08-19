import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  PROVIDER_ACT_RESULT_STATUS,
  type ProviderControlResult,
  type ProviderMessageResult,
  type ProviderWorkspaceResult,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
}

export class SupersetCli {
  readonly #homeDirectory: string;
  readonly #run: SupersetCommandRunner;
  readonly #query: SupersetQueryRunner;

  constructor(options: SupersetCliOptions) {
    this.#homeDirectory = options.homeDirectory;
    this.#run = options.run ?? defaultCommandRunner;
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
}
