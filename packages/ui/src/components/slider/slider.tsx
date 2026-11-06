import { cn } from "../../cn.js";
import { Slider as ShadcnSlider } from "../../shadcn/slider.js";

export const SLIDER_LENGTH = {
  COMFORTABLE: "comfortable",
  FILL: "fill",
} as const;

export type SliderLength = (typeof SLIDER_LENGTH)[keyof typeof SLIDER_LENGTH];

const LENGTH = {
  comfortable: "data-horizontal:w-[min(320px,100%)]",
  fill: "flex-[1_1_auto] data-horizontal:w-auto min-w-0",
} as const satisfies Record<SliderLength, string>;

export function Slider({
  value,
  onChange,
  label,
  min = 0,
  max = 100,
  step,
  length = SLIDER_LENGTH.COMFORTABLE,
  valueText,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  min?: number | undefined;
  max?: number | undefined;
  step?: number | undefined;
  length?: SliderLength | undefined;
  valueText?: string | undefined;
}): React.JSX.Element {
  return (
    <ShadcnSlider
      className={cn("ui-slider", LENGTH[length])}
      data-length={length}
      min={min}
      max={max}
      step={step}
      value={value}
      thumbLabel={label}
      thumbValueText={valueText}
      onValueChange={(next) => onChange(typeof next === "number" ? next : (next[0] ?? min))}
    />
  );
}
