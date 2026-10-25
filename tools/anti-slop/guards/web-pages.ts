import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { type RepositoryGuard, readJson, readText, record } from "./guard.ts";

/**
 * web-pages.ts -- what the site's pages carry in their heads and the stylesheets they draw with.
 *
 * Every page names Luke's icons and a theme colour, each icon a file the
 * site serves, so no page ships a blank tab; the web app installs from a
 * manifest whose icons are the sizes they claim; a pasted Luke link unfurls
 * as the landing page's card under Luke's name, since an unfurler reads it
 * signed out; the page the app frames carries its one style by the digest
 * its policy admits and loads nothing; and every Tailwind entry takes
 * `@luke/ui`'s theme (`packages/ui/AGENTS.md`), without which the buttons'
 * utilities compile to nothing; and the panel's root stops a phone's text
 * autosizing, without which iOS Safari draws a code block's lines larger
 * than the words around them.
 */

const WEB = "apps/web";
const PUBLIC = `${WEB}/public`;
const BRAND_FAVICON = "packages/brand/assets/icon/luke-favicon.svg";
const FRAMED_PAGE = "page-in-mac-app.html";
const PANEL_BASE = "packages/panel/src/styles/base.css";

/** The icons every page links, in order, and no other. */
const ICONS = [
  { rel: "icon", href: "/favicon.ico" },
  { rel: "icon", href: "/favicon.svg" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
] as const;

const THEME_COLOR = /<meta name="theme-color" content="(#[0-9a-f]{6})" \/>/u;

/** A Tailwind entry: a stylesheet that compiles Tailwind's utilities. */
const TAILWIND_UTILITIES = /@import\s+"tailwindcss(?:\/utilities\.css)?"/u;

/** What every Tailwind entry takes from `@luke/ui`, so its components' utilities compile. */
const UI_THEME_IMPORTS = ['"@luke/ui/tailwind/sources.css"', '"@luke/ui/tailwind/theme.css"'];

/** What the panel's root declares so a phone draws its sizes as the tokens say: WebKit's spelling and the standard one. */
const TEXT_SIZE_ADJUST = [
  /-webkit-text-size-adjust:\s*100%/u,
  /(?<![\w-])text-size-adjust:\s*100%/u,
];

/** Each `<link>` in a page's head, as its `rel` and `href`. */
function linksOf(html: string): readonly { rel: string; href: string }[] {
  const head = html.slice(0, html.indexOf("</head>"));
  return Array.from(head.matchAll(/<link\b[^>]*>/gu), ([tag]) => ({
    rel: /\brel="([^"]*)"/u.exec(tag)?.[1] ?? "",
    href: /\bhref="([^"]*)"/u.exec(tag)?.[1] ?? "",
  }));
}

/** A page's `<meta>` tags, by their `name` or `property`. */
function metaOf(html: string): ReadonlyMap<string, string> {
  return new Map(
    Array.from(
      html.matchAll(/<meta\s+(?:name|property)="([^"]+)"\s+content="([^"]*)"/gu),
      ([, key = "", content = ""]) => [key, content],
    ),
  );
}

/** Where a page's head misses an icon, links another, or names no theme colour. */
export function headProblems(page: string, html: string): readonly string[] {
  const problems: string[] = [];
  const icons = linksOf(html).filter((link) => link.rel.includes("icon"));
  const expected = ICONS.map(({ rel, href }) => `${rel} ${href}`).join(", ");
  const found = icons.map(({ rel, href }) => `${rel} ${href}`).join(", ");
  if (found !== expected) problems.push(`${page}: links icons ${found || "none"}, not ${expected}`);
  if (!THEME_COLOR.test(html)) problems.push(`${page}: names no theme-color`);
  return problems;
}

/** Where a pasted link's card differs from the landing page's, or leaves Luke's name or one description. */
export function unfurlProblems(app: string, landing: string): readonly string[] {
  const tags = metaOf(app);
  const card = metaOf(landing);
  const problems: string[] = [];
  const expect = (key: string, value: string | undefined): void => {
    if (tags.get(key) !== value)
      problems.push(`app.html: ${key} is ${tags.get(key) ?? "missing"}, not ${value ?? "absent"}`);
  };
  for (const key of ["og:title", "twitter:title", "og:site_name"]) expect(key, "Luke");
  // Note that a card naming a URL would lead to the landing page rather than the link pasted.
  expect("og:url", undefined);
  for (const key of ["og:image", "og:image:width", "og:image:height", "og:image:alt"])
    expect(key, card.get(key));
  expect("twitter:image", card.get("og:image"));
  expect("twitter:card", "summary_large_image");
  const description = tags.get("description");
  if (description === undefined || description === "")
    problems.push("app.html: carries no description");
  else for (const key of ["og:description", "twitter:description"]) expect(key, description);
  return problems;
}

