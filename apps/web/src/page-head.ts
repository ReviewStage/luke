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
  return html.replace(
    tag,
    (_, open: string, close: string) => `${open}${escapeAttribute(content)}${close}`,
  );
}

function withCanonical(html: string, url: string): string {
  const tag = /(<link\s+rel="canonical"\s+href=")[^"]*(")/;
  if (!tag.test(html)) throw new Error('the page template has no <link rel="canonical">');
  return html.replace(
    tag,
    (_, open: string, close: string) => `${open}${escapeAttribute(url)}${close}`,
  );
}

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
  rewritten = withCanonical(rewritten, head.url);
  if (head.image === undefined) return rewritten;
  const origin = new URL(head.url).origin;
  rewritten = withMeta(rewritten, "property", "og:image", `${origin}${head.image.src}`);
  rewritten = withMeta(rewritten, "property", "og:image:alt", head.image.alt);
  if (imageSize === undefined) return rewritten;
  rewritten = withMeta(rewritten, "property", "og:image:width", String(imageSize.width));
  return withMeta(rewritten, "property", "og:image:height", String(imageSize.height));
}
