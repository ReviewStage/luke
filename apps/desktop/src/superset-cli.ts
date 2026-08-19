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
import type { SupersetSessionContext } from "./superset-workspaces";

export const SUPERSET_CONTROL_ID = {
  OPEN_WORKSPACE: "superset-open-workspace",
  CLOSE_TERMINAL: "superset-close-terminal",
} as const;

const execFileAsync = promisify(execFile);

export type SupersetCommandRunner = (
  executable: string,
  arguments_: readonly string[],
) => Promise<void>;

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
}

export class SupersetCli {
  readonly #homeDirectory: string;
  readonly #run: SupersetCommandRunner;

  constructor(options: SupersetCliOptions) {
    this.#homeDirectory = options.homeDirectory;
    this.#run = options.run ?? defaultCommandRunner;
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
