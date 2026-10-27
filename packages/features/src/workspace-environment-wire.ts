import { Schema as EffectSchema } from "effect";
import { countedNumber } from "./service-wire.js";
import { workspaceIdSchema } from "./task-wire.js";

/**
 * workspace-environment-wire.ts -- a workspace's environment variables and secrets, which its coding agents' sandboxes run every command with.
 *
 * Every coding agent of a workspace runs its shell commands with the
 * workspace's variables and secrets in its environment, as Copilot, Cursor,
 * Devin, and Jules do. A variable is shown to every member with its value; a
 * secret is shown by its name alone once saved, as GitHub's are, and its
 * value is masked in what the agent's commands answer. A member of the
 * workspace reads the list; an owner or admin saves one, replacing the value
 * a name held, or removes one. A value travels once, in the body of the save,
 * and a secret's never again. Every answer carries the list as it then stands.
 *
 * A name is an environment variable's own: upper-case letters, digits, and
 * underscores, not starting with a digit, and not one the sandbox's shell or
 * Luke sets itself (`RESERVED_ENVIRONMENT_NAMES`, `RESERVED_ENVIRONMENT_PREFIXES`).
 */

/** Whether a value is shown to the workspace or kept secret. */
export const WORKSPACE_ENVIRONMENT_KIND = {
  /** Shown to every member, and to the agent, with its value. */
  VARIABLE: "variable",
  /** Shown by its name alone once saved, and masked in what the agent's commands answer. */
  SECRET: "secret",
} as const;

export type WorkspaceEnvironmentKind =
  (typeof WORKSPACE_ENVIRONMENT_KIND)[keyof typeof WORKSPACE_ENVIRONMENT_KIND];

export const WORKSPACE_ENVIRONMENT_BOUNDS = {
  MAX_NAME_CHARS: 128,
  /** The most one value may hold; a certificate or a JSON credential fits. */
  MAX_VALUE_CHARS: 16_384,
  /** The most variables and secrets one workspace may hold together. */
  MAX_ENTRIES: 100,
  /**
   * The shortest secret: the shortest value masked out of what a command
   * answers, since a shorter one would mask ordinary words and numbers too.
   */
  MIN_SECRET_CHARS: 4,
} as const;

/**
 * Names that would steer where the agent's commands, or the process a native
 * agent's harness runs in, find their programs, home, and temporary files, or
 * that would steer the harness itself, which holds the member's own
 * credential (its loader, its runtime's options, its proxy, the certificates
 * it trusts), which no workspace may set. Note that a name only a shell's
 * looks or habits read (`TERM`, `PAGER`, `LANG`) is left to the workspace, as
 * GitHub leaves every name but its own prefix.
 */
const RESERVED_ENVIRONMENT_NAMES: ReadonlySet<string> = new Set([
  "ALL_PROXY",
  "BASH_ENV",
  "ENV",
  "HOME",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "NODE_EXTRA_CA_CERTS",
  "NODE_OPTIONS",
  "NODE_PATH",
  "PATH",
  "SHELL",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TMPDIR",
]);

/**
 * Prefixes Luke, eve, and Vercel set variables under in the sandbox, and
 * those Claude Code, Codex, and their providers read their credential and
 * settings under, or the dynamic loader its libraries, which no workspace
 * may take.
 */
const RESERVED_ENVIRONMENT_PREFIXES: readonly string[] = [
  "LUKE_",
  "EVE_",
  "VERCEL_",
  "ANTHROPIC_",
  "CLAUDE_",
  "CODEX_",
  "OPENAI_",
  "DYLD_",
  "LD_",
];

/** A name a shell takes: capital letters, digits, and underscores, not starting with a digit. */
export const ENVIRONMENT_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/u;

/** Whether a name is one the workspace may set. */
export function environmentNameAllowed(name: string): boolean {
  return (
    !RESERVED_ENVIRONMENT_NAMES.has(name) &&
    !RESERVED_ENVIRONMENT_PREFIXES.some((prefix) => name.startsWith(prefix))
  );
}

const workspaceEnvironmentNameSchema = EffectSchema.String.check(
  EffectSchema.isMaxLength(WORKSPACE_ENVIRONMENT_BOUNDS.MAX_NAME_CHARS),
  EffectSchema.isPattern(ENVIRONMENT_NAME_PATTERN),
  EffectSchema.makeFilter(environmentNameAllowed),
);

const kindSchema = EffectSchema.Literals(Object.values(WORKSPACE_ENVIRONMENT_KIND));

/** What a member sees of one variable or secret. */
const workspaceEnvironmentEntrySchema = EffectSchema.Struct({
  name: EffectSchema.String,
  kind: kindSchema,
  /** A variable's value; absent for a secret, and for a value the service can no longer read. */
  value: EffectSchema.optionalKey(EffectSchema.String),
  /** False where the service can no longer decrypt the value, which then reaches no sandbox until it is saved again. */
  readable: EffectSchema.Boolean,
  /** When it was last saved, in epoch milliseconds. */
  updatedAt: countedNumber,
});

export type WorkspaceEnvironmentEntry = typeof workspaceEnvironmentEntrySchema.Type;

/** Why a save kept nothing. */
export const WORKSPACE_ENVIRONMENT_REJECTION = {
  /** The workspace holds `MAX_ENTRIES` already, and the save names a new one. */
  TOO_MANY: "too_many",
} as const;

/** The workspace's variables and secrets by name (every answer), with why a save kept nothing where it did. */
export const workspaceEnvironmentAnswerSchema = EffectSchema.Struct({
  entries: EffectSchema.Array(workspaceEnvironmentEntrySchema),
  rejected: EffectSchema.optionalKey(
    EffectSchema.Literals(Object.values(WORKSPACE_ENVIRONMENT_REJECTION)),
  ),
});

export type WorkspaceEnvironmentAnswer = typeof workspaceEnvironmentAnswerSchema.Type;

/** The list read by a member (POST). */
export const workspaceEnvironmentListRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
});

/** One variable or secret saved by an owner or admin (POST), replacing what the name held, of either kind. */
export const workspaceEnvironmentSaveRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  name: workspaceEnvironmentNameSchema,
  kind: kindSchema,
  /**
   * The value, of either kind. Note that it is named for a secret whatever
   * its kind, so Sentry's default denylist, which replaces a field by its
   * name, keeps it out of a request's trace (`PRIVACY.md`).
   */
  secretValue: EffectSchema.String.check(
    EffectSchema.isMinLength(1),
    EffectSchema.isMaxLength(WORKSPACE_ENVIRONMENT_BOUNDS.MAX_VALUE_CHARS),
    // A NUL ends a C string, so no environment can carry one.
    EffectSchema.isPattern(/^[^\0]*$/u),
  ),
}).check(
  // A secret too short to mask is refused rather than kept and printed whole.
  EffectSchema.makeFilter(
    (asked) =>
      asked.kind !== WORKSPACE_ENVIRONMENT_KIND.SECRET ||
      asked.secretValue.length >= WORKSPACE_ENVIRONMENT_BOUNDS.MIN_SECRET_CHARS,
  ),
);

export type WorkspaceEnvironmentSaveRequest = typeof workspaceEnvironmentSaveRequestSchema.Type;

/** One variable or secret removed by an owner or admin (POST); removing a name the workspace does not hold moves nothing. */
export const workspaceEnvironmentRemoveRequestSchema = EffectSchema.Struct({
  workspaceId: workspaceIdSchema,
  name: EffectSchema.String,
});

export type WorkspaceEnvironmentRemoveRequest = typeof workspaceEnvironmentRemoveRequestSchema.Type;
