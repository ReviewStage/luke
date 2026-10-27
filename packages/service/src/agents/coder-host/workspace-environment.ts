import { RUNNER_ENV, redactSecrets, type WorkspaceEnvironment } from "@luke/agent-runner/protocol";
import type { DatabaseServices } from "@luke/database/core/query";
import { openEnvironmentValue, parseKeyRing } from "@luke/database/models/provider-key-seal";
import {
  listWorkspaceEnvironmentRows,
  sealedOf,
} from "@luke/database/models/workspace-environment-store";
import { CODING_AGENT_MACHINE, type CodingAgentMachine } from "@luke/features/coding-agent-wire";
import { WORKSPACE_ENVIRONMENT_KIND } from "@luke/features/workspace-environment-wire";
import { Effect, Redacted, Result } from "effect";
import type { BashToolOutput } from "eve/tools/bash";
import { HostedEnvironment } from "../../environment.js";

/**
 * workspace-environment.ts -- a workspace's environment variables and secrets, as its coding agents' shell commands run with them.
 *
 * Read afresh for every eve command and every native launch, so a value an
 * owner or admin saves reaches the agent's next command, or the runner its
 * next message relaunches (`runner-sessions.ts`), and one removed reaches
 * none. An eve agent's command exports each value ahead of itself in the one
 * shell eve spawns for it; a native agent's runner is handed them all in its
 * sealed launch environment (`RUNNER_ENV.WORKSPACE`), which it hands on to
 * the harness and so to every command the agent runs. Either way nothing is
 * written to the machine's disk or its snapshot, and nothing reaches a
 * terminal tab. Every secret's value is masked out of what an eve command
 * answers, and out of every event a runner posts, before the model's answer
 * is stored or the transcript keeps it. The mask is no guarantee, since a
 * command may print a value transformed, so AGENTS.md's carve-out for these
 * secrets is what lets one reach the transcript and the model.
 *
 * A workspace's secrets reach Luke's cloud sandboxes alone: an agent on a
 * member's own Mac or host (`CODING_AGENT_MACHINE.DEVICE`) is handed the
 * workspace's variables and none of its secrets, which are not even opened
 * for it.
 *
 * A workspace's values are best effort: a deployment holding no ring, a
 * store that does not answer, or a value the ring no longer opens leaves
 * those values out, logged by kind alone, and the command runs without
 * them rather than failing.
 */

/** What one command or launch runs with: each variable and each secret, by name. */
export type ShellEnvironment = WorkspaceEnvironment;

export const NO_SHELL_ENVIRONMENT: ShellEnvironment = { variables: {}, secrets: {} };

/** Whether a workspace's secrets reach an agent on the machine given: Luke's cloud sandbox alone, and no machine of a member's own. */
function secretsReach(machine: CodingAgentMachine | undefined): boolean {
  return machine === undefined || machine === CODING_AGENT_MACHINE.VERCEL;
}

/** A value as one single-quoted shell word. */
function quoted(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** The readable values of the workspace an agent on the machine given runs with: its variables, and its secrets where they reach that machine. */
export function workspaceShellEnvironment(
  organizationId: string,
  machine: CodingAgentMachine | undefined,
): Effect.Effect<ShellEnvironment, never, DatabaseServices | HostedEnvironment> {
  return Effect.gen(function* () {
    const configured = (yield* HostedEnvironment).providerKeyEncryptionKeys;
    const ring = configured === undefined ? undefined : parseKeyRing(configured);
    if (ring === undefined || Result.isFailure(ring)) return NO_SHELL_ENVIRONMENT;
    const rows = yield* listWorkspaceEnvironmentRows(organizationId);
    const withSecrets = secretsReach(machine);
    const variables: Record<string, string> = {};
    const secrets: Record<string, string> = {};
    for (const row of rows) {
      const secret = row.kind === WORKSPACE_ENVIRONMENT_KIND.SECRET;
      if (secret && !withSecrets) continue;
      const opened = openEnvironmentValue(
        ring.success,
        { organizationId, name: row.name },
        sealedOf(row),
      );
      // Note that an unreadable value is left out rather than failing the command, since its settings row says so.
      if (Result.isFailure(opened)) continue;
      (secret ? secrets : variables)[row.name] = Redacted.value(opened.success);
    }
    return { variables, secrets };
  }).pipe(
    Effect.catch((failure) =>
      Effect.as(
        Effect.logWarning(
          `The environment of workspace ${organizationId} was not read: ${failure._tag}`,
        ),
        NO_SHELL_ENVIRONMENT,
      ),
    ),
  );
}

/** The lines that export every value, for the head of a command; nothing where there is none. */
export function exportLines(environment: ShellEnvironment): string {
  return Object.entries({ ...environment.variables, ...environment.secrets })
    .map(([name, value]) => `export ${name}=${quoted(value)}\n`)
    .join("");
}

/** The runner's launch environment's share of the workspace's values, as `RUNNER_ENV.WORKSPACE` carries them; nothing where there is none. */
export function runnerWorkspaceEnvironment(
  environment: ShellEnvironment,
): Readonly<Record<string, string>> {
  const empty =
    Object.keys(environment.variables).length === 0 &&
    Object.keys(environment.secrets).length === 0;
  return empty ? {} : { [RUNNER_ENV.WORKSPACE]: JSON.stringify(environment) };
}

/** eve's answer to a command with every secret's value redacted out of each of its texts. */
export function maskSecrets(answer: BashToolOutput, environment: ShellEnvironment): BashToolOutput {
  const secrets = Object.values(environment.secrets);
  if (secrets.length === 0) return answer;
  const stdout = redactSecrets(answer.stdout, secrets);
  const stderr = redactSecrets(answer.stderr, secrets);
  switch (answer.status) {
    case "completed":
      return { ...answer, stdout, stderr };
    case "running":
      return { ...answer, stdout, stderr, message: redactSecrets(answer.message, secrets) };
  }
}
