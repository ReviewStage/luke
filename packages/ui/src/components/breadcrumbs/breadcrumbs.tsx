import {
  type ComponentProps,
  type ComponentType,
  isValidElement,
  type ReactNode,
  useState,
} from "react";
import { pulseOnPress } from "../../press-pulse.js";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../../shadcn/breadcrumb.js";
import { useDisclosure } from "../../use-disclosure.js";
import { BUTTON_VARIANT } from "../button/button.js";
import { FoldingButton, type FoldingButtonHint } from "../folding-button/folding-button.js";
import { dropBelowStart, Menu, type MenuAction, useMenu } from "../menu/menu.js";
import {
  ClippedLine,
  ONE_LINE_ELEMENT,
  ONE_LINE_END,
  type OneLineEnd,
} from "../one-line/clipped-line.js";
import { Tooltip } from "../tooltip/hint.js";
import { useCrumbFold } from "./crumb-fold.js";

/**
 * breadcrumbs.tsx -- a path to where the reader stands: a named landmark holding an ordered list of crumbs, each words, a press, or a press that opens a menu or a dialog, the chevrons between them punctuation alone.
 *
 * A crumb is data: its words, and what a press on it does. One crumb may be
 * the page the reader stands on, and is said to be (`aria-current`); a
 * crumb with no press is words, and one with a glyph is the toolbar's way
 * back, a `FoldingButton` whose words fold away where its toolbar says so.
 * A crumb that opens something says what it opens and whether it stands
 * open, and its press is handed the crumb, which the caller hangs what it
 * opens from and hands the keyboard back to. A crumb may wear a glyph
 * before its words, as a tab names its kind, and hang a card in its hint's
 * place, its hint raising it as it raises a pill. A crumb may come
 * and go (`shown`), as a page's title joins its bar once its heading has
 * scrolled away: it fades in with a short rise as it comes, and fades out
 * before it goes (`use-disclosure.ts`).
 *
 * Two looks: a bar's path in the caption type, every crumb a quiet pill
 * that narrows by its share, fading out at its end, the current one last of
 * all; and a toolbar's heading, a way back then the page's name in the
 * dialog heading type.
 *
 * A path gives way on a narrow bar first by folding: one that does not
 * fit whole folds the crumbs at its start into one "…" (`crumb-fold.ts`),
 * the last always standing, before any crumb is cut; only once nothing is
 * left to fold does each crumb narrow, in the stylesheet, by its share down
 * to a floor its words stay legible at. The rest is the stylesheet's
 * alone, nothing measured: each crumb says at which of the bar's widths it is drawn
 * (`shownAt`), read off the `BreadcrumbBar` holding the path, the row of
 * the bar it stands in. A crumb may stand for others a narrow bar leaves
 * out, as a "…" naming them in its hint does.
 *
 * The path is shadcn/ui's breadcrumb (`../../shadcn/breadcrumb.tsx`), drawn
 * in Tailwind utilities over the theme; what hangs on the bar's widths, on
 * `:has()`, or on a keyframe stays in `breadcrumbs.css`.
 */

/** The two looks a path is drawn in. */
export const BREADCRUMBS_VARIANT = {
  /** A bar's path in the caption type, every crumb a quiet pill. */
  CAPTION: "caption",
  /** A toolbar's heading: the way back, then the page's name in the dialog heading type. */
  TITLE: "title",
} as const;

export type BreadcrumbsVariant = (typeof BREADCRUMBS_VARIANT)[keyof typeof BREADCRUMBS_VARIANT];

/**
 * At which of its bar's widths a crumb is drawn: wide is 520px and up,
 * narrow 300px to 519px, narrowest under 300px, the width of the
 * `BreadcrumbBar` holding the path. A path in none is drawn as a wide bar
 * draws it.
 */
export const BREADCRUMB_SHOWN = {
  ALWAYS: "always",
  WIDE: "wide",
  WIDE_OR_NARROW: "wide-or-narrow",
  /** Narrow alone: a crumb standing for those a narrow bar leaves out. */
  NARROW: "narrow",
  /** Narrowest alone: a crumb standing for those the narrowest bar leaves out. */
  NARROWEST: "narrowest",
} as const;

export type BreadcrumbShown = (typeof BREADCRUMB_SHOWN)[keyof typeof BREADCRUMB_SHOWN];

/** What a crumb's press opens. */
export const BREADCRUMB_POPUP = {
  DIALOG: "dialog",
  MENU: "menu",
} as const;

export type BreadcrumbPopup = (typeof BREADCRUMB_POPUP)[keyof typeof BREADCRUMB_POPUP];

/**
 * The hint a path hangs from its crumbs, the window's tooltip unless the caller hangs its own: the words a crumb raises, or
 * the card it hangs in their place, and a folded way back's words.
 */
