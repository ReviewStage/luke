import { PRODUCT_NAME } from "@repo/features/product-name";
import {
  BUTTON_SHAPE,
  BUTTON_VARIANT,
  ButtonLink,
  IconButtonLink,
  MARK_PROVIDER,
  ProductMark,
  ProviderMark,
  SiteBarPages,
  SiteFootLinks,
  TEXT_LINK_CURRENT,
  TEXT_LINK_HEIGHT,
  TEXT_VARIANT,
  TextLink,
  type TextLinkCurrent,
} from "@repo/ui";
import { captureSiteEvent, SITE_EVENT } from "./analytics";
import { PANEL_PATH } from "./app/web-address";

export const REPOSITORY_URL = "https://github.com/ReviewStage/vespin";
/** The newest release's version-free DMG, named for the product as the Release workflow names it. */
export const DMG_URL = `${REPOSITORY_URL}/releases/latest/download/${PRODUCT_NAME}.dmg`;

/**
 * The user docs, which Mintlify builds from `apps/docs`; the root
 * `vercel.json` passes `/docs` and Mintlify's asset paths on to it, so they
 * stand beside the changelog on this origin.
 */
export const DOCS_URL = "/docs";

/** Where the web app opens, the one address the site and the invitation page send a reader to. */
export const WEB_APP_URL = PANEL_PATH;

/**
 * The product's name beside the mark, in the web profile's wordmark display style
 * (`@repo/ui`'s `tokens/display.css`): the site's banner and the admin's rail.
 */
export const WORDMARK =
  "font-brand text-(length:--ui-display-wordmark-size) font-(--ui-display-wordmark-weight) tracking-(--ui-display-wordmark-tracking)";

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
 * the wordmark, then at the bar's end the site's pages, a hairline, and the
 * actions that leave the page (the repository, signing in), handed to
 * PublicPage's `banner` or the landing's `bar`; `current` marks where the
 * reader is. The call (`SiteBarDownload`) ends the bar after them, as every
 * devtool's bar ends on its call with signing in just before it. Every link
 * stands the web's 44px tall inside the 64px banner, so its hit target is the
 * contract's without moving a word.
 */
export function SiteNavigation({ current }: ChromeProps): React.JSX.Element {
  return (
    <nav aria-label="Site" className="flex items-center justify-between">
      <TextLink
        href={SITE_PAGE.HOME}
        height={TEXT_LINK_HEIGHT.CONTROL}
        current={currentOf(SITE_PAGE.HOME, current)}
      >
        <span className={`inline-flex items-center gap-2 text-(--ui-color-text) ${WORDMARK}`}>
          <span className="inline-flex h-4.5 w-5 shrink-0">
            <ProductMark fill inherit />
          </span>
          {PRODUCT_NAME}
        </span>
      </TextLink>
      <div className="flex items-center gap-5">
        <SiteBarPages>
          <TextLink
            href={SITE_PAGE.ABOUT}
            variant={TEXT_VARIANT.LABEL}
            height={TEXT_LINK_HEIGHT.CONTROL}
            current={currentOf(SITE_PAGE.ABOUT, current)}
          >
            About
          </TextLink>
          <TextLink href={DOCS_URL} variant={TEXT_VARIANT.LABEL} height={TEXT_LINK_HEIGHT.CONTROL}>
            Docs
          </TextLink>
          <TextLink
            href={SITE_PAGE.CHANGELOG}
            variant={TEXT_VARIANT.LABEL}
            height={TEXT_LINK_HEIGHT.CONTROL}
            current={currentOf(SITE_PAGE.CHANGELOG, current)}
          >
            Changelog
          </TextLink>
        </SiteBarPages>
        {/* The negative margins take back the room round the mark inside
              its 44px square, the same on either side, so the mark stands as
              far from its neighbors as one word stands from the next. */}
        <span className="-mx-3 flex">
          <IconButtonLink
            href={REPOSITORY_URL}
            icon={<ProviderMark provider={MARK_PROVIDER.GITHUB} />}
            label={`${PRODUCT_NAME} on GitHub`}
          />
        </span>
        <TextLink href={WEB_APP_URL} variant={TEXT_VARIANT.LABEL} height={TEXT_LINK_HEIGHT.CONTROL}>
          Sign in
        </TextLink>
      </div>
    </nav>
  );
}

/**
 * The download, the landing's one call in its hero and its close, counted
 * wherever it is pressed.
 */
export function SiteDownload(): React.JSX.Element {
  return (
    <ButtonLink
      variant={BUTTON_VARIANT.INK}
      href={DMG_URL}
      onClick={() => captureSiteEvent(SITE_EVENT.DOWNLOAD_PRESS)}
    >
      Download for macOS
    </ButtonLink>
  );
}

/**
 * The download at the end of every page's bar: a pill, so it nests in the
 * floating bar's round end, and named in one word, as the bar has room for,
 * since the page under it says which Mac it is for; its accessible name says
 * it whole. Counted as the hero's is.
 */
export function SiteBarDownload(): React.JSX.Element {
  return (
    <ButtonLink
      variant={BUTTON_VARIANT.INK}
      shape={BUTTON_SHAPE.ROUND}
      href={DMG_URL}
      label="Download for macOS"
      onClick={() => captureSiteEvent(SITE_EVENT.DOWNLOAD_PRESS)}
    >
      Download
    </ButtonLink>
  );
}

/**
 * Shared between every page so the legal and license links never drift
 * apart: what PublicPage's `footer` holds under its rule. The changelog's
 * feed is as quiet as the rest of the foot: a reader subscribes once, so it
 * needs a way in, not a call to action.
 */
export function SiteFooterLinks({ current }: ChromeProps): React.JSX.Element {
  return (
    <SiteFootLinks
      facts={["Apache-2.0", "macOS 14+"]}
      links={[
        { label: "About", href: SITE_PAGE.ABOUT, current: currentOf(SITE_PAGE.ABOUT, current) },
        { label: "Docs", href: DOCS_URL },
        {
          label: "Changelog",
          href: SITE_PAGE.CHANGELOG,
          current: currentOf(SITE_PAGE.CHANGELOG, current),
        },
        { label: "RSS", href: "/changelog/rss.xml" },
        {
          label: "Privacy",
          href: SITE_PAGE.PRIVACY,
          current: currentOf(SITE_PAGE.PRIVACY, current),
        },
        { label: "Contact", href: "mailto:founders@vespin.dev" },
      ]}
      notice="© 2026 Stage Inc."
    />
  );
}
