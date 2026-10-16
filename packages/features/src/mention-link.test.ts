import assert from "node:assert/strict";
import { test } from "vitest";
import { INTEGRATION_PROVIDER } from "./integration-wire.js";
import {
  decodeMention,
  encodeMention,
  isMentionableTool,
  isMentionLabel,
  linkLabels,
  linkMention,
  MENTION_KIND,
  type Mention,
  type MentionPlace,
  mayNameMention,
  mentionLinksIn,
  mentionMarkdown,
  mentionName,
  mentionsIn,
  pastedLinkMention,
  sectionAnchors,
} from "./mention-link.js";

const TASK_ID = "3f6c1b2a-8d4e-4f10-9a7b-5c2d1e0fa21b";
const REPOSITORY = "acme/checkout";
const PLACE: MentionPlace = { workspace: "acme", repository: REPOSITORY };

/** Whether a target names no file or folder of a plan about `repository`: nothing, or a page of GitHub's own. */
function namesNoFile(target: string, repository: string | null): boolean {
  const kind = decodeMention(target, repository)?.kind;
  return kind !== MENTION_KIND.FILE && kind !== MENTION_KIND.FOLDER;
}
const TASK: Mention = { kind: MENTION_KIND.TASK, taskId: TASK_ID };
const ROLLOUT: Mention = { kind: MENTION_KIND.SECTION, taskId: TASK_ID, anchor: "rollout" };

test("a plan and its section are written as their address on tryluke.dev, under the plan's workspace", () => {
  assert.equal(encodeMention(TASK, PLACE), `https://tryluke.dev/acme/plan/${TASK_ID}`);
  assert.equal(encodeMention(ROLLOUT, PLACE), `https://tryluke.dev/acme/plan/${TASK_ID}#rollout`);
  assert.deepEqual(decodeMention(encodeMention(TASK, PLACE), null), TASK);
  assert.deepEqual(decodeMention(encodeMention(ROLLOUT, PLACE), null), ROLLOUT);
});

test("a plan's address is found by its id alone, whatever workspace it is spelled under, and by the app's own scheme", () => {
  for (const target of [
    `https://tryluke.dev/acme/plan/${TASK_ID}#rollout`,
    `https://tryluke.dev/personal-u_1/plan/${TASK_ID}#rollout`,
    `https://tryluke.dev/acme/plan/${TASK_ID}?from=slack#Rollout`,
    `tryluke://tryluke.dev/acme/plan/${TASK_ID}#rollout`,
  ]) {
    assert.deepEqual(decodeMention(target, null), ROLLOUT, target);
  }
});

