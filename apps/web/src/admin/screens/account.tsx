import { browserClient } from "@luke/features/contract/browser-client";
import type { AdminUserAccount, AdminUserDetail } from "@luke/service/admin/admin-user";
import type { AdminMetricsWindow, AdminUserQuery } from "@luke/service/admin/http";
import {
  AVATAR_SIZE,
  BADGE_TONE,
  Badge,
  GAP,
  Inline,
  Stack,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { accountLabel } from "@luke/ui/account-initials";
import { formatDate, formatDayTick, formatNumber, signInMethodLabel } from "@luke/ui/admin-format";
import { ActivityCalendar } from "../charts/activity-calendar";
import { SectionHeading, STAT_CELL, STAT_PAIR, STAT_ROW, StatCard } from "../charts/stat-card";
import { UsageChart } from "../charts/usage-chart";
import { BackLink } from "../chrome/back-link";
import { AdminErrorCard, Centered, ForbiddenCard, SignInCard } from "../chrome/cards";
import { Refreshing, WindowSwitcher } from "../chrome/controls";
import { AccountActivityNote } from "../chrome/notes";
import { AccountAvatar, AdminPage, type ViewerAccount } from "../chrome/page-header";
import { PageSkeleton } from "../chrome/page-skeleton";
import { accountReadQuery } from "../routing";
import { SKELETON_PLOT, SKELETON_SHAPE, type SkeletonShape } from "../skeleton";
import { ADMIN_READ, type AdminReader, useAdminRead } from "../use-admin-read";
import { AccountSupportSections, formatInstant } from "./account-support";

const ACCOUNT_ERROR = "The account endpoint did not answer.";

/** One account's detail, as the admin user procedure answers it. */
const readUserDetail =
  (query: AdminUserQuery): AdminReader<AdminUserDetail> =>
  async (signal) =>
    // SAFETY: the admin user procedure answers an AdminUserDetail (`@luke/service/admin/admin-user`), which the contract cannot name.
    (await browserClient.admin.user(query, { signal })) as AdminUserDetail;

/** One account's own sections. */
const ACCOUNT_SHAPES: readonly SkeletonShape[] = [
  {
    kind: SKELETON_SHAPE.MASTHEAD,
    avatar: true,
    lines: [
      { variant: TEXT_VARIANT.BODY, width: "224px" },
      { variant: TEXT_VARIANT.CAPTION, width: "160px" },
    ],
  },
  { kind: SKELETON_SHAPE.HEADING, label: "Daily use · hosted tier" },
  { kind: SKELETON_SHAPE.STAT_CARDS, count: 4, columns: 4 },
  { kind: SKELETON_SHAPE.CHART, plots: [SKELETON_PLOT.USAGE] },
  { kind: SKELETON_SHAPE.CALENDAR },
  { kind: SKELETON_SHAPE.HEADING, label: "Volume" },
  { kind: SKELETON_SHAPE.STAT_CARDS, count: 2, columns: 2 },
  { kind: SKELETON_SHAPE.STATIC, node: <AccountActivityNote /> },
  { kind: SKELETON_SHAPE.HEADING, label: "Work" },
  { kind: SKELETON_SHAPE.STAT_CARDS, count: 4, columns: 4 },
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
  const query = accountReadQuery(id, windowDays);
  const { state, refreshing, reload, withdraw } = useAdminRead(
    { procedure: ADMIN_READ.USER, query: query },
    readUserDetail(query),
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
        <Centered
          title="No such account"
          description="No account carries this id — it may have been deleted since its row was read."
          action={{ label: "Back to users", onPress: onBack }}
        />,
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
        <AdminPage
          title={accountLabel(subject)}
          account={account}
          onSignOut={signOut}
          controls={<WindowSwitcher value={windowDays} onChange={onWindowDaysChange} />}
        >
          <Refreshing failure={state.refreshFailure} refreshing={refreshing} onRetry={reload}>
            <Stack gap={GAP.LOOSE}>
              <BackLink tab="users" label="All users" onBack={onBack} />
              <Inline gap={GAP.FIELD}>
                <AccountAvatar
                  account={{
                    name: subject.name,
                    email: subject.email,
                    image: subject.image ?? undefined,
                  }}
                  size={AVATAR_SIZE.MASTHEAD}
                />
                <Stack gap={GAP.TIGHT}>
                  <Inline>
                    <Text tone={TEXT_TONE.MUTED}>{subject.email}</Text>
                    {subject.admin ? <Badge tone={BADGE_TONE.NEUTRAL}>Admin</Badge> : null}
                  </Inline>
                  <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                    Joined {formatDate(subject.createdAt)}
                    {` · last seen ${detail.support.lastSeenAt === null ? "never" : formatInstant(detail.support.lastSeenAt)}`}
                    {subject.signInMethods.length > 0
                      ? ` · signs in with ${subject.signInMethods.map(signInMethodLabel).join(", ")}`
                      : ""}
                  </Text>
                </Stack>
              </Inline>
            </Stack>

            <SectionHeading>Daily use · hosted tier</SectionHeading>
            <div className={STAT_ROW}>
              <div className={STAT_PAIR}>
                <div className={STAT_CELL}>
                  <StatCard
                    label={`Active days · ${detail.windowDays} days`}
                    value={formatNumber(activity.activeDaysWindow)}
                    hint={`of ${formatNumber(detail.windowDays)} window days`}
                  />
                </div>
                <div className={STAT_CELL}>
                  <StatCard
                    label="Current streak"
                    value={`${streak} ${activity.currentStreakDays === 1 ? "day" : "days"}`}
                    hint="consecutive active days"
                  />
                </div>
              </div>
              <div className={STAT_PAIR}>
                <div className={STAT_CELL}>
                  <StatCard
                    label={`Active days · ${activity.activeDaysTrend.days} days`}
                    value={formatNumber(activity.activeDaysTrend.recent)}
                    hint={`${formatNumber(activity.activeDaysTrend.prior)} the week before`}
                  />
                </div>
                <div className={STAT_CELL}>
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
              </div>
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
            <div className={STAT_ROW}>
              <div className={STAT_CELL}>
                <StatCard
                  label={`Hosted calls · ${detail.windowDays} days`}
                  value={formatNumber(activity.callsWindow)}
                  hint={`${formatNumber(activity.allTime.calls)} all time`}
                />
              </div>
              <div className={STAT_CELL}>
                <StatCard
                  label="Active days · all time"
                  value={formatNumber(activity.allTime.activeDays)}
                />
              </div>
            </div>
            <AccountActivityNote />

            <AccountSupportSections support={detail.support} windowDays={detail.windowDays} />
          </Refreshing>
        </AdminPage>,
      );
    }
  }
}
