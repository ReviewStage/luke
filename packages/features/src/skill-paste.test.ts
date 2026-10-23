import { describe, expect, it } from "vitest";
import { parseSkillPaste } from "./skill-paste.js";

const github = (owner: string, repo: string, rest: object = {}) => ({
  kind: "source",
  host: "github",
  owner,
  repo,
  ...rest,
});

describe("parseSkillPaste reads a skills add command", () => {
  it.each([
    ["npx skills add vercel-labs/agent-skills", github("vercel-labs", "agent-skills")],
    ["skills add vercel-labs/agent-skills", github("vercel-labs", "agent-skills")],
    ["npx -y skills add o/r", github("o", "r")],
    ["npx --yes skills@latest add o/r", github("o", "r")],
    [
      "npx skills@latest add mattpocock/skills --skill=grill-me",
      github("mattpocock", "skills", { skills: ["grill-me"] }),
    ],
    ["pnpx skills add o/r", github("o", "r")],
    ["pnpm dlx skills add o/r", github("o", "r")],
    ["bunx skills add o/r", github("o", "r")],
    ["yarn dlx skills add o/r", github("o", "r")],
    ["npx skills install o/r", github("o", "r")],
    ["$ npx skills add o/r", github("o", "r")],
    ["  \n npx skills add o/r \n\n", github("o", "r")],
    ["npx skills add \\\n  o/r \\\n  --skill a", github("o", "r", { skills: ["a"] })],
    ["npx skills add o/r.git", github("o", "r")],
    ["npx skills add o/r@pdf", github("o", "r", { skills: ["pdf"] })],
    ["npx skills add https://github.com/o/r", github("o", "r")],
    ["npx skills add https://github.com/o/r.git", github("o", "r")],
    ["npx skills add https://www.github.com/o/r/", github("o", "r")],
    ["npx skills add github.com/o/r", github("o", "r")],
    [
      "npx skills add https://github.com/o/r/tree/main/skills/frontend-design",
      github("o", "r", { ref: "main", path: "skills/frontend-design" }),
    ],
    ["npx skills add https://github.com/o/r/tree/v2", github("o", "r", { ref: "v2" })],
    [
      "npx skills add https://github.com/o/r/blob/abc123/skills/x/SKILL.md",
      github("o", "r", { ref: "abc123", path: "skills/x" }),
    ],
    [
      "npx skills add https://skills.sh/vercel-labs/agent-skills/web-design-guidelines",
      github("vercel-labs", "agent-skills", { skills: ["web-design-guidelines"] }),
    ],
    ["npx skills add https://skills.sh/o/r", github("o", "r")],
    ["npx skills add o/r/", github("o", "r")],
    ["npx skills add o/r/skills/foo/", github("o", "r", { path: "skills/foo" })],
    ["npx skills add o/r/skills/foo/SKILL.md", github("o", "r", { path: "skills/foo" })],
    ["npx skills add o/r#dev", github("o", "r", { ref: "dev" })],
    ["npx skills add o/r#feature%2Fx", github("o", "r", { ref: "feature/x" })],
    ["npx skills add o/r#dev@s", github("o", "r", { ref: "dev", skills: ["s"] })],
    ["npx skills add o/r#@s", github("o", "r", { skills: ["s"] })],
    ["npx skills add o/r@s#dev", github("o", "r", { ref: "dev", skills: ["s"] })],
    ["npx skills add o/r/sub#dev@s", github("o", "r", { ref: "dev", path: "sub", skills: ["s"] })],
    ["npx skills add github:o/r", github("o", "r")],
    ["npx skills add github:o/r/sub", github("o", "r", { path: "sub" })],
    ["npx skills add github:o/r@s#dev", github("o", "r", { ref: "dev", skills: ["s"] })],
    ["npx skills add https://github.com/o/r#dev", github("o", "r", { ref: "dev" })],
    ["npx skills add https://github.com/o/r.git#dev", github("o", "r", { ref: "dev" })],
    ["npx skills add https://github.com/o/r/tree/main#dev", github("o", "r", { ref: "main" })],
    ["npx skills add coinbase/agentWallet", github("coinbase", "agentic-wallet-skills")],
    [
      "npx skills add vercel-labs/vercel-skills#dev",
      github("vercel-labs", "agent-skills", { ref: "dev" }),
    ],
    ["npx skills add https://github.com/o/r/issues/3", github("o", "r")],
    ["npx skills add https://github.com/o/r/releases/tag/v1", github("o", "r")],
    ["npx skills add git@github.com:o/r.git", github("o", "r")],
    ["npx skills add ssh://git@github.com/o/r.git", github("o", "r")],
    ["npx skills add git+https://github.com/o/r", github("o", "r")],
    ["npx skills add o/r --full-depth", github("o", "r", { fullDepth: true })],
    ["npx skills add --metadata '{}' o/r", github("o", "r")],
    ["npx skills add --subagent a b o/r", github("o", "r")],
  ])("%j", (text, expected) => {
    expect(parseSkillPaste(text)).toEqual(expected);
  });
});

