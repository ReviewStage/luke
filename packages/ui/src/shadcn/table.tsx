import type * as React from "react";
import { cn } from "../cn.js";

/**
 * table.tsx -- shadcn/ui's table (style `base-nova`), vendored and drawn in Luke's table.
 *
 * The component is shadcn's own source, kept as close to it as the window
 * allows, so a later `shadcn add table` reads as a small diff. Its local
 * changes:
 *
 * - `Table`'s container sets the body type, family, and ink the table's
 *   words read, its classes a plain string, because tailwind-merge reads a
 *   type role (`text-body`) as an ink and would drop one of the two; the
 *   table itself collapses its borders and keeps every cell to one line, so
 *   the container scrolls sideways rather than a narrow table splitting a
 *   count or an email mid-word.
 * - `TableHeader`'s and `TableRow`'s rules are the hairline border ink, set
 *   where shadcn leans on its preflight's, which the window does not load.
 * - `TableRow` carries no hover, open, or selected fill and no transition
 *   of its own: a row is lit under the pointer only where it opens
 *   something, which its caller says, and the window's tables select no row.
 * - `TableHead` and `TableCell` are padded alike, a column's words aligned
 *   to its start and in the weight around them, with no height floor and no
 *   rule for a checkbox column, which the window's tables do not draw.
 * - `TableFooter` and `TableCaption` are left out, since no table draws one.
 *
 * `@luke/ui`'s `DataTable` (`components/data-table/data-table.tsx`) is what
 * an app draws; this is its inside.
 */

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto font-body text-body text-foreground"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom border-collapse whitespace-nowrap", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b [&_tr]:border-border", className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr data-slot="table-row" className={cn("border-b border-border", className)} {...props} />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "px-data-table-cell-inline py-data-table-cell-block text-start align-middle [font-weight:inherit] whitespace-nowrap text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-data-table-cell-inline py-data-table-cell-block text-start align-middle whitespace-nowrap",
        className,
      )}
      {...props}
    />
  );
}

export { Table, TableBody, TableCell, TableHead, TableHeader, TableRow };
