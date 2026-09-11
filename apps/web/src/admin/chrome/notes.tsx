import { formatNumber } from "../format";

export function RetentionNote(): React.JSX.Element {
  return (
    <p className="mt-3 text-sm text-muted-foreground">
      Each cell is the share of one UTC week's signups that spent hosted voice or attention that
      many weeks after signup — Wk 0 is activation in the signup week itself, and dashed cells are
      still accruing. Purely local use of the desktop app writes no row here, so a cohort that never
      touched the hosted tier reads the same as one that left.
    </p>
  );
}

export function TopAccountsNote(): React.JSX.Element {
  return (
    <p className="mt-3 text-sm text-muted-foreground">
      An active day is a UTC day the account spent hosted voice or attention — the one per-account
      daily signal the service's own tables hold. A row opens the account's own page.
    </p>
  );
}

export function AccountActivityNote(): React.JSX.Element {
  return (
    <p className="mt-3 text-sm text-muted-foreground">
      An active day is a UTC day this account spent hosted voice or attention — the one per-account
      daily signal the service's own tables hold. Purely local use of the desktop app writes no row
      here; day-level launch activity is recorded as product-analytics events, which live with the
      analytics processor rather than in this database.
    </p>
  );
}

export function RosterNote({
  truncatedTo,
  searched,
}: {
  truncatedTo?: number | undefined;
  searched?: boolean | undefined;
}): React.JSX.Element {
  return (
    <p className="mt-3 text-sm text-muted-foreground">
      Every account the service holds, most recently active first, whether or not it ever touched
      the hosted tier — active days count the window's UTC days with hosted voice or attention,
      while last seen is the account's freshest sign-in session, which a plain sign-in moves without
      any hosted use. A heading sorts by its column, a row opens the account's own page, and a row's
      star favorites the account for you alone, following your sign-in rather than this browser.
      {truncatedTo !== undefined
        ? searched
          ? ` Only the ${formatNumber(truncatedTo)} most recently active matching accounts are listed here — narrow the search to reach the rest.`
          : ` Only the ${formatNumber(truncatedTo)} most recently active accounts are listed here — searching reads the whole roster, not just these.`
        : ""}
    </p>
  );
}

export function DayNote({
  truncatedTo,
  totalAccounts,
}: {
  truncatedTo?: number | undefined;
  totalAccounts: number;
}): React.JSX.Element {
  return (
    <p className="mt-3 text-sm text-muted-foreground">
      Voice and attention count the hosted-tier calls each account spent on this UTC day. A row
      opens the account's own page.
      {truncatedTo !== undefined
        ? ` Only the ${formatNumber(truncatedTo)} busiest accounts are listed here — the totals above still count all ${formatNumber(totalAccounts)}.`
        : ""}
    </p>
  );
}
