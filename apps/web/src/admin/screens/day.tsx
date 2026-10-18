import type { AdminDayAccount, AdminDayDetail } from "@luke/service/admin/admin-day";
import {
  BADGE_TONE,
  Badge,
  CARD_PADDING,
  Card,
  EmptyState,
  Inline,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  UserIcon,
} from "@luke/ui";
import { accountLabel } from "@luke/ui/account-initials";
import { formatDayHeading, formatNumber } from "@luke/ui/admin-format";
import { partialDayKey } from "@luke/ui/daily-series";
import { SectionHeading, STAT_CELL, STAT_ROW, StatCard } from "../charts/stat-card";
import { BackLink } from "../chrome/back-link";
import { AdminErrorCard, ForbiddenCard, SignInCard } from "../chrome/cards";
import { HideAdminsToggle, Refreshing } from "../chrome/controls";
import { DayNote } from "../chrome/notes";
import { AccountAvatar, AdminPage, type ViewerAccount } from "../chrome/page-header";
import { PageSkeleton } from "../chrome/page-skeleton";
import { accountHref, dayReadPath, plainLeftClick } from "../routing";
import { SKELETON_SHAPE, type SkeletonShape } from "../skeleton";
import { type AdminReader, adminReadFailure, useAdminRead } from "../use-admin-read";

const DAY_ERROR = "The day endpoint did not answer.";

/** A cell's room around its words, the same in the heading row and the rows under it. */
const TABLE_CELL = "px-5 py-3";

// SAFETY: a 200 from the admin day endpoint is an AdminDayDetail body by its contract.
const readDayDetail: AdminReader<AdminDayDetail> = async (response) =>
  (await response.json()) as AdminDayDetail;

/** What the day's page says it is, under the heading the address already names. */
const DAY_DESCRIPTION = "One UTC day of hosted-tier calls";

/** One day's own sections. */
const DAY_SHAPES: readonly SkeletonShape[] = [
  { kind: SKELETON_SHAPE.HEADING, label: "Hosted tier · this day" },
  { kind: SKELETON_SHAPE.STAT_CARDS, count: 2, columns: 2 },
  { kind: SKELETON_SHAPE.HEADING, label: "Accounts active this day" },
  { kind: SKELETON_SHAPE.TABLE, rows: 5, numericColumns: 1 },
];

/**
 * The day's accounts, busiest first as the endpoint orders them. The shared
 * `AccountsTable` draws windowed columns a single day does not have, so the
 * day page keeps a table of its own with the same row anatomy: the row for
 * the pointer, and a real anchor on the name so a keyboard reaches it and a
 * modified click still gets the browser's own gesture.
 */