/** A PNG's width and height, read from its IHDR chunk, which always follows the 8-byte signature. */
export function pngSize(png: Buffer): string | undefined {
  if (png.toString("latin1", 1, 4) !== "PNG") return undefined;
  return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
}

/** Where the manifest would not install the app full screen at /app, with the icons a browser asks for. */
export function manifestProblems(
  html: string,
  manifest: Record<string, unknown>,
  sizeOf: (src: string) => string | undefined,
): readonly string[] {
  const problems: string[] = [];
  const say = (what: string): void => {
    problems.push(`${PUBLIC}/manifest.webmanifest: ${what}`);
  };
  if (
    !linksOf(html).some((link) => link.rel === "manifest" && link.href === "/manifest.webmanifest")
  )
    problems.push("app.html: links no /manifest.webmanifest");
  for (const meta of ["apple-mobile-web-app-capable", "apple-mobile-web-app-status-bar-style"]) {
    if (!metaOf(html).has(meta)) problems.push(`app.html: names no ${meta}`);
  }
  if (manifest.name !== "Luke") say("its name is not Luke");
  if (manifest.start_url !== "/app") say("it does not start at /app");
  if (typeof manifest.scope !== "string" || !"/app".startsWith(manifest.scope))
    say("its scope leaves out /app");
  if (manifest.display !== "standalone") say("it does not install standalone");
  // Note that the splash and the installed app's chrome are the page's own ground.
  const themeColor = THEME_COLOR.exec(html)?.[1];
  if (manifest.theme_color !== themeColor || manifest.background_color !== themeColor)
    say(`its theme and background colours are not app.html's theme-color, ${themeColor ?? "none"}`);
  const icons = Array.isArray(manifest.icons)
    ? manifest.icons.map((icon) => record(icon, "an icon"))
    : [];
  for (const size of ["192x192", "512x512"]) {
    if (!icons.some((icon) => icon.sizes === size && icon.purpose === "any"))
      say(`it has no ${size} icon`);
  }
  if (!icons.some((icon) => icon.purpose === "maskable")) say("it has no maskable icon");
  for (const icon of icons) {
    const src = String(icon.src);
    if (icon.type !== "image/png") say(`${src} is not a PNG`);
    else if (sizeOf(src) !== icon.sizes)
      say(`${src} is ${sizeOf(src) ?? "missing"}, not ${String(icon.sizes)}`);
  }
  return problems;
}

/** A policy's directives by name, each with its sources. */
function directivesOf(policy: string): ReadonlyMap<string, readonly string[]> {
  return new Map(
    policy.split(";").map((directive) => {
      const [name = "", ...sources] = directive.trim().split(/\s+/u);
      return [name, sources];
    }),
  );
}

/** Where the framed page loads anything, or carries a style its policy does not admit by digest. */
export function framedPageProblems(html: string, policy: string | undefined): readonly string[] {
  const problems: string[] = [];
  const digests = [...html.matchAll(/<style>([\s\S]*?)<\/style>/gu)].map(
    ([, style = ""]) => `'sha256-${createHash("sha256").update(style).digest("base64")}'`,
  );
  if (digests.length !== 1)
    problems.push(`${FRAMED_PAGE}: carries ${digests.length} styles, not one`);
  if (/<(?:script|link|img|iframe)\b/u.test(html))
    problems.push(`${FRAMED_PAGE}: loads a script, a link, an image, or a frame`);
  if (policy === undefined)
    return [...problems, `vercel.json: no route answers /${FRAMED_PAGE} with a policy`];
  const directives = directivesOf(policy);
  if (directives.get("default-src")?.join(" ") !== "'none'")
    problems.push(`vercel.json: /${FRAMED_PAGE}'s policy does not default to 'none'`);
  if (directives.get("style-src")?.join(" ") !== digests.join(" "))
    problems.push(
      `vercel.json: /${FRAMED_PAGE}'s style-src is not its style's digest, ${digests.join(" ")}`,
    );
  return problems;
}

