/**
 * skills-repository.ts -- a repository's skill folders as GitHub's trees and contents APIs answer them, from a test's own table.
 *
 * A suite names each root's entries and each file's text, and the script
 * answers the two reads the skill reader makes (`server/hosted/repository-skills.ts`):
 * a root's folder through git trees, and a `SKILL.md` through the contents
 * API, at the default branch. Anything else the script hands on, so it
 * composes under `githubReaching` as a repository's own paths.
 */

import type { RepositoryScript, SentToGitHub } from "./github-app-fake";

/** An entry of a root as a test names it: a skill's folder, or a link standing where one would. */
export const SKILL_ENTRY = {
  FOLDER: "folder",
  LINK: "link",
} as const;

type SkillEntry = (typeof SKILL_ENTRY)[keyof typeof SKILL_ENTRY];

/** What git holds each kind of entry as, by its type and mode. */
const GIT_OF = {
  [SKILL_ENTRY.FOLDER]: { type: "tree", mode: "040000" },
  [SKILL_ENTRY.LINK]: { type: "blob", mode: "120000" },
} as const satisfies Record<SkillEntry, { readonly type: string; readonly mode: string }>;

/** One repository's skills as a test holds them: each root's entries by name, each file's text by its path, and the size GitHub reports for a file where a test says one other than its own. */
export interface SkillsRepositoryFixture {
  readonly fullName: string;
  readonly branch: string;
  readonly roots: Readonly<Record<string, Readonly<Record<string, SkillEntry>>>>;
  readonly files: Readonly<Record<string, string>>;
  readonly sizes?: Readonly<Record<string, number>>;
}

/** The contents API's answer for a regular file of the text given, of the size given or its own. */
function fileResponse(text: string, size: number | undefined): Response {
  const bytes = new TextEncoder().encode(text);
  return Response.json({
    type: "file",
    size: size ?? bytes.length,
    encoding: "base64",
    content: Buffer.from(bytes).toString("base64"),
  });
}

const NOT_FOUND = () => Response.json({ message: "Not Found" }, { status: 404 });

/** The tree-ish a trees read names, or the path a contents read names, as GitHub was asked. */
function asked(fixture: SkillsRepositoryFixture, sent: SentToGitHub) {
  const url = new URL(sent.url);
  const prefix = `/repos/${fixture.fullName}/`;
  if (!url.pathname.startsWith(prefix)) return undefined;
  const rest = url.pathname.slice(prefix.length);
  if (rest.startsWith("git/trees/")) {
    return { tree: decodeURIComponent(rest.slice("git/trees/".length)) } as const;
  }
  if (rest.startsWith("contents/")) {
    const path = rest.slice("contents/".length).split("/").map(decodeURIComponent).join("/");
    return { file: path, ref: url.searchParams.get("ref") } as const;
  }
  return undefined;
}

/** The script answering the fixture's skill reads; any other request is handed on. */
export function skillsRepository(fixture: SkillsRepositoryFixture): RepositoryScript {
  return (sent) => {
    const read = asked(fixture, sent);
    if (read === undefined) return undefined;
    if ("tree" in read) {
      const [branch, path] = read.tree.split(/:(.*)/su);
      const root = branch === fixture.branch ? fixture.roots[path ?? ""] : undefined;
      if (root === undefined) return NOT_FOUND();
      const tree = Object.entries(root).map(([name, entry]) => ({
        path: name,
        ...GIT_OF[entry],
        sha: "0".repeat(40),
      }));
      return Response.json({ tree, truncated: false });
    }
    const file = read.ref === fixture.branch ? fixture.files[read.file] : undefined;
    return file === undefined ? NOT_FOUND() : fileResponse(file, fixture.sizes?.[read.file]);
  };
}
