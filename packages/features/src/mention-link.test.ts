import assert from "node:assert/strict";
import { test } from "vitest";
import {
  appLinkOf,
  decodeMention,
  encodeMention,
  isMentionLabel,
  MENTION_KIND,
  type Mention,
  type MentionPlace,
  mentionLinksIn,
  mentionMarkdown,
  mentionName,
  mentionsIn,
  sectionAnchors,
} from "./mention-link.js";

const PLAN_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const REPOSITORY = "acme/checkout";
const PLACE: MentionPlace = { workspace: "acme", repository: REPOSITORY };
const PLAN: Mention = { kind: MENTION_KIND.PLAN, planId: PLAN_ID };
const ROLLOUT: Mention = { kind: MENTION_KIND.SECTION, planId: PLAN_ID, anchor: "rollout" };

test("a plan and its section are written as their address on tryluke.dev, under the plan's workspace", () => {
  assert.equal(encodeMention(PLAN, PLACE), `https://tryluke.dev/acme/plan/${PLAN_ID}`);
  assert.equal(encodeMention(ROLLOUT, PLACE), `https://tryluke.dev/acme/plan/${PLAN_ID}#rollout`);
  assert.deepEqual(decodeMention(encodeMention(PLAN, PLACE), null), PLAN);
  assert.deepEqual(decodeMention(encodeMention(ROLLOUT, PLACE), null), ROLLOUT);
});

test("a plan's address is found by its id alone, whatever workspace it is spelled under, and by the app's own scheme", () => {
  for (const target of [
    `https://tryluke.dev/acme/plan/${PLAN_ID}#rollout`,
    `https://tryluke.dev/personal-u_1/plan/${PLAN_ID}#rollout`,
    `https://tryluke.dev/acme/plan/${PLAN_ID}?from=slack#Rollout`,
    `tryluke://tryluke.dev/acme/plan/${PLAN_ID}#rollout`,
  ]) {
    assert.deepEqual(decodeMention(target, null), ROLLOUT, target);
  }
});

test("every form written before the link was settled reads as the mention the settled form names", () => {
  assert.deepEqual(decodeMention(`luke://plan/${PLAN_ID}`, null), PLAN);
  assert.deepEqual(decodeMention(`luke://plan/${PLAN_ID}#Rollout`, null), ROLLOUT);
  assert.deepEqual(decodeMention(`luke://plan/pl_1#Auth%20token%20refresh`, null), {
    kind: MENTION_KIND.SECTION,
    planId: "pl_1",
    anchor: "auth-token-refresh",
  });
  assert.deepEqual(decodeMention("luke://file/apps/web/session-store.ts", REPOSITORY), {
    kind: MENTION_KIND.FILE,
    path: "apps/web/session-store.ts",
  });
  assert.deepEqual(decodeMention("luke://folder/apps/web/auth/", null), {
    kind: MENTION_KIND.FOLDER,
    path: "apps/web/auth",
  });
});

test("a heading's anchor is spelled as GitHub spells a Markdown heading's, a heading borne twice told apart", () => {
  assert.deepEqual(
    sectionAnchors([
      "",
      "Auth token refresh",
      "Step #2: (re)try once!",
      "Größe & Ölçü — 次の手順",
      "snake_case and kebab-case",
      "Rollout",
      "Rollout",
      "Rollout-1",
      "!!!",
    ]),
    [
      "",
      "auth-token-refresh",
      "step-2-retry-once",
      "größe--ölçü--次の手順",
      "snake_case-and-kebab-case",
      "rollout",
      "rollout-1",
      "rollout-1-1",
      "",
    ],
  );
});

test("a heading at its bound, borne twice, still has an anchor that reads back from its target", () => {
  const heading = "語".repeat(1_000);
  const anchors = sectionAnchors([heading, heading]);

  for (const anchor of anchors) {
    const section: Mention = { kind: MENTION_KIND.SECTION, planId: PLAN_ID, anchor };
    assert.deepEqual(decodeMention(encodeMention(section, PLACE), null), section);
  }
  assert.equal(anchors[1]?.endsWith("-1"), true);
});

