import type { CSSProperties, ReactNode } from "react";
import { cssCustomProperties } from "../../css.js";
import { ReplayWords } from "../../session-replay-marks.js";
import { Badge as ShadcnBadge } from "../../shadcn/badge.js";
import { STATUS_TONE, type StatusTone } from "../../status-tone.js";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "../text/text.js";
import type { VisuallyHiddenUnder } from "../visually-hidden/visually-hidden.js";

const SWATCH_COLOR = /^#?([0-9a-f]{6})$/iu;

const BADGE_FACE = {
  PLAIN: "plain",
  FILLED: "filled",
  LIT: "lit",
} as const;

const SWATCH = "ui-badge-swatch size-badge-swatch flex-none rounded-full bg-muted-foreground";

const LIGHT_FILL = 0.453;

const DARK_WORDS = "#24292f";
const LIGHT_WORDS = "#ffffff";

const DARK_GROUND_WORDS = 0.6;

const EDGE_SHADE = 0.15;

const TINT_ALPHA = "20";
const EDGE_ALPHA = "40";

type Rgb = readonly [number, number, number];

function channelsOf(color: string): Rgb | undefined {
  const hex = SWATCH_COLOR.exec(color.trim())?.[1];
  if (hex === undefined) return undefined;
  const channel = (at: number) => Number.parseInt(hex.slice(at, at + 2), 16);
  return [channel(0), channel(2), channel(4)];
}

function lightnessOf([red, green, blue]: Rgb): number {
  return (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255;
}

function mixed([red, green, blue]: Rgb, toward: number, by: number): Rgb {
  const move = (channel: number) => Math.round(channel + (toward - channel) * by);
  return [move(red), move(green), move(blue)];
}

function hexOf(rgb: Rgb): string {
  return `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

function fillColors(color: string): CSSProperties | undefined {
  const rgb = channelsOf(color);
  if (rgb === undefined) return undefined;
  const fill = hexOf(rgb);
  const lightness = lightnessOf(rgb);
  const lift =
    lightness >= DARK_GROUND_WORDS ? 0 : (DARK_GROUND_WORDS - lightness) / (1 - lightness);
  const words = hexOf(mixed(rgb, 255, lift));
  return cssCustomProperties({
    "--ui-badge-fill-light": fill,
    "--ui-badge-edge-light": hexOf(mixed(rgb, 0, EDGE_SHADE)),
    "--ui-badge-words-light": lightness > LIGHT_FILL ? DARK_WORDS : LIGHT_WORDS,
    "--ui-badge-fill-dark": `${fill}${TINT_ALPHA}`,
    "--ui-badge-edge-dark": `${words}${EDGE_ALPHA}`,
    "--ui-badge-words-dark": words,
  });
}

function FilledWords({ children }: { children: string }): React.JSX.Element {
  return (
    <Text
      as={TEXT_ELEMENT.SPAN}
      variant={TEXT_VARIANT.INHERIT}
      truncate
      className="ui-badge-line block"
      dir="auto"
    >
      {children}
    </Text>
  );
}

export function Badge({
  tone = STATUS_TONE.NEUTRAL,
  icon,
  swatch,
  fill,
  lit = false,
  hideWordsUnder,
  replayMasked = false,
  children,
}: {
  tone?: StatusTone;
  icon?: ReactNode;
  swatch?: string | undefined;
  fill?: string | undefined;
  lit?: boolean;
  hideWordsUnder?: VisuallyHiddenUnder | undefined;
  replayMasked?: boolean | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const color = swatch === undefined ? undefined : SWATCH_COLOR.exec(swatch)?.[1];
  const filled = fill === undefined ? undefined : fillColors(fill);
  const marked = icon != null || swatch !== undefined || tone !== STATUS_TONE.NEUTRAL;
  const toneDot = tone !== STATUS_TONE.NEUTRAL && icon == null && swatch === undefined;
  const face = lit ? BADGE_FACE.LIT : filled === undefined ? BADGE_FACE.PLAIN : BADGE_FACE.FILLED;
  return (
    <ShadcnBadge
      className={lit && filled !== undefined ? "ui-badge whitespace-nowrap" : "ui-badge"}
      variant={tone}
      face={face}
      dot={toneDot}
      data-tone={tone}
      data-fill={filled === undefined ? undefined : "true"}
      data-lit={lit ? "true" : undefined}
      style={filled}
    >
      {swatch === undefined ? null : (
        <span
          className={SWATCH}
          aria-hidden="true"
          style={color === undefined ? undefined : { background: `#${color}` }}
        />
      )}
      {icon}
      <span
        className="ui-badge-words min-w-0 wrap-break-word"
        data-under={marked ? hideWordsUnder : undefined}
      >
        <ReplayWords masked={replayMasked}>
          {filled !== undefined && typeof children === "string" ? (
            <FilledWords>{children}</FilledWords>
          ) : (
            children
          )}
        </ReplayWords>
      </span>
    </ShadcnBadge>
  );
}
