/**
 * Skills, as OpenClaw lists them: a directory holding a `SKILL.md` whose
 * front matter names and describes it. The prompt carries only each eligible
 * skill's name, description, and location; the instructions themselves are
 * read on demand, through the workspace read tool, when the model decides a
 * skill matches.
 */

/** What a workspace tool answers when asked to load one skill's whole instructions. */
export type SkillLoad =
  | { readonly ok: true; readonly instructions: string; readonly truncated: boolean }
  | { readonly ok: false; readonly reason: string };
