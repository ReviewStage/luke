import { FACE_ART } from "@luke/brand";
import { PublicBanner, PublicFooter } from "@luke/ui";

export const REPOSITORY_URL = "https://github.com/ReviewStage/luke";
export const DMG_URL = `${REPOSITORY_URL}/releases/latest/download/Luke.dmg`;

/**
 * GitHub's mark, drawn in `currentColor` so the stylesheet holds the color in
 * one place. Inlined for the same reason as the favicon: the page ships no
 * binary assets and fetches nothing at runtime.
 */
const GITHUB_MARK_PATH =
  "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.65 7.65 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z";

/**
 * Both marks size at their call site rather than through a stylesheet rule, so
 * the one place a mark's box is decided is the place it is drawn.
 */
type MarkProps = { readonly className?: string };

/**
 * Always decorative: every use either sits beside a visible label or hangs off
 * a link that carries its own `aria-label`, so announcing the mark as well
 * would only repeat what a reader already hears.
 */
export function GitHubMark({ className = "block size-4" }: MarkProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d={GITHUB_MARK_PATH} />
    </svg>
  );
}

/**
 * Luke's face, drawn from the generated `FACE_ART` constants so the web mark
 * stays tied to the product artwork. Drawing in `currentColor` keeps the page
 * free of fetched assets. Decorative: the wordmark beside it already says
 * "Luke".
 *
 * Wider than tall, so a caller sizes both axes and lets the default
 * `xMidYMid meet` letterbox the face inside that box rather than stretch it.
 */
export function LukeMark({ className = "block h-[18px] w-5" }: MarkProps): React.JSX.Element {
  const { MARK_VIEW_BOX, TILT, SMILE, STROKE_WIDTH, EYE_X, EYE_Y, EYE_RADIUS } = FACE_ART;
  return (
    <svg className={className} viewBox={MARK_VIEW_BOX} fill="none" aria-hidden="true">
      <g transform={TILT}>
        <path
          d={SMILE}
          fill="none"
          stroke="currentColor"
          strokeWidth={STROKE_WIDTH}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx={EYE_X.LEFT} cy={EYE_Y} r={EYE_RADIUS} fill="currentColor" />
        <circle cx={EYE_X.RIGHT} cy={EYE_Y} r={EYE_RADIUS} fill="currentColor" />
      </g>
    </svg>
  );
}

/** The pages the site's chrome links to, by the path each is served at. */
export const SITE_PAGE = {
  HOME: "/",
  ABOUT: "/about",
  CHANGELOG: "/changelog",
  PRIVACY: "/privacy",
} as const;

export type SitePage = (typeof SITE_PAGE)[keyof typeof SITE_PAGE];

/** What the chrome is told of the page it is drawn on: the one the reader is on. */
type ChromeProps = { readonly current?: SitePage };

/** The chrome's quiet link: muted until hovered, and in the text's own ink on the page it names. */
const QUIET_LINK =
  "no-underline transition-colors duration-150 hover:text-foreground aria-[current=page]:text-foreground motion-reduce:transition-none";

/** What a link to `page` says about it when the reader is on `current`. */
function currentProps(page: SitePage, current: SitePage | undefined) {
  return { href: page, "aria-current": page === current ? ("page" as const) : undefined };
}

/**
 * Shared between every page so navigation and branding never drift apart:
 * the wordmark and the links the banner holds, handed to PublicPage's
 * `banner`; `current` marks the page the reader is on. Every link stands the
 * web's 44px tall inside the 64px banner, so its hit target is the contract's
 * without moving a word.
 */
export function SiteNavigation({ current }: ChromeProps): React.JSX.Element {
  return (
    <nav aria-label="Site" className="flex items-center justify-between">
      <a
        className="inline-flex min-h-11 items-center gap-2 font-brand text-base font-bold tracking-[-0.01em] no-underline"
        {...currentProps(SITE_PAGE.HOME, current)}
      >
        <LukeMark />
        Luke
      </a>
      <div className="flex items-center gap-4">
        <a
          className={`inline-flex min-h-11 items-center text-sm font-medium text-muted-foreground ${QUIET_LINK}`}
          {...currentProps(SITE_PAGE.ABOUT, current)}
        >
          About
        </a>
        <a
          className={`inline-flex min-h-11 items-center text-sm font-medium text-muted-foreground ${QUIET_LINK}`}
          {...currentProps(SITE_PAGE.CHANGELOG, current)}
        >
          Changelog
        </a>
        {/* Icon-only, so the padding buys the web's 44px hit target and a
              focus ring with room around the mark. The matching negative
              margins keep the mark where it stood: 22px from the last link,
              and optically aligned with the column's edge rather than inset
              from it. */}
        <a
          className={`-mr-[13px] -ml-[7px] inline-flex items-center rounded-md p-[13px] text-muted-foreground ${QUIET_LINK}`}
          href={REPOSITORY_URL}
          aria-label="Luke on GitHub"
        >
          <GitHubMark className="block size-[18px]" />
        </a>
      </div>
    </nav>
  );
}

/**
 * The banner for a page that still draws its own main. The banner is the
 * design system's, so its wash, rule, and gutters are the public page's.
 */
export function SiteHeader(props: ChromeProps): React.JSX.Element {
  return (
    <PublicBanner>
      <SiteNavigation {...props} />
    </PublicBanner>
  );
}

/**
 * Shared between every page so the legal and license links never drift
 * apart: what PublicPage's `footer` holds under its rule.
 */
export function SiteFooterLinks({ current }: ChromeProps): React.JSX.Element {
  return (
    <div className="font-mono text-xs text-muted-foreground">
      {/* The separator belongs to the gap between items rather than to any
            item, so adding or reordering a link never leaves a stray dot. */}
      <div className="flex flex-wrap gap-2 [&>*+*]:before:mr-2 [&>*+*]:before:content-['·']">
        <span>Apache-2.0</span>
        <span>macOS 14+</span>
        <a className={QUIET_LINK} {...currentProps(SITE_PAGE.ABOUT, current)}>
          About
        </a>
        <a className={QUIET_LINK} {...currentProps(SITE_PAGE.CHANGELOG, current)}>
          Changelog
        </a>
        {/* The changelog's feed, as quiet as the rest of the footer: a reader
              subscribes once, so it needs a way in, not a call to action. */}
        <a className={QUIET_LINK} href="/changelog/rss.xml">
          RSS
        </a>
        <a className={QUIET_LINK} {...currentProps(SITE_PAGE.PRIVACY, current)}>
          Privacy
        </a>
        <a className={QUIET_LINK} href="mailto:founders@stagereview.app">
          Contact
        </a>
      </div>
      {/* The notice sits under its own rule at the foot of the column, the
            way stagereview.app closes its footer, so the link row above stays
            a row of links. */}
      <p className="mt-8 border-t border-border pt-6">© 2026 Stage Inc.</p>
    </div>
  );
}

/** The footer for a page that still draws its own main. */
export function SiteFooter(props: ChromeProps): React.JSX.Element {
  return (
    <PublicFooter>
      <SiteFooterLinks {...props} />
    </PublicFooter>
  );
}
