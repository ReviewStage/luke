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

import type { AdminFunnelStep, AdminOverview } from "@luke/service/admin/admin-overview";
import {
  FUNNEL_STEP,
  type FunnelStep,
  REACH_FEATURE,
  type ReachFeature,
} from "@luke/service/admin/admin-overview-vocabulary";
import { TEXT_ELEMENT, TEXT_TONE, Text } from "@luke/ui";
import { formatNumber } from "@luke/ui/admin-format";
import { ChartEmpty, ChartFrame } from "./chart-frame";

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

function formatShare(share: number | null): string {
  return share === null ? "—" : `${Math.round(share * 100)}%`;
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
    <li className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto_3rem] items-center gap-3 tabular-nums">
      <Text as={TEXT_ELEMENT.SPAN}>{label}</Text>
      <span
        aria-hidden="true"
        className="block h-2 overflow-hidden rounded-full bg-(--luke-color-fill-hover)"
      >
        <span
          className="block h-full rounded-full bg-(--luke-color-chart-1)"
          style={{ width: `${percent}%` }}
        />
      </span>
      <Text as={TEXT_ELEMENT.SPAN}>{formatNumber(count)}</Text>
      <span className="text-right">
        <Text as={TEXT_ELEMENT.SPAN} tone={TEXT_TONE.MUTED}>
          {formatShare(share)}
        </Text>
      </span>
    </li>
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
  const title = `Activation · accounts created in the last ${windowDays} days`;
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
      <ul aria-label="Activation funnel" className="grid gap-2">
        {funnel.map((step) => (
          <ShareRow
            key={step.step}
            label={FUNNEL_LABEL[step.step]}
            count={step.accounts}
            share={step.share}
          />
        ))}
      </ul>
    </ChartFrame>
  );
}

/** The share of this week's active developers who used each feature. */
export function ReachChart({ reach }: { reach: AdminOverview["reach"] }): React.JSX.Element {
  const title = "Feature reach · this week";
  const aside = `of ${formatNumber(reach.activeDevelopers)} active developers`;
  if (reach.activeDevelopers === 0) {
    return (
      <ChartFrame title={title} aside={aside}>
        <ChartEmpty>No active developers this week yet.</ChartEmpty>
      </ChartFrame>
    );
  }
  return (
    <ChartFrame title={title} aside={aside}>
      <ul aria-label="Feature reach" className="grid gap-2">
        {reach.features.map((row) => (
          <ShareRow
            key={row.feature}
            label={REACH_LABEL[row.feature]}
            count={row.developers}
            share={row.share}
          />
        ))}
      </ul>
    </ChartFrame>
  );
}