/** Where a Tailwind entry leaves out `@luke/ui`'s sources or theme, or takes it before Tailwind's own. */
export function themeImportProblems(file: string, sheet: string): readonly string[] {
  // Note that an import inside a comment is no import, so comments are taken out before reading.
  const css = sheet.replace(/\/\*[\s\S]*?\*\//gu, "");
  const tailwind = TAILWIND_UTILITIES.exec(css);
  if (tailwind === null) return [];
  return UI_THEME_IMPORTS.filter(
    (specifier) => css.indexOf(`@import ${specifier}`) < tailwind.index,
  ).map(
    (specifier) =>
      `${file}: compiles Tailwind's utilities without importing ${specifier} after them`,
  );
}

/** Where a sheet's root leaves a phone's browser free to inflate its text, in either spelling. */
export function textSizeProblems(file: string, sheet: string): readonly string[] {
  const css = sheet.replace(/\/\*[\s\S]*?\*\//gu, "");
  const root = /(?:^|\})\s*:root\s*\{([^}]*)\}/u.exec(css)?.[1] ?? "";
  if (TEXT_SIZE_ADJUST.every((declaration) => declaration.test(root))) return [];
  return [`${file}: its :root does not set -webkit-text-size-adjust and text-size-adjust to 100%`];
}

/** The Content-Security-Policy a route of the web service answers the framed page with. */
function framedPolicy(root: string): string | undefined {
  const services = record(readJson(root, "vercel.json").services, "vercel.json's services");
  for (const service of Object.values(services)) {
    const routes = record(service, "a service").routes;
    if (!Array.isArray(routes)) continue;
    for (const route of routes.map((one) => record(one, "a route"))) {
      if (route.dest !== `/${FRAMED_PAGE}` || route.headers === undefined) continue;
      const policy = record(route.headers, "a route's headers")["Content-Security-Policy"];
      if (typeof policy === "string") return policy;
    }
  }
  return undefined;
}

/** The stylesheets of each app's and package's source, by path from the root. */
function stylesheets(root: string): readonly string[] {
  return ["apps", "packages"].flatMap((parent) =>
    readdirSync(path.join(root, parent)).flatMap((workspace) => {
      const source = path.join(root, parent, workspace, "src");
      if (!existsSync(source)) return [];
      return readdirSync(source, { recursive: true, encoding: "utf8" })
        .filter((file) => file.endsWith(".css"))
        .map((file) => `${parent}/${workspace}/src/${file.split(path.sep).join("/")}`);
    }),
  );
}

async function webPageProblems(root: string): Promise<readonly string[]> {
  const pages = readdirSync(path.join(root, WEB)).filter((name) => name.endsWith(".html"));
  const app = readText(root, `${WEB}/app.html`);
  const served = (href: string): string => path.join(root, PUBLIC, href);
  const problems = [
    ...pages.flatMap((page) => headProblems(`${WEB}/${page}`, readText(root, `${WEB}/${page}`))),
    ...ICONS.filter(({ href }) => !existsSync(served(href))).map(
      ({ href }) => `${PUBLIC}${href}: is not there`,
    ),
    ...unfurlProblems(app, readText(root, `${WEB}/index.html`)),
    ...manifestProblems(app, readJson(root, `${PUBLIC}/manifest.webmanifest`), (src) =>
      existsSync(served(src)) ? pngSize(readFileSync(served(src))) : undefined,
    ),
    ...framedPageProblems(readText(root, `${PUBLIC}/${FRAMED_PAGE}`), framedPolicy(root)),
    ...stylesheets(root).flatMap((file) => themeImportProblems(file, readText(root, file))),
    ...textSizeProblems(PANEL_BASE, readText(root, PANEL_BASE)),
  ];
  if (readText(root, `${PUBLIC}/favicon.svg`) !== readText(root, BRAND_FAVICON))
    problems.push(`${PUBLIC}/favicon.svg: is not ${BRAND_FAVICON}`);
  return problems;
}

export const webPagesGuard: RepositoryGuard = {
  holds:
    "the site's pages carry their icons, theme colour, card and policy, and every Tailwind entry takes @luke/ui's theme, and the panel's root stops a phone's text autosizing",
  problems: webPageProblems,
};
