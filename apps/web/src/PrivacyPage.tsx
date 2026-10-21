import { Prose, PublicPage, PublicSection } from "@luke/ui";
import { markdownSections } from "@luke/ui/markdown-document";
import privacyMarkdown from "../../../PRIVACY.md?raw";
import { SITE_PAGE, SiteFooterLinks, SiteNavigation } from "./SiteChrome";

/** The policy must name the title the page draws above its sections. */
function policyOf(markdown: string) {
  const policy = markdownSections(markdown);
  if (policy.title === null) throw new Error("PRIVACY.md has no `#` title");
  return { ...policy, title: policy.title };
}

/** Generated inline markup, for a heading the page sets itself. */
function Inline({ html }: { html: string }): React.JSX.Element {
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * PRIVACY.md at the repo root is the only place this text is written — it
 * makes claims about what the app does, and a copy pasted into JSX would
 * drift from it. Parsed once at module load since the document is fixed at
 * build time.
 */
const POLICY = policyOf(privacyMarkdown);

export function PrivacyPage(): React.JSX.Element {
  return (
    <PublicPage
      banner={<SiteNavigation current={{ page: SITE_PAGE.PRIVACY }} />}
      footer={<SiteFooterLinks current={{ page: SITE_PAGE.PRIVACY }} />}
      title={<Inline html={POLICY.title} />}
    >
      {POLICY.sections.map((section) => (
        <PublicSection
          key={section.title ?? ""}
          title={section.title === null ? undefined : <Inline html={section.title} />}
        >
          <Prose html={section.html} />
        </PublicSection>
      ))}
    </PublicPage>
  );
}
