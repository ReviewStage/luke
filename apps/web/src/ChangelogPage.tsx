import {
  BUTTON_VARIANT,
  ButtonLink,
  MARK_PROVIDER,
  ProviderMark,
  PUBLIC_PAGE_WIDTH,
  PublicPage,
  PublicSection,
  TEXT_ELEMENT,
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
  changelogPagerItems,
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

/**
 * What opens either view: an optional way back, the page's title, and its door
 * to GitHub, which is the landing hero's secondary button, so the two GitHub
 * doors read as the same control. The intro sets its own `h1` rather than
 * PublicPage's title, because a release's way back stands above it.
 */
function ChangelogIntro({
  back,
  title,
  github,
}: {
  readonly back?: React.ReactNode;
  readonly title: React.ReactNode;
  readonly github: { readonly href: string; readonly label: React.ReactNode };
}): React.JSX.Element {
  return (
    <div className="pb-10">
      {back === undefined ? null : <div className="mb-4">{back}</div>}
      <Text variant={TEXT_VARIANT.TITLE} as={TEXT_ELEMENT.H1}>
        {title}
      </Text>
      <div className="mt-6">
        <ButtonLink
          variant={BUTTON_VARIANT.OUTLINE}
          href={github.href}
          icon={<ProviderMark provider={MARK_PROVIDER.GITHUB} />}
        >
          {github.label}
        </ButtonLink>
      </div>
    </div>
  );
}

function ReleaseEntry({ release }: { readonly release: Release }): React.JSX.Element {
  return (
    <section className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-10 py-12 max-[640px]:grid-cols-1 max-[640px]:gap-4 max-[640px]:py-10">
      {/* `self-start` because a stretched grid item is as tall as the
          release and leaves sticky nowhere to travel. On one column the rail
          becomes the entry's own dated heading line. */}
      <div className="sticky top-24 flex flex-col gap-1 self-start max-[640px]:static max-[640px]:flex-row max-[640px]:items-baseline max-[640px]:gap-3">
        <a
          className="font-mono text-sm font-semibold text-foreground no-underline transition-colors duration-150 hover:text-accent-ink motion-reduce:transition-none"
          href={changelogReleasePath(release.version)}
        >
          v{release.version}
        </a>
        <time className="font-mono text-xs text-muted-foreground" dateTime={release.date}>
          {formatReleaseDate(release.date)}
        </time>
      </div>
      <div className="document" dangerouslySetInnerHTML={{ __html: release.html }} />
    </section>
  );
}

/* The navs stand under the notes' column, not centred on the page, so they
   line up with what they page through; on one column there is no rail to clear. */
const UNDER_NOTES = "ml-[calc(8.5rem+2.5rem)] pt-4 max-[640px]:ml-0";

const PAGER_ITEM =
  "inline-flex h-7 min-w-7 items-center justify-center rounded-md px-2 font-mono text-xs text-muted-foreground no-underline transition-colors duration-150 hover:bg-muted hover:text-foreground motion-reduce:transition-none";
const PAGER_CURRENT =
  "inline-flex h-7 min-w-7 items-center justify-center rounded-md border border-border bg-muted px-2 font-mono text-xs font-semibold text-foreground";
const PAGER_IDLE =
  "inline-flex h-7 min-w-7 items-center justify-center px-2 font-mono text-xs text-muted-foreground opacity-40";

/** A step to the page or release beside this one, or the arrow alone, dimmed, at either end. */
function PagerStep({
  href,
  rel,
  label,
  children,
}: {
  readonly href: string | undefined;
  readonly rel: "prev" | "next";
  /** What the step opens, for a step whose glyph alone says only which way it points. */
  readonly label: string | undefined;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  if (href === undefined) {
    return (
      <span aria-hidden="true" className={PAGER_IDLE}>
        {children}
      </span>
    );
  }
  return (
    <a aria-label={label} className={PAGER_ITEM} href={href} rel={rel}>
      {children}
    </a>
  );
}

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
    <nav aria-label="Changelog pages" className={`${UNDER_NOTES} flex items-center gap-1`}>
      <PagerStep
        href={page > 1 ? changelogPagePath(page - 1) : undefined}
        rel="prev"
        label="Newer page"
      >
        ←
      </PagerStep>
      {changelogPagerItems(page, pageCount).map((number, index) =>
        number === undefined ? (
          <span key={`gap-${index}`} className={PAGER_IDLE}>
            …
          </span>
        ) : number === page ? (
          <span key={number} aria-current="page" className={PAGER_CURRENT}>
            {number}
          </span>
        ) : (
          <a key={number} className={PAGER_ITEM} href={changelogPagePath(number)}>
            {number}
          </a>
        ),
      )}
      <PagerStep
        href={page < pageCount ? changelogPagePath(page + 1) : undefined}
        rel="next"
        label="Older page"
      >
        →
      </PagerStep>
    </nav>
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
    <nav aria-label="Releases" className={`${UNDER_NOTES} flex items-center justify-between gap-4`}>
      <PagerStep
        href={newer === undefined ? undefined : changelogReleasePath(newer.version)}
        rel="prev"
        label={newer === undefined ? undefined : `Newer release, v${newer.version}`}
      >
        {newer === undefined ? "←" : `← v${newer.version}`}
      </PagerStep>
      <PagerStep
        href={older === undefined ? undefined : changelogReleasePath(older.version)}
        rel="next"
        label={older === undefined ? undefined : `Older release, v${older.version}`}
      >
        {older === undefined ? "→" : `v${older.version} →`}
      </PagerStep>
    </nav>
  );
}