test("a section's anchor keeps every character it is spelled in through its target, which never closes the link", () => {
  for (const heading of ["Größe & Ölçü — 次の手順", "a) b (c", "語".repeat(1_000)]) {
    const [anchor = ""] = sectionAnchors([heading]);
    const section: Mention = { kind: MENTION_KIND.SECTION, planId: PLAN_ID, anchor };
    const target = encodeMention(section, PLACE);

    assert.deepEqual(decodeMention(target, null), section, heading);
    assert.equal(/[\s()]/u.test(target), false, heading);
  }
});

test("a file and a folder are their pages on GitHub on the default branch, and read back as the paths they were written from", () => {
  const file: Mention = { kind: MENTION_KIND.FILE, path: "docs/A plan (draft)#2.md" };
  const folder: Mention = { kind: MENTION_KIND.FOLDER, path: "apps/web/server/auth" };

  assert.equal(
    encodeMention(file, PLACE),
    "https://github.com/acme/checkout/blob/HEAD/docs/A%20plan%20%28draft%29%232.md",
  );
  assert.equal(
    encodeMention(folder, PLACE),
    "https://github.com/acme/checkout/tree/HEAD/apps/web/server/auth",
  );
  assert.deepEqual(decodeMention(encodeMention(file, PLACE), REPOSITORY), file);
  assert.deepEqual(decodeMention(encodeMention(folder, PLACE), REPOSITORY), folder);
  assert.deepEqual(
    decodeMention("https://github.com/Acme/Checkout/blob/HEAD/src/a.ts", REPOSITORY),
    { kind: MENTION_KIND.FILE, path: "src/a.ts" },
  );
});

test("a branch's page is no file of the plan, since a branch's name may hold a slash", () => {
  for (const target of [
    "https://github.com/acme/checkout/blob/main/src/a.ts",
    "https://github.com/acme/checkout/blob/feature/rollout/src/a.ts",
    "https://github.com/acme/checkout/tree/feature/rollout/src",
  ]) {
    assert.equal(decodeMention(target, REPOSITORY), undefined, target);
  }
});

test("a file's lines are pinned to the commit they were read at, and lines on HEAD read as the file alone", () => {
  const lines: Mention = {
    kind: MENTION_KIND.FILE,
    path: "src/a.ts",
    lines: { commit: "0123456789abcdef0123456789abcdef01234567", startLine: 3, endLine: 5 },
  };
  const line: Mention = {
    kind: MENTION_KIND.FILE,
    path: "src/a.ts",
    lines: { commit: "0123456", startLine: 7, endLine: 7 },
  };

  assert.equal(
    encodeMention(lines, PLACE),
    "https://github.com/acme/checkout/blob/0123456789abcdef0123456789abcdef01234567/src/a.ts#L3-L5",
  );
  assert.equal(
    encodeMention(line, PLACE),
    "https://github.com/acme/checkout/blob/0123456/src/a.ts#L7",
  );
  assert.deepEqual(decodeMention(encodeMention(lines, PLACE), REPOSITORY), lines);
  assert.deepEqual(decodeMention(encodeMention(line, PLACE), REPOSITORY), line);
  assert.deepEqual(
    decodeMention("https://github.com/acme/checkout/blob/HEAD/src/a.ts#L3-L5", REPOSITORY),
    { kind: MENTION_KIND.FILE, path: "src/a.ts" },
  );
  assert.equal(
    decodeMention("https://github.com/acme/checkout/blob/0123456/src/a.ts#L5-L3", REPOSITORY),
    undefined,
  );
});

test("a GitHub page is a file or a folder only of the plan's own repository, and never another page of it", () => {
  for (const target of [
    "https://github.com/acme/checkout/blob/HEAD/src/a.ts",
    "https://github.com/acme/checkout/tree/HEAD/src",
  ]) {
    assert.equal(decodeMention(target, null), undefined, target);
    assert.equal(decodeMention(target, "acme/other"), undefined, target);
  }
  for (const target of [
    "https://github.com/acme/checkout/pull/12",
    "https://github.com/acme/checkout",
    "https://github.com/acme/checkout/tree/HEAD",
    "https://github.com/acme/checkout/blob/HEAD/",
  ]) {
    assert.equal(decodeMention(target, REPOSITORY), undefined, target);
  }
});

