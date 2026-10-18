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
} from "@luke/ui";
import changelogMarkdown from "../../../CHANGELOG.md?raw";
import {
  CHANGELOG_PATH,
  CHANGELOG_VIEW,
  type ChangelogView,
  changelogPagePath,
  changelogReleasePath,
  parseReleases,
  type Release,
} from "./changelog-releases";
import { REPOSITORY_URL, SITE_PAGE, SiteFooterLinks, SiteNavigation } from "./SiteChrome";

/**
 * The changelog's pages and its per-release pages, drawn from CHANGELOG.md
 * (`changelog-releases.ts` reads it and decides which releases an address
 * shows). Every release keeps the same rail and body wherever it appears, so
 * a release read on its own page looks as it does in the list.
 */
export const RELEASES = parseReleases(changelogMarkdown);

/* UTC, because the heading's date names a calendar day, not an instant — a
   visitor west of Greenwich must not read the release as the evening before. */
const RELEASE_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

function formatReleaseDate(date: string): string {
  return RELEASE_DATE_FORMAT.format(new Date(`${date}T00:00:00Z`));
}

/** The view's door to GitHub, the landing hero's secondary button, so the two GitHub doors read as the same control. */
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
      {/* `self-start` because a stretched grid item is as tall as the
          release and leaves sticky nowhere to travel. On one column the rail
          becomes the entry's own dated heading line. */}
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

/* The navs stand under the notes' column, not centred on the page, so they
   line up with what they page through; on one column there is no rail to clear. */
const UNDER_NOTES = "ml-[calc(8.5rem+2.5rem)] pt-4 max-[640px]:ml-0";

/** The changelog's pages as numbers, the current one held, with a step to either side. */
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

/** The releases beside this one: newer to the left, older to the right, as the changelog reads down. */
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
  // Note that only page one is the changelog's own address; later pages and releases sit beneath it.
  const place = {
    page: SITE_PAGE.CHANGELOG,
    beneath: view.kind !== CHANGELOG_VIEW.PAGE || view.page !== 1,
  };
  const page = view.kind === CHANGELOG_VIEW.PAGE;
  const releases = page ? view.releases : [view.release];
  // Wide: the rail and its gutter sit beside the notes, which keep about
  // the reading column's own measure. Each release stands under a rule.
  return (
    <PublicPage
      banner={<SiteNavigation current={place} />}
      footer={<SiteFooterLinks current={place} />}
      back={page ? undefined : { href: CHANGELOG_PATH, label: "Changelog" }}
      title={page ? "Changelog" : `Luke ${view.release.version}`}
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
