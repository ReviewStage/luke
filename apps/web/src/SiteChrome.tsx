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
  TEXT_ELEMENT,
  TEXT_FONT,
  TEXT_LINK_CURRENT,
  TEXT_LINK_HEIGHT,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextLink,
  type TextLinkCurrent,
} from "@repo/ui";
import { captureSiteEvent, SITE_EVENT } from "./analytics";
import { PANEL_PATH } from "./app/web-address";

export const REPOSITORY_URL = "https://github.com/ReviewStage/vespin";
export const DMG_URL = `${REPOSITORY_URL}/releases/latest/download/${PRODUCT_NAME}.dmg`;

export const DOCS_URL = "/docs";

export const WEB_APP_URL = PANEL_PATH;

export const WORDMARK =
  "font-brand text-(length:--ui-display-wordmark-size) font-(--ui-display-wordmark-weight) tracking-(--ui-display-wordmark-tracking)";

export const SITE_PAGE = {
  HOME: "/",
  ABOUT: "/about",
  CHANGELOG: "/changelog",
  PRIVACY: "/privacy",
} as const;

export type SitePage = (typeof SITE_PAGE)[keyof typeof SITE_PAGE];

export type SitePlace = { readonly page: SitePage; readonly beneath?: boolean };

type ChromeProps = { readonly current?: SitePlace };

function currentOf(page: SitePage, place: SitePlace | undefined): TextLinkCurrent | undefined {
  if (place?.page !== page) return undefined;
  return place.beneath === true ? TEXT_LINK_CURRENT.SECTION : TEXT_LINK_CURRENT.PAGE;
}

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

export function SiteDownload(): React.JSX.Element {
  return (
    <ButtonLink
      variant={BUTTON_VARIANT.PRIMARY}
      href={DMG_URL}
      onClick={() => captureSiteEvent(SITE_EVENT.DOWNLOAD_PRESS)}
    >
      Download for macOS
    </ButtonLink>
  );
}

export function SiteBarDownload(): React.JSX.Element {
  return (
    <ButtonLink
      variant={BUTTON_VARIANT.PRIMARY}
      shape={BUTTON_SHAPE.ROUND}
      href={DMG_URL}
      label="Download for macOS"
      onClick={() => captureSiteEvent(SITE_EVENT.DOWNLOAD_PRESS)}
    >
      Download
    </ButtonLink>
  );
}

export function SiteFooterLinks({ current }: ChromeProps): React.JSX.Element {
  return (
    <Text
      as={TEXT_ELEMENT.DIV}
      variant={TEXT_VARIANT.CAPTION}
      tone={TEXT_TONE.MUTED}
      font={TEXT_FONT.MONO}
    >
      <div className="flex flex-wrap gap-2 [&>*+*]:before:mr-2 [&>*+*]:before:content-['·']">
        <span>Apache-2.0</span>
        <span>macOS 14+</span>
        <TextLink href={SITE_PAGE.ABOUT} current={currentOf(SITE_PAGE.ABOUT, current)}>
          About
        </TextLink>
        <TextLink href={DOCS_URL}>Docs</TextLink>
        <TextLink href={SITE_PAGE.CHANGELOG} current={currentOf(SITE_PAGE.CHANGELOG, current)}>
          Changelog
        </TextLink>
        <TextLink href="/changelog/rss.xml">RSS</TextLink>
        <TextLink href={SITE_PAGE.PRIVACY} current={currentOf(SITE_PAGE.PRIVACY, current)}>
          Privacy
        </TextLink>
        <TextLink href="mailto:founders@vespin.dev">Contact</TextLink>
      </div>
      <p className="mt-8 border-t border-(--ui-color-border) pt-6">© 2026 Stage Inc.</p>
    </Text>
  );
}
