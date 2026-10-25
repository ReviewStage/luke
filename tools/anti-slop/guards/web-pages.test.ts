import { describe, expect, it } from "vitest";

import {
  framedPageProblems,
  headProblems,
  textSizeProblems,
  themeImportProblems,
  unfurlProblems,
} from "./web-pages.ts";

const ICONS =
  '<link rel="icon" href="/favicon.ico" /><link rel="icon" href="/favicon.svg" /><link rel="apple-touch-icon" href="/apple-touch-icon.png" />';

describe("the site's pages", () => {
  it("name a page whose head misses an icon or the theme colour", () => {
    expect(
      headProblems("ok.html", `<head>${ICONS}<meta name="theme-color" content="#ffffff" /></head>`),
    ).toEqual([]);
    expect(
      headProblems("bare.html", '<head><link rel="icon" href="/favicon.svg" /></head>'),
    ).toHaveLength(2);
  });

  it("name a pasted link's card that leaves Luke's name or the landing page's image", () => {
    const landing = '<meta property="og:image" content="/card.png" />';
    const app = [
      '<meta property="og:title" content="Luke" />',
      '<meta name="twitter:title" content="Luke" />',
      '<meta property="og:site_name" content="Luke" />',
      '<meta property="og:image" content="/other.png" />',
      '<meta name="twitter:image" content="/card.png" />',
      '<meta name="twitter:card" content="summary_large_image" />',
      '<meta name="description" content="Talk a task through." />',
      '<meta property="og:description" content="Talk a task through." />',
      '<meta name="twitter:description" content="Talk a task through." />',
    ].join("\n");
    expect(unfurlProblems(app, landing)).toEqual([
      "app.html: og:image is /other.png, not /card.png",
    ]);
  });

  it("name a framed page whose style its policy no longer admits, or that loads a script", () => {
    const page = "<style>body{margin:0}</style>";
    // The digest of `body{margin:0}`, worked out by hand with `openssl dgst -sha256 -binary | base64`.
    const policy =
      "default-src 'none'; style-src 'sha256-IAdwN3biDCQ3brrgp1m8kBEsPQYyqfREKOEfeoREopc='";
    expect(framedPageProblems(page, policy)).toEqual([]);
    expect(framedPageProblems(`${page}<script src="/x.js"></script>`, policy)).toHaveLength(1);
    expect(framedPageProblems("<style>body{margin:1px}</style>", policy)).toHaveLength(1);
  });

  it("name a Tailwind entry that compiles the utilities without @luke/ui's theme after them", () => {
    const entry = '@import "tailwindcss";\n@import "@luke/ui/tailwind/sources.css";\n';
    expect(
      themeImportProblems("app.css", `${entry}@import "@luke/ui/tailwind/theme.css";`),
    ).toEqual([]);
    expect(themeImportProblems("app.css", entry)).toEqual([
      'app.css: compiles Tailwind\'s utilities without importing "@luke/ui/tailwind/theme.css" after them',
    ]);
    expect(
      themeImportProblems("app.css", `${entry}/* @import "@luke/ui/tailwind/theme.css"; */`),
    ).toHaveLength(1);
    expect(themeImportProblems("page.css", ".page { margin: 0; }")).toEqual([]);
  });

  it("name a root that leaves a phone's browser free to inflate its text", () => {
    const both = "-webkit-text-size-adjust: 100%; text-size-adjust: 100%;";
    expect(textSizeProblems("base.css", `:root { color: red; ${both} }`)).toEqual([]);
    expect(textSizeProblems("base.css", ":root { -webkit-text-size-adjust: 100%; }")).toEqual([
      "base.css: its :root does not set -webkit-text-size-adjust and text-size-adjust to 100%",
    ]);
    expect(textSizeProblems("base.css", `:root { color: red; } .card { ${both} }`)).toHaveLength(1);
    expect(textSizeProblems("base.css", `:root { /* ${both} */ }`)).toHaveLength(1);
    expect(
      textSizeProblems("base.css", `:root { ${both} -webkit-text-size-adjust: auto; }`),
    ).toHaveLength(1);
  });
});
