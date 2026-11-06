import type { ReactNode } from "react";
import { cn } from "../../cn.js";
import { ShadcnSpinner } from "../../shadcn/spinner.js";
import { useSettled } from "./settle-wait.js";

export const SPINNER_SIZE = {
  SMALL: "small",
  INLINE: "inline",
  REGION: "region",
} as const;

export type SpinnerSize = (typeof SPINNER_SIZE)[keyof typeof SPINNER_SIZE];

const SPINNER_BOX =
  "ui-spinner inline-flex flex-none size-spinner text-muted-foreground data-[size=small]:size-spinner-small data-[size=region]:size-spinner-region";

const BUSY_SPINNER_BOX = "ui-spinner inline-flex flex-none size-spinner col-start-1 row-start-1";

export function SpinnerRing({ size }: { size?: SpinnerSize }): React.JSX.Element {
  const ring = <ShadcnSpinner />;
  if (size === undefined) return ring;
  return (
    <span className={SPINNER_BOX} data-size={size} aria-hidden="true">
      {ring}
    </span>
  );
}

export function Spinner({
  label,
  size = SPINNER_SIZE.INLINE,
  delay = true,
}: {
  label: string;
  size?: SpinnerSize;
  delay?: boolean;
}): React.JSX.Element {
  const settled = useSettled(delay);
  return (
    <span className={SPINNER_BOX} data-size={size} role="status">
      {delay && !settled ? null : <SpinnerRing />}
      <span className="ui-visually-hidden">{label}</span>
    </span>
  );
}

export function SpinnerRegion({
  label,
  delay = true,
}: {
  label: string;
  delay?: boolean;
}): React.JSX.Element {
  return (
    <div className="ui-spinner-region flex min-h-0 flex-1 items-center justify-center self-stretch p-spinner-region-inset">
      <Spinner label={label} size={SPINNER_SIZE.REGION} delay={delay} />
    </div>
  );
}

export function BusyLabel({
  busy,
  label,
  delay = true,
  children,
}: {
  busy: boolean;
  label: string;
  delay?: boolean;
  children: ReactNode;
}): React.JSX.Element {
  const settled = useSettled(busy && delay);
  if (!busy) return <>{children}</>;
  const ringShown = !delay || settled;
  return (
    <span className="ui-busy-label inline-grid items-center justify-items-center gap-[inherit]">
      <span
        className={cn(
          "ui-busy-label-words col-start-1 row-start-1 inline-flex items-center gap-[inherit]",
          ringShown && "invisible",
        )}
      >
        {children}
      </span>
      {ringShown ? (
        <span className={BUSY_SPINNER_BOX} data-size={SPINNER_SIZE.INLINE}>
          <SpinnerRing />
        </span>
      ) : null}
      <span className="ui-visually-hidden">{label}</span>
    </span>
  );
}
