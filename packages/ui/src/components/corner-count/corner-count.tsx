import type { ReactNode } from "react";

export function CornerCount({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <span className="ui-corner-count">
      {children}
      {count > 0 ? (
        <span className="ui-corner-count-mark" aria-hidden="true">
          {count}
        </span>
      ) : null}
    </span>
  );
}

export function CornerDot({
  shown,
  children,
}: {
  shown: boolean;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <span className="ui-corner-dot relative inline-flex" data-dot={shown ? "true" : undefined}>
      {children}
      {shown ? (
        <span
          className="ui-corner-dot-mark pointer-events-none absolute top-ui-4 right-ui-4 size-corner-dot rounded-disc bg-accent-ink"
          aria-hidden="true"
        />
      ) : null}
    </span>
  );
}

export function CornerBadge({
  mark,
  children,
}: {
  mark: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <span className="ui-corner-badge relative inline-flex min-w-0">
      {children}
      <span
        className="ui-corner-badge-mark pointer-events-none absolute -top-ui-6 -right-ui-6 inline-grid size-corner-badge place-items-center rounded-disc border border-border-strong bg-ground text-muted-foreground [&>svg]:size-corner-badge-glyph"
        aria-hidden="true"
      >
        {mark}
      </span>
    </span>
  );
}
