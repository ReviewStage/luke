import { Schema as EffectSchema } from "effect";

/**
 * linear-wire.ts -- a workspace's one Linear connection and the issues it reaches, as the desktop reads them.
 *
 * An owner or admin connects Linear once for a whole workspace: the grant
 * Vercel Connect holds is the workspace's, not the admin's account's, so
 * every member of the workspace reads every issue it reaches, a private
 * team's among them, and a member who leaves takes nothing with them.
 * `POST /api/workspaces/linear/connect` begins the browser sign-in and
 * answers the address the desktop opens; the browser returns to
 * `/api/workspaces/linear/connected`, which settles it and lands on the
 * integrations landing page. `POST /api/workspaces/linear/disconnect` ends
 * it and answers the workspace. `POST /api/workspaces/linear/issues`
 * answers the issues a member may start a plan from, newest changed first,
 * or those a search matches. A plan started from one names it by its id
 * (`planCreateRequestSchema`'s `linearIssueId`), and the service reads the
 * issue itself through the workspace's grant and keeps what it read on the
 * plan (`planLinearIssueSchema`), so the plan keeps it after Linear is
 * disconnected. No answer carries a token. The requests that name a
 * workspace are `workspace-wire.ts`'s, beside its GitHub's.
 */

export const LINEAR_BOUNDS = {
  /** The most characters a search may spell. */
  MAX_QUERY_CHARS: 200,
  /** The most issues one read answers. */
  MAX_ISSUES: 50,
  /** The most characters of an issue's description a plan keeps, enough for any brief and short of a document. */
  MAX_DESCRIPTION_CHARS: 20_000,
  /** The most characters an issue's id may spell; Linear's are UUIDs. */
  MAX_ID_CHARS: 100,
} as const;

/** A Linear issue's own id, as Linear minted it. */
export const linearIssueIdSchema = EffectSchema.String.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(LINEAR_BOUNDS.MAX_ID_CHARS),
);

/** One issue as the picker lists it: what a person picks it by. */
export const linearIssueSummarySchema = EffectSchema.Struct({
  id: linearIssueIdSchema,
  /** The issue's key, `ENG-123`. */
  identifier: EffectSchema.String,
  title: EffectSchema.String,
  url: EffectSchema.String,
  /** The name of the workflow state it stands in, `In Progress`; absent where Linear named none. */
  state: EffectSchema.optionalKey(EffectSchema.String),
});

export type LinearIssueSummary = typeof linearIssueSummarySchema.Type;

/**
 * The issue a plan was started from, as the service read it through the
 * workspace's grant when the plan started: what the planning call is told
 * to research, and kept on the plan whatever becomes of the connection.
 */
export const planLinearIssueSchema = EffectSchema.Struct({
  identifier: EffectSchema.String,
  title: EffectSchema.String,
  url: EffectSchema.String,
  /** The issue's description as Markdown, bounded; empty where it has none. */
  description: EffectSchema.String.check(
    EffectSchema.isMaxLength(LINEAR_BOUNDS.MAX_DESCRIPTION_CHARS),
  ),
});

export type PlanLinearIssue = typeof planLinearIssueSchema.Type;

export const linearIssuesAnswerSchema = EffectSchema.Struct({
  issues: EffectSchema.Array(linearIssueSummarySchema).check(
    EffectSchema.isMaxLength(LINEAR_BOUNDS.MAX_ISSUES),
  ),
});

export type LinearIssuesAnswer = typeof linearIssuesAnswerSchema.Type;
