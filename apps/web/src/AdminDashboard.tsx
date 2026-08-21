import { createAuthClient } from "better-auth/react";
import { useEffect, useMemo, useState } from "react";
import type {
  AdminDailySignups,
  AdminDailyUsage,
  AdminIntegration,
  AdminMetrics,
  AdminTopUser,
} from "../server/admin/admin-metrics";
import { SOCIAL_PROVIDER, SOCIAL_PROVIDER_LABEL, type SocialProvider } from "./sign-in-provider";
import { LukeMark } from "./SiteChrome";

const authClient = createAuthClient();

const METRICS_PATH = "/api/admin/metrics";

/** What the fetch resolved to: the gate's two refusals stay distinct here. */
type DashboardState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "forbidden" }
  | { status: "error" }
  | { status: "ready"; metrics: AdminMetrics };

const numberFormat = new Intl.NumberFormat("en-US");

function formatNumber(value: number): string {
  return numberFormat.format(value);
}

function formatTimestamp(epochMs: number): string {
  return new Date(epochMs).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  });
}

/** A day key drawn as a short axis tick, e.g. "Aug 21". */
function formatDayTick(day: string): string {
  return new Date(`${day}T00:00:00.000Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-border bg-card px-5 py-4">
      <div className="font-mono text-xs tracking-[0.2px] text-muted-foreground uppercase">
        {label}
      </div>
      <div className="mt-2 text-3xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-1 text-sm text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <h2 className="mt-12 mb-4 text-lg font-semibold tracking-[-0.01em]">{children}</h2>
  );
}

/**
 * A trailing-window bar chart drawn from divs rather than a charting library:
 * the series is small and the page ships no dependency for it. Voice and
 * attention stack so one bar reads as a day's total while its split stays
 * visible; a title carries the exact numbers for a pointer, and the whole
 * series is described once for a reader.
 */
function UsageChart({ daily }: { daily: readonly AdminDailyUsage[] }): React.JSX.Element {
  const max = Math.max(1, ...daily.map((day) => day.voiceCalls + day.attentionReviews));
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4 flex items-center gap-4 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-[2px] bg-primary" aria-hidden="true" />
          Voice calls
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block size-2.5 rounded-[2px] bg-complete" aria-hidden="true" />
          Attention reviews
        </span>
      </div>
      <div
        className="flex h-40 items-end gap-[3px]"
        role="img"
        aria-label={`Daily hosted-tier usage across the last ${daily.length} days.`}
      >
        {daily.map((day) => {
          const total = day.voiceCalls + day.attentionReviews;
          return (
            <div
              key={day.day}
              className="flex flex-1 flex-col justify-end"
              title={`${formatDayTick(day.day)}: ${formatNumber(day.voiceCalls)} voice, ${formatNumber(day.attentionReviews)} attention`}
            >
              <div
                className="w-full rounded-t-[2px] bg-complete"
                style={{ height: `${(day.attentionReviews / max) * 100}%` }}
              />
              <div
                className="w-full bg-primary"
                style={{ height: `${(day.voiceCalls / max) * 100}%` }}
              />
              {total === 0 ? <div className="h-px w-full bg-border" /> : null}
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>{daily.length > 0 ? formatDayTick(daily[0]?.day ?? "") : ""}</span>
        <span>{daily.length > 0 ? formatDayTick(daily[daily.length - 1]?.day ?? "") : ""}</span>
      </div>
    </div>
  );
}

function SignupsChart({ daily }: { daily: readonly AdminDailySignups[] }): React.JSX.Element {
  const max = Math.max(1, ...daily.map((day) => day.count));
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="mb-4 text-xs text-muted-foreground">New accounts per day</div>
      <div
        className="flex h-28 items-end gap-[3px]"
        role="img"
        aria-label={`New accounts per day across the last ${daily.length} days.`}
      >
        {daily.map((day) => (
          <div
            key={day.day}
            className="flex flex-1 flex-col justify-end"
            title={`${formatDayTick(day.day)}: ${formatNumber(day.count)} new`}
          >
            {day.count === 0 ? (
              <div className="h-px w-full bg-border" />
            ) : (
              <div
                className="w-full rounded-t-[2px] bg-foreground/70"
                style={{ height: `${(day.count / max) * 100}%` }}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ProviderBar({
  label,
  value,
  total,
}: {
  label: string;
  value: number;
  total: number;
}): React.JSX.Element {
  const share = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-sm">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {formatNumber(value)} · {share}%
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
      </div>
    </div>
  );
}

function TopUsersTable({ users }: { users: readonly AdminTopUser[] }): React.JSX.Element {
  if (users.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card px-5 py-8 text-center text-sm text-muted-foreground">
        No hosted-tier usage recorded in this window yet.
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left font-mono text-xs text-muted-foreground uppercase">
            <th className="px-5 py-3 font-medium">Account</th>
            <th className="px-5 py-3 text-right font-medium">Voice</th>
            <th className="px-5 py-3 text-right font-medium">Attention</th>
            <th className="px-5 py-3 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {users.map((entry) => (
            <tr key={entry.email} className="border-b border-border last:border-0">
              <td className="px-5 py-3">
                <div className="font-medium">{entry.name}</div>
                <div className="text-xs text-muted-foreground">{entry.email}</div>
              </td>
              <td className="px-5 py-3 text-right tabular-nums">{formatNumber(entry.voiceCalls)}</td>
              <td className="px-5 py-3 text-right tabular-nums">
                {formatNumber(entry.attentionReviews)}
              </td>
              <td className="px-5 py-3 text-right font-semibold tabular-nums">
                {formatNumber(entry.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function IntegrationRow({ integration }: { integration: AdminIntegration }): React.JSX.Element {
  return (
    <li className="flex items-center justify-between gap-4 border-b border-border py-3 last:border-0">
      <span className="text-sm">{integration.label}</span>
      <span
        className="inline-flex items-center gap-2 font-mono text-xs"
        data-tone={integration.configured ? "complete" : "attention"}
      >
        <span
          className="inline-block size-2 rounded-full data-[on=true]:bg-complete data-[on=false]:bg-attention"
          data-on={integration.configured}
          aria-hidden="true"
        />
        <span className={integration.configured ? "text-complete" : "text-attention"}>
          {integration.configured ? "Configured" : "Not configured"}
        </span>
      </span>
    </li>
  );
}

function Dashboard({ metrics }: { metrics: AdminMetrics }): React.JSX.Element {
  const providerTotal =
    metrics.users.signInMethods.google +
    metrics.users.signInMethods.github +
    metrics.users.signInMethods.other;
  const db = metrics.systemHealth.database;

  return (
    <div className="mx-auto max-w-[1040px] px-6 py-10">
      <header className="flex items-center justify-between gap-4">
        <div className="inline-flex items-center gap-2">
          <span className="inline-flex w-6 text-foreground" aria-hidden="true">
            <LukeMark className="h-auto w-full" />
          </span>
          <span className="font-brand text-base font-bold tracking-[-0.01em]">Luke admin</span>
        </div>
        <span className="font-mono text-xs text-muted-foreground">
          {metrics.windowDays}-day window · generated {formatTimestamp(metrics.generatedAt)} UTC
        </span>
      </header>

      <SectionHeading>User activity</SectionHeading>
      <div className="grid grid-cols-2 gap-3 min-[720px]:grid-cols-4">
        <StatCard label="Total accounts" value={formatNumber(metrics.users.total)} />
        <StatCard
          label="New · 7 days"
          value={formatNumber(metrics.users.newLast7Days)}
          hint={`${formatNumber(metrics.users.newLast30Days)} in 30 days`}
        />
        <StatCard
          label="Active sessions"
          value={formatNumber(metrics.users.activeSessions)}
          hint={`${formatNumber(metrics.users.activeSessionUsers)} distinct accounts`}
        />
        <StatCard
          label="Active today"
          value={formatNumber(metrics.featureUsage.activeUsersToday)}
          hint="accounts using the hosted tier"
        />
      </div>
      <div className="mt-3 grid gap-3 min-[720px]:grid-cols-[1.6fr_1fr]">
        <SignupsChart daily={metrics.users.dailySignups} />
        <div className="rounded-lg border border-border bg-card p-5">
          <div className="mb-4 text-xs text-muted-foreground">Linked sign-in methods</div>
          <div className="grid gap-3">
            <ProviderBar
              label="GitHub"
              value={metrics.users.signInMethods.github}
              total={providerTotal}
            />
            <ProviderBar
              label="Google"
              value={metrics.users.signInMethods.google}
              total={providerTotal}
            />
            {metrics.users.signInMethods.other > 0 ? (
              <ProviderBar
                label="Other"
                value={metrics.users.signInMethods.other}
                total={providerTotal}
              />
            ) : null}
          </div>
        </div>
      </div>

      <SectionHeading>Feature usage · hosted tier</SectionHeading>
      <div className="grid grid-cols-2 gap-3 min-[720px]:grid-cols-4">
        <StatCard
          label="Voice · today"
          value={formatNumber(metrics.featureUsage.voiceCallsToday)}
          hint={`${formatNumber(metrics.featureUsage.voiceCallsWindow)} in ${metrics.windowDays} days`}
        />
        <StatCard
          label="Attention · today"
          value={formatNumber(metrics.featureUsage.attentionReviewsToday)}
          hint={`${formatNumber(metrics.featureUsage.attentionReviewsWindow)} in ${metrics.windowDays} days`}
        />
        <StatCard
          label="Voice ceiling"
          value={formatNumber(metrics.reliability.voiceDailyLimit)}
          hint="calls per account per day"
        />
        <StatCard
          label="Attention ceiling"
          value={formatNumber(metrics.reliability.attentionDailyLimit)}
          hint="reviews per account per day"
        />
      </div>
      <div className="mt-3">
        <UsageChart daily={metrics.featureUsage.daily} />
      </div>
      <SectionHeading>Heaviest hosted-tier accounts</SectionHeading>
      <TopUsersTable users={metrics.featureUsage.topUsers} />

      <SectionHeading>Reliability</SectionHeading>
      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Throttled account-days · today"
          value={formatNumber(metrics.reliability.quotaLimitedUserDaysToday)}
          hint="an account that reached a daily ceiling"
        />
        <StatCard
          label={`Throttled account-days · ${metrics.windowDays} days`}
          value={formatNumber(metrics.reliability.quotaLimitedUserDaysWindow)}
        />
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        A hosted request that reaches a daily ceiling is refused with{" "}
        <code className="font-mono text-xs">quota-exhausted</code>; the count above is the closest
        rejection signal the service's own tables hold. Per-request error rates and client-side
        failures are recorded as product-analytics events, which live with the analytics processor
        rather than in this database.
      </p>

      <SectionHeading>System health</SectionHeading>
      <div className="grid gap-3 min-[720px]:grid-cols-[1fr_1.4fr]">
        <div className="rounded-lg border border-border bg-card px-5 py-4">
          <div className="font-mono text-xs tracking-[0.2px] text-muted-foreground uppercase">
            Database
          </div>
          <div
            className="mt-2 inline-flex items-center gap-2 text-xl font-semibold"
            data-tone={db.reachable ? "complete" : "attention"}
          >
            <span
              className="inline-block size-2.5 rounded-full data-[on=true]:bg-complete data-[on=false]:bg-attention"
              data-on={db.reachable}
              aria-hidden="true"
            />
            <span className={db.reachable ? "text-complete" : "text-attention"}>
              {db.reachable ? "Reachable" : "Unreachable"}
            </span>
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            probe round-trip {formatNumber(db.latencyMs)} ms
          </div>
        </div>
        <div className="rounded-lg border border-border bg-card px-5 py-4">
          <div className="mb-1 font-mono text-xs tracking-[0.2px] text-muted-foreground uppercase">
            Integrations
          </div>
          <ul className="m-0 list-none p-0">
            {metrics.systemHealth.integrations.map((integration) => (
              <IntegrationRow key={integration.key} integration={integration} />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function SignInCard(): React.JSX.Element {
  const [pending, setPending] = useState<SocialProvider>();
  const [failed, setFailed] = useState(false);

  const begin = async (provider: SocialProvider) => {
    if (pending) return;
    setPending(provider);
    setFailed(false);
    const result = await authClient.signIn.social({
      provider,
      callbackURL: window.location.pathname,
    });
    if (result.error) {
      setPending(undefined);
      setFailed(true);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center p-6">
      <section className="w-full max-w-[390px] rounded-lg border border-border bg-card px-8 py-12 text-center shadow-[0_24px_80px_rgba(0,0,0,0.42)]">
        <div className="inline-flex w-13" aria-hidden="true">
          <LukeMark className="h-auto w-full" />
        </div>
        <h1 className="mt-4 mb-2 text-[1.75rem] leading-[1.15] font-semibold">Luke admin</h1>
        <p className="m-0 text-muted-foreground">
          Sign in with the account this dashboard is restricted to.
        </p>
        <div className="mt-8 mb-4 grid gap-3">
          <button
            type="button"
            className="min-h-[46px] cursor-pointer rounded-md border border-border bg-card font-semibold transition-[background-color,transform] duration-150 hover:not-disabled:-translate-y-px hover:not-disabled:bg-muted disabled:cursor-wait disabled:opacity-[0.56] motion-reduce:transition-none"
            disabled={pending !== undefined}
            onClick={() => void begin(SOCIAL_PROVIDER.GITHUB)}
          >
            {pending === SOCIAL_PROVIDER.GITHUB
              ? "Opening…"
              : `Continue with ${SOCIAL_PROVIDER_LABEL[SOCIAL_PROVIDER.GITHUB]}`}
          </button>
          <button
            type="button"
            className="min-h-[46px] cursor-pointer rounded-md border border-border bg-card font-semibold transition-[background-color,transform] duration-150 hover:not-disabled:-translate-y-px hover:not-disabled:bg-muted disabled:cursor-wait disabled:opacity-[0.56] motion-reduce:transition-none"
            disabled={pending !== undefined}
            onClick={() => void begin(SOCIAL_PROVIDER.GOOGLE)}
          >
            {pending === SOCIAL_PROVIDER.GOOGLE
              ? "Opening…"
              : `Continue with ${SOCIAL_PROVIDER_LABEL[SOCIAL_PROVIDER.GOOGLE]}`}
          </button>
        </div>
        {failed ? <p className="m-0 text-attention">Sign-in could not start. Try again.</p> : null}
      </section>
    </main>
  );
}

function Centered({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <main className="grid min-h-screen place-items-center p-6">
      <section className="w-full max-w-[420px] rounded-lg border border-border bg-card px-8 py-12 text-center">
        <div className="mx-auto inline-flex w-11" aria-hidden="true">
          <LukeMark className="h-auto w-full" />
        </div>
        <h1 className="mt-4 mb-2 text-2xl font-semibold">{title}</h1>
        <div className="text-muted-foreground">{children}</div>
      </section>
    </main>
  );
}

export function AdminDashboard(): React.JSX.Element {
  const [state, setState] = useState<DashboardState>({ status: "loading" });

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const response = await fetch(METRICS_PATH, { headers: { accept: "application/json" } });
        if (!live) return;
        if (response.status === 401) {
          setState({ status: "signed-out" });
          return;
        }
        if (response.status === 403) {
          setState({ status: "forbidden" });
          return;
        }
        if (!response.ok) {
          setState({ status: "error" });
          return;
        }
        const metrics = (await response.json()) as AdminMetrics;
        if (live) setState({ status: "ready", metrics });
      } catch {
        if (live) setState({ status: "error" });
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const body = useMemo(() => {
    switch (state.status) {
      case "loading":
        return <Centered title="Loading…">Reading the service's own tables.</Centered>;
      case "signed-out":
        return <SignInCard />;
      case "forbidden":
        return (
          <Centered title="Not authorized">
            You are signed in, but this dashboard is restricted to Luke's maintainers.
          </Centered>
        );
      case "error":
        return (
          <Centered title="Could not load">
            The metrics endpoint did not answer. Try again shortly.
          </Centered>
        );
      case "ready":
        return <Dashboard metrics={state.metrics} />;
    }
  }, [state]);

  return body;
}