export type BreadcrumbHint = ComponentType<
  ComponentProps<FoldingButtonHint> & { card?: ReactNode | undefined }
>;

/** What every crumb holds: its words, its press, and the widths it is drawn at. */
interface CrumbBase {
  /** Its words. */
  readonly label: string;
  /** What a press does, handed the crumb pressed. */
  readonly onPress?: ((crumb: HTMLElement) => void) | undefined;
  /** At which of its bar's widths it is drawn; always where none is said. */
  readonly shownAt?: BreadcrumbShown | undefined;
}

/** A crumb of words, or a quiet pill a press reaches. */
interface PathCrumb extends CrumbBase {
  readonly icon?: undefined;
  /** A glyph before its words, as a tab names its kind; decoration, since the words say what it is. */
  readonly glyph?: ReactNode;
  /** The card its hint hangs in the words' place. */
  readonly card?: ReactNode;
  /** Its name for a reader, where its words alone do not say it ("…"). */
  readonly name?: string | undefined;
  /** The words its hint raises, where the app hands the path one. */
  readonly hint?: string | undefined;
  /** Whether it is the page the reader stands on. */
  readonly current?: boolean | undefined;
  /** What a press opens, said to a reader. */
  readonly popup?: BreadcrumbPopup | undefined;
  /** Whether what it opens stands open. */
  readonly expanded?: boolean | undefined;
  /** Whether it stands in the path now, for a crumb that comes and goes; always where none is said. */
  readonly shown?: boolean | undefined;
  /** How its words end where they are cut short: fading out where none is said, or in an ellipsis. */
  readonly end?: OneLineEnd | undefined;
  /** Whether it keeps its size in a narrow bar, so the crumbs after it are cut short first; it gives way with the rest where none is said. */
  readonly fixed?: boolean | undefined;
}

/**
 * The toolbar's way back: a glyph before its words, which fold away where
 * its toolbar folds them. Note that it is never the current page and opens
 * nothing, because a way back leads elsewhere, and so it says neither.
 */
interface WayBackCrumb extends CrumbBase {
  readonly icon: ReactNode;
  readonly onPress: (crumb: HTMLElement) => void;
  readonly glyph?: undefined;
  readonly card?: undefined;
  readonly name?: undefined;
  readonly hint?: undefined;
  readonly current?: undefined;
  readonly popup?: undefined;
  readonly expanded?: undefined;
  readonly shown?: undefined;
  readonly end?: undefined;
  readonly fixed?: undefined;
}

/** One crumb of a path. */
export type Crumb = PathCrumb | WayBackCrumb;

/** The widths at which each `shownAt` draws its crumb. */
const SHOWN_WIDTHS = {
  [BREADCRUMB_SHOWN.ALWAYS]: { wide: true, narrow: true, narrowest: true },
  [BREADCRUMB_SHOWN.WIDE]: { wide: true, narrow: false, narrowest: false },
  [BREADCRUMB_SHOWN.WIDE_OR_NARROW]: { wide: true, narrow: true, narrowest: false },
  [BREADCRUMB_SHOWN.NARROW]: { wide: false, narrow: true, narrowest: false },
  [BREADCRUMB_SHOWN.NARROWEST]: { wide: false, narrow: false, narrowest: true },
} as const;

/** At which of the bar's widths something is drawn. */
interface Widths {
  readonly wide: boolean;
  readonly narrow: boolean;
  readonly narrowest: boolean;
}

/**
 * Each look's utilities by part. Note that a crumb's display, its share of a
 * narrow bar, and its floor stay in `breadcrumbs.css`, because they hang on
 * the bar's container widths and on `:has()`, and a utility would outrank
 * the rules that hide a crumb.
 */
const LOOK = {
  [BREADCRUMBS_VARIANT.CAPTION]: {
    nav: "text-caption",
    list: "",
    item: "",
    wordsItem: "",
    separator: "flex-none items-center text-muted-foreground [&>svg]:size-breadcrumb-chevron",
    words: "",
  },
  [BREADCRUMBS_VARIANT.TITLE]: {
    nav: "text-muted-foreground",
    list: "gap-breadcrumb-gap",
    item: "flex-none gap-breadcrumb-gap",
    wordsItem: "min-w-0 flex-initial gap-breadcrumb-gap",
    separator: "flex-none items-center [&>svg]:size-breadcrumb-title-chevron",
    words: "text-dialog font-dialog",
  },
} as const;

/**
 * The path's punctuation between two crumbs, drawn at the widths `at` says,
 * the chevron a menu row's submenu points with.
 */
function Chevron({ at, variant }: { at: Widths; variant: BreadcrumbsVariant }): React.JSX.Element {
  return (
    <BreadcrumbSeparator
      className={`luke-breadcrumb-separator ${LOOK[variant].separator}`}
      data-wide={at.wide}
      data-narrow={at.narrow}
      data-narrowest={at.narrowest}
    />
  );
}

