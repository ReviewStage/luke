import type { FaceMotion } from "@luke/brand";
import {
  ALIGN,
  Card,
  Inline,
  JUSTIFY,
  Stack,
  TEXT_ELEMENT,
  TEXT_FONT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
} from "@luke/ui";
import {
  ANIMATION_ROSTER,
  ANIMATION_SWATCH,
  ANIMATION_VARIANT,
  type AnimationEntry,
  type AnimationVariant,
  formatCycleSeconds,
  indexAnimationAssets,
} from "@luke/ui/admin-animations";
import { useEffect, useRef } from "react";
import { AdminPage, type ViewerAccount } from "../chrome/page-header";

/**
 * The committed motion SVGs, inlined into the bundle at build time. The glob
 * reaches outside the app the way the changelog's `CHANGELOG.md?raw` does:
 * `packages/brand/assets/motion/` is the artwork's one committed home, and a copy kept
 * here would drift from what `generate-brand-assets.mjs --check` guards. The
 * pattern is resolved against this file, and a glob that matches nothing is an
 * empty set rather than a failed build — so a moved file draws every motion as
 * a missing asset and says nothing about why.
 */
const MOTION_ASSET_SOURCES = import.meta.glob<string>(
  "../../../../../packages/brand/assets/motion/*.svg",
  {
    eager: true,
    query: "?raw",
    import: "default",
  },
);

const MOTION_ASSETS = indexAnimationAssets(MOTION_ASSET_SOURCES);

/**
 * Each variant's markup as one `{__html}` object per asset, built once. React
 * re-sets `dangerouslySetInnerHTML` whenever that object's identity changes,
 * which replaces the SVG elements and restarts their timelines unpaused — so
 * an object built in render would undo the pause below on any ancestor
 * re-render, the session resolving included.
 */
const MOTION_MARKUP: ReadonlyMap<
  FaceMotion,
  ReadonlyMap<AnimationVariant, { __html: string }>
> = new Map(
  [...MOTION_ASSETS].map(([motion, byVariant]) => [
    motion,
    new Map([...byVariant].map(([variant, svg]) => [variant, { __html: svg }])),
  ]),
);

/** Dark first: the variant matching the page's own surface previews first. */
const PREVIEW_VARIANTS: readonly AnimationVariant[] = [
  ANIMATION_VARIANT.DARK,
  ANIMATION_VARIANT.LIGHT,
];

/** A preview's square: a variant's motion, or the word for a missing one. */
const PREVIEW_FRAME = "aspect-square overflow-hidden rounded-md";

/**
 * One motion's card: its name and cycle in the shared roles over a preview
 * per variant, then the parts it draws beyond the face, if any. Note that the
 * name and the cycle keep the monospace face, because both are the artwork's
 * own identifiers and figures rather than prose.
 */
function AnimationCard({ entry }: { entry: AnimationEntry }): React.JSX.Element {
  const variants = MOTION_MARKUP.get(entry.motion);
  return (
    <Card>
      <Stack>
        <Inline justify={JUSTIFY.BETWEEN} align={ALIGN.BASELINE}>
          <Text as={TEXT_ELEMENT.H3} variant={TEXT_VARIANT.SECTION} font={TEXT_FONT.MONO}>
            {entry.motion}
          </Text>
          <Text
            as={TEXT_ELEMENT.SPAN}
            variant={TEXT_VARIANT.CAPTION}
            tone={TEXT_TONE.MUTED}
            font={TEXT_FONT.MONO}
          >
            {formatCycleSeconds(entry.cycleMs)} cycle
          </Text>
        </Inline>
        <div className="grid grid-cols-2 gap-3">
          {PREVIEW_VARIANTS.map((variant) => {
            const markup = variants?.get(variant);
            return markup === undefined ? (
              <div
                key={variant}
                className={`${PREVIEW_FRAME} grid place-items-center border border-dashed border-border px-2 text-center`}
              >
                <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
                  No committed asset
                </Text>
              </div>
            ) : (
              <div
                key={variant}
                className={`${PREVIEW_FRAME} [&>svg]:block [&>svg]:size-full`}
                style={{ backgroundColor: ANIMATION_SWATCH[variant] }}
                aria-hidden="true"
                dangerouslySetInnerHTML={markup}
              />
            );
          })}
        </div>
        {entry.extraParts.length > 0 ? (
          <Text variant={TEXT_VARIANT.CAPTION} tone={TEXT_TONE.MUTED}>
            Also draws: {entry.extraParts.join(", ")}
          </Text>
        ) : null}
      </Stack>
    </Card>
  );
}

/**
 * Every motion the face artwork defines, previewed from the committed brand
 * SVGs beside the metadata the generated table states. The page reads nothing
 * from the service — the artwork is the repository's own, inlined at build
 * time — so the local sign-in press is the only gate standing before it, the
 * same first-visit consent every other view starts behind.
 */
export function AnimationsScreen({
  account,
  onSignOut,
}: {
  account: ViewerAccount | undefined;
  onSignOut: () => void;
}): React.JSX.Element {
  // SMIL loops answer to neither `--face-motion` nor `prefers-reduced-motion`,
  // so the page holds them still itself wherever the reader asked the system
  // for less motion, following the setting as it changes.
  const previewsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previews = previewsRef.current;
    if (previews === null) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => {
      for (const svg of previews.querySelectorAll("svg")) {
        if (reduced.matches) svg.pauseAnimations();
        else svg.unpauseAnimations();
      }
    };
    apply();
    reduced.addEventListener("change", apply);
    return () => reduced.removeEventListener("change", apply);
  }, []);

  return (
    <AdminPage title="Animations" account={account} onSignOut={onSignOut} controls={null}>
      <div
        ref={previewsRef}
        className="mt-8 grid gap-4 min-[560px]:grid-cols-2 min-[880px]:grid-cols-3"
      >
        {ANIMATION_ROSTER.map((entry) => (
          <AnimationCard key={entry.motion} entry={entry} />
        ))}
      </div>
    </AdminPage>
  );
}
