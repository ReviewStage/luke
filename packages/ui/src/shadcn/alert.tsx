import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "../cn.js";
import { STATUS_TONE, type StatusTone } from "../status-tone.js";

/**
 * alert.tsx -- shadcn/ui's alert (style `base-nova`), vendored and drawn as Luke's banner: a glyph, its words, and the presses that answer it on one row.
 *
 * The component is shadcn's own source, kept as close to it as the window
 * allows, so a later `shadcn add alert` reads as a small diff. Its local
 * changes:
 *
 * - `Alert` is a `<section>` with no `role="alert"`, because a banner is a
 *   region named by its own words (`aria-labelledby`), which a reader finds
 *   rather than hears announced the moment it mounts. Its `variant`
 *   (`default`, `destructive`) is Luke's `look` (`strip`, `card`, `row`) and
 *   a status `tone` (`../status-tone.ts`), each kept on the section as
 *   `data-look`/`data-tone` too, so the tone's ink and tint
 *   (`tokens/status-tone.css`) reach its strip's mix and its card's disc.
 * - shadcn's grid of an icon beside a title and a description is Luke's one
 *   flex row (`AlertRow`) of a glyph slot (`AlertGlyph`, which shadcn reaches
 *   as `*:[svg]`), the words (`AlertDescription`), and the presses
 *   (`AlertAction`), which stand in the row rather than absolutely at its
 *   corner, so they drop beneath the words where the banner is narrow
 *   (`components/banner/banner.css`'s container query).
 * - Luke's inks, type, spacing, and radii from the theme rather than
 *   `bg-card` and `text-sm`, and no `text-balance`, link underline, or
 *   `md:` breakpoint, because a banner measures its own width.
 * - `AlertTitle` is dropped, because a banner's words are one slot whose
 *   heading, where it has one, is the caller's own `Text`.
 * - Each part keeps the `luke-banner-*` class it wore before the move, which
 *   the sheet's narrow rules select. The words and the glyph do not go
 *   through `cn`, because
 *   tailwind-merge reads `text-body` (a size) and `text-body-foreground` (a
 *   colour) as one group and would keep only the last.
 *
 * `@luke/ui`'s `Banner` (`components/banner/banner.tsx`) is what an app
 * draws; this is its inside.
 */

const alertVariants = cva("luke-banner flex-none @container/luke-banner", {
  variants: {
    look: {
      strip:
        "border-b border-banner-strip-edge bg-banner-strip py-banner-strip-block pr-banner-strip-end pl-banner-strip-start",
      card: "box-border rounded-dialog border border-border-strong bg-well p-banner-card pl-banner-card-start",
      row: "",
    },
  },
});

type AlertLook = NonNullable<VariantProps<typeof alertVariants>["look"]>;
type AlertTone = StatusTone;

const alertRowVariants = cva("luke-banner-row flex", {
  variants: {
    look: {
      strip: "min-h-control items-center gap-icon-gap",
      card: "items-center gap-banner-card",
      row: "items-start gap-icon-gap",
    },
  },
});

const alertGlyphVariants = cva(
  "luke-banner-glyph inline-flex flex-none items-center justify-center [&>svg]:size-control-icon",
  {
    variants: {
      look: {
        strip: "text-muted-foreground",
        card: "size-banner-disc rounded-full",
        row: "h-control text-muted-foreground",
      },
      // Note that a neutral card's disc is the strong fill, and any other tone's is its tint in its ink.
      neutral: {
        true: "",
        false: "",
      },
    },
    compoundVariants: [
      { look: "card", neutral: true, class: "bg-secondary text-muted-foreground" },
      { look: "card", neutral: false, class: "bg-tone-tint text-tone-ink" },
    ],
  },
);

const alertDescriptionVariants = cva("luke-banner-words min-w-0 flex-1", {
  variants: {
    look: {
      strip: "block overflow-hidden text-ellipsis text-body text-body-foreground",
      card: "flex flex-col gap-banner-words-gap",
      row: "flex flex-col gap-banner-words-gap py-banner-row-inset",
    },
  },
});

function Alert({
  className,
  look,
  tone,
  ...props
}: React.ComponentProps<"section"> & { look: AlertLook; tone: AlertTone }) {
  return (
    <section
      data-slot="alert"
      data-look={look}
      data-tone={tone}
      className={cn(alertVariants({ look }), className)}
      {...props}
    />
  );
}

function AlertRow({ look, ...props }: React.ComponentProps<"div"> & { look: AlertLook }) {
  return <div data-slot="alert-row" className={alertRowVariants({ look })} {...props} />;
}

function AlertGlyph({
  look,
  tone,
  ...props
}: React.ComponentProps<"span"> & { look: AlertLook; tone: AlertTone }) {
  return (
    <span
      data-slot="alert-glyph"
      aria-hidden="true"
      className={alertGlyphVariants({ look, neutral: tone === STATUS_TONE.NEUTRAL })}
      {...props}
    />
  );
}

function AlertDescription({ look, ...props }: React.ComponentProps<"div"> & { look: AlertLook }) {
  return (
    <div data-slot="alert-description" className={alertDescriptionVariants({ look })} {...props} />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("luke-banner-actions flex min-w-0 items-center gap-control-gap", className)}
      {...props}
    />
  );
}

export type { AlertLook, AlertTone };
export { Alert, AlertAction, AlertDescription, AlertGlyph, AlertRow };
