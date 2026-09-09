import type { FaceMotion } from "@sidecar/surface";
import { useEffect, useRef } from "react";
import {
  ANIMATION_ROSTER,
  ANIMATION_SWATCH,
  ANIMATION_VARIANT,
  type AnimationEntry,
  type AnimationVariant,
  formatCycleSeconds,
  indexAnimationAssets,
} from "../../admin-animations";
import { PageHeader, type ViewerAccount } from "../chrome/page-header";

/**
 * The committed motion SVGs, inlined into the bundle at build time. The glob
 * reaches outside the app the way the changelog's `CHANGELOG.md?raw` does:
 * `design/brand/motion/` is the artwork's one committed home, and a copy kept
 * here would drift from what `generate-brand-assets.mjs --check` guards.
 */
const MOTION_ASSET_SOURCES = import.meta.glob<string>("../../../design/brand/motion/*.svg", {
  eager: true,
  query: "?raw",
  import: "default",
});

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

function AnimationCard({ entry }: { entry: AnimationEntry }): React.JSX.Element {
  const variants = MOTION_MARKUP.get(entry.motion);
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="m-0 font-mono text-sm font-semibold">{entry.motion}</h3>
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {formatCycleSeconds(entry.cycleMs)} cycle
        </span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {PREVIEW_VARIANTS.map((variant) => {
          const markup = variants?.get(variant);
          return markup === undefined ? (
            <div
              key={variant}
              className="grid aspect-square place-items-center rounded-md border border-dashed border-border px-2 text-center text-xs text-muted-foreground"
            >
              No committed asset
            </div>
          ) : (
            <div
              key={variant}
              className="aspect-square overflow-hidden rounded-md [&>svg]:block [&>svg]:size-full"
              style={{ backgroundColor: ANIMATION_SWATCH[variant] }}
              aria-hidden="true"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: the markup is a committed design/brand/motion SVG inlined at build time, not user input.
              dangerouslySetInnerHTML={markup}
            />
          );
        })}
      </div>
      {entry.extraParts.length > 0 ? (
        <p className="mt-3 mb-0 text-xs text-muted-foreground">
          Also draws: {entry.extraParts.join(", ")}
        </p>
      ) : null}
    </div>
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
    <main className="mx-auto max-w-[1040px] px-4 py-8 min-[520px]:px-6 min-[720px]:py-10">
      <PageHeader title="Animations" account={account} onSignOut={onSignOut} controls={null} />
      <div
        ref={previewsRef}
        className="mt-8 grid gap-4 min-[560px]:grid-cols-2 min-[880px]:grid-cols-3"
      >
        {ANIMATION_ROSTER.map((entry) => (
          <AnimationCard key={entry.motion} entry={entry} />
        ))}
      </div>
    </main>
  );
}
