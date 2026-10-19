/**
 * shadcn/ui's chart primitives (registry `new-york-v4/ui/chart`, built for
 * recharts 3), vendored because no app here is shadcn-scaffolded: there is no
 * components.json for the CLI to install into, and the one shared utility the
 * registry file expects — `cn` from `@/lib/utils` — is this package's own
 * `cn`. Exported at `@luke/ui/chart` alone, so recharts rides into no bundle
 * behind the barrel. Its frame and tooltip are drawn by `chart.css` in the
 * shared `--luke-*` tokens, not the stock utilities, so the chart reads
 * alike whichever app mounts it; a caller's `className` on the container
 * sizes it and nothing more. The tooltip's indicator is the swatch alone,
 * stock's line and dashed variants having no caller. Series colors
 * arrive through `ChartConfig`, whose values this repository fixes at build
 * time, never from anything observed.
 */

import * as React from "react";
import type { TooltipValueType } from "recharts";
import * as RechartsPrimitive from "recharts";
import { cn } from "../cn.js";
import { isSafeChartCssColor, isSafeChartCssKey } from "./chart-css.js";

// Format: { THEME_NAME: CSS_SELECTOR }
// A dark series colour applies where the page is drawn in the dark theme
// (`data-luke-theme`, `@luke/ui`'s `tokens/surface.ts`).
const THEMES = { light: "", dark: '[data-luke-theme="dark"]' } as const;

const INITIAL_DIMENSION = { width: 320, height: 200 } as const;
type TooltipNameType = number | string;

export type ChartConfig = Record<
  string,
  {
    label?: React.ReactNode;
    icon?: React.ComponentType;
  } & (
    | { color?: string; theme?: never }
    | { color?: never; theme: Record<keyof typeof THEMES, string> }
  )
>;

interface ChartContextProps {
  config: ChartConfig;
}

const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
  const context = React.useContext(ChartContext);

  if (!context) {
    throw new Error("useChart must be used within a <ChartContainer />");
  }

  return context;
}

function ChartContainer({
  id,
  className,
  children,
  config,
  initialDimension = INITIAL_DIMENSION,
  ...props
}: React.ComponentProps<"div"> & {
  config: ChartConfig;
  children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"];
  initialDimension?: {
    width: number;
    height: number;
  };
}) {
  const uniqueId = React.useId();
  const chartId = `chart-${id ?? uniqueId.replace(/:/g, "")}`;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn("luke-chart", className)}
        {...props}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer initialDimension={initialDimension}>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

