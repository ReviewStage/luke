/**
 * share-bars.tsx -- the Overview's activation funnel and feature reach, each a
 * column of rows that read as a share of one base.
 *
 * A row is a name, a bar filled to its share of the base, the count, and the
 * share as a percentage. The bar is a plain track and fill rather than a chart
 * engine's, because a row of seven fixed categories needs no axis, and the
 * words beside it carry every figure, so a reader who cannot see the fill
 * loses nothing. A share of nobody draws an empty track and a dash.
 */

import type { AdminFunnelStep, AdminOverview } from "@luke/features/admin-answer-wire";
import {
  FUNNEL_STEP,
  type FunnelStep,
  REACH_FEATURE,
  type ReachFeature,
} from "@luke/features/admin-overview-vocabulary";
import { Skeleton, TEXT_ELEMENT, TEXT_TONE, Text } from "@luke/ui";
import { formatCount } from "@luke/ui/time-format";
import { AsideSkeleton, ChartEmpty, ChartFrame } from "./chart-frame.js";

/** What each funnel step is called, in the words a maintainer reads it by. */
const FUNNEL_LABEL = {
  [FUNNEL_STEP.SIGNED_UP]: "Signed up",
  [FUNNEL_STEP.GITHUB_CONNECTED]: "GitHub connected",
  [FUNNEL_STEP.CREATED_TASK]: "Created a task",
  [FUNNEL_STEP.HELD_CALL]: "Held a call",
  [FUNNEL_STEP.STARTED_AGENT]: "Started an agent",
  [FUNNEL_STEP.OPENED_PR]: "Opened a PR",
  [FUNNEL_STEP.MERGED_PR]: "Merged a PR",
} as const satisfies Record<FunnelStep, string>;

const REACH_LABEL = {
  [REACH_FEATURE.TASKS]: "Tasks & plans",
  [REACH_FEATURE.CODING_AGENTS]: "Coding agents",
  [REACH_FEATURE.INBOX]: "Inbox",
  [REACH_FEATURE.VOICE_CALLS]: "Voice calls",
  [REACH_FEATURE.INTEGRATIONS]: "Integration connected",
  [REACH_FEATURE.AUTOMATIONS]: "Automations",
  [REACH_FEATURE.CHAT]: "Chat",
} as const satisfies Record<ReachFeature, string>;

const REACH_TITLE = "Feature reach · this week";

/** The funnel's heading, which names the window its accounts were created in. */
function funnelTitle(windowDays: number): string {
  return `Activation · accounts created in the last ${windowDays} days`;
}

function formatShare(share: number | null): string {
  return share === null ? "—" : `${Math.round(share * 100)}%`;
}

/** The bones standing for a row's count and share, about their figures' width. */
const SKELETON_COUNT_WIDTH = "32px";

const SKELETON_SHARE_WIDTH = "28px";

/** The rows of one chart, a step apart. */
function ShareList({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <ul aria-label={label} className="grid gap-(--luke-space-8)">
      {children}
    </ul>
  );
}

/** One row's frame: its name, its bar, its count, and its share, each in its column. */
function ShareRowFrame({
  label,
  bar,
  count,
  share,
}: {
  label: string;
  bar: React.ReactNode;
  count: React.ReactNode;
  share: React.ReactNode;
}): React.JSX.Element {
  return (
    <li className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto_3rem] items-center gap-(--luke-space-12) tabular-nums">
      <Text as={TEXT_ELEMENT.SPAN}>{label}</Text>
      {bar}
      <Text as={TEXT_ELEMENT.SPAN}>{count}</Text>
      <span className="text-right">
        <Text as={TEXT_ELEMENT.SPAN} tone={TEXT_TONE.MUTED}>
          {share}
        </Text>
      </span>
    </li>
  );
}

