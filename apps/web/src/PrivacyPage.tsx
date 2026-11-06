import POLICY from "virtual:site/privacy-policy";
import { Prose, PublicPage, PublicSection } from "@repo/ui";
import { SITE_PAGE, SiteBarDownload, SiteFooterLinks, SiteNavigation } from "./SiteChrome";

function Inline({ html }: { html: string }): React.JSX.Element {
  return <span dangerouslySetInnerHTML={{ __html: html }} />;
}

export function PrivacyPage(): React.JSX.Element {
  return (
    <PublicPage
      banner={<SiteNavigation current={{ page: SITE_PAGE.PRIVACY }} />}
      bannerCall={<SiteBarDownload />}
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
