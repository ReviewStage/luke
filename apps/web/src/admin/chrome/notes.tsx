import { TEXT_TONE, Text } from "@luke/ui";
import { formatNumber } from "@luke/ui/admin-format";

/** A note under the section it explains, in the muted body role. */
function SectionNote({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mt-3">
      <Text tone={TEXT_TONE.MUTED}>{children}</Text>
    </div>
  );
}

export function RetentionNote(): React.JSX.Element {
  return (
    <SectionNote>
      Each cell is the share of one UTC week's signups that spent hosted voice or attention that
      many weeks after signup. Wk 0 is the signup week, and dashed cells are still accruing. Local
      use of the desktop app writes no row here, so a cohort that never touched the hosted tier
      reads the same as one that left.
    </SectionNote>
  );
}

export function TopAccountsNote(): React.JSX.Element {
  return (
    <SectionNote>
      An active day is a UTC day the account spent hosted voice or attention.
    </SectionNote>
  );
}

export function AccountActivityNote(): React.JSX.Element {
  return (
    <SectionNote>
      An active day is a UTC day this account spent hosted voice or attention. Local use of the
      desktop app writes no row here. Launch activity is in product analytics, not this database.
    </SectionNote>
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
    <SectionNote>
      Active days count the window's UTC days with hosted voice or attention. Last seen is the
      account's latest sign-in session, which a sign-in moves without any hosted use.
      {truncatedTo !== undefined
        ? searched
          ? ` Only the ${formatNumber(truncatedTo)} most recently active matches are listed. Narrow the search to reach the rest.`
          : ` Only the ${formatNumber(truncatedTo)} most recently active accounts are listed. Search reads every account.`
        : ""}
    </SectionNote>
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
    <SectionNote>
      Voice and attention count the hosted-tier calls each account spent on this UTC day.
      {truncatedTo !== undefined
        ? ` Only the ${formatNumber(truncatedTo)} busiest accounts are listed. The totals count all ${formatNumber(totalAccounts)}.`
        : ""}
    </SectionNote>
  );
}
