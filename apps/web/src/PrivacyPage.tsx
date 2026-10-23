import POLICY from "virtual:luke/privacy-policy";
import { Prose, PublicPage, PublicSection } from "@luke/ui";
import { SITE_PAGE, SiteFooterLinks, SiteNavigation } from "./SiteChrome";

/** Generated inline markup, for a heading the page sets itself. */
function Inline({ html }: { html: string }): React.JSX.Element {
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

/**
 * PRIVACY.md at the repo root is the only place this text is written — it
 * makes claims about what the app does, and a copy pasted into JSX would
 * drift from it. It is drawn when the site is built (`site-markdown.tsx`),
 * cut at its `#` and `##` headings, so the page draws the title and each
 * section itself and the generated markup is only what lies between.
 */
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
