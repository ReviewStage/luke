import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "../cn.js";
import { STATUS_TONE, type StatusTone } from "../status-tone.js";

const alertVariants = cva("ui-banner flex-none @container/ui-banner", {
  variants: {
    look: {
      strip:
        "border-b border-banner-strip-edge bg-banner-strip py-banner-strip-block pr-banner-strip-end pl-banner-strip-start",
      card: "box-border rounded-dialog border border-border-strong bg-well p-banner-card pl-banner-card-start",
      row: "",
      inset: "py-banner-strip-block pr-banner-strip-end pl-banner-strip-start",
    },
  },
});

type AlertLook = NonNullable<VariantProps<typeof alertVariants>["look"]>;
type AlertTone = StatusTone;

const alertRowVariants = cva("ui-banner-row flex", {
  variants: {
    look: {
      strip: "min-h-control items-center gap-icon-gap",
      card: "items-center gap-banner-card",
      row: "items-start gap-icon-gap",
      inset: "min-h-control items-center gap-icon-gap",
    },
  },
});

const alertGlyphVariants = cva(
  "ui-banner-glyph inline-flex flex-none items-center justify-center [&>svg]:size-control-icon",
  {
    variants: {
      look: {
        strip: "text-muted-foreground",
        card: "",
        row: "h-control text-muted-foreground",
        inset: "",
      },
      neutral: {
        true: "",
        false: "",
      },
      mark: {
        true: "",
        false: "",
      },
    },
    compoundVariants: [
      { look: "card", mark: false, class: "size-banner-disc rounded-full" },
      { look: "card", mark: false, neutral: true, class: "bg-secondary text-muted-foreground" },
      { look: "card", mark: false, neutral: false, class: "bg-tone-tint text-tone-ink" },
      { look: "card", mark: true, class: "h-banner-mark-row self-start" },
      { look: "card", mark: true, neutral: true, class: "text-muted-foreground" },
      { look: "card", mark: true, neutral: false, class: "text-tone-ink" },
      { look: "inset", neutral: true, class: "text-muted-foreground" },
      { look: "inset", neutral: false, class: "text-tone-ink" },
    ],
  },
);

const alertDescriptionVariants = cva("ui-banner-words min-w-0 grow", {
  variants: {
    look: {
      strip: "block overflow-hidden text-body text-body-foreground",
      card: "flex flex-col gap-banner-words-gap",
      row: "flex flex-col gap-banner-words-gap py-banner-row-inset",
      inset: "block text-body",
    },
    neutral: {
      true: "",
      false: "",
    },
  },
  compoundVariants: [
    { look: "inset", neutral: true, class: "text-body-foreground" },
    { look: "inset", neutral: false, class: "text-tone-ink" },
  ],
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
  mark = false,
  ...props
}: React.ComponentProps<"span"> & { look: AlertLook; tone: AlertTone; mark?: boolean }) {
  return (
    <span
      data-slot="alert-glyph"
      aria-hidden="true"
      className={alertGlyphVariants({ look, neutral: tone === STATUS_TONE.NEUTRAL, mark })}
      {...props}
    />
  );
}

function AlertDescription({
  look,
  tone,
  ...props
}: React.ComponentProps<"div"> & { look: AlertLook; tone: AlertTone }) {
  return (
    <div
      data-slot="alert-description"
      className={alertDescriptionVariants({ look, neutral: tone === STATUS_TONE.NEUTRAL })}
      {...props}
    />
  );
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("ui-banner-actions flex min-w-0 items-center gap-control-gap", className)}
      {...props}
    />
  );
}

export type { AlertLook, AlertTone };
export { Alert, AlertAction, AlertDescription, AlertGlyph, AlertRow };
