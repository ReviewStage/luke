import { type ReactNode, useEffect, useState } from "react";
import { LandingWordmark } from "./landing-wordmark.js";

/**
 * site-frame.tsx -- the frame every page of the public site stands in: its paper, a bar that floats once the page scrolls, and the foot's links over the wordmark.
 *
 * The page stands on a warm paper, its parts set apart by hairlines alone
 * (`SiteRule`) that keep to the content's width. The bar spans the page at
 * its top and, once the reader scrolls, narrows into a floating pill on the
 * paper; its header keeps one height and the bar stands in it out of the
 * page's flow, so floating moves nothing under it. The foot holds the
 * site's links over the product's wordmark pressed in a faint warm gray
 * (`landing-wordmark.tsx`). The
 * landing (`LandingPage`) and every other public page (`PublicPage`) are
 * drawn in it, so the site reads as one. It is drawn in `landing.css`.
 */

/**
 * How far the reader scrolls before the bar floats, and how near the top
 * they come back before it spans the page again, in CSS pixels. Note that
 * the two differ, because a phone's scroll bounces past the top and its
 * toolbar's collapse nudges the offset, which would flip one threshold back
 * and forth mid-animation.
 */
const FLOAT = { AFTER: 24, BEFORE: 4 } as const;

/** Whether the page has scrolled past the bar's own height, so the bar floats. */
function useFloating(): boolean {
  const [floating, setFloating] = useState(false);
  useEffect(() => {
    const read = (): void =>
      setFloating((was) => (was ? window.scrollY > FLOAT.BEFORE : window.scrollY > FLOAT.AFTER));
    read();
    window.addEventListener("scroll", read, { passive: true });
    return () => window.removeEventListener("scroll", read);
  }, []);
  return floating;
}

/** A hairline across the content's width. */
export function SiteRule(): React.JSX.Element {
  return <div className="ui-landing-rule" aria-hidden="true" />;
}

/**
 * The bar's links to the site's own pages, set apart from the actions after
 * them by a hairline; a page narrower than a phone's leaves them to the foot,
 * which links them too.
 */
export function SiteBarPages({ children }: { children: ReactNode }): React.JSX.Element {
  return <span className="ui-landing-bar-pages">{children}</span>;
}

/** The site's frame: `bar` and its `barCall` over the page's `children`, over the `footer` and the wordmark. */
export function SiteFrame({
  bar,
  barCall,
  footer,
  children,
}: {
  /** The site's wordmark and links, laid across the bar; none draws no bar. */
  bar?: ReactNode;
  /** The bar's call at its end, which a page narrower than a phone's leaves out. */
  barCall?: ReactNode;
  /** The site's closing links and notices; none draws no foot. */
  footer?: ReactNode;
  /** The page itself, its `main` among it. */
  children: ReactNode;
}): React.JSX.Element {
  const floating = useFloating();
  return (
    <div className="ui-landing-page">
      {bar === undefined || bar === null ? null : (
        <header className="ui-landing-bar" data-floating={floating}>
          <div className="ui-landing-bar-in">
            {bar}
            {barCall === undefined ? null : <span className="ui-landing-bar-call">{barCall}</span>}
          </div>
        </header>
      )}
      {children}
      {footer === undefined || footer === null ? null : (
        <footer className="ui-landing-foot">
          <div className="ui-landing-foot-links">{footer}</div>
          <div className="ui-landing-foot-art">
            <LandingWordmark />
          </div>
        </footer>
      )}
    </div>
  );
}
