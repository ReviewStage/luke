import assert from "node:assert/strict";
import { test } from "vitest";
import {
  decodeMention,
  encodeMention,
  isMentionLabel,
  MENTION_KIND,
  type Mention,
  mentionMarkdown,
  mentionName,
  mentionsIn,
} from "./mention-link.js";

const PLAN: Mention = { kind: MENTION_KIND.PLAN, planId: "pl_7Hq2Xc" };

test("a plan and a section read back as the mention they were written from", () => {
  const section: Mention = { kind: MENTION_KIND.SECTION, planId: "pl_7Hq2Xc", heading: "Rollout" };

  assert.deepEqual(decodeMention(encodeMention(PLAN)), PLAN);
  assert.deepEqual(decodeMention(encodeMention(section)), section);
});

test("a heading keeps every character it is spelled in through its target", () => {
  for (const heading of [
    "Auth token refresh",
    "Step #2: (re)try once!",
    "Größe & Ölçü — 次の手順",
    "100% done, then *ship*",
    "a/b?c=d",
  ]) {
    const section: Mention = { kind: MENTION_KIND.SECTION, planId: "pl_1", heading };

    assert.deepEqual(decodeMention(encodeMention(section)), section, heading);
  }
});

test("a section's target never closes the markdown link it is written in", () => {
  const target = encodeMention({ kind: MENTION_KIND.SECTION, planId: "pl_1", heading: "a) b (c" });

  assert.equal(/[\s()]/u.test(target), false);
});

test("a link that names no mention reads as none", () => {
  for (const target of [
    "https://linear.app/luke/issue/LUKE-142",
    "luke://page/pg_1",
    "luke://plan/",
    "luke://plan/pl_1#%E0%A4%A",
    "not a link",
    `luke://plan/pl_1#${"x".repeat(5_000)}`,
  ]) {
    assert.equal(decodeMention(target), undefined, target);
  }
});

test("a mention is written as a link whose label starts with @, its brackets escaped", () => {
  const written = mentionMarkdown(
    { kind: MENTION_KIND.SECTION, planId: "pl_1", heading: "Rollout" },
    "Rollout [draft]",
  );

  assert.equal(written, "[@Rollout \\[draft\\]](luke://plan/pl_1#Rollout)");
});

test("only a label that starts with @ and says more is a mention's, which its chip names without the @", () => {
  assert.equal(isMentionLabel("@Rollout"), true);
  assert.equal(isMentionLabel("Rollout"), false);
  assert.equal(isMentionLabel("@"), false);
  assert.equal(mentionName("@Rollout"), "Rollout");
});

test("a heading at its bound in the widest characters still reads back from its target", () => {
  const section: Mention = {
    kind: MENTION_KIND.SECTION,
    planId: "pl_1",
    heading: "語".repeat(1_000),
  };

  assert.deepEqual(decodeMention(encodeMention(section)), section);
});

test("a file and a folder read back as the paths they were written from", () => {
  for (const mention of [
    { kind: MENTION_KIND.FILE, path: "apps/web/server/hosted/session-store.ts" },
    { kind: MENTION_KIND.FILE, path: "docs/A plan (draft)#2.md" },
    { kind: MENTION_KIND.FOLDER, path: "apps/web/server/auth" },
  ] as const) {
    assert.deepEqual(decodeMention(encodeMention(mention)), mention, mention.path);
  }
});

test("a step back at a path's root is taken by the address itself, and stays inside the repository", () => {
  assert.deepEqual(decodeMention("luke://file/%2E%2E/secrets.txt"), {
    kind: MENTION_KIND.FILE,
    path: "secrets.txt",
  });
});

test("a path that climbs out of the repository names nothing", () => {
  for (const target of [
    "luke://file/apps/%2E%2E%2F%2E%2E/etc/passwd",
    "luke://file//etc/passwd",
    "luke://file/apps%5Cweb",
    "luke://file/",
  ]) {
    assert.equal(decodeMention(target), undefined, target);
  }
});

test("the mentions in a message are its @ links outside code, in order, their labels unescaped", () => {
  const words = [
    "Move [@session-store.ts](luke://file/apps/web/session-store.ts) as",
    "[@Rollout \\[draft\\]](luke://plan/pl_1#Rollout) says, not like",
    "`[@inline](luke://file/a.ts)` or [a plain link](https://example.com) or [@nothing](luke://page/1).",
    "```",
    "[@fenced](luke://file/b.ts)",
    "```",
  ].join("\n");

  const found = mentionsIn(words);

  assert.deepEqual(
    found.map(({ label, mention }) => ({ label, mention })),
    [
      {
        label: "@session-store.ts",
        mention: { kind: MENTION_KIND.FILE, path: "apps/web/session-store.ts" },
      },
      {
        label: "@Rollout [draft]",
        mention: { kind: MENTION_KIND.SECTION, planId: "pl_1", heading: "Rollout" },
      },
    ],
  );
  assert.equal(
    words.slice(found[0]?.start, found[0]?.end),
    "[@session-store.ts](luke://file/apps/web/session-store.ts)",
  );
});

