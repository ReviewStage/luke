import { FACE_ART } from "@luke/brand";
import {
  IconButtonLink,
  MARK_PROVIDER,
  ProviderMark,
  TEXT_ELEMENT,
  TEXT_FONT,
  TEXT_LINK_CURRENT,
  TEXT_LINK_HEIGHT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextLink,
  type TextLinkCurrent,
} from "@luke/ui";

export const REPOSITORY_URL = "https://github.com/ReviewStage/luke";
export const DMG_URL = `${REPOSITORY_URL}/releases/latest/download/Luke.dmg`;

/**
 * "Luke" beside the mark, in the web profile's wordmark display style
 * (`@luke/ui`'s `tokens/display.css`): the site's banner and the admin's rail.
 */
export const WORDMARK =
  "font-brand text-(length:--luke-display-wordmark-size) font-(--luke-display-wordmark-weight) tracking-(--luke-display-wordmark-tracking)";

/** A mark's box is decided at its call site, the one place it is drawn. */
type MarkProps = { readonly className?: string };

/**
 * Luke's face, drawn from the generated `FACE_ART` constants so the web mark
 * stays tied to the product artwork. Drawing in `currentColor` keeps the page
 * free of fetched assets. Decorative: the wordmark beside it already says
 * "Luke".
 *
 * Wider than tall, so a caller sizes both axes and lets the default
 * `xMidYMid meet` letterbox the face inside that box rather than stretch it.
 */
export function LukeMark({ className = "block h-4.5 w-5" }: MarkProps): React.JSX.Element {
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

/**
 * Where the reader is: on `page` itself, or, `beneath` it, on a page of that
 * part of the site (a release under the changelog).
 */
export type SitePlace = { readonly page: SitePage; readonly beneath?: boolean };

/** What the chrome is told of the page it is drawn on: where the reader is. */
type ChromeProps = { readonly current?: SitePlace };

/**
 * What a link to `page` says about it when the reader is at `place`: the
 * current page where they are on it, and the current part of the site where
 * they are beneath it, since the page they are on is not the one it links to.
 */
function currentOf(page: SitePage, place: SitePlace | undefined): TextLinkCurrent | undefined {
  if (place?.page !== page) return undefined;
  return place.beneath === true ? TEXT_LINK_CURRENT.SECTION : TEXT_LINK_CURRENT.PAGE;
}

/**
 * Shared between every page so navigation and branding never drift apart:
 * the wordmark and the links the banner holds, handed to PublicPage's
 * `banner`; `current` marks where the reader is. Every link stands the
 * web's 44px tall inside the 64px banner, so its hit target is the contract's
 * without moving a word.
 */
export function SiteNavigation({ current }: ChromeProps): React.JSX.Element {
  return (
    <nav aria-label="Site" className="flex items-center justify-between">
      <a
        className={`inline-flex min-h-11 items-center gap-2 no-underline ${WORDMARK}`}
        href={SITE_PAGE.HOME}
        aria-current={currentOf(SITE_PAGE.HOME, current)}
      >
        <LukeMark />
        Luke
      </a>
      <div className="flex items-center gap-4">
        <TextLink
          href={SITE_PAGE.ABOUT}
          variant={TEXT_VARIANT.LABEL}
          height={TEXT_LINK_HEIGHT.CONTROL}
          current={currentOf(SITE_PAGE.ABOUT, current)}
        >
          About
        </TextLink>
        <TextLink
          href={SITE_PAGE.CHANGELOG}
          variant={TEXT_VARIANT.LABEL}
          height={TEXT_LINK_HEIGHT.CONTROL}
          current={currentOf(SITE_PAGE.CHANGELOG, current)}
        >
          Changelog
        </TextLink>
        {/* The negative margins keep the mark where it stood beside its
              44px square: 22px from the last link, and optically aligned with
              the column's edge rather than inset from it. */}
        <span className="-mr-3.5 -ml-2 flex">
          <IconButtonLink
            href={REPOSITORY_URL}
            icon={<ProviderMark provider={MARK_PROVIDER.GITHUB} />}
            label="Luke on GitHub"
          />
        </span>
      </div>
    </nav>
  );
}

/**
 * Shared between every page so the legal and license links never drift
 * apart: what PublicPage's `footer` holds under its rule.
 */
export function SiteFooterLinks({ current }: ChromeProps): React.JSX.Element {
  return (
    <Text
      as={TEXT_ELEMENT.DIV}
      variant={TEXT_VARIANT.CAPTION}
      tone={TEXT_TONE.MUTED}
      font={TEXT_FONT.MONO}
    >
      {/* The separator belongs to the gap between items rather than to any
            item, so adding or reordering a link never leaves a stray dot. */}
      <div className="flex flex-wrap gap-2 [&>*+*]:before:mr-2 [&>*+*]:before:content-['·']">
        <span>Apache-2.0</span>
        <span>macOS 14+</span>
        <TextLink href={SITE_PAGE.ABOUT} current={currentOf(SITE_PAGE.ABOUT, current)}>
          About
        </TextLink>
        <TextLink href={SITE_PAGE.CHANGELOG} current={currentOf(SITE_PAGE.CHANGELOG, current)}>
          Changelog
        </TextLink>
        {/* The changelog's feed, as quiet as the rest of the footer: a reader
              subscribes once, so it needs a way in, not a call to action. */}
        <TextLink href="/changelog/rss.xml">RSS</TextLink>
        <TextLink href={SITE_PAGE.PRIVACY} current={currentOf(SITE_PAGE.PRIVACY, current)}>
          Privacy
        </TextLink>
        <TextLink href="mailto:founders@stagereview.app">Contact</TextLink>
      </div>
      {/* The notice sits under its own rule at the foot of the column, the
            way stagereview.app closes its footer, so the link row above stays
            a row of links. */}
      <p className="mt-8 border-t border-(--luke-color-border) pt-6">© 2026 Stage Inc.</p>
    </Text>
  );
}