/** One row: its name, its bar, its count, and its share. */
function ShareRow({
  label,
  count,
  share,
}: {
  label: string;
  count: number;
  share: number | null;
}): React.JSX.Element {
  const percent = Math.min(100, Math.round((share ?? 0) * 100));
  return (
    <ShareRowFrame
      label={label}
      bar={
        <span
          aria-hidden="true"
          className="block h-2 overflow-hidden rounded-full bg-(--luke-color-fill-hover)"
        >
          <span
            className="block h-full rounded-full bg-(--luke-color-chart-1)"
            style={{ width: `${percent}%` }}
          />
        </span>
      }
      count={formatCount(count)}
      share={formatShare(share)}
    />
  );
}

/** One row while its figures are read: its name, which the chart knows, and bones for the rest. */
function ShareRowSkeleton({ label }: { label: string }): React.JSX.Element {
  return (
    <ShareRowFrame
      label={label}
      bar={<Skeleton />}
      count={<Skeleton width={SKELETON_COUNT_WIDTH} />}
      share={<Skeleton width={SKELETON_SHARE_WIDTH} />}
    />
  );
}

/**
 * The window's new accounts, step by step: how many of them ever took each
 * step, and their share of everyone who signed up. Each step is counted on its
 * own, so a later step can stand taller than an earlier one: an account can
 * hold a call before it ever connects GitHub.
 */
export function FunnelChart({
  funnel,
  windowDays,
}: {
  funnel: readonly AdminFunnelStep[];
  windowDays: number;
}): React.JSX.Element {
  const title = funnelTitle(windowDays);
  const signedUp = funnel.find((step) => step.step === FUNNEL_STEP.SIGNED_UP)?.accounts ?? 0;
  if (signedUp === 0) {
    return (
      <ChartFrame title={title}>
        <ChartEmpty>No accounts created in this window yet.</ChartEmpty>
      </ChartFrame>
    );
  }
  return (
    <ChartFrame title={title}>
      <ShareList label="Activation funnel">
        {funnel.map((step) => (
          <ShareRow
            key={step.step}
            label={FUNNEL_LABEL[step.step]}
            count={step.accounts}
            share={step.share}
          />
        ))}
      </ShareList>
    </ChartFrame>
  );
}

/** The funnel while the window is read: its heading, and a row for every step by its name, with bones for its figures. */
export function FunnelChartSkeleton({ windowDays }: { windowDays: number }): React.JSX.Element {
  return (
    <ChartFrame title={funnelTitle(windowDays)}>
      <ShareList label="Activation funnel">
        {Object.values(FUNNEL_STEP).map((step) => (
          <ShareRowSkeleton key={step} label={FUNNEL_LABEL[step]} />
        ))}
      </ShareList>
    </ChartFrame>
  );
}

/** The share of this week's active developers who used each feature. */
export function ReachChart({ reach }: { reach: AdminOverview["reach"] }): React.JSX.Element {
  const title = REACH_TITLE;
  const aside = `of ${formatCount(reach.activeDevelopers)} active developers`;
  if (reach.activeDevelopers === 0) {
    return (
      <ChartFrame title={title} aside={aside}>
        <ChartEmpty>No active developers this week yet.</ChartEmpty>
      </ChartFrame>
    );
  }
  return (
    <ChartFrame title={title} aside={aside}>
      <ShareList label="Feature reach">
        {reach.features.map((row) => (
          <ShareRow
            key={row.feature}
            label={REACH_LABEL[row.feature]}
            count={row.developers}
            share={row.share}
          />
        ))}
      </ShareList>
    </ChartFrame>
  );
}

/** The reach while the week is read: a row for every feature, by its name, with bones for its figures. */
export function ReachChartSkeleton(): React.JSX.Element {
  return (
    <ChartFrame title={REACH_TITLE} aside={<AsideSkeleton />}>
      <ShareList label="Feature reach">
        {Object.values(REACH_FEATURE).map((feature) => (
          <ShareRowSkeleton key={feature} label={REACH_LABEL[feature]} />
        ))}
      </ShareList>
    </ChartFrame>
  );
}
