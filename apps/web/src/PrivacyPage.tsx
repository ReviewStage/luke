import { marked } from "marked";
import privacyMarkdown from "../../../PRIVACY.md?raw";
import { SiteFooter, SiteHeader } from "./SiteChrome";

/**
 * PRIVACY.md at the repo root is the only place this text is written — it
 * makes claims about what the app does, and a copy pasted into JSX would
 * drift from it. Parsed once at module load since the document is fixed at
 * build time.
 */
const privacyHtml = marked.parse(privacyMarkdown, { async: false }) as string;

export function PrivacyPage(): React.JSX.Element {
  return (
    <>
      <SiteHeader />

      <main className="shell">
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: privacyHtml is parsed from PRIVACY.md, a repository file fixed at build time, not user input. */}
        <article className="document" dangerouslySetInnerHTML={{ __html: privacyHtml }} />
      </main>

      <SiteFooter />
    </>
  );
}
