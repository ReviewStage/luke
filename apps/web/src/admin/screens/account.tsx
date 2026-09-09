import type { AdminUserAccount, AdminUserDetail } from "../../../server/admin/admin-user";
import type { AdminMetricsWindow } from "../../../server/admin/http";
import { accountLabel } from "../../account-initials";
import { ActivityCalendar } from "../charts/activity-calendar";
import { SectionHeading, StatCard } from "../charts/stat-card";
import { UsageChart } from "../charts/usage-chart";
import { AdminErrorCard, Centered, ForbiddenCard, SignInCard } from "../chrome/cards";
import { PLAIN_BUTTON, RefreshFailureNotice, WindowSwitcher } from "../chrome/controls";
import { AccountActivityNote } from "../chrome/notes";
import { AccountAvatar, PageHeader, type ViewerAccount } from "../chrome/page-header";
import { PageSkeleton } from "../chrome/page-skeleton";
import { formatDate, formatDayTick, formatNumber, signInMethodLabel } from "../format";
import { accountReadPath, plainLeftClick, tabHref } from "../routing";
import { SKELETON_PLOT, SKELETON_SHAPE, type SkeletonShape } from "../skeleton";
import { type AdminReader, useAdminRead } from "../use-admin-read";

const ACCOUNT_ERROR = "The account endpoint did not answer. Try again shortly.";

// SAFETY: a 200 from the admin user endpoint is an AdminUserDetail body by its contract.
const readUserDetail: AdminReader<AdminUserDetail> = async (response) =>
  (await response.json()) as AdminUserDetail;

/** One account's own sections. */
const ACCOUNT_SHAPES: readonly SkeletonShape[] = [
  {
    kind: SKELETON_SHAPE.MASTHEAD,
    avatar: true,
    lines: [
      { box: "h-8", bone: "h-6 w-48" },
      { box: "h-5", bone: "h-3.5 w-56" },
      { box: "h-4", bone: "h-3 w-40" },
    ],
  },
  { kind: SKELETON_SHAPE.HEADING, label: "Daily use · hosted tier" },
  { kind: SKELETON_SHAPE.STAT_CARDS, count: 4, columns: 4 },
  { kind: SKELETON_SHAPE.CHART, plots: [SKELETON_PLOT.USAGE] },
  { kind: SKELETON_SHAPE.CALENDAR },
  { kind: SKELETON_SHAPE.HEADING, label: "Volume" },
  { kind: SKELETON_SHAPE.STAT_CARDS, count: 3, columns: 3 },
  { kind: SKELETON_SHAPE.STATIC, node: <AccountActivityNote /> },
];

