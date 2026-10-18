import { type IssueFilter, NO_ISSUE_FILTER } from "@luke/features/issue-list-model";
import { issuePrioritySchema } from "@luke/features/issue-wire";
import { Schema } from "effect";
import { useState } from "react";
import { readKept, writeKept } from "./folded-groups";

/**
 * issue-filter-view.ts -- what the Issues page leaves out of each workspace's issues, kept per workspace on this Mac.
 *
 * The filter is the developer's reading of a workspace's issues, kept in
 * the renderer's own storage as the page's layout and the sidebar's task
 * views are, so it stands when the page opens again on this Mac, and one
 * workspace's filter never changes another's. A workspace with no filter
 * kept leaves nothing out.
 */

/** Where the filters are kept in the renderer's storage. */
const STORAGE_KEY = "luke.issuesFilters";

/** Each workspace's filter, by its id. */
const storedFilters = Schema.fromJsonString(
  Schema.Record(
    Schema.String,
    Schema.Struct({
      priorities: Schema.optionalKey(Schema.Array(issuePrioritySchema)),
      createdBy: Schema.optionalKey(Schema.String),
      showCompleted: Schema.Boolean,
    }),
  ),
);

type Filters = Readonly<Record<string, IssueFilter>>;

/** The listed workspace's filter, and the press that changes it. */
export interface IssueFilterControl {
  readonly filter: IssueFilter;
  readonly onFilter: (filter: IssueFilter) => void;
}

/** The filter of the workspace listed, kept as each choice is made. */
export function useIssueFilter(workspaceId: string | undefined): IssueFilterControl {
  const [filters, setFilters] = useState<Filters>(() => readKept(STORAGE_KEY, storedFilters, {}));
  const filter = (workspaceId === undefined ? undefined : filters[workspaceId]) ?? NO_ISSUE_FILTER;
  return {
    filter,
    onFilter: (next) => {
      if (workspaceId === undefined) return;
      const all = { ...filters, [workspaceId]: next };
      setFilters(all);
      writeKept(STORAGE_KEY, storedFilters, all);
    },
  };
}
