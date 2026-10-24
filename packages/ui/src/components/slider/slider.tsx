import { cn } from "../../cn.js";
import { Slider as ShadcnSlider } from "../../shadcn/slider.js";

/**
 * slider.tsx -- one thumb along a track, for a value chosen between two
 * ends: how far a swipe or a fade has gone, or where a video stands in its
 * run.
 *
 * It is shadcn/ui's Base UI slider (`../../shadcn/slider.tsx`), drawn in the
 * switch's inks, whose thumb holds a native range input, so the arrow,
 * Home, End, and Page keys and the slider role and value reading come with
 * it. A `label` names it. It stands at a comfortable length, as long as the
 * room allows, or fills the room its row gives it (`SLIDER_LENGTH.FILL`),
 * as a video's scrubber does between its buttons.
 */

/** How long a slider stands: at a comfortable length, or across the room its row gives it. */
export const SLIDER_LENGTH = {
  COMFORTABLE: "comfortable",
  FILL: "fill",
} as const;

export type SliderLength = (typeof SLIDER_LENGTH)[keyof typeof SLIDER_LENGTH];

/** Each length's box: an off-scale comfortable length the room may cut short, or the row's room. */
const LENGTH = {
  comfortable: "data-horizontal:w-[min(320px,100%)]",
  fill: "flex-[1_1_auto] data-horizontal:w-auto min-w-0",
} as const satisfies Record<SliderLength, string>;

/** A range at `value` between `min` and `max`, named by `label`, told of each change. */
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
  /** What the slider moves, for a reader who cannot see it ("Swipe position"). */
  label: string;
  min?: number | undefined;
  max?: number | undefined;
  /** How far one step moves it; whole numbers where left out. */
  step?: number | undefined;
  /** How long it stands. */
  length?: SliderLength | undefined;
  /** Its value as a reader is told it ("0:04 of 0:25"), where the number alone says too little. */
  valueText?: string | undefined;
}): React.JSX.Element {
  return (
    <ShadcnSlider
      className={cn("luke-slider", LENGTH[length])}
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
