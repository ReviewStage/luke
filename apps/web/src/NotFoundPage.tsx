import { PublicPage, PublicSection, TEXT_TONE, Text, TextLink } from "@repo/ui";
import { SITE_PAGE, SiteFooterLinks, SiteNavigation } from "./SiteChrome";

/** What any address the site has no page for is answered with, the site's chrome around it and a way home. */
export function NotFoundPage(): React.JSX.Element {
  return (
    <PublicPage
      banner={<SiteNavigation />}
      footer={<SiteFooterLinks />}
      title="Page not found"
      lead="Nothing stands at this address. It may have moved, or the link may be mistyped."
    >
      <PublicSection>
        <Text tone={TEXT_TONE.MUTED}>
          <TextLink href={SITE_PAGE.HOME}>Go to the home page</TextLink>
        </Text>
      </PublicSection>
    </PublicPage>
  );
}