/**
 * At which widths a chevron stands before the crumb at `at`: each width
 * where a crumb before it is drawn too, so a crumb leading the path at a
 * width, the others before it gone there, stands without one, as one
 * whose crumbs before it are not `shown` does. Note that a width the crumb
 * is not drawn at says yes, since nothing is drawn there.
 */
function chevronBefore(crumbs: readonly Crumb[], at: number): Widths | undefined {
  const own = SHOWN_WIDTHS[crumbs[at]?.shownAt ?? BREADCRUMB_SHOWN.ALWAYS];
  const before = crumbs
    .slice(0, at)
    .filter((each) => each.shown !== false)
    .map((each) => SHOWN_WIDTHS[each.shownAt ?? BREADCRUMB_SHOWN.ALWAYS]);
  const led = {
    wide: before.some((widths) => widths.wide),
    narrow: before.some((widths) => widths.narrow),
    narrowest: before.some((widths) => widths.narrowest),
  };
  if (!(own.wide && led.wide) && !(own.narrow && led.narrow) && !(own.narrowest && led.narrowest)) {
    return undefined;
  }
  return {
    wide: !own.wide || led.wide,
    narrow: !own.narrow || led.narrow,
    narrowest: !own.narrowest || led.narrowest,
  };
}

/** The chevron before a crumb, where one stands at any width. */
function CrumbChevron({
  at,
  variant,
}: {
  at: Widths | undefined;
  variant: BreadcrumbsVariant;
}): React.JSX.Element | null {
  return at === undefined ? null : <Chevron at={at} variant={variant} />;
}

/** A crumb's face: its glyph, where it wears one, then its words. */
function CrumbFace({
  glyph,
  label,
  end = ONE_LINE_END.FADE,
}: {
  glyph: ReactNode;
  label: string;
  end?: OneLineEnd | undefined;
}): React.JSX.Element {
  return (
    <>
      {glyph === undefined ? null : (
        <span className="flex flex-none [&_svg]:size-control-icon" aria-hidden="true">
          {glyph}
        </span>
      )}
      <ClippedLine
        className="luke-breadcrumb-label min-w-0 overflow-hidden whitespace-nowrap"
        as={ONE_LINE_ELEMENT.SPAN}
        end={end}
        words={label}
      >
        {label}
      </ClippedLine>
    </>
  );
}

/** One crumb's control: words, a quiet pill, or the toolbar's folding way back. */
function CrumbControl({
  crumb,
  variant,
  hint: Hint,
}: {
  crumb: Crumb;
  variant: BreadcrumbsVariant;
  hint: BreadcrumbHint;
}): React.JSX.Element {
  const { label, icon, onPress } = crumb;
  const current = crumb.current === true ? "page" : undefined;
  if (icon !== undefined) {
    return (
      <FoldingButton
        label={label}
        icon={icon}
        variant={BUTTON_VARIANT.QUIET}
        hint={Hint}
        onClick={onPress === undefined ? undefined : (event) => onPress(event.currentTarget)}
      />
    );
  }
  const control =
    onPress === undefined ? (
      <BreadcrumbPage
        className={`flex min-w-0 items-center gap-breadcrumb-gap ${LOOK[variant].words}`}
        aria-current={current}
      >
        <CrumbFace glyph={crumb.glyph} label={label} end={crumb.end} />
      </BreadcrumbPage>
    ) : (
      <BreadcrumbLink
        render={<button type="button" />}
        aria-label={crumb.name}
        aria-current={current}
        aria-haspopup={crumb.popup}
        aria-expanded={crumb.popup === undefined ? undefined : crumb.expanded === true}
        onClick={pulseOnPress((event) => onPress(event.currentTarget))}
      >
        <CrumbFace glyph={crumb.glyph} label={label} end={crumb.end} />
      </BreadcrumbLink>
    );
  return crumb.hint === undefined && crumb.card === undefined ? (
    control
  ) : (
    <Hint label={crumb.hint} card={crumb.card}>
      {control}
    </Hint>
  );
}

/** The motions a crumb that comes and goes rides, read by the stylesheet from its `data-motion`. */
const CRUMB_MOTION = {
  ARRIVING: "arriving",
  LEAVING: "leaving",
} as const;

/**
 * One crumb's place in the path, its chevron before it. A crumb that comes
 * and goes is drawn while `shown` and through its exit after, and rides in
 * only when it comes on a change, so a path drawn with it already there
 * stands still. Note that one leaving is inert, since it already reads as
 * gone.
 */
