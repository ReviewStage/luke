import { ACT_KIND } from "@repo/host/acts";
import { queryOptions, skipToken } from "@tanstack/react-query";
import { askAct } from "../act.js";
import { QUERY_ROOT } from "../query-keys.js";

interface SearchNarrowing {
  readonly repository?: string | undefined;
  readonly includeArchived?: boolean | undefined;
}

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
