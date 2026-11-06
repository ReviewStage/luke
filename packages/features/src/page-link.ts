import { Schema as EffectSchema } from "effect";

export const PAGE_LINK_TYPE = "app-page-link";

export const pageLinkPressSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(PAGE_LINK_TYPE),
  href: EffectSchema.String,
});

export const PAGE_LINK_SCRIPT = `(() => {
  "use strict";
  const TYPE = ${JSON.stringify(PAGE_LINK_TYPE)};
  const OPENED = new Set(["http:", "https:", "mailto:"]);
  const LINK = "a[href], area[href]";

  const linkOut = (link) => {
    let address;
    try {
      address = new URL(link.href);
    } catch {
      return undefined;
    }
    if (!OPENED.has(address.protocol) || address.origin === new URL(document.baseURI).origin) return undefined;
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
