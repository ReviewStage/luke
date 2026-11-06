import { formatCount } from "@repo/features/number-format";
import { BUTTON_VARIANT, Button, GAP, Stack, TEXT_TONE, Text } from "@repo/ui";
import {
  createDataTableColumnHelper,
  DATA_TABLE_COLUMN_KIND,
  DATA_TABLE_MIN_WIDTH,
  DataTable,
  type DataTableColumns,
  type SortingState,
} from "@repo/ui/data-table";
import { useMemo, useState } from "react";
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

const column = createDataTableColumnHelper<Run>();

/** The runs' columns, the name a button that opens its run where `onOpen` is given. */
function runColumns(onOpen?: (run: Run) => void): DataTableColumns<Run> {
  return column.columns([
    column.accessor((run) => run.name, {
      id: "name",
      header: "Run",
      sortFn: "text",
      sortDescFirst: true,
      cell: ({ row: { original: run } }) =>
        // Note that the run's name is a button, so a keyboard opens the row the pointer presses.
        onOpen ? (
          <Button variant={BUTTON_VARIANT.QUIET} onClick={() => onOpen(run)}>
            {run.name}
          </Button>
        ) : (
          run.name
        ),
    }),
    column.display({
      id: "owner",
      header: "Owner",
      cell: ({ row: { original: run } }) => run.owner,
    }),
    column.accessor((run) => run.minutes, {
      id: "minutes",
      header: "Minutes",
      meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
      sortFn: "basic",
      sortDescFirst: true,
      cell: ({ getValue }) => formatCount(getValue()),
    }),
    column.display({
      id: "lastRun",
      header: "Last run",
      meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
      cell: ({ row: { original: run } }) => run.lastRun,
    }),
  ]);
}

/** A table that sorts nothing: its columns with no accessor. */
const STATIC_COLUMNS = column.columns([
  column.display({ id: "name", header: "Run", cell: ({ row: { original: run } }) => run.name }),
  column.display({ id: "owner", header: "Owner", cell: ({ row: { original: run } }) => run.owner }),
  column.display({
    id: "minutes",
    header: "Minutes",
    meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
    cell: ({ row: { original: run } }) => formatCount(run.minutes),
  }),
  column.display({
    id: "lastRun",
    header: "Last run",
    meta: { kind: DATA_TABLE_COLUMN_KIND.NUMERIC },
    cell: ({ row: { original: run } }) => run.lastRun,
  }),
]);

/** The longest runs first. */
const LONGEST_FIRST: SortingState = [{ id: "minutes", desc: true }];

function SortedRuns(): React.JSX.Element {
  const [opened, setOpened] = useState<string>("none yet");
  const columns = useMemo(() => runColumns((run) => setOpened(run.name)), []);
  return (
    <Stack gap={GAP.CONTROL}>
      <DataTable
        label="Runs"
        columns={columns}
        rows={RUNS}
        getRowId={(run) => run.id}
        empty="No runs yet."
        initialSorting={LONGEST_FIRST}
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
        <DataTable
          label="Runs"
          columns={STATIC_COLUMNS}
          rows={RUNS}
          getRowId={(run) => run.id}
          empty=""
        />
      </CatalogSection>
      <CatalogSection id="data-table-empty" title="No rows">
        <DataTable
          label="Runs"
          columns={STATIC_COLUMNS}
          rows={[]}
          getRowId={(run) => run.id}
          empty="No runs recorded in this window yet."
        />
      </CatalogSection>
      <CatalogSection id="data-table-narrow" title="A wide table in a narrow column">
        <div className="catalog-narrow">
          <DataTable
            label="Runs"
            columns={STATIC_COLUMNS}
            rows={RUNS}
            getRowId={(run) => run.id}
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
