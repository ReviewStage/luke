/**
 * workspace-agent-search.ts -- the service's search of a workspace's agents for words, as an `@` list and an automation's "Runs land in" row ask it.
 *
 * Each search is read afresh as it is asked, since an agent may have been
 * started or renamed since, and answered at once where it fails, never tried
 * again on its own, so a list says it could not search rather than waiting.
 */

import { ACT_KIND } from "@repo/host/acts";
import { queryOptions, skipToken } from "@tanstack/react-query";
import { askAct } from "../act.js";
import { QUERY_ROOT } from "../query-keys.js";

/** What narrows a search beyond its words: one repository's agents, and archived ones among them. */
interface SearchNarrowing {
  readonly repository?: string | undefined;
  readonly includeArchived?: boolean | undefined;
}

/** The agents of the workspace the words name; none asked while no workspace is known. */
export function workspaceAgentSearchQueryOptions(
  workspaceId: string | undefined,
  words: string,
  { repository, includeArchived = false }: SearchNarrowing,
) {
  return queryOptions({
    queryKey: [
      QUERY_ROOT.WORKSPACE_AGENTS,
      workspaceId,
      repository ?? null,
      includeArchived,
      words,
    ],
    queryFn:
      workspaceId === undefined
        ? skipToken
        : () =>
            askAct(ACT_KIND.AGENTS_WORKSPACE_LIST, {
              workspaceId,
              words,
              ...(repository === undefined ? undefined : { repository }),
              ...(includeArchived ? { includeArchived } : undefined),
            }),
    retry: false,
  });
}
