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
 * or those a search matches, or the one issue an identifier names, as a
 * link to it drawn in Luke's words asks for its title and state
 * (`linearIssueIdentifierOf`). A plan started from one names it by its id
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

/** A Linear issue's identifier, its team's key and its number, `ENG-123`, as Linear spells it. */
const LINEAR_IDENTIFIER = /^[A-Z][A-Z0-9_]{0,9}-[1-9]\d{0,8}$/u;

/** A Linear issue's identifier, as a read of one issue names it. */
export const linearIdentifierSchema = EffectSchema.String.check(
  EffectSchema.isPattern(LINEAR_IDENTIFIER),
);

/** Linear's own host, whose `/<workspace>/issue/<identifier>` pages are its issues. */
const LINEAR_HOST = "linear.app";

/** The step before an issue's identifier in its page's path. */
const ISSUE_STEP = "issue";

/**
 * The identifier of the issue a page of Linear's is, `ENG-123` from
 * `https://linear.app/acme/issue/ENG-123/its-title`; nothing for any other
 * address, another of Linear's pages among them.
 */
export function linearIssueIdentifierOf(href: string): string | undefined {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  if (url.hostname !== LINEAR_HOST) return undefined;
  const [first, , step, identifier] = url.pathname.split("/");
  if (first !== "" || step !== ISSUE_STEP || identifier === undefined) return undefined;
  const upper = identifier.toUpperCase();
  return LINEAR_IDENTIFIER.test(upper) ? upper : undefined;
}

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