test("a file of a plan with no repository is written in the form that names none", () => {
  const place: MentionPlace = { workspace: "acme", repository: null };

  assert.equal(
    encodeMention({ kind: MENTION_KIND.FOLDER, path: "src" }, place),
    "luke://folder/src/",
  );
  assert.equal(encodeMention({ kind: MENTION_KIND.FILE, path: "a.ts" }, place), "luke://file/a.ts");
});

test("a link that names no mention reads as none", () => {
  for (const target of [
    "https://linear.app/luke/issue/LUKE-142",
    "https://tryluke.dev/changelog",
    `https://tryluke.dev//plan/${PLAN_ID}`,
    `https://tryluke.dev/acme/plan/${PLAN_ID}/more`,
    `https://tryluke.dev.evil.example/acme/plan/${PLAN_ID}`,
    `http://tryluke.dev/acme/plan/${PLAN_ID}`,
    `https://tryluke.dev/acme/plan/${PLAN_ID}#a%20b`,
    "luke://page/pg_1",
    "luke://plan/",
    "luke://plan/pl_1#%E0%A4%A",
    "not a link",
    `luke://plan/pl_1#${"x".repeat(5_000)}`,
  ]) {
    assert.equal(decodeMention(target, REPOSITORY), undefined, target);
  }
});

test("a mention is written as a link whose label starts with @, its brackets escaped", () => {
  const written = mentionMarkdown(ROLLOUT, "Rollout [draft]", PLACE);

  assert.equal(written, `[@Rollout \\[draft\\]](https://tryluke.dev/acme/plan/${PLAN_ID}#rollout)`);
});

test("only a label that starts with @ and says more is a mention's, which its chip names without the @", () => {
  assert.equal(isMentionLabel("@Rollout"), true);
  assert.equal(isMentionLabel("Rollout"), false);
  assert.equal(isMentionLabel("@"), false);
  assert.equal(mentionName("@Rollout"), "Rollout");
});

test("a step back at a path's root is taken by the address itself, and stays inside the repository", () => {
  assert.deepEqual(decodeMention("luke://file/%2E%2E/secrets.txt", null), {
    kind: MENTION_KIND.FILE,
    path: "secrets.txt",
  });
  assert.deepEqual(
    decodeMention("https://github.com/acme/checkout/blob/HEAD/%2E%2E/secrets.txt", REPOSITORY),
    undefined,
  );
});

test("a path that climbs out of the repository names nothing", () => {
  for (const target of [
    "luke://file/apps/%2E%2E%2F%2E%2E/etc/passwd",
    "luke://file//etc/passwd",
    "luke://file/apps%5Cweb",
    "luke://file/",
    "https://github.com/acme/checkout/blob/HEAD/apps/%2E%2E%2F%2E%2E/etc/passwd",
    "https://github.com/acme/checkout/blob/HEAD//etc/passwd",
  ]) {
    assert.equal(decodeMention(target, REPOSITORY), undefined, target);
  }
});

