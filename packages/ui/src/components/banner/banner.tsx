import { STATUS_TONE, type StatusTone } from "../../status-tone.js";

import { type ReactNode, useId } from "react";
import { Alert, AlertAction, AlertDescription, AlertGlyph, AlertRow } from "../../shadcn/alert.js";
import { useClipped } from "../../use-clipped.js";

export const BANNER_LOOK = {
  STRIP: "strip",
  CARD: "card",
  ROW: "row",
  INSET: "inset",
} as const;

export type BannerLook = (typeof BANNER_LOOK)[keyof typeof BANNER_LOOK];

export const BANNER_GLYPH = {
  DISC: "disc",
  MARK: "mark",
} as const;

export type BannerGlyph = (typeof BANNER_GLYPH)[keyof typeof BANNER_GLYPH];

export function Banner({
  look,
  tone = STATUS_TONE.NEUTRAL,
  glyph,
  glyphLook = BANNER_GLYPH.DISC,
  actions,
  children,
}: {
  look: BannerLook;
  tone?: StatusTone;
  glyph: ReactNode;
  glyphLook?: BannerGlyph;
  actions?: ReactNode;
  children: ReactNode;
}): React.JSX.Element {
  const wordsId = useId();
  const [measured, clipped] = useClipped();
  const strip = look === BANNER_LOOK.STRIP;
  return (
    <Alert look={look} tone={tone} aria-labelledby={wordsId}>
      <AlertRow look={look}>
        <AlertGlyph look={look} tone={tone} mark={glyphLook === BANNER_GLYPH.MARK}>
          {glyph}
        </AlertGlyph>
        <AlertDescription
          look={look}
          tone={tone}
          id={wordsId}
          ref={strip ? measured : undefined}
          data-overflow={strip ? String(clipped) : undefined}
        >
          {children}
        </AlertDescription>
        {actions === undefined ? null : <AlertAction>{actions}</AlertAction>}
      </AlertRow>
    </Alert>
  );
}
