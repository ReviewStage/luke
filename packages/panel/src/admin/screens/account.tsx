import { accountPictureAt } from "@repo/features/account-picture";
import type { AdminUserDetail } from "@repo/features/admin-answer-wire";
import type { AdminMetricsWindow } from "@repo/features/admin-wire";
import { formatCount } from "@repo/features/number-format";
import { formatDate, formatDayTick, formatInstant } from "@repo/features/time-format";
import { readFailedWords } from "@repo/features/words";
import {
  AVATAR_SIZE,
  Badge,
  BUTTON_VARIANT,
  Button,
  GAP,
  Inline,
  MARK_PROVIDER,
  PICTURE_TILE_FACE,
  PictureTile,
  SKELETON_SHAPE,
  Skeleton,
  STATUS_TONE,
  Stack,
  TEXT_ELEMENT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@repo/ui";
import { accountLabel } from "@repo/ui/account-initials";
import { signInMethodLabel } from "@repo/ui/admin-format";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { NOT_FOUND_THING, NotFound } from "../../not-found.js";
import { AttachmentViewer } from "../../tasks/attachment-viewer.js";
import { useAdminDoors } from "../admin-doors.js";
import { adminUserQuery, useAdminSignOut } from "../admin-queries.js";
import { adminReadView } from "../admin-read-view.js";
import { ActionsChart, ActionsChartSkeleton } from "../charts/actions-chart.js";
import {
  ActivityCalendar,
  ActivityCalendarSkeleton,
  CALENDAR_MEASURE,
} from "../charts/activity-calendar.js";
import { AdminSection, STAT_LAYOUT, StatCards, type StatSpec } from "../charts/stat-card.js";
import { UsageChart, UsageChartSkeleton } from "../charts/usage-chart.js";
import { AdminViewOptions, windowWords } from "../chrome/controls.js";
import { ExternalLinks } from "../chrome/external-links.js";
import { AccountActionsNote, AccountActivityNote, retiredTitle } from "../chrome/notes.js";
import {
  AccountAvatar,
  AdminPage,
  type AdminWayBack,
  type ViewerAccount,
} from "../chrome/page-header.js";
import { PageSkeleton } from "../chrome/page-skeleton.js";
import { ADMIN_TAB, accountReadQuery } from "../routing.js";
import { AccountSupportSections } from "./account-support.js";

const ACCOUNT_ERROR = readFailedWords("this account");

const ACCOUNT_TITLE = "Account";

const SKELETON_AVATAR_WIDTH = "56px";

const SKELETON_EMAIL_WIDTH = "224px";

const SKELETON_JOINED_WIDTH = "160px";

const ENLARGED_PHOTO_PIXELS = 512;

const PHOTO_MEDIA_TYPE = "image/*";

const USAGE_LABEL = "This account's calls per day";

const ACTIVITY_TITLE = "Activity";

function streakWords(days: number, capped: boolean): string {
  const streak = capped ? `${formatCount(days)}+` : formatCount(days);
  return `${streak} ${days === 1 ? "day" : "days"}`;
}

function firstActiveWords(detail: AdminUserDetail): string {
  const { firstActiveDay, calendarDaily } = detail.actions;
  if (firstActiveDay === null) return "none in the past year";
  const yearStart = calendarDaily[0]?.day;
  const joinedInYear =
    yearStart !== undefined && detail.account.createdAt >= Date.parse(`${yearStart}T00:00:00Z`);
  return `${joinedInYear ? "first active" : "earliest in the past year"} ${formatDayTick(firstActiveDay)}`;
}

const ACTIVITY_STATS: readonly StatSpec<AdminUserDetail>[] = [
  {
    key: "active-days-window",
    label: (detail) => `Active days · ${detail.windowDays} days`,
    value: (detail) => formatCount(detail.actions.activeDaysWindow),
    hint: (detail) => `of ${formatCount(detail.windowDays)} window days`,
  },
  {
    key: "streak",
    label: () => "Current streak",
    value: ({ actions }) =>
      streakWords(
        actions.currentStreakDays,
        actions.currentStreakDays >= actions.calendarDaily.length - 1,
      ),
    hint: () => "consecutive active days",
  },
  {
    key: "active-days-trend",
    label: ({ actions }) => `Active days · ${actions.activeDaysTrend.days} days`,
    value: ({ actions }) => formatCount(actions.activeDaysTrend.recent),
    hint: ({ actions }) => `${formatCount(actions.activeDaysTrend.prior)} the week before`,
  },
  {
    key: "last-active",
    label: () => "Last active",
    value: ({ actions }) => (actions.lastActiveDay ? formatDayTick(actions.lastActiveDay) : "—"),
    hint: firstActiveWords,
  },
];

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
    value: (detail) =>
      streakWords(
        detail.activity.currentStreakDays,
        detail.activity.currentStreakDays >= detail.windowDays,
      ),
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

function MastheadFrame({
  avatar,
  email,
  joined,
  links,
}: {
  avatar: React.ReactNode;
  email: React.ReactNode;
  joined: React.ReactNode;
  links: React.ReactNode;
}): React.JSX.Element {
  return (
    <Inline gap={GAP.FIELD}>
      {avatar}
      <Stack gap={GAP.TIGHT}>
        {email}
        {joined}
        {links}
      </Stack>
    </Inline>
  );
}

function MastheadAvatar({ account }: { account: ViewerAccount }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const avatar = (
    <AccountAvatar account={account} size={AVATAR_SIZE.MASTHEAD} onFail={() => setFailed(true)} />
  );
  if (account.image === undefined || failed) return avatar;
  const label = accountLabel(account);
  const photo = {
    name: label,
    mediaType: PHOTO_MEDIA_TYPE,
    url: accountPictureAt(account.image, ENLARGED_PHOTO_PIXELS),
  };
  return (
    <>
      <PictureTile name={label} face={PICTURE_TILE_FACE.ROUND} onOpen={() => setOpen(true)}>
        {avatar}
      </PictureTile>
      {open ? (
        <AttachmentViewer
          files={[photo]}
          at={0}
          onAt={() => undefined}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function supportAccessLive(detail: AdminUserDetail): boolean {
  const until = detail.account.supportAccessUntil;
  return until !== null && until > detail.generatedAt;
}

function supportAccessWords(detail: AdminUserDetail): string {
  const until = detail.account.supportAccessUntil;
  return until !== null && supportAccessLive(detail)
    ? `support access until ${formatInstant(until)}`
    : "no support access";
}

const IMPERSONATE_FAILED = "Couldn't sign in as this account. Try again.";

function ImpersonateControl({
  impersonate,
  userId,
}: {
  impersonate: (userId: string) => Promise<string | undefined>;
  userId: string;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string>();
  const press = () => {
    setBusy(true);
    setRefusal(undefined);
    void impersonate(userId)
      .catch(() => IMPERSONATE_FAILED)
      .then((refused) => {
        setBusy(false);
        setRefusal(refused);
      });
  };
  return (
    <Inline>
      {refusal === undefined ? null : (
        <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
          {refusal}
        </Text>
      )}
      <Button
        variant={BUTTON_VARIANT.OUTLINE}
        busy={busy}
        busyLabel="Signing in as this account"
        onClick={press}
      >
        Impersonate
      </Button>
    </Inline>
  );
}

function offersImpersonate(detail: AdminUserDetail): boolean {
  return !detail.account.admin && supportAccessLive(detail);
}

function Masthead({ detail }: { detail: AdminUserDetail }): React.JSX.Element {
  const subject = detail.account;
  return (
    <MastheadFrame
      avatar={
        <MastheadAvatar
          account={{
            name: subject.name,
            email: subject.email,
            image: subject.image ?? undefined,
          }}
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
          {` · ${supportAccessWords(detail)}`}
        </Text>
      }
      links={
        <ExternalLinks
          places={
            detail.analyticsPersonUrl === undefined
              ? []
              : [
                  {
                    provider: MARK_PROVIDER.POSTHOG,
                    label: "Person in PostHog",
                    href: detail.analyticsPersonUrl,
                  },
                ]
          }
        />
      }
    />
  );
}

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
      links={null}
    />
  );
}

function AccountSections({
  detail,
  windowDays,
  onOpenWorkspace,
}: {
  detail: AdminUserDetail | undefined;
  windowDays: number;
  onOpenWorkspace: (id: string) => void;
}): React.JSX.Element {
  return (
    <>
      {detail === undefined ? <MastheadSkeleton /> : <Masthead detail={detail} />}

      <AdminSection title={ACTIVITY_TITLE}>
        <StatCards layout={STAT_LAYOUT.PAIRS} stats={ACTIVITY_STATS} data={detail} />
        {detail === undefined ? (
          <ActionsChartSkeleton />
        ) : (
          <ActionsChart actions={detail.actions} generatedAt={detail.generatedAt} />
        )}
        {detail === undefined ? (
          <ActivityCalendarSkeleton measure={CALENDAR_MEASURE.ACTIONS} />
        ) : (
          <ActivityCalendar
            daily={detail.actions.calendarDaily}
            measure={CALENDAR_MEASURE.ACTIONS}
            generatedAt={detail.generatedAt}
          />
        )}
        <AccountActionsNote />
      </AdminSection>

      <AccountSupportSections
        support={detail?.support}
        windowDays={detail?.windowDays ?? windowDays}
        onOpenWorkspace={onOpenWorkspace}
      />

      <AdminSection title={retiredTitle("Hosted tier")}>
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
        {detail === undefined ? (
          <ActivityCalendarSkeleton measure={CALENDAR_MEASURE.HOSTED_CALLS} />
        ) : (
          <ActivityCalendar
            daily={detail.activity.calendarDaily.map((day) => ({ day: day.day, count: day.calls }))}
            measure={CALENDAR_MEASURE.HOSTED_CALLS}
            generatedAt={detail.generatedAt}
          />
        )}
        <StatCards layout={STAT_LAYOUT.ROW} stats={VOLUME_STATS} data={detail} />
        <AccountActivityNote />
      </AdminSection>
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
  onOpenWorkspace,
  frame,
}: {
  id: string;
  windowDays: AdminMetricsWindow;
  onWindowDaysChange: (windowDays: AdminMetricsWindow) => void;
  account: ViewerAccount | undefined;
  onSignOut: () => Promise<void>;
  onBack: () => void;
  onOpenWorkspace: (id: string) => void;
  frame: (content: React.JSX.Element) => React.JSX.Element;
}): React.JSX.Element {
  const { reads, gate, impersonate } = useAdminDoors();
  const query = accountReadQuery(id, windowDays);
  const read = useQuery({ ...adminUserQuery(reads, query), enabled: !gate.heldAtGate() });
  const withdraw = useAdminSignOut(onSignOut);
  const signOut = () => withdraw.mutate();
  const back: AdminWayBack = { tab: ADMIN_TAB.USERS, onBack };
  const controls = (
    <AdminViewOptions windowDays={windowDays} onWindowDaysChange={onWindowDaysChange} />
  );
  const note = windowWords(windowDays);

  return adminReadView({
    read,
    gate,
    email: account?.email,
    onSignOut: signOut,
    failure: ACCOUNT_ERROR,
    loading: () =>
      frame(
        <PageSkeleton title={ACCOUNT_TITLE} note={note} back={back} controls={controls}>
          <AccountSections
            detail={undefined}
            windowDays={windowDays}
            onOpenWorkspace={onOpenWorkspace}
          />
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
        <AdminPage
          title={accountLabel(detail.account)}
          back={back}
          note={note}
          controls={
            impersonate !== undefined && offersImpersonate(detail) ? (
              <>
                <ImpersonateControl impersonate={impersonate} userId={detail.account.id} />
                {controls}
              </>
            ) : (
              controls
            )
          }
        >
          {refreshed(
            <AccountSections
              detail={detail}
              windowDays={windowDays}
              onOpenWorkspace={onOpenWorkspace}
            />,
          )}
        </AdminPage>,
      ),
  });
}