const ChartStyle = ({ id, config }: { id: string; config: ChartConfig }) => {
  // SAFETY: the interpolation below is raw CSS, so the boundary must sit here
  // in the primitive rather than at call sites: every config funnels through
  // this component, and a future call site feeding it anything observed would
  // otherwise turn a key or color string into an injection point. An entry
  // that fails validation is skipped, not thrown on, because one bad series
  // color should cost that series its variable, not the chart its render.
  const colorConfig = Object.entries(config).filter(([key, itemConfig]) => {
    const colors = itemConfig.theme
      ? Object.values(itemConfig.theme)
      : itemConfig.color
        ? [itemConfig.color]
        : [];
    return colors.length > 0 && isSafeChartCssKey(key) && colors.every(isSafeChartCssColor);
  });

  if (!colorConfig.length) {
    return null;
  }

  return (
    <style
      dangerouslySetInnerHTML={{
        __html: Object.entries(THEMES)
          .map(
            ([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${colorConfig
  .map(([key, itemConfig]) => {
    // SAFETY: theme iterates Object.entries(THEMES), so it is a THEMES key.
    const color = itemConfig.theme?.[theme as keyof typeof itemConfig.theme] ?? itemConfig.color;
    return color ? `  --color-${key}: ${color};` : null;
  })
  .join("\n")}
}
`,
          )
          .join("\n"),
      }}
    />
  );
};

const ChartTooltip = RechartsPrimitive.Tooltip;

/** One series' line of a tooltip: its swatch, or the icon its config names, then its name and value. */
function ChartTooltipRow({
  indicator,
  name,
  value,
}: {
  indicator: React.ReactNode;
  name: React.ReactNode;
  value: React.ReactNode;
}) {
  return (
    <div className="luke-chart-tooltip-row">
      {indicator}
      <div className="luke-chart-tooltip-entry">
        <span className="luke-chart-tooltip-name">{name}</span>
        {value}
      </div>
    </div>
  );
}

function ChartTooltipSwatch({ color }: { color: string | undefined }) {
  return <div className="luke-chart-tooltip-swatch" style={{ backgroundColor: color }} />;
}

/**
 * A tooltip for a chart that is not recharts', one it places itself: the
 * same floating card as `ChartTooltipContent`, over `label`, with one row per
 * series under it, each its colour's swatch, its name, and its value.
 */
function ChartTooltipFrame({
  label,
  rows,
}: {
  label: React.ReactNode;
  rows: readonly {
    readonly key: string;
    readonly color: string;
    readonly name: React.ReactNode;
    readonly value: React.ReactNode;
  }[];
}) {
  return (
    <div className="luke-chart-tooltip">
      <div className="luke-chart-tooltip-label">{label}</div>
      {rows.map((row) => (
        <ChartTooltipRow
          key={row.key}
          indicator={<ChartTooltipSwatch color={row.color} />}
          name={row.name}
          value={<span className="luke-chart-tooltip-value">{row.value}</span>}
        />
      ))}
    </div>
  );
}

function ChartTooltipContent({
  active,
  payload,
  hideLabel = false,
  hideIndicator = false,
  label,
  labelFormatter,
  formatter,
  color,
  nameKey,
  labelKey,
  valueFormatter,
}: React.ComponentProps<typeof RechartsPrimitive.Tooltip> & {
  hideLabel?: boolean;
  hideIndicator?: boolean;
  color?: string;
  nameKey?: string;
  labelKey?: string;
  /** How a finite value is drawn, where the locale's plain number would misread it, as a share. */
  valueFormatter?: (value: number) => string;
} & Omit<
    RechartsPrimitive.DefaultTooltipContentProps<TooltipValueType, TooltipNameType>,
    "accessibilityLayer"
  >) {
  const { config } = useChart();

  const tooltipLabel = React.useMemo(() => {
    if (hideLabel || !payload?.length) {
      return null;
    }

    const [item] = payload;
    const key = `${labelKey ?? item?.dataKey ?? item?.name ?? "value"}`;
    const itemConfig = getPayloadConfigFromPayload(config, item, key);
    // Recharts hands `label` over as a loose ReactNode, and a string is the
    // only form that can name a ChartConfig entry — this check is the boundary.
    const value =
      // oxlint-disable-next-line anti-slop/no-runtime-typeof
      !labelKey && typeof label === "string" ? (config[label]?.label ?? label) : itemConfig?.label;

    if (labelFormatter) {
      return <div className="luke-chart-tooltip-label">{labelFormatter(value, payload)}</div>;
    }

    if (!value) {
      return null;
    }

    return <div className="luke-chart-tooltip-label">{value}</div>;
  }, [label, labelFormatter, payload, hideLabel, config, labelKey]);

  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className="luke-chart-tooltip">
      {tooltipLabel}
      <div className="luke-chart-tooltip-rows">
        {payload
          .filter((item) => item.type !== "none")
          .map((item, index) => {
            const key = `${nameKey ?? item.name ?? item.dataKey ?? "value"}`;
            const itemConfig = getPayloadConfigFromPayload(config, item, key);
            const indicatorColor = color ?? item.payload?.fill ?? item.color;

            if (formatter && item?.value !== undefined && item.name) {
              return (
                <div key={key} className="luke-chart-tooltip-row">
                  {formatter(item.value, item.name, item, index, item.payload)}
                </div>
              );
            }
            return (
              <ChartTooltipRow
                key={key}
                indicator={
                  itemConfig?.icon ? (
                    <itemConfig.icon />
                  ) : hideIndicator ? null : (
                    <ChartTooltipSwatch color={indicatorColor} />
                  )
                }
                name={itemConfig?.label ?? item.name}
                value={
                  item.value == null ? null : (
                    <span className="luke-chart-tooltip-value">
                      {Number.isFinite(item.value)
                        ? (valueFormatter?.(Number(item.value)) ??
                          Number(item.value).toLocaleString())
                        : String(item.value)}
                    </span>
                  )
                }
              />
            );
          })}
      </div>
    </div>
  );
}

/**
 * Helper to extract item config from a payload.
 *
 * This is the boundary where recharts' untyped tooltip and legend payloads
 * are parsed: their shapes are recharts' own, carrying no contract this
 * repository could import, so the narrowing has to happen here at runtime.
 */
/* oxlint-disable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/require-safety-comment-for-type-assertion */
function getPayloadConfigFromPayload(config: ChartConfig, payload: unknown, key: string) {
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }

  const payloadPayload =
    "payload" in payload && typeof payload.payload === "object" && payload.payload !== null
      ? payload.payload
      : undefined;

  let configLabelKey: string = key;

  if (key in payload && typeof payload[key as keyof typeof payload] === "string") {
    configLabelKey = payload[key as keyof typeof payload] as string;
  } else if (
    payloadPayload &&
    key in payloadPayload &&
    typeof payloadPayload[key as keyof typeof payloadPayload] === "string"
  ) {
    configLabelKey = payloadPayload[key as keyof typeof payloadPayload] as string;
  }

  return configLabelKey in config ? config[configLabelKey] : config[key];
}

/* oxlint-enable anti-slop/no-unknown-parameters, anti-slop/no-runtime-typeof, anti-slop/require-safety-comment-for-type-assertion */

export { ChartContainer, ChartTooltip, ChartTooltipContent, ChartTooltipFrame };
