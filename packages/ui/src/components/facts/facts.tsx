import type { ReactNode } from "react";

export function Facts({
  ruled = false,
  children,
}: {
  ruled?: boolean | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <dl className="ui-facts" data-ruled={ruled ? "true" : undefined}>
      {children}
    </dl>
  );
}

export function Fact({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div className="ui-fact">
      <dt className="ui-fact-label">{label}</dt>
      <dd className="ui-fact-value">{children}</dd>
    </div>
  );
}
