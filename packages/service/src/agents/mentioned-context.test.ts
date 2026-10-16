import assert from "node:assert/strict";
import {
  lineParts,
  MENTIONED_HEADING,
  receivedPartsOf,
} from "@luke/database/models/attached-file-parts";
import { COALESCED_LINE_SEPARATOR } from "@luke/database/models/message-reads";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import {
  MENTION_KIND,
  type MentionPlace,
  mentionMarkdown,
  sectionAnchors,
} from "@luke/features/mention-link";
import type { Plan } from "@luke/features/plan-wire";
import { test } from "vitest";
import { eveContent, receivedMessage } from "./attached-files.js";
import {
  MENTIONED_BOUNDS,
  type MentionedAgent,
  mentionedContext,
  mentionedServers,
} from "./mentioned-context.js";

/**
 * What a coding agent's message mentions of its plan, handed beside its
 * words as it stood at the send, within its bounds; and the line that
 * carried it matched by eve's receipt of what eve was handed, its words
 * alone read back as the developer's. Synthetic plan.
 */

const PLAN: Plan = {
  id: "7d4f3c2a-1b0e-4f6a-9c8d-2e1f0a9b8c7d",
  workspaceId: "workspace-personal",
  name: "Teammate invitations",
  createdAt: 1_000,
  updatedAt: 1_000,
  repository: "acme/relay",
  document: {
    body: [
      "## Goal",
      "",
      "Any member can invite a teammate by email.",
      "",
      "## Rollout",
      "",
      "Store first, then the desktop.",
    ].join("\n"),
    assumptions: [],
  },
};

const PLACE: MentionPlace = { workspace: "acme", repository: PLAN.repository };

const anchorOf = (heading: string) => sectionAnchors([heading])[0] ?? "";

const section = (heading: string) =>
  mentionMarkdown(
    { kind: MENTION_KIND.SECTION, planId: PLAN.id, anchor: anchorOf(heading) },
    heading,
    PLACE,
  );

test("a section the words mention is handed as it stands, under the part's heading", () => {
  const part = mentionedContext(`Do what ${section("Rollout")} says.`, PLAN);

  assert.equal(
    part,
    `${MENTIONED_HEADING}\n\nThe plan's section "Rollout":\n\n## Rollout\n\nStore first, then the desktop.`,
  );
});

