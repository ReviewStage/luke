import { defineRegistry, JSONUIProvider, Renderer } from "@json-render/react";
import { type ReactNode, useMemo } from "react";
import { Badge } from "../components/badge/badge.js";
import { CARD_CORNER, CARD_LOOK, Card } from "../components/card/card.js";
import {
  DATA_TABLE_COLUMN_KIND,
  DataTable,
  type DataTableColumn,
} from "../components/data-table/data-table.js";
import { Fact, Facts } from "../components/facts/facts.js";
import { ALIGN, GAP, Inline, JUSTIFY, Stack } from "../components/layout/layout.js";
import { LIST_DENSITY, LIST_VARIANT, List, ListRow } from "../components/list-row/list-row.js";
import { TEXT_ELEMENT, TEXT_TONE, TEXT_VARIANT, Text } from "../components/text/text.js";
import { STATUS_TONE, type StatusTone } from "../status-tone.js";
import { LUKE_UI_CATALOG, readLukeUiSpec } from "./luke-ui-catalog.js";
import { LUKE_UI_COMPONENT, type LukeUiModule } from "./luke-ui-contract.js";

/**
 * luke-ui-spec.tsx -- a ```` ```luke-ui ```` fence's spec drawn with `@luke/ui`'s own components, or its fallback where the spec cannot be read.
 *
 * Each component the catalog names (`luke-ui-catalog.ts`) is drawn here by
 * the `@luke/ui` component it stands for: a Card, Facts, a DataTable, a
 * Badge, a List of ListRows, and Text, so a spec is drawn in the window's
 * one design system and nothing json-render ships. A spec is read before it
 * is drawn, and one the reading refuses draws the caller's fallback, which
 * a transcript makes the fence's code card; json-render's renderer would
 * otherwise draw nothing for a component it has no entry for. What a
 * component throws while drawing, json-render's boundary around each element
 * catches, drawing that element as nothing.
 *
 * The renderer stands inside json-render's provider, which keeps its state,
 * visibility, validation, and actions; a spec here carries none of them, so
 * the provider stays empty and its confirm dialog, drawn only for an
 * action that asks one, is never drawn.
 *
 * Exported at `@luke/ui/luke-ui-spec` alone, as the bundle a transcript
 * imports the first time it draws a whole fence (`luke-ui-contract.ts`).
 */

/** A row of a spec's table, its cells by column, and where it stands among the rows. */
interface TableRow {
  readonly at: number;
  readonly cells: readonly (string | number)[];
}

/** A status as a badge: its words in its tone. */
function StatusBadge({
  status,
}: {
  status: { label: string; tone?: StatusTone | undefined } | undefined;
}): ReactNode {
  if (status === undefined) return null;
  return <Badge tone={status.tone ?? STATUS_TONE.NEUTRAL}>{status.label}</Badge>;
}

/** Each component the catalog names, drawn by the `@luke/ui` component it stands for. */
const { registry } = defineRegistry(LUKE_UI_CATALOG, {
  components: {
    [LUKE_UI_COMPONENT.CARD]: ({ props, children }) => (
      <Card look={CARD_LOOK.RAISED} corner={CARD_CORNER.CONTROL}>
        <Stack gap={GAP.FIELD}>
          <Stack gap={GAP.TIGHT}>
            <Inline justify={JUSTIFY.BETWEEN} align={ALIGN.CENTER}>
              <Text as={TEXT_ELEMENT.H3} variant={TEXT_VARIANT.LABEL}>
                {props.title}
              </Text>
              <StatusBadge status={props.status} />
            </Inline>
            {props.description === undefined ? null : (
              <Text tone={TEXT_TONE.MUTED}>{props.description}</Text>
            )}
          </Stack>
          {children}
        </Stack>
      </Card>
    ),
    [LUKE_UI_COMPONENT.FACTS]: ({ props }) => (
      <Facts>
        {props.items.map((item, at) => (
          <Fact key={at} label={item.label}>
            {item.value}
          </Fact>
        ))}
      </Facts>
    ),
    [LUKE_UI_COMPONENT.TABLE]: ({ props }) => {
      const columns: DataTableColumn<TableRow>[] = props.columns.map((column, at) => ({
        key: String(at),
        label: column.label,
        kind:
          column.numeric === true ? DATA_TABLE_COLUMN_KIND.NUMERIC : DATA_TABLE_COLUMN_KIND.TEXT,
        cell: (row) => row.cells[at] ?? "",
      }));
      return (
        <DataTable
          label={props.label}
          columns={columns}
          rows={props.rows.map((cells, at) => ({ at, cells }))}
          rowKey={(row) => String(row.at)}
          empty={null}
        />
      );
    },
    [LUKE_UI_COMPONENT.BADGE]: ({ props }) => <StatusBadge status={props} />,
    [LUKE_UI_COMPONENT.LIST]: ({ props }) => (
      <List label={props.label} variant={LIST_VARIANT.CARD} density={LIST_DENSITY.COMPACT}>
        {props.items.map((item, at) => (
          <ListRow
            key={at}
            title={item.title}
            description={item.description}
            meta={
              item.meta === undefined && item.status === undefined ? undefined : (
                <Inline gap={GAP.ICON} wrap={false}>
                  {item.meta}
                  <StatusBadge status={item.status} />
                </Inline>
              )
            }
          />
        ))}
      </List>
    ),
    [LUKE_UI_COMPONENT.TEXT]: ({ props }) => (
      <Text tone={props.muted === true ? TEXT_TONE.MUTED : TEXT_TONE.DEFAULT}>{props.text}</Text>
    ),
  },
});

/** A fence's code drawn as the components its spec names, or `fallback` where the spec cannot be read. */
export function LukeUiSpec({ code, fallback }: { code: string; fallback: ReactNode }): ReactNode {
  const spec = useMemo(() => readLukeUiSpec(code), [code]);
  if (spec === undefined) return fallback;
  return (
    <JSONUIProvider registry={registry}>
      <Renderer spec={spec} registry={registry} />
    </JSONUIProvider>
  );
}

/** What the bundle's entry exports (`luke-ui-contract.ts`). */
export const lukeUi: LukeUiModule = { LukeUiSpec };
