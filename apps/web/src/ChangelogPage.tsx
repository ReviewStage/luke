import changelogMarkdown from "../../../CHANGELOG.md?raw";
import {
  CHANGELOG_FEED_PATH,
  CHANGELOG_PATH,
  CHANGELOG_VIEW,
  type ChangelogView,
  changelogPagePath,
  changelogReleasePath,
  parseReleases,
  type Release,
} from "./changelog-releases";
import { GitHubMark, REPOSITORY_URL, SiteFooter, SiteHeader } from "./SiteChrome";

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

const NAV_LINK =
  "text-sm font-semibold text-muted-foreground no-underline transition-colors duration-150 hover:text-foreground motion-reduce:transition-none";

/* The landing hero's secondary button, so the two GitHub doors read as the
   same control. */
const GITHUB_BUTTON =
  "mt-6 inline-flex items-center gap-2 rounded-md border border-border px-[23px] py-[11px] text-sm font-semibold text-muted-foreground no-underline transition-colors duration-150 hover:border-muted-foreground hover:text-foreground motion-reduce:transition-none";

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

/** The links beneath the releases: newer to the left, older to the right, as the list reads down. */
function Pager({
  newer,
  older,
  middle,
}: {
  readonly newer: { readonly href: string; readonly label: string } | undefined;
  readonly older: { readonly href: string; readonly label: string } | undefined;
  readonly middle: string | undefined;
}): React.JSX.Element | null {
  if (newer === undefined && older === undefined) return null;
  return (
    <nav
      aria-label="Changelog pages"
      className="flex items-center justify-between gap-4 border-t border-border py-8"
    >
      <span>
        {newer === undefined ? null : (
          <a className={NAV_LINK} href={newer.href} rel="prev">
            ← {newer.label}
          </a>
        )}
      </span>
      {middle === undefined ? null : (
        <span className="font-mono text-xs text-muted-foreground">{middle}</span>
      )}
      <span>
        {older === undefined ? null : (
          <a className={NAV_LINK} href={older.href} rel="next">
            {older.label} →
          </a>
        )}
      </span>
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
      <div className="pt-12 pb-10">
        <h1 className="m-0 text-[2rem] leading-[1.15] font-semibold tracking-[-0.02em]">
          Changelog
        </h1>
        <div className="flex flex-wrap items-center gap-x-6">
          <a className={GITHUB_BUTTON} href={`${REPOSITORY_URL}/releases`}>
            <GitHubMark />
            View releases on GitHub
          </a>
          <a className={`mt-6 ${NAV_LINK}`} href={CHANGELOG_FEED_PATH}>
            RSS feed
          </a>
        </div>
      </div>
      <div className="divide-y divide-border border-t border-border">
        {view.releases.map((release) => (
          <ReleaseEntry key={release.version} release={release} />
        ))}
      </div>
      <Pager
        newer={
          view.page > 1 ? { href: changelogPagePath(view.page - 1), label: "Newer" } : undefined
        }
        older={
          view.page < view.pageCount
            ? { href: changelogPagePath(view.page + 1), label: "Older" }
            : undefined
        }
        middle={`Page ${view.page} of ${view.pageCount}`}
      />
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
      <div className="pt-12 pb-10">
        <a className={NAV_LINK} href={CHANGELOG_PATH}>
          ← Changelog
        </a>
        <h1 className="mt-4 mb-0 text-[2rem] leading-[1.15] font-semibold tracking-[-0.02em]">
          Luke {release.version}
        </h1>
        <a className={GITHUB_BUTTON} href={`${REPOSITORY_URL}/releases/tag/v${release.version}`}>
          <GitHubMark />
          View v{release.version} on GitHub
        </a>
      </div>
      <div className="border-t border-border">
        <ReleaseEntry release={release} />
      </div>
      <Pager
        newer={
          newer === undefined
            ? undefined
            : { href: changelogReleasePath(newer.version), label: `v${newer.version}` }
        }
        older={
          older === undefined
            ? undefined
            : { href: changelogReleasePath(older.version), label: `v${older.version}` }
        }
        middle={undefined}
      />
    </>
  );
}

export function ChangelogPage({ view }: { readonly view: ChangelogView }): React.JSX.Element {
  return (
    <>
      <SiteHeader />

      {/* Wider than the shell: the rail and its gutter sit beside the body,
          which keeps the shell's own document measure. */}
      <main className="mx-auto w-full max-w-[860px] px-6 max-[520px]:px-4">
        {view.kind === CHANGELOG_VIEW.PAGE ? (
          <PageOfReleases view={view} />
        ) : (
          <SingleRelease view={view} />
        )}
      </main>

      <SiteFooter />
    </>
  );
}