test("every @ link outside code is one a writer keeps, whatever its target names", () => {
  const words = [
    "See [@Rollout](https://tryluke.dev/acme/plan/x#rollout), [@Linear](https://linear.app/a)",
    "and `[@code](luke://file/a.ts)`, but not [plain](https://example.com).",
  ].join("\n");

  assert.deepEqual(
    mentionLinksIn(words).map(({ label, target }) => ({ label, target })),
    [
      { label: "@Rollout", target: "https://tryluke.dev/acme/plan/x#rollout" },
      { label: "@Linear", target: "https://linear.app/a" },
    ],
  );
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

  const found = mentionsIn(words, null);

  assert.deepEqual(
    found.map(({ label, mention }) => ({ label, mention })),
    [
      {
        label: "@session-store.ts",
        mention: { kind: MENTION_KIND.FILE, path: "apps/web/session-store.ts" },
      },
      {
        label: "@Rollout [draft]",
        mention: { kind: MENTION_KIND.SECTION, planId: "pl_1", anchor: "rollout" },
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

  assert.equal(mentionsIn(words, null).length, 20);
});

test("a fence's line carrying an info string inside the fence closes nothing, so a link after it is still code", () => {
  const words = ["```md", "an example:", "```ts", "[@a](luke://file/a.ts)", "```"].join("\n");

  assert.deepEqual(mentionsIn(words, null), []);
});

test("a fence closed on a line ending in a carriage return closes, so a mention after it is read", () => {
  const words = ["```", "code", "```", "[@a](luke://file/a.ts)"].join("\r\n");

  assert.deepEqual(
    mentionsIn(words, null).map(({ mention }) => mention),
    [{ kind: MENTION_KIND.FILE, path: "a.ts" }],
  );
});

test("a path still percent-encoded once its target is read names nothing, so no reader decoding it again can climb out", () => {
  for (const target of ["luke://file/apps%252F..%252F..%252Fetc%252Fpasswd"]) {
    assert.equal(decodeMention(target, null), undefined, target);
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
    mentionsIn(words, null).map(({ mention }) => mention),
    [{ kind: MENTION_KIND.FILE, path: "c.ts" }],
  );
});

test("a whole plan is read for every mention it holds, past a message's twenty", () => {
  const words = Array.from({ length: 25 }, (_, at) => `[@f${at}](luke://file/f${at}.ts)`).join(" ");

  assert.equal(mentionsIn(words, null, Number.POSITIVE_INFINITY).length, 25);
});

test("a name that holds a percent sign is still a file, while an encoded separator still names nothing", () => {
  const file: Mention = { kind: MENTION_KIND.FILE, path: "docs/report%20final.md" };

  assert.deepEqual(decodeMention(encodeMention(file, PLACE), REPOSITORY), file);
  assert.equal(decodeMention("luke://file/a%252Eb%252F..%252Fc", null), undefined);
});

test("a stray backtick before a list pairs with nothing in the list, so the list's mentions stand", () => {
  const words = ["Watch the ` tick.", "- see [@a](luke://file/a.ts)", "- and `this`"].join("\n");

  assert.deepEqual(
    mentionsIn(words, null).map(({ mention }) => mention),
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
    mentionsIn(words, null).map(({ mention }) => mention),
    [{ kind: MENTION_KIND.FILE, path: "b.ts" }],
  );
});

test("a quote's blank line, or an item inside the quote, ends its paragraph, so a backtick before it pairs with nothing after", () => {
  const paragraphs = ["> `before", ">", "> [@a](luke://file/a.ts) `after"].join("\n");
  const item = ["> `before", "> - [@b](luke://file/b.ts) `after"].join("\n");
  const deeper = ["> `before", "> > [@c](luke://file/c.ts) `after"].join("\n");

  assert.deepEqual(
    [paragraphs, item, deeper].flatMap((words) =>
      mentionsIn(words, null).map(({ mention }) => mention),
    ),
    [
      { kind: MENTION_KIND.FILE, path: "a.ts" },
      { kind: MENTION_KIND.FILE, path: "b.ts" },
      { kind: MENTION_KIND.FILE, path: "c.ts" },
    ],
  );
});

test("a nested quote is one depth however far apart its markers stand, so a span across its lines is code", () => {
  const words = [
    ">    > `before",
    "> > [@a](luke://file/a.ts) `after",
    "",
    "[@b](luke://file/b.ts)",
  ].join("\n");

  assert.deepEqual(
    mentionsIn(words, null).map(({ mention }) => mention),
    [{ kind: MENTION_KIND.FILE, path: "b.ts" }],
  );
});

test("a plan's address, by either scheme and on any page that reads it, is spelled in the desktop's own scheme, written again from what it names", () => {
  assert.equal(
    appLinkOf(`https://tryluke.dev/acme/plan/${PLAN_ID}?from=slack#Rollout`),
    `tryluke://tryluke.dev/acme/plan/${PLAN_ID}#rollout`,
  );
  assert.equal(
    appLinkOf(`tryluke://tryluke.dev/personal-u_1/plan/${PLAN_ID}`),
    `tryluke://tryluke.dev/personal-u_1/plan/${PLAN_ID}`,
  );
  for (const target of [
    `https://tryluke.dev//plan/${PLAN_ID}`,
    `https://example.com/acme/plan/${PLAN_ID}`,
    `luke://plan/${PLAN_ID}`,
    "https://github.com/acme/checkout/blob/HEAD/src/a.ts",
    `https://tryluke.dev/acme/plan/${PLAN_ID}#a%20b`,
  ]) {
    assert.equal(appLinkOf(target), undefined, target);
  }
});
