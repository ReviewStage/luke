import releases from "virtual:site/changelog-releases";
import { PRODUCT_NAME } from "@repo/features/product-name";
import { formatDayHeading } from "@repo/features/time-format";
import {
  BUTTON_VARIANT,
  ButtonLink,
  MARK_PROVIDER,
  Pagination,
  Prose,
  ProviderMark,
  PUBLIC_PAGE_WIDTH,
  PUBLIC_SECTIONS,
  PublicPage,
  PublicSection,
  TEXT_ELEMENT,
  TEXT_FONT,
  TEXT_LINK_LOOK,
  TEXT_TONE,
  TEXT_VARIANT,
  Text,
  TextLink,
} from "@repo/ui";
import {
  CHANGELOG_PATH,
  CHANGELOG_VIEW,
  type ChangelogView,
  changelogPagePath,
  changelogReleasePath,
  type Release,
} from "./changelog-releases";
import {
  REPOSITORY_URL,
  SITE_PAGE,
  SiteBarDownload,
  SiteFooterLinks,
  SiteNavigation,
} from "./SiteChrome";

export const RELEASES: readonly Release[] = releases;

function formatReleaseDate(date: string): string {
  return formatDayHeading(date);
}

function GitHubDoor({
  href,
  children,
}: {
  readonly href: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <ButtonLink
      variant={BUTTON_VARIANT.OUTLINE}
      href={href}
      icon={<ProviderMark provider={MARK_PROVIDER.GITHUB} />}
    >
      {children}
    </ButtonLink>
  );
}

function ReleaseEntry({ release }: { readonly release: Release }): React.JSX.Element {
  return (
    <div className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-10 max-[640px]:grid-cols-1 max-[640px]:gap-4">
      <div className="sticky top-24 flex flex-col gap-1 self-start max-[640px]:static max-[640px]:flex-row max-[640px]:items-baseline max-[640px]:gap-3">
        <TextLink
          href={changelogReleasePath(release.version)}
          look={TEXT_LINK_LOOK.HEADING}
          variant={TEXT_VARIANT.LABEL}
          font={TEXT_FONT.MONO}
        >
          v{release.version}
        </TextLink>
        <time dateTime={release.date}>
          <Text
            as={TEXT_ELEMENT.SPAN}
            variant={TEXT_VARIANT.CAPTION}
            tone={TEXT_TONE.MUTED}
            font={TEXT_FONT.MONO}
          >
            {formatReleaseDate(release.date)}
          </Text>
        </time>
      </div>
      <Prose html={release.html} />
    </div>
  );
}

const UNDER_NOTES = "ml-44 pt-4 max-[640px]:ml-0";

function PageNumbers({
  page,
  pageCount,
}: {
  readonly page: number;
  readonly pageCount: number;
}): React.JSX.Element | null {
  if (pageCount < 2) return null;
  return (
    <div className={UNDER_NOTES}>
      <Pagination
        label="Changelog pages"
        previous={page > 1 ? { href: changelogPagePath(page - 1), label: "Newer page" } : undefined}
        next={
          page < pageCount ? { href: changelogPagePath(page + 1), label: "Older page" } : undefined
        }
        pages={{ current: page, count: pageCount, href: changelogPagePath }}
      />
    </div>
  );
}

function ReleaseSteps({
  newer,
  older,
}: {
  readonly newer: Release | undefined;
  readonly older: Release | undefined;
}): React.JSX.Element {
  return (
    <div className={UNDER_NOTES}>
      <Pagination
        label="Releases"
        previous={
          newer === undefined
            ? undefined
            : {
                href: changelogReleasePath(newer.version),
                label: `Newer release, v${newer.version}`,
                text: `v${newer.version}`,
              }
        }
        next={
          older === undefined
            ? undefined
            : {
                href: changelogReleasePath(older.version),
                label: `Older release, v${older.version}`,
                text: `v${older.version}`,
              }
        }
      />
    </div>
  );
}

export function ChangelogPage({ view }: { readonly view: ChangelogView }): React.JSX.Element {
  const place = {
    page: SITE_PAGE.CHANGELOG,
    beneath: view.kind !== CHANGELOG_VIEW.PAGE || view.page !== 1,
  };
  const page = view.kind === CHANGELOG_VIEW.PAGE;
  const releases = page ? view.releases : [view.release];
  return (
    <PublicPage
      banner={<SiteNavigation current={place} />}
      bannerCall={<SiteBarDownload />}
      footer={<SiteFooterLinks current={place} />}
      back={page ? undefined : { href: CHANGELOG_PATH, label: "Changelog" }}
      title={page ? "Changelog" : `${PRODUCT_NAME} ${view.release.version}`}
      lead={
        page ? (
          <GitHubDoor href={`${REPOSITORY_URL}/releases`}>View releases on GitHub</GitHubDoor>
        ) : (
          <GitHubDoor href={`${REPOSITORY_URL}/releases/tag/v${view.release.version}`}>
            View v{view.release.version} on GitHub
          </GitHubDoor>
        )
      }
      width={PUBLIC_PAGE_WIDTH.WIDE}
      sections={PUBLIC_SECTIONS.RULED}
    >
      {releases.map((release) => (
        <PublicSection key={release.version}>
          <ReleaseEntry release={release} />
        </PublicSection>
      ))}
      {page ? (
        <PageNumbers page={view.page} pageCount={view.pageCount} />
      ) : (
        <ReleaseSteps newer={view.newer} older={view.older} />
      )}
    </PublicPage>
  );
}
