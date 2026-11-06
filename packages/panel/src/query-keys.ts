/**
 * query-keys.ts -- the roots every TanStack Query key in the panel starts with.
 *
 * A key is an array, as the docs' Query Keys guide has it: its root from
 * `QUERY_ROOT` first, then the original ids it reads by, each an element of
 * its own (`[QUERY_ROOT.X, workspaceId, taskId]`), never a string built from
 * them. A read adds its root here, in the PR that moves it.
 *
 * Each read is declared once, as a `queryOptions` factory beside the surface
 * family that owns it, as the docs' Query Options guide shows: a function of
 * the ids that answers `queryOptions({ queryKey, queryFn, ... })`, which
 * `useQuery`, `setQueryData`, and `invalidateQueries` all take, so a key and
 * the data under it are typed together and never spelled twice. A `queryFn`
 * runs an Effect only through an edge `tools/anti-slop/effect-edges.json`
 * lists.
 */

import type { QueryClient } from "@tanstack/react-query";

/** The first element of every panel query key, one per read. */
export const QUERY_ROOT = {
  /** The web app's invitation page: the invitation its link names, as the signed-in session reads it. */
  INVITATION_OFFER: "invitation-offer",
  /** The web app's consent page: the client and account an OAuth authorization asks about. */
  CONSENT_REQUEST: "consent-request",
  /** The admin screens' reads and writes (`admin/admin-queries.ts`), each next keyed by its procedure. */
  ADMIN: "admin",
  HOST_PAIRING: "host-pairing",
  INSTALLED_SKILL: "installed-skill",
  INSTALLED_SKILL_PREVIEW: "installed-skill-preview",
  TASK_NEWEST_REVISION: "task-newest-revision",
  WORKSPACE_AGENTS: "workspace-agents",
  REPOSITORY_PATHS: "repository-paths",
  AGENT_PART: "agent-part",
  /** The window's one app-state document (`use-app-state.ts`'s `appStateQuery`), read by no id. */
  APP_STATE: "appState",
  TASK_FILE: "task-file",
  TASK_TREE: "task-tree",
  PAGE_SOURCE: "page-source",
  CODE_COLORING: "code-coloring",
  /** The one-off reads asked as a reader acts (`tasks/agent-reads.ts`). */
  AGENT_PAGE: "agent-page",
  INBOX_ITEM_HOME: "inbox-item-home",
  TASK_BY_NUMBER: "task-by-number",
  AGENT_MESSAGES: "agent-messages",
  REPOSITORY_SKILLS: "repository-skills",
  TERMINAL_LIST: "terminal-list",
  AGENT_CHANGES: "agent-changes",
  /** One version of a plan, as its version history draws it (`tasks/use-plan-history.ts`). */
  TASK_REVISION: "task-revision",
  /** A picture the window reads (`picture-query.ts`'s `pictureQuery`), by what it belongs to and its id there. */
  PICTURE: "picture",
} as const;

/**
 * The roots read as the account signed in but not keyed by it, which the
 * window lets go of once that account changes (`forgetAccountReads`), so the
 * next account is never drawn what the last one read on a task both may
 * open. Note that a new root read as the account, and not keyed by it, joins
 * this list in the PR that adds it, because nothing else lets go of it.
 */
const ACCOUNT_SCOPED_ROOTS: ReadonlySet<unknown> = new Set<string>([
  QUERY_ROOT.TASK_TREE,
  QUERY_ROOT.TASK_FILE,
  QUERY_ROOT.PAGE_SOURCE,
  QUERY_ROOT.REPOSITORY_PATHS,
  QUERY_ROOT.AGENT_PART,
  QUERY_ROOT.TASK_NEWEST_REVISION,
  QUERY_ROOT.AGENT_CHANGES,
  QUERY_ROOT.TASK_REVISION,
  QUERY_ROOT.INSTALLED_SKILL,
  QUERY_ROOT.INSTALLED_SKILL_PREVIEW,
  QUERY_ROOT.HOST_PAIRING,
]);

/**
 * Lets go of every read the window took as the account signed in but keyed
 * by no account, as `forgetPictures` does its pictures: reset rather than
 * removed, so a place still drawing one reads it again as the account now
 * signed in rather than going on drawing the last one's answer.
 */
export function forgetAccountReads(client: QueryClient): Promise<void> {
  return client.resetQueries({ predicate: (query) => ACCOUNT_SCOPED_ROOTS.has(query.queryKey[0]) });
}
