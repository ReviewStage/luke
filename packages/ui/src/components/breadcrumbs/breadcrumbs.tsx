import type { ReactNode } from "react";
import { BUTTON_VARIANT } from "../button/button.js";
import { FoldingButton, type FoldingButtonHint } from "../folding-button/folding-button.js";

/**
 * breadcrumbs.tsx -- a path to where the reader stands: a named landmark holding an ordered list of crumbs, each words, a press, or a press that opens a menu or a dialog, the chevrons between them punctuation alone.
 *
 * A crumb is data: its words, and what a press on it does. One crumb may be
 * the page the reader stands on, and is said to be (`aria-current`); a
 * crumb with no press is words, and one with a glyph is the toolbar's way
 * back, a `FoldingButton` whose words fold away where its toolbar says so.
 * A crumb that opens something says what it opens and whether it stands
 * open, and its press is handed the crumb, which the caller hangs what it
 * opens from and hands the keyboard back to.
 *
 * Two looks: a bar's path in the caption type, every crumb a quiet pill
 * that narrows by its share, cut short at its end, the current one last of
 * all; and a toolbar's heading, a way back then the page's name in the
 * dialog heading type.
 *
 * A path may give way on a narrow bar in the stylesheet alone, so nothing
 * here measures: each crumb says at which of the bar's widths it is drawn
 * (`shownAt`), read off the `BreadcrumbBar` holding the path, the row of
 * the bar it stands in. A crumb may stand for others a narrow bar leaves
 * out, as a "…" naming them in its hint does.
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
  MENU: "menu",
  DIALOG: "dialog",
} as const;

export type BreadcrumbPopup = (typeof BREADCRUMB_POPUP)[keyof typeof BREADCRUMB_POPUP];

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
}

/**
 * The toolbar's way back: a glyph before its words, which fold away where
 * its toolbar folds them. Note that it is never the current page and opens
 * nothing, because a way back leads elsewhere, and so it says neither.
 */
interface WayBackCrumb extends CrumbBase {
  readonly icon: ReactNode;
  readonly onPress: (crumb: HTMLElement) => void;
  readonly name?: undefined;
  readonly hint?: undefined;
  readonly current?: undefined;
  readonly popup?: undefined;
  readonly expanded?: undefined;
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
 * The path's punctuation between two crumbs, drawn at the widths `at` says,
 * the chevron a menu row's submenu points with.
 */
function Chevron({ at }: { at: Widths }): React.JSX.Element {
  return (
    <span
      className="luke-breadcrumb-separator"
      aria-hidden="true"
      data-wide={at.wide}
      data-narrow={at.narrow}
      data-narrowest={at.narrowest}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <path d="m9 18 6-6-6-6" />
      </svg>
    </span>
  );
}

/**
 * At which widths a chevron stands before the crumb at `at`: each width
 * where a crumb before it is drawn too, so a crumb leading the path at a
 * width, the others before it gone there, stands without one. Note that a
 * width the crumb is not drawn at says yes, since nothing is drawn there.
 */
function chevronBefore(crumbs: readonly Crumb[], at: number): Widths | undefined {
  const own = SHOWN_WIDTHS[crumbs[at]?.shownAt ?? BREADCRUMB_SHOWN.ALWAYS];
  const before = crumbs
    .slice(0, at)
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
function CrumbChevron({ at }: { at: Widths | undefined }): React.JSX.Element | null {
  return at === undefined ? null : <Chevron at={at} />;
}

/** One crumb's control: words, a quiet pill, or the toolbar's folding way back. */
function CrumbControl({
  crumb,
  hint: Hint,
}: {
  crumb: Crumb;
  hint: FoldingButtonHint | undefined;
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
  if (onPress === undefined) {
    return (
      <span className="luke-breadcrumb-words" aria-current={current}>
        {label}
      </span>
    );
  }
  const button = (
    <button
      type="button"
      className="luke-breadcrumb-button"
      aria-label={crumb.name}
      aria-current={current}
      aria-haspopup={crumb.popup}
      aria-expanded={crumb.popup === undefined ? undefined : crumb.expanded === true}
      onClick={(event) => onPress(event.currentTarget)}
    >
      {label}
    </button>
  );
  return Hint === undefined || crumb.hint === undefined ? (
    button
  ) : (
    <Hint label={crumb.hint}>{button}</Hint>
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
  hint,
}: {
  /** The landmark's name ("Path"). */
  label: string;
  crumbs: readonly Crumb[];
  variant?: BreadcrumbsVariant;
  /** The app's hint, raising a crumb's `hint`, and a folded way back's words. */
  hint?: FoldingButtonHint | undefined;
}): React.JSX.Element {
  return (
    <nav className="luke-breadcrumbs" data-variant={variant} aria-label={label}>
      <ol>
        {crumbs.map((crumb, at) => (
          <li
            // oxlint-disable-next-line react/no-array-index-key -- a path's crumbs are its places, and the same words may stand twice.
            key={at}
            data-shown={crumb.shownAt ?? BREADCRUMB_SHOWN.ALWAYS}
            data-words={crumb.icon === undefined && crumb.onPress === undefined}
          >
            <CrumbChevron at={chevronBefore(crumbs, at)} />
            <CrumbControl crumb={crumb} hint={hint} />
          </li>
        ))}
      </ol>
    </nav>
  );
}

/**
 * A bar's row holding a path among the bar's other controls, whose width is
 * what the path's crumbs fold by (`shownAt`). It fills the bar it stands in
 * and lays its children in a row, centred, spaced as the bar spaces its
 * own, so the bar keeps its padding, its height, and its gap.
 */
export function BreadcrumbBar({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="luke-breadcrumb-bar">{children}</div>;
}