describe("parseSkillPaste reads the skills a command asks for", () => {
  it.each([
    [
      "npx skills add o/r --skill frontend-design -s skill-creator",
      ["frontend-design", "skill-creator"],
    ],
    ["npx skills add o/r --skill a b c", ["a", "b", "c"]],
    ["npx skills add o/r --skill 'a' \"b\"", ["a", "b"]],
    ["npx skills add o/r --skill=a", ["a"]],
    ["npx skills add o/r --skill=a,b", ["a", "b"]],
    ["npx skills add o/r -s a,b", ["a", "b"]],
    ["npx skills add o/r -s a -s a", ["a"]],
    ["npx skills add --skill a o/r", ["a"]],
    ["npx skills add o/r@a -s b", ["a", "b"]],
    ["npx skills add o/r --skill '*'", "all"],
    ["npx skills add o/r --skill a '*'", "all"],
    ["npx skills add o/r --all", "all"],
    ["npx skills add o/r@a --all", "all"],
  ])("%j", (text, skills) => {
    expect(parseSkillPaste(text)).toEqual(github("o", "r", { skills }));
  });

  it("passes over the flags about local agent folders", () => {
    expect(
      parseSkillPaste(
        "npx skills add o/r -g --global -a claude-code codex --agent cursor -y --copy -l -s a",
      ),
    ).toEqual(github("o", "r", { skills: ["a"] }));
  });

  it("finds the source after an agent flag that takes several values", () => {
    expect(parseSkillPaste("npx skills add -a claude-code codex o/r")).toEqual(github("o", "r"));
  });
});

describe("parseSkillPaste names a source it does not install from", () => {
  it.each([
    ["npx skills add https://gitlab.com/o/r", "gitlab"],
    ["npx skills add https://gitlab.example.com/o/r", "gitlab"],
    ["npx skills add https://dev.azure.com/org/project/_git/r", "azure-devops"],
    ["npx skills add https://org.visualstudio.com/project/_git/r", "azure-devops"],
    ["npx skills add https://bitbucket.org/o/r", "other-host"],
    ["npx skills add git@gitlab.com:o/r.git", "ssh"],
    ["npx skills add ssh://git@example.com/o/r.git", "ssh"],
    ["npx skills add ./my-skills", "local-path"],
    ["npx skills add ../skills", "local-path"],
    ["npx skills add /Users/me/skills", "local-path"],
    ["npx skills add ~/skills", "local-path"],
    ["npx skills add .", "local-path"],
    ["npx skills add https://example.com/skills.zip", "download-url"],
    ["npx skills add https://example.com/a/SKILL.md", "download-url"],
    ["npx skills add https://github.com/o", "unreadable-source"],
    ["npx skills add https://github.com/o/r/archive/refs/heads/main.zip", "download-url"],
    ["npx skills add https://github.com/o/r/releases/download/v1/skills.tgz", "download-url"],
    ["npx skills add https://codeload.github.com/o/r/zip/main", "download-url"],
    ["npx skills add https://github.com/o/r/tree/main/../x", "unreadable-source"],
    ["npx skills add https://github.com/o/r/tree/main/..%2Fx", "unreadable-source"],
    ["npx skills add https://github.com/o/r/tree/main/a/%2e%2e/b", "unreadable-source"],
    ["npx skills add o/r/skills/../../x", "unreadable-source"],
    ["npx skills add o/r/a%2F..%2Fb", "unreadable-source"],
    ["npx skills add pdf", "unreadable-source"],
    ["npx skills add", "no-source"],
    ["npx skills add -g -y", "no-source"],
    ["npx skills find pdf", "other-command"],
    ["npx skills list", "other-command"],
  ])("%j", (text, reason) => {
    expect(parseSkillPaste(text)).toEqual({ kind: "unsupported", reason });
  });
});

