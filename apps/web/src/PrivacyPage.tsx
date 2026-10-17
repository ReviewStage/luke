import { marked } from "marked";
import privacyMarkdown from "../../../PRIVACY.md?raw";
import { SITE_PAGE, SiteFooter, SiteHeader } from "./SiteChrome";

/**
 * PRIVACY.md at the repo root is the only place this text is written — it
 * makes claims about what the app does, and a copy pasted into JSX would
 * drift from it. Parsed once at module load since the document is fixed at
 * build time.
 */
// SAFETY: `async: false` makes marked.parse synchronous; the return is a string, not a Promise.
const privacyHtml = marked.parse(privacyMarkdown, { async: false }) as string;

export function PrivacyPage(): React.JSX.Element {
  return (
    <>
      <SiteHeader current={SITE_PAGE.PRIVACY} />

      <main className="shell">
        <article
          className="document document-column"
          dangerouslySetInnerHTML={{ __html: privacyHtml }}
        />
      </main>

      <SiteFooter current={SITE_PAGE.PRIVACY} />
    </>
  );
}