test("the whole plan the words mention is handed as an agent started on it is", () => {
  const part = mentionedContext(
    `Read ${mentionMarkdown({ kind: MENTION_KIND.PLAN, planId: PLAN.id }, PLAN.name, PLACE)} first.`,
    PLAN,
  );

  assert.match(part ?? "", /The whole plan:\n\n# Teammate invitations\n\n## Goal/u);
  assert.match(part ?? "", /Store first, then the desktop\.$/u);
});

test("a section the plan no longer holds is named as gone", () => {
  const part = mentionedContext(`See ${section("Old flow")}.`, PLAN);

  assert.match(part ?? "", /The section "Old flow": no longer in the plan\./u);
});

test("a section mentioned in the form written before the link was settled is handed as one in the settled form is", () => {
  const part = mentionedContext(`Do what [@Rollout](luke://plan/${PLAN.id}#Rollout) says.`, PLAN);

  assert.equal(part, mentionedContext(`Do what ${section("Rollout")} says.`, PLAN));
  assert.match(part ?? "", /The plan's section "Rollout":/u);
});

test("a heading the plan bears twice is handed by which of them the anchor names", () => {
  const plan: Plan = {
    ...PLAN,
    document: { body: "## Notes\n\nfirst\n\n## Notes\n\nsecond", assumptions: [] },
  };
  const second = mentionMarkdown(
    { kind: MENTION_KIND.SECTION, planId: PLAN.id, anchor: "notes-1" },
    "Notes",
    PLACE,
  );

  assert.match(mentionedContext(`See ${second}.`, plan) ?? "", /## Notes\n\nsecond$/u);
});

test("words that mention only files, folders, another plan, or nothing are handed nothing more", () => {
  for (const words of [
    "Fix [@a.ts](luke://file/src/a.ts) and look through [@src/](luke://folder/src/).",
    "Fix [@a.ts](https://github.com/acme/relay/blob/HEAD/src/a.ts) as it stands.",
    `See ${mentionMarkdown({ kind: MENTION_KIND.SECTION, planId: "another-plan", anchor: "goal" }, "Goal", PLACE)}.`,
    "No mention here, only [a link](https://example.com).",
    "`[@Rollout](luke://plan/7d4f3c2a-1b0e-4f6a-9c8d-2e1f0a9b8c7d#Rollout)` is code.",
  ]) {
    assert.equal(mentionedContext(words, PLAN), undefined, words);
  }
});

test("a section mentioned twice is handed once", () => {
  const part = mentionedContext(`${section("Goal")} and again ${section("Goal")}.`, PLAN);

  assert.equal(part?.split('The plan\'s section "Goal"').length, 2);
});

test("a long section is cut on a line, saying how much was left out, and a full part names what it left out", () => {
  const long = Array.from({ length: 400 }, (_, at) => `- step ${at}: ${"x".repeat(20)}`).join("\n");
  const headings = ["One", "Two", "Three", "Four", "Five", "Six", "Seven"];
  const plan: Plan = {
    ...PLAN,
    document: {
      body: headings.map((heading) => `## ${heading}\n\n${long}`).join("\n\n"),
      assumptions: [],
    },
  };

  const part = mentionedContext(headings.map(section).join(" "), plan) ?? "";

  assert.ok(part.length <= MENTIONED_BOUNDS.PART_CHARS, `${part.length} characters`);
  assert.match(part, /… \(\d+ more characters\)/u);
  assert.match(part, /\d+ more mentions? of the plan left out, since this part is full/u);
});

test("a line carrying what it mentioned is matched by eve's receipt of it, and reads back as its words alone", () => {
  const words = `Do what ${section("Rollout")} says.`;
  const mentioned = mentionedContext(words, PLAN);
  const handed = eveContent(words, [], mentioned);
  assert.ok(Array.isArray(handed));
  const receipt = receivedMessage({
    message: words,
    parts: handed.flatMap((part) =>
      part.type === "text" ? [{ type: "text", text: part.text }] : [],
    ),
  });

  const line = receivedPartsOf(lineParts(words, [], mentioned));

  assert.equal(line?.join(COALESCED_LINE_SEPARATOR), receipt.text);
  assert.equal(receipt.words, words);
});

test("words that mention nothing of the plan go to eve as the words alone, as every message did before", () => {
  assert.equal(eveContent("Use the helper.", [], undefined), "Use the helper.");
});

test("however long the headings of what is left out, the part stays inside its bound", () => {
  const long = "x".repeat(3_900);
  const headings = Array.from({ length: 12 }, (_, at) => `${"Heading ".repeat(100)}${at}`);
  const plan: Plan = {
    ...PLAN,
    document: {
      body: headings.map((heading) => `## ${heading}\n\n${long}`).join("\n\n"),
      assumptions: [],
    },
  };

  const part = mentionedContext(headings.map(section).join(" "), plan) ?? "";

  assert.ok(part.length <= MENTIONED_BOUNDS.PART_CHARS, `${part.length} characters`);
});

test("a plan cut short names every section past the cut, one whose heading earlier words quote included", () => {
  const filler = Array.from({ length: 700 }, (_, at) => `- line ${at} of the context`).join("\n");
  const plan: Plan = {
    ...PLAN,
    document: {
      body: `## Context\n\nSee Rollout below.\n\n${filler}\n\n## Rollout\n\nStore first.`,
      assumptions: [],
    },
  };

  const part =
    mentionedContext(
      mentionMarkdown({ kind: MENTION_KIND.PLAN, planId: PLAN.id }, PLAN.name, PLACE),
      plan,
    ) ?? "";

  assert.match(part, /The whole plan, cut short/u);
  assert.match(part, /Its other sections: Rollout\./u);
});

test("a message whose words happen to open as the mentioned part does still reads back as its words", () => {
  const words = `${MENTIONED_HEADING} is how the part opens.`;

  const receipt = receivedMessage({ message: words, parts: [{ type: "text", text: words }] });

  assert.equal(receipt.words, words);
});

test("a section too long for the room left is passed over, and a shorter one after it still goes", () => {
  const plan: Plan = {
    ...PLAN,
    document: {
      body: [
        "## Big",
        "",
        ...Array.from({ length: 6 }, () => "x".repeat(3_900)),
        "## Huge",
        "",
        ...Array.from({ length: 6 }, () => "y".repeat(3_900)),
        "## Small",
        "",
        "Store first.",
      ].join("\n"),
      assumptions: [],
    },
  };
  const many = Array.from({ length: 5 }, (_, at) => `## S${at}\n\n${"z".repeat(3_950)}`).join(
    "\n\n",
  );
  const crowded: Plan = {
    ...plan,
    document: { body: `${many}\n\n${plan.document.body}`, assumptions: [] },
  };
  const words = [
    ...Array.from({ length: 5 }, (_, at) => section(`S${at}`)),
    section("Big"),
    section("Small"),
  ].join(" ");

  const part = mentionedContext(words, crowded) ?? "";

  assert.match(part, /The plan's section "Small"/u);
  assert.match(part, /1 more mention of the plan left out/u);
  assert.ok(part.length <= MENTIONED_BOUNDS.PART_CHARS);
});

test("a cut plan with many long headings past the cut is still handed, its list of them bounded", () => {
  const sections = Array.from(
    { length: 60 },
    (_, at) => `## ${"Long heading ".repeat(70)}${at}\n\n${"w".repeat(400)}`,
  );
  const plan: Plan = { ...PLAN, document: { body: sections.join("\n\n"), assumptions: [] } };

  const part =
    mentionedContext(
      mentionMarkdown({ kind: MENTION_KIND.PLAN, planId: PLAN.id }, PLAN.name, PLACE),
      plan,
    ) ?? "";

  assert.match(part, /The whole plan, cut short/u);
  assert.match(part, /and \d+ more\./u);
  assert.ok(part.length <= MENTIONED_BOUNDS.PART_CHARS, `${part.length} characters`);
});

const LINEAR = mentionMarkdown(
  { kind: MENTION_KIND.SERVER, provider: INTEGRATION_PROVIDER.LINEAR },
  "Linear",
  PLACE,
);

const LIST_ISSUES = mentionMarkdown(
  { kind: MENTION_KIND.TOOL, provider: INTEGRATION_PROVIDER.LINEAR, tool: "list_issues" },
  "Linear · list_issues",
  PLACE,
);

test("a server or a tool the words mention is handed as one note naming its connection, in the order mentioned, each once", () => {
  const part = mentionedContext(
    `Use ${LINEAR} and ${LIST_ISSUES} for ${section("Rollout")}, then ${LINEAR} again.`,
    PLAN,
  );

  const words = part ?? "";
  const server = words.indexOf(
    "The developer pointed you at the Linear MCP server (connection `linear`)",
  );
  const tool = words.indexOf(
    "The developer pointed you at the tool `list_issues` of the Linear MCP server (connection `linear`)",
  );
  const rollout = words.indexOf('The plan\'s section "Rollout":');
  assert.ok(server > 0 && server < tool && tool < rollout, words);
  assert.equal(words.split("The developer pointed you at").length - 1, 2, words);
  assert.match(words, /`connection_search`/u);
});

test("the servers the words mention, by themselves or by a tool, are named each once, and nothing else is", () => {
  assert.deepEqual(
    mentionedServers(`See ${LIST_ISSUES}, ${LINEAR}, and ${section("Rollout")}.`, PLAN.repository),
    [INTEGRATION_PROVIDER.LINEAR],
  );
  assert.deepEqual(mentionedServers(`See ${section("Rollout")}.`, PLAN.repository), []);
});

test("an agent with no plan is handed a server's note, and nothing for a mention of a plan", () => {
  const part = mentionedContext(`Use ${LINEAR} for ${section("Rollout")}.`, undefined) ?? "";

  assert.equal(part.split("The developer pointed you at").length - 1, 1, part);
  assert.ok(!part.includes("The plan's section"), part);
});

const ISSUE_URL = "https://linear.app/acme/issue/LUKE-142/fix-the-thing";

const ISSUE = mentionMarkdown(
  { kind: MENTION_KIND.LINK, provider: INTEGRATION_PROVIDER.LINEAR, url: ISSUE_URL },
  "LUKE-142/fix-the-thing",
  PLACE,
);

test("a page of an integration's the words mention is handed as a note naming its address and its connection, and brings its server in", () => {
  const part = mentionedContext(`Fix ${ISSUE}, then ${ISSUE} again.`, PLAN) ?? "";

  assert.equal(part.split("The developer pointed you at").length - 1, 1, part);
  assert.match(part, /pointed you at https:\/\/linear\.app\/acme\/issue\/LUKE-142\/fix-the-thing/u);
  assert.match(part, /the Linear MCP server \(connection `linear`\)/u);
  assert.deepEqual(mentionedServers(`Fix ${ISSUE}.`, PLAN.repository), [
    INTEGRATION_PROVIDER.LINEAR,
  ]);
});

test("a GitHub page that is a file of the plan's repository brings in no server", () => {
  const file = `[@app.ts](https://github.com/${PLAN.repository}/blob/HEAD/src/app.ts)`;

  assert.deepEqual(mentionedServers(`See ${file}.`, PLAN.repository), []);
});

test("a file's lines the words mention are handed as a note naming the lines and the commit they were read at, and a whole file as nothing", () => {
  const commit = "0123456789abcdef0123456789abcdef01234567";
  const lines = mentionMarkdown(
    { kind: MENTION_KIND.FILE, path: "src/app.ts", lines: { commit, startLine: 12, endLine: 20 } },
    "app.ts:12–20",
    PLACE,
  );
  const whole = mentionMarkdown({ kind: MENTION_KIND.FILE, path: "src/app.ts" }, "app.ts", PLACE);

  const part = mentionedContext(`Fix ${lines}, as ${lines} says.`, PLAN) ?? "";

  assert.equal(part.split("The developer pointed you at").length - 1, 1, part);
  assert.match(
    part,
    /lines 12–20 of `src\/app\.ts` as they stood at commit `0123456789abcdef0123456789abcdef01234567`/u,
  );
  assert.match(part, /git show 0123456789abcdef0123456789abcdef01234567:src\/app\.ts/u);
  assert.equal(mentionedContext(`Fix ${whole}.`, PLAN), undefined);
});

test("a server of an account past its provider's first is pointed at and brought in by its own connection, beside the provider's first", () => {
  const personal = mentionMarkdown(
    { kind: MENTION_KIND.SERVER, provider: INTEGRATION_PROVIDER.NOTION, connection: "notion-2" },
    "Notion · Personal",
    PLACE,
  );
  const acme = mentionMarkdown(
    { kind: MENTION_KIND.SERVER, provider: INTEGRATION_PROVIDER.NOTION },
    "Notion · Acme",
    PLACE,
  );
  const part = mentionedContext(`Move it from ${personal} to ${acme}.`, PLAN) ?? "";

  assert.match(part, /the Notion MCP server \(connection `notion-2`\)/u);
  assert.match(part, /the Notion MCP server \(connection `notion`\)/u);
  assert.deepEqual(mentionedServers(`Move it from ${personal} to ${acme}.`, PLAN.repository), [
    "notion-2",
    INTEGRATION_PROVIDER.NOTION,
  ]);
});

const PAGE_ID = "3b9a0c1d-2e4f-4a6b-8c0d-1e2f3a4b5c6d";

const OTHER_AGENT_ID = "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b";

const PAGE_HTML = "<!doctype html>\n<h1>Invites by week</h1>\n<p>Code: ```x```</p>";

const page = (name: string, pageId = PAGE_ID) =>
  mentionMarkdown({ kind: MENTION_KIND.PAGE, planId: PLAN.id, pageId }, name, PLACE);

const agent = (name: string, agentId = OTHER_AGENT_ID, planId = PLAN.id) =>
  mentionMarkdown({ kind: MENTION_KIND.AGENT, planId, agentId }, name, PLACE);

const OTHER_AGENT: MentionedAgent = {
  id: OTHER_AGENT_ID,
  name: "Store the invitations",
  repository: "acme/relay",
  branch: "luke/store-invitations",
  pullRequest: { number: 42, url: "https://github.com/acme/relay/pull/42" },
  archived: false,
};

const READS = {
  pages: new Map([
    [PAGE_ID, { id: PAGE_ID, title: "Invites by week", version: 3, at: 1_000, html: PAGE_HTML }],
  ]),
  agents: new Map([[OTHER_AGENT_ID, OTHER_AGENT]]),
};

test("a page of the plan the words mention is handed by its id and version, with its HTML as it stands in a fence its own backticks cannot close, of tildes", () => {
  const part = mentionedContext(`Build what ${page("Invites by week")} shows.`, PLAN, READS);

  assert.equal(
    part,
    `${MENTIONED_HEADING}\n\nThe developer pointed you at the page "Invites by week" (id \`${PAGE_ID}\`, version 3) shown on this task. To change it, show it again with \`show_page\` and \`page: "${PAGE_ID}"\`, which writes its next version in its place. Its HTML as it stands:\n\n~~~html\n${PAGE_HTML}\n~~~`,
  );
});

test("another agent of the plan the words mention is handed by its id and where its work stands on GitHub, and never its conversation", () => {
  const part = mentionedContext(`Build on ${agent("Store")}.`, PLAN, READS) ?? "";

  assert.match(
    part,
    /another coding agent on this task, "Store the invitations" \(id `9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b`\) working in `acme\/relay` on the branch `luke\/store-invitations`, whose pull request is #42 \(https:\/\/github\.com\/acme\/relay\/pull\/42\)\./u,
  );
  assert.match(part, /`gh pr diff 42`/u);
  assert.match(part, /Its conversation is not yours to read\./u);
});

test("an agent of the plan that published nothing yet is handed its branch to fetch, and one with no branch as having nothing to read", () => {
  const pushed = { ...OTHER_AGENT, pullRequest: null };
  const fresh = { ...OTHER_AGENT, branch: null, pullRequest: null };
  const read = (standing: MentionedAgent) =>
    mentionedContext(`See ${agent("Store")}.`, PLAN, {
      pages: new Map(),
      agents: new Map([[OTHER_AGENT_ID, standing]]),
    }) ?? "";

  assert.match(
    read(pushed),
    /`git fetch origin luke\/store-invitations` and `git diff HEAD\.\.\.FETCH_HEAD`/u,
  );
  assert.match(read(fresh), /It has pushed no work yet, so there is none of its to read\./u);
});

test("a page or an agent the send did not find on the plan is named as gone, and one of another plan is handed nothing", () => {
  const gone = mentionedContext(
    `See ${page("Old chart", "5f5f5f5f-0000-4000-8000-000000000000")} and ${agent("Old", "6a6a6a6a-0000-4000-8000-000000000000")}.`,
    PLAN,
    READS,
  );
  const elsewhere = mentionedContext(
    `See ${agent("Store", OTHER_AGENT_ID, "1c1c1c1c-0000-4000-8000-000000000000")}.`,
    PLAN,
    READS,
  );

  assert.equal(
    gone,
    `${MENTIONED_HEADING}\n\nThe page "Old chart": no longer on this task.\n\nThe coding agent "Old": no longer on this task.`,
  );
  assert.equal(elsewhere, undefined);
});

test("a long page is cut on a line to its bound, saying how much was left out", () => {
  const long = Array.from({ length: 2_000 }, (_, at) => `<p>row ${at}</p>`).join("\n");
  const part =
    mentionedContext(`See ${page("Rows")}.`, PLAN, {
      pages: new Map([[PAGE_ID, { id: PAGE_ID, title: "Rows", version: 1, at: 0, html: long }]]),
      agents: new Map(),
    }) ?? "";

  assert.ok(part.length <= MENTIONED_BOUNDS.PART_CHARS, String(part.length));
  assert.match(part, /\n… \(\d+ more characters\)\n```$/u);
});

test("a page whose HTML holds a long run of backticks is still handed, its fence and HTML inside the page's bound", () => {
  const ticks = "`".repeat(11_000);
  const part =
    mentionedContext(`See ${page("Ticks")}.`, PLAN, {
      pages: new Map([
        [PAGE_ID, { id: PAGE_ID, title: "Ticks", version: 1, at: 0, html: `<pre>${ticks}</pre>` }],
      ]),
      agents: new Map(),
    }) ?? "";

  assert.match(part, /the page "Ticks"/u);
  assert.match(part, /\n~~~html\n<pre>`+<\/pre>\n~~~$/u);
  assert.ok(part.length <= MENTIONED_BOUNDS.PART_CHARS, String(part.length));
});

test("a page whose cut-off end holds long runs of both fence characters still hands its kept beginning in a short fence", () => {
  const html = `<h1>Chart</h1>\n${"`".repeat(6_000)}${"~".repeat(6_000)}`;
  const part =
    mentionedContext(`See ${page("Chart")}.`, PLAN, {
      pages: new Map([[PAGE_ID, { id: PAGE_ID, title: "Chart", version: 1, at: 0, html }]]),
      agents: new Map(),
    }) ?? "";

  assert.match(part, /\n```html\n<h1>Chart<\/h1>\n… \(\d+ more characters\)\n```$/u);
});
