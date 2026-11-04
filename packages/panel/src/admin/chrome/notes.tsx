import { RETENTION_BASIS, type RetentionBasis } from "@repo/features/admin-overview-vocabulary";
import { formatCount } from "@repo/features/number-format";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { TEXT_TONE, Text } from "@repo/ui";

/**
 * Why the hosted tier's figures stand under a retired heading: the voice
 * service that made most of its calls left on Oct 28, 2026 (#5712), and every
 * model call runs on the account's own key, so dictation alone still meters.
 */
const HOSTED_TIER_RETIRED =
  "The hosted tier is retired: since Oct 28, 2026, only dictation writes its rows, so an account working through tasks and agents can read as idle here.";

/**
 * A section's title marked retired, for what measures a feature the product
 * no longer has. Such a section stands at the bottom of its page, under every
 * live one.
 */
export function retiredTitle(title: string): string {
  return `${title} · retired`;
}

/** A note under the cards of the section it explains, in the muted body role; the section stands it. */
function SectionNote({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <Text tone={TEXT_TONE.MUTED}>{children}</Text>;
}

/**
 * What every figure on a page is, where its title cannot say it: a muted
 * line at the top of its content, since the toolbar holds a title alone;
 * the page stands it a section's gap above the first section.
 */
export function PageNote({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <Text tone={TEXT_TONE.MUTED}>{children}</Text>;
}

/**
 * What a retention cell counts, by the grid's basis: a meaningful action, or
 * any hosted-tier call, the basis the grid had before the Overview was rebuilt.
 */
export function RetentionNote({ basis }: { basis: RetentionBasis }): React.JSX.Element {
  return (
    <SectionNote>
      Each cell is the share of one UTC week's signups that{" "}
      {basis === RETENTION_BASIS.MEANINGFUL
        ? "created a task, wrote a plan revision, or started an agent"
        : "made a hosted-tier call"}{" "}
      that many weeks after signup. Wk 0 is the signup week, and dashed cells are still accruing.
      {basis === RETENTION_BASIS.MEANINGFUL
        ? " A deleted task takes its agents and revisions with it, so a cohort's past weeks can shrink."
        : ` Local use of the desktop app writes no row here, so a cohort that never touched the hosted tier reads the same as one that left. ${HOSTED_TIER_RETIRED}`}
    </SectionNote>
  );
}

export function TopAccountsNote(): React.JSX.Element {
  return (
    <SectionNote>
      An active day is a UTC day the account created a task, wrote a plan revision, or started an
      agent. PRs merged count its agents' pull requests merged in the window. Last seen is the
      account's latest sign-in session.
    </SectionNote>
  );
}

/** What the activity chart and the headline tiles count, and what they cannot. */
export function ActivityNote(): React.JSX.Element {
  return (
    <SectionNote>
      An active developer created a task, wrote a plan revision, or started an agent in the last 7
      UTC days. Plan revisions count the developer's own, and the notes {PRODUCT_NAME}'s retired
      notetaker took before agents wrote plans; automation runs leave out the ones a guard held
      back. A deleted task leaves no row, and takes its agents and revisions with it, so past counts
      can shrink.
    </SectionNote>
  );
}

/** How the agents-by-origin rows split the week's agents, and where pilots stand. */
export function AgentOriginsNote(): React.JSX.Element {
  return (
    <SectionNote>
      Each agent started counts under one origin, the first that fits: an automation's run, then a
      message to the Slack bot, then another agent's start_agent, then by hand, which is every agent
      the others leave, so the rows sum to the week's agents started. A pilot's coders count under
      Another agent; pilots counts the task pilots among the week's agents, whatever started them.
    </SectionNote>
  );
}

export function AccountActivityNote(): React.JSX.Element {
  return (
    <SectionNote>
      {HOSTED_TIER_RETIRED} An active day is a UTC day this account made a hosted-tier call. Local
      use of the desktop app writes no row here. Launch activity is in product analytics, not this
      database.
    </SectionNote>
  );
}

/** What the account page's live activity counts: the Overview's and the roster's active day. */
export function AccountActionsNote(): React.JSX.Element {
  return (
    <SectionNote>
      An active day is a UTC day the account created a task, wrote a plan revision, or started an
      agent. Plan revisions count the account's own. The streak, Last active, and the calendar read
      back a trailing year. A deleted task takes its agents and revisions with it, so past days can
      empty.
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
      An active day is a UTC day the account created a task, wrote a plan revision, or started an
      agent. Last active is the latest such day in the past year, and the roster is ranked by it.
      Last seen is the account's latest sign-in session.
      {truncatedTo !== undefined
        ? searched
          ? ` Only the ${formatCount(truncatedTo)} most recently active matches are listed. Narrow the search to reach the rest.`
          : ` Only the ${formatCount(truncatedTo)} most recently active accounts are listed. Search reads every account.`
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
      Calls count the hosted-tier calls each account made on this UTC day. {HOSTED_TIER_RETIRED}
      {truncatedTo !== undefined
        ? ` Only the ${formatCount(truncatedTo)} busiest accounts are listed. The totals count all ${formatCount(totalAccounts)}.`
        : ""}
    </SectionNote>
  );
}

/**
 * What the Day page's live figures count: one UTC day of the Overview's
 * activity chart, and who was active in it.
 */
export function DayActivityNote({
  truncatedTo,
  activeDevelopers,
}: {
  truncatedTo?: number | undefined;
  activeDevelopers: number;
}): React.JSX.Element {
  return (
    <SectionNote>
      An active account created a task, wrote a plan revision, or started an agent on this UTC day.
      The totals are this day's bar on the Overview's activity chart, so plan revisions count the
      notes {PRODUCT_NAME}'s retired notetaker took too, and automation runs leave out the ones a
      guard held back.
      {truncatedTo !== undefined
        ? ` Only the ${formatCount(truncatedTo)} busiest accounts are listed. Active developers counts all ${formatCount(activeDevelopers)}.`
        : ""}
    </SectionNote>
  );
}

/** Why the app's own turns stand under a retired heading on Reliability. */
export function AppTurnsNote(): React.JSX.Element {
  return (
    <SectionNote>
      Every conversation the service starts now is an agent's, so only {PRODUCT_NAME}'s own turns
      from before that still count here, and the rate falls silent as they leave the window.
    </SectionNote>
  );
}
