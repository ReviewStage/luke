import type { DatabaseServices } from "@luke/database/core/query";
import { openEnvironmentValue, parseKeyRing } from "@luke/database/models/provider-key-seal";
import {
  listWorkspaceEnvironmentRows,
  sealedOf,
} from "@luke/database/models/workspace-environment-store";
import {
  WORKSPACE_ENVIRONMENT_BOUNDS,
  WORKSPACE_ENVIRONMENT_KIND,
} from "@luke/features/workspace-environment-wire";
import { Effect, Redacted, Result } from "effect";
import type { BashToolOutput } from "eve/tools/bash";
import { HostedEnvironment } from "../../environment.js";

/**
 * workspace-environment.ts -- a workspace's environment variables and secrets, as its coding agents' shell commands run with them.
 *
 * Read afresh for every command, so a value an owner or admin saves reaches
 * the agent's next command, and one removed reaches none. Each value is
 * exported ahead of the command in the one shell eve spawns for it, so it
 * stands in that shell's environment alone: nothing is written to the
 * sandbox's disk or its snapshot, and nothing reaches a terminal tab. Every
 * secret's value is masked out of what the command answers before the model
 * reads it or the transcript keeps it. The mask is no guarantee, since a
 * command may print a value transformed, so AGENTS.md's carve-out for these
 * secrets is what lets one reach the transcript and the model.
 *
 * A workspace's values are best effort: a deployment holding no ring, a
 * store that does not answer, or a value the ring no longer opens leaves
 * those values out, logged by kind alone, and the command runs without
 * them rather than failing.
 */

/** What a secret's value is replaced with in a command's answer. */
export const MASKED_SECRET = "[REDACTED]";

/** The shortest secret masked, which is the shortest the service keeps. */
const MIN_MASKED_CHARS = WORKSPACE_ENVIRONMENT_BOUNDS.MIN_SECRET_CHARS;

/** What one command runs with. */
export interface ShellEnvironment {
  /** Each name and its value, in name order. */
  readonly values: ReadonlyArray<readonly [name: string, value: Redacted.Redacted<string>]>;
  /** The secrets' values, longest first, which every answer is masked of. */
  readonly secrets: readonly Redacted.Redacted<string>[];
}

export const NO_SHELL_ENVIRONMENT: ShellEnvironment = { values: [], secrets: [] };

/** A value as one single-quoted shell word. */
function quoted(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** The workspace's readable values, each secret's kept to mask it. */
export function workspaceShellEnvironment(
  organizationId: string,
): Effect.Effect<ShellEnvironment, never, DatabaseServices | HostedEnvironment> {
  return Effect.gen(function* () {
    const configured = (yield* HostedEnvironment).providerKeyEncryptionKeys;
    const ring = configured === undefined ? undefined : parseKeyRing(configured);
    if (ring === undefined || Result.isFailure(ring)) return NO_SHELL_ENVIRONMENT;
    const rows = yield* listWorkspaceEnvironmentRows(organizationId);
    const values: Array<readonly [string, Redacted.Redacted<string>]> = [];
    const secrets: Redacted.Redacted<string>[] = [];
    for (const row of rows) {
      const opened = openEnvironmentValue(
        ring.success,
        { organizationId, name: row.name },
        sealedOf(row),
      );
      // Note that an unreadable value is left out rather than failing the command, since its settings row says so.
      if (Result.isFailure(opened)) continue;
      values.push([row.name, opened.success]);
      if (row.kind === WORKSPACE_ENVIRONMENT_KIND.SECRET) secrets.push(opened.success);
    }
    secrets.sort((a, b) => Redacted.value(b).length - Redacted.value(a).length);
    return { values, secrets };
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
  return environment.values
    .map(([name, value]) => `export ${name}=${quoted(Redacted.value(value))}\n`)
    .join("");
}

function maskText(text: string, secrets: readonly Redacted.Redacted<string>[]): string {
  let masked = text;
  for (const secret of secrets) {
    const value = Redacted.value(secret);
    if (value.length >= MIN_MASKED_CHARS) masked = masked.replaceAll(value, MASKED_SECRET);
  }
  return masked;
}

/** eve's answer to a command with every secret's value masked out of each of its texts. */
export function maskSecrets(
  answer: BashToolOutput,
  secrets: readonly Redacted.Redacted<string>[],
): BashToolOutput {
  if (secrets.length === 0) return answer;
  const stdout = maskText(answer.stdout, secrets);
  const stderr = maskText(answer.stderr, secrets);
  switch (answer.status) {
    case "completed":
      return { ...answer, stdout, stderr };
    case "running":
      return { ...answer, stdout, stderr, message: maskText(answer.message, secrets) };
  }
}