export function AccountScreen({
  id,
  windowDays,
  onWindowDaysChange,
  account,
  onSignOut,
  onBack,
  frame,
}: {
  id: string;
  windowDays: AdminMetricsWindow;
  onWindowDaysChange: (windowDays: AdminMetricsWindow) => void;
  account: ViewerAccount | undefined;
  onSignOut: () => Promise<void>;
  onBack: () => void;
  /** Applied around every answer but the gate's own cards, which stand alone. */
  frame: (content: React.JSX.Element) => React.JSX.Element;
}): React.JSX.Element {
  const { state, refreshing, reload, withdraw } = useAdminRead(
    accountReadPath(id, windowDays),
    readUserDetail,
    ACCOUNT_ERROR,
    { keeps: (shown) => shown.account.id === id },
  );
  const signOut = () => void withdraw(onSignOut);

  switch (state.status) {
    case "loading":
      return frame(
        <PageSkeleton
          title="Account"
          account={account}
          onSignOut={signOut}
          loading="Reading the account's own rows."
          controls={<WindowSwitcher value={windowDays} onChange={onWindowDaysChange} />}
          back={{ tab: "users", label: "All users", onBack }}
          shapes={ACCOUNT_SHAPES}
        />,
      );
    case "signed-out":
      return <SignInCard />;
    case "forbidden":
      return <ForbiddenCard email={account?.email} onSignOut={signOut} />;
    case "missing":
      return frame(
        <Centered title="No such account">
          No account carries this id — it may have been deleted since its row was read.
          <div className="mt-6">
            <button type="button" className={PLAIN_BUTTON} onClick={onBack}>
              Back to users
            </button>
          </div>
        </Centered>,
      );
    case "error":
      return frame(
        <AdminErrorCard detail={state.detail} refreshing={refreshing} onRetry={reload} />,
      );
    case "ready": {
      const detail = state.value;
      const subject: AdminUserAccount = detail.account;
      const activity = detail.activity;
      // A streak as long as the window may run past it; the page says so rather
      // than posing the truncation as the exact count.
      const streak =
        activity.currentStreakDays >= detail.windowDays
          ? `${formatNumber(detail.windowDays)}+`
          : formatNumber(activity.currentStreakDays);

      return frame(
        <main className="mx-auto max-w-[1040px] px-4 py-8 min-[520px]:px-6 min-[720px]:py-10">
          <PageHeader
            title="Account"
            account={account}
            onSignOut={signOut}
            controls={<WindowSwitcher value={windowDays} onChange={onWindowDaysChange} />}
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
              href={tabHref("users")}
              className="mt-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-150 hover:text-foreground"
              onClick={(event) => {
                if (!plainLeftClick(event)) return;
                event.preventDefault();
                onBack();
              }}
            >
              <span aria-hidden="true">←</span> All users
            </a>

            <div className="mt-6 flex flex-wrap items-center gap-4">
              <AccountAvatar
                account={{
                  name: subject.name,
                  email: subject.email,
                  image: subject.image ?? undefined,
                }}
                size="large"
              />
              <div>
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-2xl font-semibold tracking-[-0.01em]">
                    {accountLabel(subject)}
                  </h1>
                  {subject.admin ? (
                    <span className="rounded-full border border-border px-2 py-0.5 font-mono text-[10px] tracking-[0.2px] text-muted-foreground uppercase">
                      Admin
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">{subject.email}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Joined {formatDate(subject.createdAt)}
                  {subject.signInMethods.length > 0
                    ? ` · signs in with ${subject.signInMethods.map(signInMethodLabel).join(", ")}`
                    : ""}
                </div>
              </div>
            </div>

            <SectionHeading>Daily use · hosted tier</SectionHeading>
            <div className="grid grid-cols-2 gap-3 min-[720px]:grid-cols-4">
              <StatCard
                label={`Active days · ${detail.windowDays} days`}
                value={formatNumber(activity.activeDaysWindow)}
                hint={`of ${formatNumber(detail.windowDays)} window days`}
              />
              <StatCard
                label="Current streak"
                value={`${streak} ${activity.currentStreakDays === 1 ? "day" : "days"}`}
                hint="consecutive active days"
              />
              <StatCard
                label={`Active days · ${activity.activeDaysTrend.days} days`}
                value={formatNumber(activity.activeDaysTrend.recent)}
                hint={`${formatNumber(activity.activeDaysTrend.prior)} the week before`}
              />
              <StatCard
                label="Last active"
                value={
                  activity.allTime.lastActiveDay
                    ? formatDayTick(activity.allTime.lastActiveDay)
                    : "—"
                }
                hint={
                  activity.allTime.firstActiveDay
                    ? `first active ${formatDayTick(activity.allTime.firstActiveDay)}`
                    : "no hosted usage yet"
                }
              />
            </div>
            <div className="mt-3">
              <UsageChart
                daily={activity.daily}
                trend={activity.usageTrend}
                label="This account's calls per day"
                generatedAt={detail.generatedAt}
              />
            </div>
            {/* The calendar spans its own trailing year, so it draws whatever
            window is chosen above — and an account with no calls at all
            draws the all-neutral year, because at a year's span the quiet
            grid is the answer rather than a restatement of the chart's
            empty notice. */}
            <div className="mt-3">
              <ActivityCalendar daily={activity.calendarDaily} generatedAt={detail.generatedAt} />
            </div>

            <SectionHeading>Volume</SectionHeading>
            <div className="grid grid-cols-2 gap-3 min-[720px]:grid-cols-3">
              <StatCard
                label={`Hosted calls · ${detail.windowDays} days`}
                value={formatNumber(activity.callsWindow)}
                hint={`${formatNumber(activity.allTime.calls)} all time`}
              />
              <StatCard
                label="Active days · all time"
                value={formatNumber(activity.allTime.activeDays)}
              />
              <StatCard
                label={`Throttled days · ${detail.windowDays} days`}
                value={formatNumber(activity.quotaLimitedDaysWindow)}
                hint="days a daily ceiling was reached"
              />
            </div>
            <AccountActivityNote />
          </div>
        </main>,
      );
    }
  }
}
