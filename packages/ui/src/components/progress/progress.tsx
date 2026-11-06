import { Progress as ShadcnProgress } from "../../shadcn/progress.js";

function percentOf(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function Progress({
  value,
  label,
}: {
  value: number;
  label?: string | undefined;
}): React.JSX.Element {
  const percent = percentOf(value);
  const read =
    label === undefined
      ? ({
          "aria-hidden": true,
          role: undefined,
          "aria-valuemin": undefined,
          "aria-valuemax": undefined,
          "aria-valuenow": undefined,
          "aria-valuetext": undefined,
        } as const)
      : ({
          role: "progressbar",
          "aria-label": label,
          "aria-valuemin": 0,
          "aria-valuemax": 100,
          "aria-valuenow": Math.round(percent),
          "aria-valuetext": undefined,
        } as const);
  return <ShadcnProgress value={percent} {...read} />;
}
