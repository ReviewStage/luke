import { formatCount } from "@repo/features/number-format";
import * as React from "react";
import type { TooltipValueType } from "recharts";
import * as RechartsPrimitive from "recharts";
import { cn } from "../cn.js";
import { isSafeChartCssColor, isSafeChartCssKey } from "./chart-css.js";

const THEMES = { light: "", dark: '[data-ui-theme="dark"]' } as const;

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
  const { style, ...rest } = props;

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn("ui-chart", className)}
        style={{ ...singleColorVariables(config), ...style }}
        {...rest}
      >
        <ChartStyle id={chartId} config={config} />
        <RechartsPrimitive.ResponsiveContainer initialDimension={initialDimension}>
          {children}
        </RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
}

function singleColorVariables(config: ChartConfig): React.CSSProperties {
  const variables: Record<string, string> = {};
  for (const [key, itemConfig] of Object.entries(config)) {
    if (itemConfig.theme || !itemConfig.color) continue;
    if (!isSafeChartCssKey(key) || !isSafeChartCssColor(itemConfig.color)) continue;
    variables[`--color-${key}`] = itemConfig.color;
  }
  return variables;
}

const ChartStyle = ({ id, config }: { id: string; config: ChartConfig }) => {
  const colorConfig = Object.entries(config).filter(([key, itemConfig]) => {
    const colors = itemConfig.theme ? Object.values(itemConfig.theme) : [];
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
    const color = itemConfig.theme?.[theme as keyof typeof itemConfig.theme];
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
    <div className="ui-chart-tooltip-row">
      {indicator}
      <div className="ui-chart-tooltip-entry">
        <span className="ui-chart-tooltip-name">{name}</span>
        {value}
      </div>
    </div>
  );
}

function ChartTooltipSwatch({ color }: { color: string | undefined }) {
  return <div className="ui-chart-tooltip-swatch" style={{ backgroundColor: color }} />;
}

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
    <div className="ui-chart-tooltip">
      <div className="ui-chart-tooltip-label">{label}</div>
      {rows.map((row) => (
        <ChartTooltipRow
          key={row.key}
          indicator={<ChartTooltipSwatch color={row.color} />}
          name={row.name}
          value={<span className="ui-chart-tooltip-value">{row.value}</span>}
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
    const value =
      !labelKey && typeof label === "string" ? (config[label]?.label ?? label) : itemConfig?.label;

    if (labelFormatter) {
      return <div className="ui-chart-tooltip-label">{labelFormatter(value, payload)}</div>;
    }

    if (!value) {
      return null;
    }

    return <div className="ui-chart-tooltip-label">{value}</div>;
  }, [label, labelFormatter, payload, hideLabel, config, labelKey]);

  if (!active || !payload?.length) {
    return null;
  }

  return (
    <div className="ui-chart-tooltip">
      {tooltipLabel}
      <div className="ui-chart-tooltip-rows">
        {payload
          .filter((item) => item.type !== "none")
          .map((item, index) => {
            const key = `${nameKey ?? item.name ?? item.dataKey ?? "value"}`;
            const itemConfig = getPayloadConfigFromPayload(config, item, key);
            const indicatorColor = color ?? item.payload?.fill ?? item.color;

            if (formatter && item?.value !== undefined && item.name) {
              return (
                <div key={key} className="ui-chart-tooltip-row">
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
                    <span className="ui-chart-tooltip-value">
                      {Number.isFinite(item.value)
                        ? (valueFormatter?.(Number(item.value)) ?? formatCount(Number(item.value)))
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

export { ChartContainer, ChartTooltip, ChartTooltipContent, ChartTooltipFrame };
