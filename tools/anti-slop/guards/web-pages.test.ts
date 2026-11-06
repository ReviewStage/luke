import { describe, expect, it } from "vitest";

import {
  cardProblems,
  framedPageProblems,
  headProblems,
  textSizeProblems,
  themeImportProblems,
  unfurlProblems,
} from "./web-pages.ts";

const ICONS =
  '<link rel="icon" href="/favicon.ico" /><link rel="icon" href="/favicon.svg" /><link rel="apple-touch-icon" href="/apple-touch-icon.png" />';

describe("the site's pages", () => {
  it("name a page whose head misses an icon or the theme color", () => {
    expect(
      headProblems("ok.html", `<head>${ICONS}<meta name="theme-color" content="#ffffff" /></head>`),
    ).toEqual([]);
    expect(
      headProblems("bare.html", '<head><link rel="icon" href="/favicon.svg" /></head>'),
    ).toHaveLength(2);
  });

  it("name a pasted link's card that leaves Vespin's name or the landing page's image", () => {
    const landing = '<meta property="og:image" content="/card.png" />';
    const app = [
      '<meta property="og:title" content="Vespin" />',
      '<meta name="twitter:title" content="Vespin" />',
      '<meta property="og:site_name" content="Vespin" />',
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

  const CARD = [
    '<meta property="og:title" content="Vespin: An inbox" />',
    '<meta property="og:description" content="For agents." />',
    '<meta property="og:image" content="/card.png" />',
    '<meta property="og:image:alt" content="The logo." />',
    '<meta name="twitter:card" content="summary_large_image" />',
    '<meta name="twitter:title" content="Vespin: An inbox" />',
    '<meta name="twitter:description" content="For agents." />',
    '<meta name="twitter:image" content="/card.png" />',
    '<meta name="twitter:image:alt" content="The logo." />',
  ].join("\n");

  it("name a card that draws no image, or tells X something else", () => {
    expect(cardProblems("ok.html", CARD)).toEqual([]);
    expect(
      cardProblems("twin.html", CARD.replace(/<meta name="twitter:image" [^>]*>/u, "")),
    ).toEqual(["twin.html: twitter:image is missing, not its og:image"]);
    expect(
      cardProblems("bare.html", CARD.replaceAll(/<meta \S+="\S+:image" [^>]*>/gu, "")),
    ).toEqual(["bare.html: carries no og:image"]);
    expect(
      cardProblems("empty.html", CARD.replaceAll('content="/card.png"', 'content=""')),
    ).toEqual(["empty.html: carries no og:image"]);
  });

  it("name a card whose title opens lowercase once iMessage drops the site's name", () => {
    expect(cardProblems("lower.html", CARD.replaceAll("An inbox", "an inbox"))).toEqual([
      'lower.html: og:title reads "an inbox" once iMessage drops the site\'s name',
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

  it("name a Tailwind entry that compiles the utilities without @repo/ui's theme after them", () => {
    const entry = '@import "tailwindcss";\n@import "@repo/ui/tailwind/sources.css";\n';
    expect(
      themeImportProblems("app.css", `${entry}@import "@repo/ui/tailwind/theme.css";`),
    ).toEqual([]);
    expect(themeImportProblems("app.css", entry)).toEqual([
      'app.css: compiles Tailwind\'s utilities without importing "@repo/ui/tailwind/theme.css" after them',
    ]);
    expect(
      themeImportProblems("app.css", `${entry}/* @import "@repo/ui/tailwind/theme.css"; */`),
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
