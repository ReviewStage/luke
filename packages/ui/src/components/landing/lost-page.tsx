import type { ReactNode } from "react";
import { LandingDotWords } from "./landing-wordmark.js";
import { SiteFrame, SiteRule } from "./site-frame.js";

/**
 * lost-page.tsx -- the page the public site answers an address it has no page for with: the numerals in copper dots over the one line, its lead, and the ways back, in the site's frame.
 *
 * It stands in the site's frame (`site-frame.tsx`) as every public page
 * does, the bar over it and the foot under it, so a reader who lands here
 * still reads the site. The numerals are drawn in the foot's own dots
 * (`landing-wordmark.tsx`): the same band of light passes through them and
 * the pointer's trail turns them to chrome, so the page has something to
 * play with while the reader finds their way. Beside the line, in the
 * mono face, stands the address the reader asked for, which the caller
 * reads off the location once the page has mounted. Its words and links
 * are the caller's. It is drawn in `landing.css`.
 */

/** The page for an address the site has no page for: `title`, `lead`, and `actions` under the dotted numerals. */
export function LostPage({
  bar,
  barCall,
  footer,
  address,
  title,
  lead,
  actions,
}: {
  /** The site's wordmark and links, laid across the bar. */
  bar: ReactNode;
  /** The bar's call at its end. */
  barCall?: ReactNode;
  /** The site's closing links and notices. */
  footer: ReactNode;
  /** The path the reader asked for, set in the mono face above the line; none leaves the line alone. */
  address?: string | undefined;
  /** The page's one line, its `h1`. */
  title: ReactNode;
  lead: ReactNode;
  /** The ways back, under the lead. */
  actions: ReactNode;
}): React.JSX.Element {
  return (
    <SiteFrame bar={bar} barCall={barCall} footer={footer}>
      <main className="ui-landing-lost">
        <div className="ui-landing-lost-art" aria-hidden="true">
          <LandingDotWords words="404" />
        </div>
        <div className="ui-landing-lost-words">
          <p className="ui-landing-lost-address">
            <span>404</span>
            {address === undefined ? null : <span>{address}</span>}
          </p>
          <h1 className="ui-landing-title">{title}</h1>
          <p className="ui-landing-hero-lead">{lead}</p>
          <div className="ui-landing-actions">{actions}</div>
        </div>
      </main>
      <SiteRule />
    </SiteFrame>
  );
}
