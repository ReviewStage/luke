export function StatCard({
  label,
  value,
  hint,
  title,
  grouped = false,
}: {
  label: string;
  value: string;
  hint?: string | undefined;
  title?: string | undefined;
  grouped?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={
        grouped ? "min-w-0 bg-card px-5 py-4" : "rounded-lg border border-border bg-card px-5 py-4"
      }
      title={title}
    >
      <div className="font-mono text-xs tracking-[0.2px] text-muted-foreground uppercase">
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-1 text-sm text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

/** Related headline metrics share one surface, leaving charts as the dominant objects. */
export function StatGroup({
  columns,
  children,
}: {
  columns: 2 | 3;
  children: React.ReactNode;
}): React.JSX.Element {
  const layout =
    columns === 3
      ? "divide-y min-[720px]:grid-cols-3 min-[720px]:divide-x min-[720px]:divide-y-0"
      : "divide-y min-[520px]:grid-cols-2 min-[520px]:divide-x min-[520px]:divide-y-0";
  return (
    <div
      className={`grid divide-border overflow-hidden rounded-lg border border-border bg-card ${layout}`}
    >
      {children}
    </div>
  );
}

export function SectionHeading({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <h2 className="mt-12 mb-4 text-lg font-semibold tracking-[-0.01em]">{children}</h2>;
}