function CrumbItem({
  crumb,
  chevron,
  legible,
  whole,
  variant,
  hint,
}: {
  crumb: Crumb;
  chevron: Widths | undefined;
  /** Whether it keeps its words legible, down to a floor of its own, in a narrow bar. */
  legible: boolean;
  /** Whether it keeps its whole width, because the path folds a crumb before it cuts this one. */
  whole: boolean;
  variant: BreadcrumbsVariant;
  hint: BreadcrumbHint;
}): React.JSX.Element | null {
  const shown = crumb.shown ?? true;
  const presence = useDisclosure(shown);
  const [was, setWas] = useState(shown);
  const [arriving, setArriving] = useState(false);
  if (shown !== was) {
    setWas(shown);
    setArriving(shown);
  }
  if (!presence.mounted) return null;
  const motion = presence.leaving
    ? CRUMB_MOTION.LEAVING
    : arriving
      ? CRUMB_MOTION.ARRIVING
      : undefined;
  const words = crumb.icon === undefined && crumb.onPress === undefined;
  return (
    <BreadcrumbItem
      ref={presence.ref}
      className={words ? LOOK[variant].wordsItem : LOOK[variant].item}
      data-shown={crumb.shownAt ?? BREADCRUMB_SHOWN.ALWAYS}
      data-words={words}
      data-fixed={crumb.fixed === true ? "true" : undefined}
      data-legible={legible ? "true" : undefined}
      data-whole={whole ? "true" : undefined}
      data-motion={motion}
      inert={presence.leaving}
    >
      <CrumbChevron at={chevron} variant={variant} />
      <CrumbControl crumb={crumb} variant={variant} hint={hint} />
    </BreadcrumbItem>
  );
}

/**
 * A path named `label`, its crumbs in order. Note that a crumb is keyed by
 * its place, because the same words may stand twice in one path.
 */
export function Breadcrumbs({
  label,
  crumbs,
  variant = BREADCRUMBS_VARIANT.CAPTION,
  hint = Tooltip,
}: {
  /** The landmark's name ("Path"). */
  label: string;
  crumbs: readonly Crumb[];
  variant?: BreadcrumbsVariant;
  /** The hint raising a crumb's `hint` or hanging its `card`, and a folded way back's words: the window's tooltip, unless the caller hangs one of its own. */
  hint?: BreadcrumbHint | undefined;
}): React.JSX.Element {
  const [measured, drawn, hidden] = useCrumbFold(crumbs);
  const menu = useMenu(hidden.length > 0);
  // Note that the "…" opens a menu of the crumbs it stands for, each pressing as its own crumb did, since folding a crumb must not take away where it leads.
  const shown = drawn.map((each) =>
    each.folded
      ? {
          ...each,
          crumb: {
            label: each.crumb.label,
            name: each.crumb.name,
            hint: each.crumb.hint,
            popup: BREADCRUMB_POPUP.MENU,
            expanded: menu.open !== undefined,
            onPress: (opener: HTMLElement) =>
              menu.open === undefined
                ? menu.show(dropBelowStart(opener), opener)
                : menu.close(true),
          } satisfies Crumb,
        }
      : each,
  );
  const path = shown.map((each) => each.crumb);
  const opener = menu.open?.opener;
  const hiddenRows: MenuAction[] = hidden.map((crumb) => ({
    label: crumb.label,
    ...(isValidElement(crumb.glyph) ? { icon: crumb.glyph as React.JSX.Element } : {}),
    disabled: crumb.onPress === undefined,
    onSelect: () => {
      if (opener !== undefined) crumb.onPress?.(opener);
    },
  }));
  return (
    <Breadcrumb
      ref={variant === BREADCRUMBS_VARIANT.CAPTION ? measured : undefined}
      className={`luke-breadcrumbs relative min-w-0 flex-initial overflow-clip ${LOOK[variant].nav}`}
      data-variant={variant}
      aria-label={label}
    >
      <BreadcrumbList className={LOOK[variant].list}>
        {shown.map((each, at) => (
          <CrumbItem
            key={each.key}
            crumb={each.crumb}
            chevron={chevronBefore(path, at)}
            legible={each.legible}
            whole={each.whole}
            variant={variant}
            hint={hint}
          />
        ))}
      </BreadcrumbList>
      {menu.drawn === undefined ? null : (
        <Menu
          label="Earlier in the path"
          menu={menu.drawn}
          groups={[hiddenRows]}
          onClose={menu.close}
        />
      )}
    </Breadcrumb>
  );
}

/**
 * A bar's row holding a path among the bar's other controls, whose width is
 * what the path's crumbs fold by (`shownAt`). It fills the bar it stands in
 * and lays its children in a row, centred, spaced as the bar spaces its
 * own, so the bar keeps its padding, its height, and its gap.
 */
export function BreadcrumbBar({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <div className="@container/luke-breadcrumb-bar flex min-w-0 flex-auto items-center gap-[inherit]">
      {children}
    </div>
  );
}
