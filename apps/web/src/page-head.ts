/**
 * page-head.ts -- rewrites a built page's `<head>` for one route: its title, description, address, and share image.
 *
 * The prerender serves many routes from one built template (every changelog
 * page and release from `changelog.html`), and a browser tab, a search
 * result, and a share card each read the route's own head, not the
 * template's. The template's tags are the contract: each one rewritten here
 * must be in it once, and a template without it is refused rather than
 * shipped with another route's words.
 */

import type { PageHead } from "./changelog-releases";

export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

const escapeAttribute = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const escapeText = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** A `<meta>` tag's content, found by its `name` or `property` across however it is wrapped. */
function withMeta(
  html: string,
  attribute: "name" | "property",
  key: string,
  content: string,
): string {
  const tag = new RegExp(
    `(<meta\\s+${attribute}="${key.replaceAll(".", "\\.")}"\\s+content=")[^"]*(")`,
  );
  if (!tag.test(html)) throw new Error(`the page template has no <meta ${attribute}="${key}">`);
  // A replacer function, because a string replacement would read any `$` in the content as a back-reference.
  return html.replace(
    tag,
    (_, open: string, close: string) => `${open}${escapeAttribute(content)}${close}`,
  );
}

/**
 * The template's head rewritten for a route. A route with an image shares it
 * in place of the site's card, at its own size when the caller read one.
 */
export function withPageHead(
  html: string,
  head: PageHead,
  imageSize: ImageSize | undefined,
): string {
  const title = /<title>[^<]*<\/title>/;
  if (!title.test(html)) throw new Error("the page template has no <title>");
  let rewritten = html.replace(title, () => `<title>${escapeText(head.title)}</title>`);
  rewritten = withMeta(rewritten, "name", "description", head.description);
  rewritten = withMeta(rewritten, "property", "og:title", head.title);
  rewritten = withMeta(rewritten, "property", "og:description", head.description);
  rewritten = withMeta(rewritten, "property", "og:url", head.url);
  if (head.image === undefined) return rewritten;
  const origin = new URL(head.url).origin;
  rewritten = withMeta(rewritten, "property", "og:image", `${origin}${head.image.src}`);
  rewritten = withMeta(rewritten, "property", "og:image:alt", head.image.alt);
  if (imageSize === undefined) return rewritten;
  rewritten = withMeta(rewritten, "property", "og:image:width", String(imageSize.width));
  return withMeta(rewritten, "property", "og:image:height", String(imageSize.height));
}
