import type { AdminDayAccount, AdminDayDetail } from "../../../server/admin/admin-day";
import { accountLabel } from "../../account-initials";
import { partialDayKey } from "../../daily-series";
import { SectionHeading, StatCard } from "../charts/stat-card";
import { AdminErrorCard, ForbiddenCard, SignInCard } from "../chrome/cards";
import { HideAdminsToggle, RefreshFailureNotice } from "../chrome/controls";
import { DayNote } from "../chrome/notes";
import { AccountAvatar, PageHeader, type ViewerAccount } from "../chrome/page-header";
import { PageSkeleton } from "../chrome/page-skeleton";
import { formatDayHeading, formatNumber } from "../format";
import { accountHref, dayReadPath, plainLeftClick, tabHref } from "../routing";
import { SKELETON_SHAPE, type SkeletonShape } from "../skeleton";
import { type AdminReader, adminReadFailure, useAdminRead } from "../use-admin-read";

const DAY_ERROR = "The day endpoint did not answer. Try again shortly.";

// SAFETY: a 200 from the admin day endpoint is an AdminDayDetail body by its contract.
const readDayDetail: AdminReader<AdminDayDetail> = async (response) =>
  (await response.json()) as AdminDayDetail;

/** One day's own sections, under the heading the address already names. */
function daySkeletonShapes(day: string): readonly SkeletonShape[] {
  return [
    {
      kind: SKELETON_SHAPE.MASTHEAD,
      title: formatDayHeading(day),
      lines: [{ box: "h-5", bone: "h-3.5 w-56" }],
    },
    { kind: SKELETON_SHAPE.HEADING, label: "Hosted tier · this day" },
    { kind: SKELETON_SHAPE.STAT_CARDS, count: 2, columns: 2 },
    { kind: SKELETON_SHAPE.HEADING, label: "Accounts active this day" },
    { kind: SKELETON_SHAPE.TABLE, rows: 5, numericColumns: 1 },
  ];
}

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
    return (
      <div className="rounded-lg border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
        No hosted-tier calls recorded on this day.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-border text-left font-mono text-xs text-muted-foreground uppercase">
              <th className="px-5 py-3 font-medium">Account</th>
              <th className="px-5 py-3 text-right font-medium">Calls</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((row) => (
              <tr
                key={row.id}
                className="cursor-pointer border-b border-border transition-colors duration-150 last:border-0 hover:bg-muted"
                onClick={() => onOpen(row.id)}
              >
                <td className="px-5 py-3">
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
                    <div>
                      <div className="flex items-center gap-2 font-medium">
                        {accountLabel(row)}
                        {row.admin ? (
                          <span className="rounded-full border border-border px-1.5 py-px font-mono text-[10px] tracking-[0.2px] text-muted-foreground uppercase">
                            Admin
                          </span>
                        ) : null}
                      </div>
                      {accountLabel(row) === row.email ? null : (
                        <div className="text-xs text-muted-foreground">{row.email}</div>
                      )}
                    </div>
                  </a>
                </td>
                <td className="px-5 py-3 text-right tabular-nums">{formatNumber(row.calls)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
          title="Day"
          account={account}
          onSignOut={signOut}
          loading="Reading the day's own rows."
          controls={<HideAdminsToggle checked={hideAdmins} onChange={onHideAdminsChange} />}
          back={{ tab: "dashboard", label: "Dashboard", onBack }}
          shapes={daySkeletonShapes(day)}
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
        <main className="mx-auto max-w-[1040px] px-4 py-8 min-[520px]:px-6 min-[720px]:py-10">
          <PageHeader
            title="Day"
            account={account}
            onSignOut={signOut}
            controls={<HideAdminsToggle checked={hideAdmins} onChange={onHideAdminsChange} />}
          />

          <RefreshFailureNotice
            failure={state.refreshFailure}
            refreshing={refreshing}
            onRetry={reload}
          />

          <div
            className="transition-opacity duration-150 data-[busy=true]:opacity-50"
            data-busy={refreshing}
            aria-busy={refreshing}
          >
            <a
              href={tabHref("dashboard")}
              className="mt-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
              onClick={(event) => {
                if (!plainLeftClick(event)) return;
                event.preventDefault();
                onBack();
              }}
            >
              <span aria-hidden="true">←</span> Dashboard
            </a>

            <div className="mt-6">
              <h1 className="text-2xl font-semibold tracking-[-0.01em]">
                {formatDayHeading(detail.day)}
              </h1>
              <div className="mt-1 text-sm text-muted-foreground">
                One UTC day of hosted-tier calls{stillFilling ? " — still filling" : ""}
              </div>
            </div>

            <SectionHeading>Hosted tier · this day</SectionHeading>
            <div className="grid grid-cols-2 gap-3">
              <StatCard
                label="Active accounts"
                value={formatNumber(detail.totals.accounts)}
                hint={soFar}
              />
              <StatCard
                label="Hosted calls"
                value={formatNumber(detail.totals.calls)}
                hint={soFar}
              />
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
          </div>
        </main>,
      );
    }
  }
}
