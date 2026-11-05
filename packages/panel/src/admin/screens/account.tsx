import { accountPictureAt } from "@repo/features/account-picture";
import type { AdminUserDetail } from "@repo/features/admin-answer-wire";
import { ADMIN_READ, type AdminMetricsWindow } from "@repo/features/admin-wire";
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
import { useState } from "react";
import { NOT_FOUND_THING, NotFound } from "../../not-found.js";
import { AttachmentViewer } from "../../tasks/attachment-viewer.js";
import { useAdminDoors } from "../admin-doors.js";
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
import { useAdminRead } from "../use-admin-read.js";
import { AccountSupportSections } from "./account-support.js";

const ACCOUNT_ERROR = readFailedWords("this account");

/** What the page is called until its account is read, or where it cannot be. */
const ACCOUNT_TITLE = "Account";

/** The masthead avatar's bone, the masthead avatar's size (`AVATAR_SIZE.MASTHEAD`). */
const SKELETON_AVATAR_WIDTH = "56px";

/** The masthead's line bones, about an email's and the joined line's width. */
const SKELETON_EMAIL_WIDTH = "224px";

const SKELETON_JOINED_WIDTH = "160px";

/** The size, in device pixels, an account's photo is asked for at to be enlarged, which its provider answers at up to the photo's own. */
const ENLARGED_PHOTO_PIXELS = 512;

/** What the viewer takes an account's photo as: some picture, its exact type its provider's to say. */
const PHOTO_MEDIA_TYPE = "image/*";

/** What the usage chart is headed. */
const USAGE_LABEL = "This account's calls per day";

/** What the live activity section is headed. */
const ACTIVITY_TITLE = "Activity";

/**
 * A streak as long as the series it is read off may run past it; the page
 * says so rather than posing the truncation as the exact count.
 */
function streakWords(days: number, capped: boolean): string {
  const streak = capped ? `${formatCount(days)}+` : formatCount(days);
  return `${streak} ${days === 1 ? "day" : "days"}`;
}

/**
 * When the account first acted in the trailing year: its first active day
 * ever where it joined inside the year, and only the year's earliest where
 * it joined before, since the read reaches no further back.
 */
function firstActiveWords(detail: AdminUserDetail): string {
  const { firstActiveDay, calendarDaily } = detail.actions;
  if (firstActiveDay === null) return "none in the past year";
  const yearStart = calendarDaily[0]?.day;
  const joinedInYear =
    yearStart !== undefined && detail.account.createdAt >= Date.parse(`${yearStart}T00:00:00Z`);
  return `${joinedInYear ? "first active" : "earliest in the past year"} ${formatDayTick(firstActiveDay)}`;
}

/**
 * The live activity's cards, in the two pairs they stand in, each read off
 * the account's meaningful actions. A streak caps where it reaches the
 * year's first day, which today not yet active leaves one short of its length.
 */
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

/** The hosted tier's daily-use cards, in the two pairs they stand in. */
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

/** The hosted tier's volume cards, side by side, under its calendar. */
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

/** The masthead's frame: `avatar` beside the email line over the joined line and the account's pages elsewhere. */
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

/**
 * The account's avatar, which, where the account has a photo that loads,
 * enlarges it over the window when pressed, as a picture in a transcript
 * opens: the window's file viewer (`attachment-viewer.tsx`) grown from the
 * disc, showing the photo asked for at a viewer's size rather than the disc's.
 */
function MastheadAvatar({ account }: { account: ViewerAccount }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const avatar = (
    <AccountAvatar account={account} size={AVATAR_SIZE.MASTHEAD} onFail={() => setFailed(true)} />
  );
  // Note that a photo that failed stands as the letter, which has nothing to enlarge.
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

/**
 * Whether the member's grant of support access stood as the account was
 * read: a maintainer may sign in as them only while it does.
 */
function supportAccessLive(detail: AdminUserDetail): boolean {
  const until = detail.account.supportAccessUntil;
  return until !== null && until > detail.generatedAt;
}

/** What the masthead says of the member's grant of support access. */
function supportAccessWords(detail: AdminUserDetail): string {
  const until = detail.account.supportAccessUntil;
  return until !== null && supportAccessLive(detail)
    ? `support access until ${formatInstant(until)}`
    : "no support access";
}

/** What the page says where Impersonate failed with no words of the service's. */
const IMPERSONATE_FAILED = "Couldn't sign in as this account. Try again.";

/**
 * Impersonate: signs the maintainer in as the member through the mount's
 * door, which leaves the page where it lands, so only a refusal comes back,
 * said beside the press in the service's own words.
 */
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

/**
 * Whether the page offers Impersonate for `detail`, where the mount can sign
 * in as a member at all: the account is no admin, and its grant of support
 * access stands.
 */
function offersImpersonate(detail: AdminUserDetail): boolean {
  return !detail.account.admin && supportAccessLive(detail);
}

/** Who the account is: its avatar, its email with an admin's badge, and when it joined, was last seen, signs in with, and grants support access until. */
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
      links={null}
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

      {/* Note that the hosted tier stands last, under everything the account
      does today, because only dictation still writes its rows. */}
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
        {/* The calendar spans its own trailing year, so it draws whatever
        window is chosen above — and an account with no calls at all draws
        the all-neutral year, because at a year's span the quiet grid is the
        answer rather than a restatement of the chart's empty notice. */}
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
  /** Applied around every answer but the gate's own cards, which stand alone. */
  frame: (content: React.JSX.Element) => React.JSX.Element;
}): React.JSX.Element {
  const { reads, gate, impersonate } = useAdminDoors();
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