function PageOfReleases({
  view,
}: {
  readonly view: Extract<ChangelogView, { kind: typeof CHANGELOG_VIEW.PAGE }>;
}): React.JSX.Element {
  return (
    <>
      <ChangelogIntro
        title="Changelog"
        github={{ href: `${REPOSITORY_URL}/releases`, label: "View releases on GitHub" }}
      />
      <div className="divide-y divide-border border-t border-border">
        {view.releases.map((release) => (
          <ReleaseEntry key={release.version} release={release} />
        ))}
      </div>
      <PageNumbers page={view.page} pageCount={view.pageCount} />
    </>
  );
}

function SingleRelease({
  view,
}: {
  readonly view: Extract<ChangelogView, { kind: typeof CHANGELOG_VIEW.RELEASE }>;
}): React.JSX.Element {
  const { release, newer, older } = view;
  return (
    <>
      <ChangelogIntro
        back={
          <TextLink href={CHANGELOG_PATH} variant={TEXT_VARIANT.LABEL}>
            ← Changelog
          </TextLink>
        }
        title={`Luke ${release.version}`}
        github={{
          href: `${REPOSITORY_URL}/releases/tag/v${release.version}`,
          label: `View v${release.version} on GitHub`,
        }}
      />
      <div className="border-t border-border">
        <ReleaseEntry release={release} />
      </div>
      <ReleaseSteps newer={newer} older={older} />
    </>
  );
}

export function ChangelogPage({ view }: { readonly view: ChangelogView }): React.JSX.Element {
  // Note that only page one is the changelog's own address; later pages and releases sit beneath it.
  const place = {
    page: SITE_PAGE.CHANGELOG,
    beneath: view.kind !== CHANGELOG_VIEW.PAGE || view.page !== 1,
  };
  // Wide: the rail and its gutter sit beside the notes, which keep about
  // the reading column's own measure.
  return (
    <PublicPage
      banner={<SiteNavigation current={place} />}
      footer={<SiteFooterLinks current={place} />}
      width={PUBLIC_PAGE_WIDTH.WIDE}
    >
      <PublicSection>
        {view.kind === CHANGELOG_VIEW.PAGE ? (
          <PageOfReleases view={view} />
        ) : (
          <SingleRelease view={view} />
        )}
      </PublicSection>
    </PublicPage>
  );
}
