import type { AdminUserDetail } from "@luke/features/admin-answer-wire";
import { ADMIN_READ, type AdminMetricsWindow } from "@luke/features/admin-wire";
import { formatCount } from "@luke/features/number-format";
import { formatDate, formatDayTick, formatInstant } from "@luke/features/time-format";
import {
  AVATAR_SIZE,
  Badge,
  GAP,
  Inline,
  SKELETON_SHAPE,
  Skeleton,
  STATUS_TONE,
  Stack,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import { accountLabel } from "@luke/ui/account-initials";
import { signInMethodLabel } from "@luke/ui/admin-format";
import { NOT_FOUND_THING, NotFound } from "../../not-found.js";
import { useAdminDoors } from "../admin-doors.js";
import { adminReadView } from "../admin-read-view.js";
import { ActivityCalendar, ActivityCalendarSkeleton } from "../charts/activity-calendar.js";
import { AdminSection, STAT_LAYOUT, StatCards, type StatSpec } from "../charts/stat-card.js";
import { UsageChart, UsageChartSkeleton } from "../charts/usage-chart.js";
import { AdminViewOptions, windowWords } from "../chrome/controls.js";
import { AccountActivityNote } from "../chrome/notes.js";
import {
  AccountAvatar,
  AdminPage,
  type AdminWayBack,
  type ViewerAccount,
} from "../chrome/page-header.js";
import { PageSkeleton } from "../chrome/page-skeleton.js";
import { ADMIN_TAB, accountReadQuery } from "../routing.js";
import { useAdminRead } from "../use-admin-read.js";
import { AccountSupportSections } from "./account-support.js";

const ACCOUNT_ERROR = "The account endpoint did not answer.";

/** What the page is called until its account is read, or where it cannot be. */
const ACCOUNT_TITLE = "Account";

/** The masthead avatar's bone, the masthead avatar's size (`AVATAR_SIZE.MASTHEAD`). */
const SKELETON_AVATAR_WIDTH = "56px";

/** The masthead's line bones, about an email's and the joined line's width. */
const SKELETON_EMAIL_WIDTH = "224px";

const SKELETON_JOINED_WIDTH = "160px";

/** What the usage chart is headed. */
const USAGE_LABEL = "This account's calls per day";

/**
 * A streak as long as the window may run past it; the page says so rather
 * than posing the truncation as the exact count.
 */
function streakWords(detail: AdminUserDetail): string {
  const days = detail.activity.currentStreakDays;
  const streak =
    days >= detail.windowDays ? `${formatCount(detail.windowDays)}+` : formatCount(days);
  return `${streak} ${days === 1 ? "day" : "days"}`;
}

/** The daily-use cards, in the two pairs they stand in. */
const DAILY_USE_STATS: readonly StatSpec<AdminUserDetail>[] = [
  {
    key: "active-days-window",
    label: (detail) => `Active days · ${detail.windowDays} days`,
    value: (detail) => formatCount(detail.activity.activeDaysWindow),
    hint: (detail) => `of ${formatCount(detail.windowDays)} window days`,
  },
  {
    key: "streak",
    label: () => "Current streak",
    value: streakWords,
    hint: () => "consecutive active days",
  },
  {
    key: "active-days-trend",
    label: ({ activity }) => `Active days · ${activity.activeDaysTrend.days} days`,
    value: ({ activity }) => formatCount(activity.activeDaysTrend.recent),
    hint: ({ activity }) => `${formatCount(activity.activeDaysTrend.prior)} the week before`,
  },
  {
    key: "last-active",
    label: () => "Last active",
    value: ({ activity }) =>
      activity.allTime.lastActiveDay ? formatDayTick(activity.allTime.lastActiveDay) : "—",
    hint: ({ activity }) =>
      activity.allTime.firstActiveDay
        ? `first active ${formatDayTick(activity.allTime.firstActiveDay)}`
        : "no hosted usage yet",
  },
];

/** The volume cards, side by side. */
const VOLUME_STATS: readonly StatSpec<AdminUserDetail>[] = [
  {
    key: "calls",
    label: (detail) => `Hosted calls · ${detail.windowDays} days`,
    value: ({ activity }) => formatCount(activity.callsWindow),
    hint: ({ activity }) => `${formatCount(activity.allTime.calls)} all time`,
  },
  {
    key: "active-days-all-time",
    label: () => "Active days · all time",
    value: ({ activity }) => formatCount(activity.allTime.activeDays),
  },
];

/** The masthead's frame: `avatar` beside the email line over the joined line. */
function MastheadFrame({
  avatar,
  email,
  joined,
}: {
  avatar: React.ReactNode;
  email: React.ReactNode;
  joined: React.ReactNode;
}): React.JSX.Element {
  return (
    <Inline gap={GAP.FIELD}>
      {avatar}
      <Stack gap={GAP.TIGHT}>
        {email}
        {joined}
      </Stack>
    </Inline>
  );
}

/** Who the account is: its avatar, its email with an admin's badge, and when it joined, was last seen, and signs in with. */
function Masthead({ detail }: { detail: AdminUserDetail }): React.JSX.Element {
  const subject = detail.account;
  return (
    <MastheadFrame
      avatar={
        <AccountAvatar
          account={{
            name: subject.name,
            email: subject.email,
            image: subject.image ?? undefined,
          }}
          size={AVATAR_SIZE.MASTHEAD}
        />
      }
      email={
        <Inline>
          <Text tone={TEXT_TONE.MUTED}>{subject.email}</Text>
          {subject.admin ? <Badge tone={STATUS_TONE.NEUTRAL}>Admin</Badge> : null}
        </Inline>
      }
      joined={
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          Joined {formatDate(subject.createdAt)}
          {` · last seen ${detail.support.lastSeenAt === null ? "never" : formatInstant(detail.support.lastSeenAt)}`}
          {subject.signInMethods.length > 0
            ? ` · signs in with ${subject.signInMethods.map(signInMethodLabel).join(", ")}`
            : ""}
        </Text>
      }
    />
  );
}

/** The masthead while the account is read: bones for its avatar and its two lines. */
function MastheadSkeleton(): React.JSX.Element {
  return (
    <MastheadFrame
      avatar={<Skeleton shape={SKELETON_SHAPE.CIRCLE} width={SKELETON_AVATAR_WIDTH} />}
      email={
        <Text as={TEXT_ELEMENT.DIV}>
          <Skeleton width={SKELETON_EMAIL_WIDTH} />
        </Text>
      }
      joined={
        <Text as={TEXT_ELEMENT.DIV} variant={TEXT_VARIANT.CAPTION}>
          <Skeleton width={SKELETON_JOINED_WIDTH} />
        </Text>
      }
    />
  );
}

/**
 * The account's sections under its toolbar, drawn from `detail` once it is
 * read and as their skeletons until then; `windowDays` is the window asked
 * for, which the answer's own replaces once it lands.
 */
function AccountSections({
  detail,
  windowDays,
}: {
  detail: AdminUserDetail | undefined;
  windowDays: number;
}): React.JSX.Element {
  return (
    <>
      {detail === undefined ? <MastheadSkeleton /> : <Masthead detail={detail} />}

      <AdminSection title="Daily use · hosted tier">
        <StatCards layout={STAT_LAYOUT.PAIRS} stats={DAILY_USE_STATS} data={detail} />
        {detail === undefined ? (
          <UsageChartSkeleton label={USAGE_LABEL} />
        ) : (
          <UsageChart
            daily={detail.activity.daily}
            trend={detail.activity.usageTrend}
            label={USAGE_LABEL}
            generatedAt={detail.generatedAt}
          />
        )}
        {/* The calendar spans its own trailing year, so it draws whatever
        window is chosen above — and an account with no calls at all draws
        the all-neutral year, because at a year's span the quiet grid is the
        answer rather than a restatement of the chart's empty notice. */}
        {detail === undefined ? (
          <ActivityCalendarSkeleton />
        ) : (
          <ActivityCalendar
            daily={detail.activity.calendarDaily}
            generatedAt={detail.generatedAt}
          />
        )}
      </AdminSection>

      <AdminSection title="Volume">
        <StatCards layout={STAT_LAYOUT.ROW} stats={VOLUME_STATS} data={detail} />
        <AccountActivityNote />
      </AdminSection>

      <AccountSupportSections
        support={detail?.support}
        windowDays={detail?.windowDays ?? windowDays}
      />
    </>
  );
}

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
  const { reads, gate } = useAdminDoors();
  const query = accountReadQuery(id, windowDays);
  const { state, refreshing, reload, withdraw } = useAdminRead(
    { procedure: ADMIN_READ.USER, query: query },
    (signal) => reads.user(query, signal),
    ACCOUNT_ERROR,
    { keeps: (shown) => shown.account.id === id },
  );
  const signOut = () => void withdraw(onSignOut);
  const back: AdminWayBack = { tab: ADMIN_TAB.USERS, onBack };
  const controls = (
    <AdminViewOptions windowDays={windowDays} onWindowDaysChange={onWindowDaysChange} />
  );
  const note = windowWords(windowDays);

  return adminReadView({
    read: { state, refreshing, reload },
    gate,
    email: account?.email,
    onSignOut: signOut,
    failure: ACCOUNT_ERROR,
    loading: () =>
      frame(
        <PageSkeleton title={ACCOUNT_TITLE} note={note} back={back} controls={controls}>
          <AccountSections detail={undefined} windowDays={windowDays} />
        </PageSkeleton>,
      ),
    missing: () =>
      frame(
        <AdminPage title={ACCOUNT_TITLE} back={back} note={note} controls={controls}>
          <NotFound thing={NOT_FOUND_THING.ACCOUNT} />
        </AdminPage>,
      ),
    failed: (error) =>
      frame(
        <AdminPage title={ACCOUNT_TITLE} back={back} note={note} controls={controls}>
          {error}
        </AdminPage>,
      ),
    ready: (detail, refreshed) =>
      frame(
        <AdminPage title={accountLabel(detail.account)} back={back} note={note} controls={controls}>
          {refreshed(<AccountSections detail={detail} windowDays={windowDays} />)}
        </AdminPage>,
      ),
  });
}