describe("parseSkillPaste reads a skill's text", () => {
  it("reads the frontmatter's name and description", () => {
    const markdown =
      "---\nname: my-pr-style\ndescription: How to write PR descriptions.\n---\n# PR style\nLead with it.";
    expect(parseSkillPaste(`\n${markdown}\n`)).toEqual({
      kind: "text",
      markdown,
      name: "my-pr-style",
      description: "How to write PR descriptions.",
      problems: [],
    });
  });

  it("reads quoted and block scalars as the repository's skills are read", () => {
    const result = parseSkillPaste(
      "---\nname: 'pdf'\ndescription: >\n  Fill PDF forms.\n  Use for PDFs.\n---\nBody",
    );
    expect(result).toMatchObject({
      name: "pdf",
      description: "Fill PDF forms. Use for PDFs.",
      problems: [],
    });
  });

  it.each([
    ["# Release Notes\nWrite them.", "release-notes"],
    ["Intro line\n\n## Café   Ünïcode -- Helper!\nBody", "cafe-unicode-helper"],
    ["```\n# not a heading\n```\n# Real One", "real-one"],
    ["````\n```\n# Not The Name\n```\n````\n# Actual Skill", "actual-skill"],
    ["# Closing hashes ##", "closing-hashes"],
    [`# ${"word ".repeat(30).trimEnd()}`, "word-".repeat(12).concat("word")],
  ])("suggests a name from the first heading of %j", (markdown, name) => {
    expect(parseSkillPaste(markdown)).toEqual({
      kind: "text",
      markdown,
      name,
      problems: ["description-missing"],
    });
  });

  it("suggests a name from the body where the frontmatter names none", () => {
    expect(parseSkillPaste("---\ndescription: Does a thing.\n---\n# Do Thing")).toMatchObject({
      name: "do-thing",
      description: "Does a thing.",
      problems: [],
    });
  });

  it.each([
    ["hello there", ["name-missing", "description-missing"]],
    ["# !!!\nbody", ["name-missing", "description-missing"]],
    ["---\nname: My Skill\ndescription: d\n---\n", ["name-invalid"]],
    ["---\nname: a--b\ndescription: d\n---\n", ["name-invalid"]],
    [`---\nname: ${"a".repeat(65)}\ndescription: d\n---\n`, ["name-invalid"]],
    ['---\nname: ok\ndescription: ""\n---\n', ["description-missing"]],
    [`---\nname: ok\ndescription: ${"d".repeat(1025)}\n---\n`, ["description-too-long"]],
    [
      "---\nname: ok\ndescription: d\n# never closed",
      ["frontmatter-unclosed", "name-missing", "description-missing"],
    ],
    [`---\nname: ok\ndescription: d\n---\n${"é".repeat(33 * 1024)}`, ["too-large"]],
  ])("lists what %j breaks", (markdown, problems) => {
    expect(parseSkillPaste(markdown)).toMatchObject({ kind: "text", problems });
  });

  it("takes a skills command among other lines as text", () => {
    expect(parseSkillPaste("npx skills add o/r\nnpx skills add o/s")).toMatchObject({
      kind: "text",
    });
  });

  it("takes a command with a quote never closed as text", () => {
    expect(parseSkillPaste("npx skills add o/r --skill 'a")).toMatchObject({ kind: "text" });
  });
});

describe("parseSkillPaste reads nothing as empty", () => {
  it.each(["", "   ", "\n\t\n"])("%j", (text) => {
    expect(parseSkillPaste(text)).toEqual({ kind: "empty" });
  });
});
