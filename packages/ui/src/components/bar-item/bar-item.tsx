import type { ReactNode } from "react";
import { pulseOnPress } from "../../press-pulse.js";

const BAR_ITEM =
  "ui-bar-item flex min-h-ui-48 flex-1 basis-0 flex-col items-center justify-center gap-ui-2 border-0 bg-transparent [font-family:inherit] [font-style:inherit] [font-weight:inherit] text-caption text-muted-foreground rounded-ui-full aria-[current=page]:bg-fill-selected aria-[current=page]:text-accent-ink";

const BAR_ITEMS =
  "ui-bar-items flex min-w-0 flex-1 items-center rounded-ui-full bg-ground p-ui-4 shadow-floating-edge";

const BAR_ACTION =
  "ui-bar-action flex size-bar-action flex-none items-center justify-center rounded-ui-full border-0 bg-primary text-primary-foreground shadow-floating-edge disabled:opacity-disabled [&_svg]:size-ui-24";

const BAR_ITEM_COUNT =
  "absolute -top-ui-4 left-bar-count-reach h-caption-leading min-w-caption-leading rounded-ui-full bg-attention-fill px-ui-4 text-center text-caption font-emphasis text-on-attention tabular-nums shadow-bar-count-ring";

export interface BarCount {
  readonly value: number;
  readonly noun?: string | undefined;
}

export interface BarItemProps {
  icon: ReactNode;
  children: ReactNode;
  current?: boolean | undefined;
  expanded?: boolean | undefined;
  count?: BarCount | undefined;
  inert?: boolean | undefined;
  onPointerDown?: (() => void) | undefined;
  onPress: () => void;
}

export function BarItem({
  icon,
  children,
  current = false,
  expanded,
  count,
  inert = false,
  onPointerDown,
  onPress,
}: BarItemProps): React.JSX.Element {
  const counted = count !== undefined && count.value > 0;
  return (
    <button
      type="button"
      className={BAR_ITEM}
      aria-current={current ? "page" : undefined}
      aria-expanded={expanded}
      inert={inert}
      onPointerDown={onPointerDown}
      onClick={pulseOnPress(onPress)}
    >
      <span className="relative flex [&_svg]:size-ui-20" aria-hidden="true">
        {icon}
        {counted ? <span className={BAR_ITEM_COUNT}>{count.value}</span> : null}
      </span>
      <span>
        {children}
        {counted ? (
          <span className="ui-visually-hidden">
            {count.noun === undefined ? `, ${count.value}` : `, ${count.value} ${count.noun}`}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function BarItems({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className={BAR_ITEMS}>{children}</div>;
}

export interface BarActionProps {
  icon: ReactNode;
  label: string;
  disabled?: boolean | undefined;
  onPress: () => void;
}

export function BarAction({
  icon,
  label,
  disabled = false,
  onPress,
}: BarActionProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={BAR_ACTION}
      aria-label={label}
      disabled={disabled}
      onClick={pulseOnPress(onPress)}
    >
      <span className="flex" aria-hidden="true">
        {icon}
      </span>
    </button>
  );
}
