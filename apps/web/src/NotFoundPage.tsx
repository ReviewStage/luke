import { BUTTON_VARIANT, ButtonLink, LostPage, TEXT_LINK_HEIGHT, TextLink } from "@repo/ui";
import { useEffect, useState } from "react";
import { SITE_PAGE, SiteBarDownload, SiteFooterLinks, SiteNavigation } from "./SiteChrome";

/**
 * The path the reader asked for, read once the page mounts. Note that the
 * page is prerendered once for every address, so the first frame names none.
 */
function useAskedPath(): string | undefined {
  const [path, setPath] = useState<string | undefined>(undefined);
  useEffect(() => setPath(window.location.pathname), []);
  return path;
}

/** What any address the site has no page for is answered with, the site's chrome around it and a way home. */
export function NotFoundPage(): React.JSX.Element {
  return (
    <LostPage
      bar={<SiteNavigation />}
      barCall={<SiteBarDownload />}
      footer={<SiteFooterLinks />}
      address={useAskedPath()}
      title="No agent could find this page."
      lead="We sent one to look. It searched every branch, read every file, and came back empty-handed. The link may be mistyped, or the page may have moved."
      actions={
        <>
          <ButtonLink variant={BUTTON_VARIANT.PRIMARY} href={SITE_PAGE.HOME}>
            Back to home
          </ButtonLink>
          <TextLink href={SITE_PAGE.CHANGELOG} height={TEXT_LINK_HEIGHT.CONTROL}>
            or see what's new
          </TextLink>
        </>
      }
    />
  );
}
