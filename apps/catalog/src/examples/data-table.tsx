import {
  DATA_TABLE_COLUMN_KIND,
  DATA_TABLE_MIN_WIDTH,
  DataTable,
  type DataTableColumn,
  type DataTableSort,
  GAP,
  Stack,
  TEXT_TONE,
  Text,
} from "@luke/ui";
import { SORT_DIRECTION } from "@luke/ui/sort-direction";
import { useState } from "react";
import type { Example } from "../examples";
import { CatalogSection } from "../section";

/**
 * data-table.tsx -- a table sorted by its headings with rows that open, one
 * that sorts nothing, one with no rows, and a wide table scrolling sideways
 * in a narrow column.
 */

interface Run {
  readonly id: string;
  readonly name: string;
  readonly owner: string;
  readonly minutes: number;
  readonly lastRun: string;
}

type RunKey = "name" | "owner" | "minutes" | "lastRun";

const RUNS: readonly Run[] = [
  {
    id: "nightly",
    name: "Nightly review",
    owner: "ada@example.com",
    minutes: 42,
    lastRun: "Oct 14",
  },
  {
    id: "release",
    name: "Release notes",
    owner: "grace@example.com",
    minutes: 7,
    lastRun: "Oct 12",
  },
  {
    id: "triage",
    name: "Issue triage",
    owner: "alan@example.com",
    minutes: 1204,
    lastRun: "Oct 9",
  },
];

const COLUMNS: readonly DataTableColumn<Run, RunKey>[] = [
  { key: "name", label: "Run", sortable: true, cell: (run) => run.name },
  { key: "owner", label: "Owner", cell: (run) => run.owner },
  {
    key: "minutes",
    label: "Minutes",
    kind: DATA_TABLE_COLUMN_KIND.NUMERIC,
    sortable: true,
    cell: (run) => run.minutes.toLocaleString("en-US"),
  },
  {
    key: "lastRun",
    label: "Last run",
    kind: DATA_TABLE_COLUMN_KIND.NUMERIC,
    cell: (run) => run.lastRun,
  },
];

/** What a run sorts by in each sortable column. */
const SORT_VALUE = {
  name: (run: Run) => run.name,
  owner: (run: Run) => run.owner,
  minutes: (run: Run) => run.minutes,
  lastRun: (run: Run) => run.lastRun,
} satisfies Record<RunKey, (run: Run) => string | number>;

function SortedRuns(): React.JSX.Element {
  const [sort, setSort] = useState<DataTableSort<RunKey>>({
    key: "minutes",
    direction: SORT_DIRECTION.DESCENDING,
  });
  const [opened, setOpened] = useState<string>("none yet");
  const value = SORT_VALUE[sort.key];
  const flip = sort.direction === SORT_DIRECTION.ASCENDING ? 1 : -1;
  const rows = [...RUNS].sort((a, b) => (value(a) < value(b) ? -flip : flip));
  return (
    <Stack gap={GAP.CONTROL}>
      <DataTable
        label="Runs"
        columns={COLUMNS}
        rows={rows}
        rowKey={(run) => run.id}
        empty="No runs yet."
        sort={sort}
        onSort={(key) =>
          setSort({
            key,
            direction:
              sort.key === key && sort.direction === SORT_DIRECTION.DESCENDING
                ? SORT_DIRECTION.ASCENDING
                : SORT_DIRECTION.DESCENDING,
          })
        }
        onRowPress={(run) => setOpened(run.name)}
      />
      <Text tone={TEXT_TONE.MUTED}>Opened: {opened}</Text>
    </Stack>
  );
}

function DataTables(): React.JSX.Element {
  return (
    <>
      <CatalogSection id="data-table-sorted" title="Sorted by its headings, rows that open">
        <SortedRuns />
      </CatalogSection>
      <CatalogSection id="data-table-static" title="A table that sorts nothing">
        <DataTable label="Runs" columns={COLUMNS} rows={RUNS} rowKey={(run) => run.id} empty="" />
      </CatalogSection>
      <CatalogSection id="data-table-empty" title="No rows">
        <DataTable
          label="Runs"
          columns={COLUMNS}
          rows={[]}
          rowKey={(run) => run.id}
          empty="No runs recorded in this window yet."
        />
      </CatalogSection>
      <CatalogSection id="data-table-narrow" title="A wide table in a narrow column">
        <div className="catalog-narrow">
          <DataTable
            label="Runs"
            columns={COLUMNS}
            rows={RUNS}
            rowKey={(run) => run.id}
            empty=""
            minWidth={DATA_TABLE_MIN_WIDTH.NARROW}
          />
        </div>
      </CatalogSection>
    </>
  );
}

export const DATA_TABLE_EXAMPLE: Example = {
  id: "data-table",
  title: "Data tables",
  Render: DataTables,
};
