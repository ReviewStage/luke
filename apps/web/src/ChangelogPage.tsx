import { marked } from "marked";
import changelogMarkdown from "../../../CHANGELOG.md?raw";
import { SiteFooter, SiteHeader } from "./SiteChrome";

/**
 * CHANGELOG.md at the repo root is the only place the release notes are
 * written — every release adds its entry there before its tag is pushed, and
 * a copy pasted into JSX would drift from it. Parsed once at module load
 * since the document is fixed at build time.
 */
const changelogHtml = marked.parse(changelogMarkdown, { async: false }) as string;

export function ChangelogPage(): React.JSX.Element {
  return (
    <>
      <SiteHeader />

      <main className="shell">
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: changelogHtml is parsed from CHANGELOG.md, a repository file fixed at build time, not user input. */}
        <article className="document" dangerouslySetInnerHTML={{ __html: changelogHtml }} />
      </main>

      <SiteFooter />
    </>
  );
}
