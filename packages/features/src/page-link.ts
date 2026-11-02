import { Schema as EffectSchema } from "effect";

/**
 * page-link.ts -- a link in a plan's page as drawn: the press of a link out of the page, which the page's frame hands the side panel to open outside it.
 *
 * A page is drawn in a frame sandboxed to its scripts alone, under a policy
 * that refuses it a popup and a navigation to anywhere but itself
 * (`@luke/features/page-policy`), so a link out of it, followed in the
 * frame, goes nowhere. Every server of a page therefore answers it with one
 * script of Fullspin's own ahead of the agent's HTML (`withPageScripts`),
 * which takes a press of a link to another site from the page, so the frame
 * does not follow it, and posts its address to the panel, which opens it as
 * it opens any link outside the window (`page-pane.tsx`). A link within the
 * page, to one of its own headings, is the page's, as is a press the page's
 * own scripts took first.
 *
 * The script runs among the page's own, so whatever the frame posts is the
 * page's word, not Fullspin's: the panel takes the message only from the frame it
 * drew, only in the shape below, only for an address it would open from any
 * other link, and only while the window holds a press of the developer's,
 * which a press in the frame hands the window that framed it, so no script
 * of the page's opens a site on its own.
 */

/** The mark every message of a link wears, setting it apart from whatever else the page posts. */
export const PAGE_LINK_TYPE = "luke-page-link";

/** A message the frame posts to the panel: the address of the link out pressed. */
export const pageLinkPressSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(PAGE_LINK_TYPE),
  href: EffectSchema.String,
});

/**
 * The script the frame runs, ahead of the page's own. It is plain JavaScript in
 * a string because it runs in the page, apart from every bundle of Fullspin's.
 * It hears a press last of all: on the window as the press sets out, it adds
 * a listener of its own to the window for the press's way back, which the
 * window then hears after every listener the page gave it, its own scripts
 * running after this one, so a press the page took for itself
 * (`preventDefault`), on an element or on the window, stays the page's, and
 * the link found as the press set out is read as the page left it, where the
 * page rewrote it, or took what was pressed in it away, as it was pressed. The listener goes once that press reaches it, so a press the page
 * starts inside it is let by, and in any case once the press is done, so one
 * the page stopped short of the window leaves none behind.
 * A link out is one to a web address on another site than the one the page's
 * links are read against, its own, since its policy refuses it a `<base>`;
 * any other link is left to the frame.
 */
export const PAGE_LINK_SCRIPT = `(() => {
  "use strict";
  const TYPE = ${JSON.stringify(PAGE_LINK_TYPE)};
  const WEB = new Set(["http:", "https:"]);
  const LINK = "a[href], area[href]";

  const linkOut = (link) => {
    let address;
    try {
      address = new URL(link.href);
    } catch {
      return undefined;
    }
    if (!WEB.has(address.protocol) || address.origin === new URL(document.baseURI).origin) return undefined;
    return address.href;
  };

  addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest(LINK) : null;
    if (event.button !== 0 || link === null) return;
    const last = (back) => {
      if (back !== event) return;
      removeEventListener("click", last);
      const href = event.defaultPrevented ? undefined : linkOut(link);
      if (href === undefined) return;
      event.preventDefault();
      parent.postMessage({ type: TYPE, href }, "*");
    };
    addEventListener("click", last);
    setTimeout(() => removeEventListener("click", last), 0);
  }, true);
})();`;
