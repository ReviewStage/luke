import { Marked } from "marked";
import changelogMarkdown from "../../../CHANGELOG.md?raw";
import { REPOSITORY_URL, SiteFooter, SiteHeader } from "./SiteChrome";

/**
 * CHANGELOG.md at the repo root is the only place the release notes are
 * written — every release adds its entry there before its tag is pushed, and
 * a copy pasted into JSX would drift from it. Screenshots are written
 * repository-relative in the markdown so GitHub renders them too; here the
 * public prefix comes off, because Vite serves that directory at the root.
 */
const changelogMarked = new Marked({
  walkTokens: (token) => {
    if (token.type === "image" && token.href.startsWith("apps/web/public/")) {
      token.href = token.href.slice("apps/web/public".length);
    }
  },
});

type Release = {
  readonly version: string;
  readonly date: string;
  readonly html: string;
};

/**
 * The heading shape is CHANGELOG.md's contract with this page: the version
 * becomes the sticky rail and the tag link, so a heading that does not parse
 * fails the build here rather than rendering a rail with holes in it.
 */
const RELEASE_HEADING = /^## (\d+\.\d+\.\d+) — (\d{4}-\d{2}-\d{2})$/;

function parseReleases(markdown: string): readonly Release[] {
  const sections = markdown.split(/^(?=## )/m);
  return sections.slice(1).map((section) => {
    const headingEnd = section.indexOf("\n");
    const heading = headingEnd === -1 ? section : section.slice(0, headingEnd);
    const match = RELEASE_HEADING.exec(heading.trimEnd());
    const version = match?.[1];
    const date = match?.[2];
    if (!version || !date) {
      throw new Error(`CHANGELOG.md release heading must be "## <version> — <date>": ${heading}`);
    }
    const body = headingEnd === -1 ? "" : section.slice(headingEnd + 1);
    return {
      version,
      date,
      html: changelogMarked.parse(body, { async: false }) as string,
    };
  });
}

const RELEASES = parseReleases(changelogMarkdown);

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

export function ChangelogPage(): React.JSX.Element {
  return (
    <>
      <SiteHeader />

      {/* Wider than the shell: the rail and its gutter sit beside the body,
          which keeps the shell's own document measure. */}
      <main className="mx-auto w-full max-w-[860px] px-6 max-[520px]:px-4">
        <div className="pt-12 pb-10">
          <h1 className="m-0 text-[2rem] leading-[1.15] font-semibold tracking-[-0.02em]">
            Changelog
          </h1>
          <p className="mt-4 mb-0 max-w-[34rem] text-muted-foreground">
            New in Luke, release by release.
          </p>
        </div>

        <div className="divide-y divide-border border-t border-border">
          {RELEASES.map((release) => (
            <section
              key={release.version}
              className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-10 py-12 max-[640px]:grid-cols-1 max-[640px]:gap-4 max-[640px]:py-10"
            >
              {/* `self-start` because a stretched grid item is as tall as the
                  release and leaves sticky nowhere to travel. On one column
                  the rail becomes the entry's own dated heading line. */}
              <div className="sticky top-24 flex flex-col gap-1 self-start max-[640px]:static max-[640px]:flex-row max-[640px]:items-baseline max-[640px]:gap-3">
                <a
                  className="font-mono text-sm font-semibold text-foreground no-underline transition-colors duration-150 hover:text-accent-ink motion-reduce:transition-none"
                  href={`${REPOSITORY_URL}/releases/tag/v${release.version}`}
                >
                  v{release.version}
                </a>
                <time className="font-mono text-xs text-muted-foreground" dateTime={release.date}>
                  {formatReleaseDate(release.date)}
                </time>
              </div>
              <div
                className="document"
                // biome-ignore lint/security/noDangerouslySetInnerHtml: release.html is parsed from CHANGELOG.md, a repository file fixed at build time, not user input.
                dangerouslySetInnerHTML={{ __html: release.html }}
              />
            </section>
          ))}
        </div>
      </main>

      <SiteFooter />
    </>
  );
}
