import type { AdminFunnelStep, AdminOverview } from "@repo/features/admin-answer-wire";
import {
  AGENT_ORIGIN,
  type AgentOrigin,
  FUNNEL_STEP,
  type FunnelStep,
  REACH_FEATURE,
  type ReachFeature,
} from "@repo/features/admin-overview-vocabulary";
import { formatCount, formatPercent } from "@repo/features/number-format";
import { Skeleton, TEXT_ELEMENT, TEXT_TONE, Text } from "@repo/ui";
import { AsideSkeleton, ChartEmpty, ChartFrame } from "./chart-frame.js";

const FUNNEL_LABEL = {
  [FUNNEL_STEP.SIGNED_UP]: "Signed up",
  [FUNNEL_STEP.GITHUB_CONNECTED]: "GitHub connected",
  [FUNNEL_STEP.CREATED_TASK]: "Created a task",
  [FUNNEL_STEP.STARTED_AGENT]: "Started an agent",
  [FUNNEL_STEP.OPENED_PR]: "Opened a PR",
  [FUNNEL_STEP.MERGED_PR]: "Merged a PR",
} as const satisfies Record<FunnelStep, string>;

const REACH_LABEL = {
  [REACH_FEATURE.TASKS]: "Tasks & descriptions",
  [REACH_FEATURE.AGENTS]: "Agents",
  [REACH_FEATURE.INBOX]: "Inbox",
  [REACH_FEATURE.INTEGRATIONS]: "Integration connected",
  [REACH_FEATURE.AUTOMATIONS]: "Automations",
} as const satisfies Record<ReachFeature, string>;

const REACH_TITLE = "Feature reach · this week";

const ORIGIN_LABEL = {
  [AGENT_ORIGIN.AUTOMATION]: "Automation",
  [AGENT_ORIGIN.SLACK]: "Slack",
  [AGENT_ORIGIN.AGENT]: "Another agent",
  [AGENT_ORIGIN.HAND]: "By hand",
} as const satisfies Record<AgentOrigin, string>;

const ORIGINS_TITLE = "Agents started by origin · this week";

function originsAside(origins: AdminOverview["agentOrigins"]): string {
  const pilots = origins.pilots === 1 ? "1 pilot" : `${formatCount(origins.pilots)} pilots`;
  return `of ${formatCount(origins.agentsStarted)} agents started · ${pilots}`;
}

function funnelTitle(windowDays: number): string {
  return `Activation · accounts created in the last ${windowDays} days`;
}

const SKELETON_COUNT_WIDTH = "32px";

const SKELETON_SHARE_WIDTH = "28px";

function ShareList({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <ul aria-label={label} className="grid gap-(--ui-space-8)">
      {children}
    </ul>
  );
}

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
    <li className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto_3rem] items-center gap-(--ui-space-12) tabular-nums">
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
          className="block h-2 overflow-hidden rounded-full bg-(--ui-color-fill-hover)"
        >
          <span
            className="block h-full rounded-full bg-(--ui-color-chart-1)"
            style={{ width: `${percent}%` }}
          />
        </span>
      }
      count={formatCount(count)}
      share={formatPercent(share)}
    />
  );
}

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

export function AgentOriginsChart({
  origins,
}: {
  origins: AdminOverview["agentOrigins"];
}): React.JSX.Element {
  const aside = originsAside(origins);
  if (origins.agentsStarted === 0) {
    return (
      <ChartFrame title={ORIGINS_TITLE} aside={aside}>
        <ChartEmpty>No agents started this week yet.</ChartEmpty>
      </ChartFrame>
    );
  }
  return (
    <ChartFrame title={ORIGINS_TITLE} aside={aside}>
      <ShareList label="Agents by origin">
        {origins.origins.map((row) => (
          <ShareRow
            key={row.origin}
            label={ORIGIN_LABEL[row.origin]}
            count={row.agents}
            share={row.share}
          />
        ))}
      </ShareList>
    </ChartFrame>
  );
}

export function AgentOriginsChartSkeleton(): React.JSX.Element {
  return (
    <ChartFrame title={ORIGINS_TITLE} aside={<AsideSkeleton />}>
      <ShareList label="Agents by origin">
        {Object.values(AGENT_ORIGIN).map((origin) => (
          <ShareRowSkeleton key={origin} label={ORIGIN_LABEL[origin]} />
        ))}
      </ShareList>
    </ChartFrame>
  );
}