test("a message is read for at most twenty mentions", () => {
  const words = Array.from({ length: 25 }, (_, at) => `[@f${at}](luke://file/f${at}.ts)`).join(" ");

  assert.equal(mentionsIn(words).length, 20);
});

test("a fence's line carrying an info string inside the fence closes nothing, so a link after it is still code", () => {
  const words = ["```md", "an example:", "```ts", "[@a](luke://file/a.ts)", "```"].join("\n");

  assert.deepEqual(mentionsIn(words), []);
});

test("a fence closed on a line ending in a carriage return closes, so a mention after it is read", () => {
  const words = ["```", "code", "```", "[@a](luke://file/a.ts)"].join("\r\n");

  assert.deepEqual(
    mentionsIn(words).map(({ mention }) => mention),
    [{ kind: MENTION_KIND.FILE, path: "a.ts" }],
  );
});

test("a path still percent-encoded once its target is read names nothing, so no reader decoding it again can climb out", () => {
  for (const target of ["luke://file/apps%252F..%252F..%252Fetc%252Fpasswd"]) {
    assert.equal(decodeMention(target), undefined, target);
  }
});

test("a link in an indented code block, or in a code span across lines, is code", () => {
  const words = [
    "An example:",
    "",
    "    [@a](luke://file/a.ts)",
    "",
    "and `a span",
    "[@b](luke://file/b.ts) across lines` too.",
    "",
    "- an item",
    "",
    "    [@c](luke://file/c.ts) is the item's own words",
  ].join("\n");

  assert.deepEqual(
    mentionsIn(words).map(({ mention }) => mention),
    [{ kind: MENTION_KIND.FILE, path: "c.ts" }],
  );
});

test("a whole plan is read for every mention it holds, past a message's twenty", () => {
  const words = Array.from({ length: 25 }, (_, at) => `[@f${at}](luke://file/f${at}.ts)`).join(" ");

  assert.equal(mentionsIn(words, Number.POSITIVE_INFINITY).length, 25);
});

test("a name that holds a percent sign is still a file, while an encoded separator still names nothing", () => {
  assert.deepEqual(
    decodeMention(encodeMention({ kind: MENTION_KIND.FILE, path: "docs/report%20final.md" })),
    {
      kind: MENTION_KIND.FILE,
      path: "docs/report%20final.md",
    },
  );
  assert.equal(decodeMention("luke://file/a%252Eb%252F..%252Fc"), undefined);
});

test("a stray backtick before a list pairs with nothing in the list, so the list's mentions stand", () => {
  const words = ["Watch the ` tick.", "- see [@a](luke://file/a.ts)", "- and `this`"].join("\n");

  assert.deepEqual(
    mentionsIn(words).map(({ mention }) => mention),
    [{ kind: MENTION_KIND.FILE, path: "a.ts" }],
  );
});

test("a code span across a quote's lines is code, the quote's lines being one block", () => {
  const words = [
    "> quoted `span",
    "> [@a](luke://file/a.ts) still` code",
    "",
    "[@b](luke://file/b.ts)",
  ].join("\n");

  assert.deepEqual(
    mentionsIn(words).map(({ mention }) => mention),
    [{ kind: MENTION_KIND.FILE, path: "b.ts" }],
  );
});

test("a quote's blank line, or an item inside the quote, ends its paragraph, so a backtick before it pairs with nothing after", () => {
  const paragraphs = ["> `before", ">", "> [@a](luke://file/a.ts) `after"].join("\n");
  const item = ["> `before", "> - [@b](luke://file/b.ts) `after"].join("\n");
  const deeper = ["> `before", "> > [@c](luke://file/c.ts) `after"].join("\n");

  assert.deepEqual(
    [paragraphs, item, deeper].flatMap((words) => mentionsIn(words).map(({ mention }) => mention)),
    [
      { kind: MENTION_KIND.FILE, path: "a.ts" },
      { kind: MENTION_KIND.FILE, path: "b.ts" },
      { kind: MENTION_KIND.FILE, path: "c.ts" },
    ],
  );
});
