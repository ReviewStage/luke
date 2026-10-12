// fidelity.mjs -- SPIKE: each Markdown layer opened on the edge cases and read back, untouched and with one character typed. Beside a scratch `puppeteer-core`; reads /tmp/fid built from src/renderer/spike/libs/fidelity.ts.

import fs from "node:fs";
import puppeteer from "puppeteer-core";

const CASES = {
  bullets: "* one\n* two",
  emphasis: "_em_ and __strong__ words,\nsoft wrapped onto a second line.",
  parenList: "1) first\n2) second",
  escape: "A \\*literal\\* star.",
  tasks: "- [ ] todo\n- [x] done",
  image: "See ![diagram](https://example.com/d.png) here.",
  refLink: "A [link][ref].\n\n[ref]: https://example.com",
  table: "| a | b |\n| - | - |\n| 1 | 2 |",
  autolink: "Visit www.example.com or <https://x.dev>.",
  html: "Press <kbd>Ctrl</kbd> twice.",
  footnote: "Footnote[^1].\n\n[^1]: The note.",
  code: "```ts\nconst x = 1;\n```",
  realistic:
    "Model an invite as a `memberships` row with `state = pending`. Why: removal covers invites and members alike.\n\n- `src/db/schema/memberships.ts`: a `pending` state.\n- `src/members/invite.ts`: new, sending and accepting an invite.",
};
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--allow-file-access-from-files"],
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto("file:///tmp/fid/index.html");
const out = {};
for (const [name, md] of Object.entries(CASES)) {
  out[name] = { input: md };
  for (const lib of ["ours", "oursNoPreserve", "milkdown", "tiptap", "pmMarkdown"]) {
    for (const edit of [false, true]) {
      const r = await page.evaluate(
        async (lib, md, edit) => {
          const host = document.createElement("div");
          document.body.append(host);
          try {
            if (lib === "ours") return window.oursRoundTrip(host, md, edit, true);
            if (lib === "oursNoPreserve") return window.oursRoundTrip(host, md, edit, false);
            if (lib === "milkdown") return await window.milkdownRoundTrip(host, md, edit);
            if (lib === "tiptap") return window.tiptapRoundTrip(host, md, edit);
            return window.pmMarkdownRoundTrip(host, md, edit);
          } catch (e) {
            return `ERROR ${e.message}`;
          } finally {
            host.remove();
          }
        },
        lib,
        md,
        edit,
      );
      out[name][`${lib}${edit ? "+edit" : ""}`] = r.trimEnd();
    }
  }
}
fs.writeFileSync(
  "/home/vercel-sandbox/luke/.context/spike/fidelity.json",
  JSON.stringify(out, null, 2),
);
for (const [name, r] of Object.entries(out)) {
  console.log(`\n### ${name}\ninput: ${JSON.stringify(r.input)}`);
  for (const [k, v] of Object.entries(r))
    if (k !== "input")
      console.log(`  ${k.padEnd(20)} ${v === r.input ? "= (identical)" : JSON.stringify(v)}`);
}
await browser.close();
