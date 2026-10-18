import { DEFAULT_ISSUE_FILTER, type IssueFilter } from "@luke/features/issue-list-model";
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
 * workspace's filter never changes another's. Each is kept under the
 * reader's account as well, so Me, which names the reader's account, never
 * filters another account signed in on this Mac to someone else's issues.
 * A workspace with no filter kept draws under the first filter, which
 * leaves out only settled issues gone quiet (`DEFAULT_ISSUE_FILTER`).
 */

/** Where the filters are kept in the renderer's storage. */
const STORAGE_KEY = "luke.issuesFilters";

/** Each reader's filter of each workspace, by the reader's account id and then the workspace's id. */
const storedFilters = Schema.fromJsonString(
  Schema.Record(
    Schema.String,
    Schema.Record(
      Schema.String,
      Schema.Struct({
        priorities: Schema.optionalKey(Schema.Array(issuePrioritySchema)),
        createdBy: Schema.optionalKey(Schema.String),
        showCompleted: Schema.Boolean,
      }),
    ),
  ),
);

type Filters = Readonly<Record<string, Readonly<Record<string, IssueFilter>>>>;

/** The listed workspace's filter, and the press that changes it. */
export interface IssueFilterControl {
  readonly filter: IssueFilter;
  readonly onFilter: (filter: IssueFilter) => void;
}

/** The reader's filter of the workspace listed, kept as each choice is made; none kept while either is unknown. */
export function useIssueFilter(
  readerId: string | undefined,
  workspaceId: string | undefined,
): IssueFilterControl {
  const [filters, setFilters] = useState<Filters>(() => readKept(STORAGE_KEY, storedFilters, {}));
  const readers = readerId === undefined ? undefined : filters[readerId];
  const filter =
    (workspaceId === undefined ? undefined : readers?.[workspaceId]) ?? DEFAULT_ISSUE_FILTER;
  return {
    filter,
    onFilter: (next) => {
      if (readerId === undefined || workspaceId === undefined) return;
      const all = { ...filters, [readerId]: { ...readers, [workspaceId]: next } };
      setFilters(all);
      writeKept(STORAGE_KEY, storedFilters, all);
    },
  };
}