function DayAccountsTable({
  accounts,
  onOpen,
}: {
  accounts: readonly AdminDayAccount[];
  onOpen: (id: string) => void;
}): React.JSX.Element {
  if (accounts.length === 0) {
    return <EmptyState icon={<UserIcon />}>No hosted-tier calls recorded on this day.</EmptyState>;
  }
  return (
    <Card padding={CARD_PADDING.FLUSH}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px]">
          <thead>
            <tr className="border-b border-border text-left">
              <th className={TABLE_CELL}>
                <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.LABEL} tone={TEXT_TONE.MUTED}>
                  Account
                </Text>
              </th>
              <th className={`${TABLE_CELL} text-right`}>
                <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.LABEL} tone={TEXT_TONE.MUTED}>
                  Calls
                </Text>
              </th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer border-b border-border transition-colors duration-150 last:border-0 hover:bg-muted"
                onClick={() => onOpen(row.id)}
              >
                <td className={TABLE_CELL}>
                  <a
                    href={accountHref(row.id)}
                    className="flex items-center gap-3 outline-offset-2"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (!plainLeftClick(event)) return;
                      event.preventDefault();
                      onOpen(row.id);
                    }}
                  >
                    <AccountAvatar
                      account={{ name: row.name, email: row.email, image: row.image ?? undefined }}
                    />
                    <div className="min-w-0">
                      <Inline>
                        <Text as={TEXT_ELEMENT.SPAN} variant={TEXT_VARIANT.LABEL}>
                          {accountLabel(row)}
                        </Text>
                        {row.admin ? <Badge tone={BADGE_TONE.NEUTRAL}>Admin</Badge> : null}
                      </Inline>
                      {accountLabel(row) === row.email ? null : (
                        <Text
                          as={TEXT_ELEMENT.DIV}
                          variant={TEXT_VARIANT.CAPTION}
                          tone={TEXT_TONE.MUTED}
                        >
                          {row.email}
                        </Text>
                      )}
                    </div>
                  </a>
                </td>
                <td className={`${TABLE_CELL} text-right tabular-nums`}>
                  <Text as={TEXT_ELEMENT.SPAN}>{formatNumber(row.calls)}</Text>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export function DayScreen({
  day,
  hideAdmins,
  onHideAdminsChange,
  account,
  onSignOut,
  onBack,
  onOpenAccount,
  frame,
}: {
  day: string;
  hideAdmins: boolean;
  onHideAdminsChange: (hide: boolean) => void;
  account: ViewerAccount | undefined;
  onSignOut: () => Promise<void>;
  onBack: () => void;
  onOpenAccount: (id: string) => void;
  /** Applied around every answer but the gate's own cards, which stand alone. */
  frame: (content: React.JSX.Element) => React.JSX.Element;
}): React.JSX.Element {
  const { state, refreshing, reload, withdraw } = useAdminRead(
    dayReadPath(day, hideAdmins),
    readDayDetail,
    DAY_ERROR,
    { keeps: (shown) => shown.day === day },
  );
  const signOut = () => void withdraw(onSignOut);

  switch (state.status) {
    case "loading":
      return frame(
        <PageSkeleton
          title={formatDayHeading(day)}
          description={DAY_DESCRIPTION}
          account={account}
          onSignOut={signOut}
          controls={<HideAdminsToggle checked={hideAdmins} onChange={onHideAdminsChange} />}
          back={{ tab: "dashboard", label: "Dashboard", onBack }}
          shapes={DAY_SHAPES}
        />,
      );
    case "signed-out":
      return <SignInCard />;
    case "forbidden":
      return <ForbiddenCard email={account?.email} onSignOut={signOut} />;
    case "missing":
    case "error":
      return frame(
        <AdminErrorCard
          detail={adminReadFailure(state, DAY_ERROR)}
          refreshing={refreshing}
          onRetry={reload}
        />,
      );
    case "ready": {
      const detail = state.value;
      const stillFilling = partialDayKey([{ day: detail.day }], detail.generatedAt) !== undefined;
      const soFar = stillFilling ? "so far today" : undefined;

      return frame(
        <AdminPage
          title={formatDayHeading(detail.day)}
          description={`${DAY_DESCRIPTION}${stillFilling ? " — still filling" : ""}`}
          account={account}
          onSignOut={signOut}
          controls={<HideAdminsToggle checked={hideAdmins} onChange={onHideAdminsChange} />}
        >
          <Refreshing failure={state.refreshFailure} refreshing={refreshing} onRetry={reload}>
            <BackLink tab="dashboard" label="Dashboard" onBack={onBack} />

            <SectionHeading>Hosted tier · this day</SectionHeading>
            {/* Note that each card shares the row from nothing up but never
            shrinks below its own figure, so the pair stacks once a figure
            needs the room rather than overflowing its card. */}
            <div className={STAT_ROW}>
              <div className={STAT_CELL}>
                <StatCard
                  label="Active accounts"
                  value={formatNumber(detail.totals.accounts)}
                  hint={soFar}
                />
              </div>
              <div className={STAT_CELL}>
                <StatCard
                  label="Hosted calls"
                  value={formatNumber(detail.totals.calls)}
                  hint={soFar}
                />
              </div>
            </div>

            <SectionHeading>Accounts active this day</SectionHeading>
            <DayAccountsTable accounts={detail.accounts} onOpen={onOpenAccount} />
            {detail.accounts.length > 0 ? (
              <DayNote
                truncatedTo={
                  detail.totals.accounts > detail.accounts.length
                    ? detail.accounts.length
                    : undefined
                }
                totalAccounts={detail.totals.accounts}
              />
            ) : null}
          </Refreshing>
        </AdminPage>,
      );
    }
  }
}