test("every form written before the link was settled reads as the mention the settled form names", () => {
  assert.deepEqual(decodeMention(`luke://plan/${TASK_ID}`, null), TASK);
  assert.deepEqual(decodeMention(`luke://plan/${TASK_ID}#Rollout`, null), ROLLOUT);
  assert.deepEqual(decodeMention(`luke://plan/pl_1#Auth%20token%20refresh`, null), {
    kind: MENTION_KIND.SECTION,
    taskId: "pl_1",
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
    const section: Mention = { kind: MENTION_KIND.SECTION, taskId: TASK_ID, anchor };
    assert.deepEqual(decodeMention(encodeMention(section, PLACE), null), section);
  }
  assert.equal(anchors[1]?.endsWith("-1"), true);
});

test("a section's anchor keeps every character it is spelled in through its target, which never closes the link", () => {
  for (const heading of ["Größe & Ölçü — 次の手順", "a) b (c", "語".repeat(1_000)]) {
    const [anchor = ""] = sectionAnchors([heading]);
    const section: Mention = { kind: MENTION_KIND.SECTION, taskId: TASK_ID, anchor };
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
    assert.ok(namesNoFile(target, REPOSITORY), target);
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
    assert.ok(namesNoFile(target, null), target);
    assert.ok(namesNoFile(target, "acme/other"), target);
  }
  for (const target of [
    "https://github.com/acme/checkout/pull/12",
    "https://github.com/acme/checkout",
    "https://github.com/acme/checkout/tree/HEAD",
    "https://github.com/acme/checkout/blob/HEAD/",
  ]) {
    assert.ok(namesNoFile(target, REPOSITORY), target);
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
    "https://example.com/luke/issue/LUKE-142",
    "https://tryluke.dev/changelog",
    `https://tryluke.dev//plan/${TASK_ID}`,
    `https://tryluke.dev/acme/plan/${TASK_ID}/more`,
    `https://tryluke.dev.evil.example/acme/plan/${TASK_ID}`,
    `http://tryluke.dev/acme/plan/${TASK_ID}`,
    `https://tryluke.dev/acme/plan/${TASK_ID}#a%20b`,
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

  assert.equal(written, `[@Rollout \\[draft\\]](https://tryluke.dev/acme/plan/${TASK_ID}#rollout)`);
});

test("only a label that starts with @ and says more is a mention's, which its chip names without the @", () => {
  assert.equal(isMentionLabel("@Rollout"), true);
  assert.equal(isMentionLabel("Rollout"), false);
  assert.equal(isMentionLabel("@"), false);
  assert.equal(mentionName("@Rollout"), "Rollout");
});

test("any link whose target names a mention is one, whatever its label says, named by its label without its @", () => {
  const lines = `https://github.com/${REPOSITORY}/blob/0a1b2c3d/apps/web/store.ts#L3-L5`;
  const read = (label: string, target: string) => {
    const found = linkMention(label, target, REPOSITORY);
    return found === undefined ? undefined : [found.mention.kind, found.name];
  };

  assert.deepEqual(read("@Rollout", encodeMention(ROLLOUT, PLACE)), [
    MENTION_KIND.SECTION,
    "Rollout",
  ]);
  assert.deepEqual(read("the rollout", encodeMention(ROLLOUT, PLACE)), [
    MENTION_KIND.SECTION,
    "the rollout",
  ]);
  assert.deepEqual(read("the store", lines), [MENTION_KIND.FILE, "the store"]);
  assert.deepEqual(read("LUKE-142", "https://linear.app/acme/issue/LUKE-142/fix"), [
    MENTION_KIND.LINK,
    "LUKE-142",
  ]);
  assert.equal(read("the docs", "https://example.com/docs"), undefined);
  assert.equal(read("@the docs", "https://example.com/docs"), undefined);
});

test("a bare address is named by what it says of the thing: a file's name and lines, a section's anchor, a page's last steps", () => {
  const named = (address: string) => linkMention(address, address, REPOSITORY)?.name;

  assert.equal(
    named(`https://github.com/${REPOSITORY}/blob/0a1b2c3d/apps/web/store.ts#L3-L5`),
    "store.ts:3–5",
  );
  assert.equal(
    named(`https://github.com/${REPOSITORY}/blob/0a1b2c3d/apps/web/store.ts#L7`),
    "store.ts:7",
  );
  assert.equal(named(`https://github.com/${REPOSITORY}/tree/HEAD/apps/web/`), "web");
  assert.equal(named(encodeMention(ROLLOUT, PLACE)), "rollout");
  assert.equal(named(encodeMention(TASK, PLACE)), "Plan");
  assert.equal(
    named("https://linear.app/acme/issue/LUKE-142/fix-the-thing"),
    "LUKE-142/fix-the-thing",
  );
  assert.equal(named("https://github.com/acme/relay/pull/123"), "relay/pull/123");
});

test("a label that spells another address than its target is the author's words, kept as its name", () => {
  const issue = "https://linear.app/acme/issue/LUKE-142/fix-the-thing";

  assert.equal(
    linkMention("https://example.com/notes", issue, REPOSITORY)?.name,
    "https://example.com/notes",
  );
  assert.equal(linkMention(issue, issue, REPOSITORY)?.name, "LUKE-142/fix-the-thing");
});

test("a target may name a mention when it names one with no repository, or is any page of GitHub's, however long", () => {
  const long = `https://github.com/${REPOSITORY}/blob/HEAD/${"%C3%A9".repeat(400)}.ts`;

  assert.ok(long.length > 2_000);
  assert.equal(mayNameMention(long), true);
  assert.equal(decodeMention(long, REPOSITORY)?.kind, MENTION_KIND.FILE);
  assert.equal(mayNameMention(encodeMention(ROLLOUT, PLACE)), true);
  assert.equal(mayNameMention("https://linear.app/acme/issue/LUKE-142"), true);
  assert.equal(mayNameMention("https://example.com/docs"), false);
});

test("a step back at a path's root is taken by the address itself, and stays inside the repository", () => {
  assert.deepEqual(decodeMention("luke://file/%2E%2E/secrets.txt", null), {
    kind: MENTION_KIND.FILE,
    path: "secrets.txt",
  });
  assert.ok(
    namesNoFile("https://github.com/acme/checkout/blob/HEAD/%2E%2E/secrets.txt", REPOSITORY),
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
    "and `[@code](luke://file/a.ts)`, but not [plain](https://example.com)",
    "or the picture ![@Rollout mock](https://tryluke.dev/acme/plan/x/files/y), even after a",
    "written backslash \\\\![@Flow](https://tryluke.dev/acme/plan/x/files/z), while an escaped",
    "\\![@Escaped](https://linear.app/b) is a link.",
  ].join("\n");

  assert.deepEqual(
    mentionLinksIn(words).map(({ label, target }) => ({ label, target })),
    [
      { label: "@Rollout", target: "https://tryluke.dev/acme/plan/x#rollout" },
      { label: "@Linear", target: "https://linear.app/a" },
      { label: "@Escaped", target: "https://linear.app/b" },
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
        mention: { kind: MENTION_KIND.SECTION, taskId: "pl_1", anchor: "rollout" },
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

test("an MCP server and one of its tools read back as the mention they were written from", () => {
  for (const mention of [
    { kind: MENTION_KIND.SERVER, provider: INTEGRATION_PROVIDER.LINEAR },
    { kind: MENTION_KIND.TOOL, provider: INTEGRATION_PROVIDER.LINEAR, tool: "list_issues" },
  ] as const) {
    assert.deepEqual(
      decodeMention(encodeMention(mention, PLACE), REPOSITORY),
      mention,
      mention.kind,
    );
  }
  assert.equal(
    encodeMention(
      {
        kind: MENTION_KIND.TOOL,
        provider: INTEGRATION_PROVIDER.SENTRY,
        tool: "get_issue",
      },
      PLACE,
    ),
    "luke://mcp/sentry/get_issue",
  );
});

test("a server no integration offers, a tool no server could list, or a step past the tool names nothing", () => {
  for (const target of [
    "luke://mcp/jira",
    "luke://mcp/",
    "luke://mcp/linear/list issues",
    "luke://mcp/linear/list%2Fissues",
    "luke://mcp/linear/list_issues/more",
    "luke://mcp/linear#list_issues",
  ]) {
    assert.equal(decodeMention(target, REPOSITORY), undefined, target);
  }
});

test("a tool named by a step an address resolves away is no tool a mention can carry", () => {
  for (const tool of [".", ".."]) {
    assert.equal(isMentionableTool(tool), false, tool);
    assert.equal(
      decodeMention(
        encodeMention(
          { kind: MENTION_KIND.TOOL, provider: INTEGRATION_PROVIDER.LINEAR, tool },
          PLACE,
        ),
        REPOSITORY,
      ),
      undefined,
      tool,
    );
  }
});

test("a page on an integration's host, its own or one under it, reads as that integration's link, and any other page as no mention", () => {
  assert.deepEqual(
    decodeMention("https://linear.app/acme/issue/LUKE-142/fix-the-thing", REPOSITORY),
    {
      kind: MENTION_KIND.LINK,
      provider: INTEGRATION_PROVIDER.LINEAR,
      url: "https://linear.app/acme/issue/LUKE-142/fix-the-thing",
    },
  );
  assert.equal(
    decodeMention("https://acme.sentry.io/issues/12345/", REPOSITORY)?.kind,
    MENTION_KIND.LINK,
  );
  for (const target of [
    "https://example.com/linear.app/issue",
    "https://notlinear.app/acme",
    "ftp://github.com/acme/relay",
  ]) {
    assert.equal(decodeMention(target, REPOSITORY), undefined, target);
  }
});

test("a page's address stays one markdown link's however many parentheses it keeps", () => {
  const mention = decodeMention("https://www.notion.so/acme/Plan-(draft)-1a2b3c", REPOSITORY);
  assert.ok(mention !== undefined);
  const markdown = mentionMarkdown(mention, "Plan (draft)", PLACE);

  assert.deepEqual(
    mentionsIn(`See ${markdown}.`, REPOSITORY).map((each) => each.mention),
    [mention],
  );
});

test("words pasted whole that are one integration's page become its mention, named by the last steps of its address", () => {
  const named = (words: string) => pastedLinkMention(words, REPOSITORY)?.name;

  assert.equal(
    named(" https://linear.app/acme/issue/LUKE-142/fix-the-thing\n"),
    "LUKE-142/fix-the-thing",
  );
  assert.equal(named("https://github.com/acme/relay/pull/123"), "relay/pull/123");
  assert.equal(named("https://acme.sentry.io/issues/12345/"), "issues/12345");
  assert.equal(named("https://linear.app"), "linear.app");
  assert.equal(named("see https://linear.app/acme"), undefined);
  assert.equal(named("https://example.com/a/b"), undefined);
});

test("a page's address keeps no user, password, or query parameter that may carry a credential, and the rest of its query", () => {
  const mention = decodeMention(
    "https://bot:hunter2@acme.slack.com/archives/C04/p1760?thread_ts=1760.1&token=xoxp-1&cid=C04",
    REPOSITORY,
  );

  assert.equal(
    mention?.kind === MENTION_KIND.LINK ? mention.url : undefined,
    "https://acme.slack.com/archives/C04/p1760?thread_ts=1760.1&cid=C04",
  );
});

test("a page's name stays one line whatever its address encodes, so its link is still read as a mention", () => {
  const pasted = pastedLinkMention("https://linear.app/acme/issue/Fix%0ANow", REPOSITORY);
  assert.ok(pasted !== undefined);

  assert.equal(pasted.name, "acme/issue/Fix Now");
  assert.deepEqual(
    mentionsIn(`See ${mentionMarkdown(pasted.mention, pasted.name, PLACE)}.`, REPOSITORY).map(
      (each) => each.mention,
    ),
    [pasted.mention],
  );
});

test("a GitHub page that is a file of the plan stays the file's mention, while one on a branch, or of another repository, is GitHub's page", () => {
  assert.equal(
    decodeMention(`https://github.com/${REPOSITORY}/blob/HEAD/src/app.ts`, REPOSITORY)?.kind,
    MENTION_KIND.FILE,
  );
  for (const target of [
    `https://github.com/${REPOSITORY}/blob/main/src/app.ts`,
    "https://github.com/acme/other/pull/12",
  ]) {
    assert.equal(decodeMention(target, REPOSITORY)?.kind, MENTION_KIND.LINK, target);
  }
});

test("a plain place says each link by its name, a mention's without its @, and never its address", () => {
  assert.equal(
    linkLabels(
      `Review [@store.ts](https://github.com/${REPOSITORY}/blob/HEAD/store.ts) and [LUKE-142](https://linear.app/acme/issue/LUKE-142) for [the \\[draft\\]](https://example.com/a)`,
    ),
    "Review store.ts and LUKE-142 for the [draft]",
  );
  assert.equal(
    linkLabels("See https://linear.app/acme/issue/LUKE-9"),
    "See https://linear.app/acme/issue/LUKE-9",
  );
});

test("a plain place reads a link as markdown does: balanced parentheses and a title in its destination, the inner of nested brackets, and a bare address by its chip's name", () => {
  assert.equal(
    linkLabels("Review [Plan](https://www.notion.so/Plan-(draft)) now"),
    "Review Plan now",
  );
  assert.equal(linkLabels('See [the docs](https://example.com/docs "Docs").'), "See the docs.");
  assert.equal(linkLabels("outer [inner](https://example.com/b) end"), "outer inner end");
  assert.equal(
    linkLabels("[https://linear.app/acme/issue/LUKE-9](https://linear.app/acme/issue/LUKE-9)"),
    "acme/issue/LUKE-9",
  );
  assert.equal(linkLabels("Ask [@alice](https://example.com/profile)"), "Ask @alice");
  assert.equal(linkLabels("[a](b c d) and [x]"), "[a](b c d) and [x]");
  assert.equal(linkLabels("See [Docs](<https://example.com/the docs>) now"), "See Docs now");
  assert.equal(linkLabels('See [Docs](<https://example.com/a b> "Title")'), "See Docs");
  assert.equal(
    linkLabels("See [Docs](<https://example.com/a b) now"),
    "See [Docs](<https://example.com/a b) now",
  );
  assert.equal(
    linkLabels("See [Docs](<https://example.com/a b) and [B](https://example.com/b)"),
    "See [Docs](<https://example.com/a b) and B",
  );
  assert.equal(
    linkLabels("See [Docs](<https://example.com/a\\\nb>)"),
    "See [Docs](<https://example.com/a\\\nb>)",
  );
  assert.equal(
    linkLabels("See [Docs](<https://example.com/a\rb>)"),
    "See [Docs](<https://example.com/a\rb>)",
  );
  assert.equal(
    linkLabels('[See](https://example.com/( "note")'),
    '[See](https://example.com/( "note")',
  );
  assert.equal(linkLabels(`[Report](https://example.com/${"a".repeat(3_000)})`), "Report");
  assert.equal(linkLabels(`[Report](https://example.com/${"a".repeat(3_000)} "Notes")`), "Report");
});

test("a server or tool of an account past a provider's first names it by its connection, and the provider's own name still names the first", () => {
  const personal = {
    kind: MENTION_KIND.TOOL,
    provider: INTEGRATION_PROVIDER.NOTION,
    connection: "notion-2",
    tool: "notion-search",
  } as const;
  assert.equal(encodeMention(personal, PLACE), "luke://mcp/notion-2/notion-search");
  assert.deepEqual(decodeMention("luke://mcp/notion-2/notion-search", REPOSITORY), personal);
  assert.deepEqual(decodeMention("luke://mcp/notion-2", REPOSITORY), {
    kind: MENTION_KIND.SERVER,
    provider: INTEGRATION_PROVIDER.NOTION,
    connection: "notion-2",
  });
  assert.deepEqual(decodeMention("luke://mcp/notion", REPOSITORY), {
    kind: MENTION_KIND.SERVER,
    provider: INTEGRATION_PROVIDER.NOTION,
  });
  for (const target of ["luke://mcp/notion-1", "luke://mcp/jira-2", "luke://mcp/notion-02"]) {
    assert.equal(decodeMention(target, REPOSITORY), undefined, target);
  }
});

test("a page or an agent of a plan is its Luke link, read back by the app's scheme too, a bare one named by its kind, and a step or a fragment past its id names nothing", () => {
  const page: Mention = { kind: MENTION_KIND.PAGE, taskId: TASK_ID, pageId: "page-1" };
  const agent: Mention = { kind: MENTION_KIND.AGENT, taskId: TASK_ID, agentId: "agent-1" };
  const plan = `https://tryluke.dev/acme/plan/${TASK_ID}`;

  assert.equal(encodeMention(page, PLACE), `${plan}/page/page-1`);
  assert.equal(encodeMention(agent, PLACE), `${plan}/agent/agent-1`);
  assert.deepEqual(
    decodeMention(`tryluke://tryluke.dev/acme/plan/${TASK_ID}/agent/agent-1`, null),
    agent,
  );
  assert.deepEqual(linkMention(`${plan}/page/page-1`, `${plan}/page/page-1`, null), {
    mention: page,
    name: "Page",
  });
  assert.deepEqual(linkMention("", `${plan}/agent/agent-1`, null)?.name, "Agent");
  for (const target of [
    `${plan}/page/page-1/version/2`,
    `${plan}/agent/agent-1/changes`,
    `${plan}/page/page-1#top`,
    `${plan}/page/`,
    `${plan}/version/2`,
    `${plan}/agent/agent%2F1`,
  ]) {
    assert.equal(decodeMention(target, null), undefined, target);
  }
});

test("an agent on no task is mentioned by its own Luke link under the workspace, read back by either scheme, and a page on no task names nothing", () => {
  const agent: Mention = { kind: MENTION_KIND.AGENT, agentId: "agent-9" };

  assert.equal(encodeMention(agent, PLACE), "https://tryluke.dev/acme/agent/agent-9");
  assert.deepEqual(decodeMention("https://tryluke.dev/acme/agent/agent-9", null), agent);
  assert.deepEqual(decodeMention("tryluke://tryluke.dev/acme/agent/agent-9", null), agent);
  assert.deepEqual(linkMention("", "https://tryluke.dev/acme/agent/agent-9", null), {
    mention: agent,
    name: "Agent",
  });
  for (const target of [
    "https://tryluke.dev/acme/agent/agent-9/inbox/item-1",
    "https://tryluke.dev/acme/agent/agent-9#top",
    "https://tryluke.dev/acme/agent/",
    "https://tryluke.dev/acme/page/page-1",
  ]) {
    assert.equal(decodeMention(target, null), undefined, target);
  }
});
