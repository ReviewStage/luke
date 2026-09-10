import { promises as fs } from "node:fs";
import path from "node:path";
import type { SkillDescriptor } from "./registry.js";

/**
 * Skills, as OpenClaw lists them: a directory holding a `SKILL.md` whose
 * front matter names and describes it. The prompt carries only each eligible
 * skill's name, description, and location; the instructions themselves are
 * read on demand, through the workspace read tool, when the model decides a
 * skill matches. Eligibility is decided here from the skill's own metadata
 * and the agent asking, never from anything a transcript said.
 */

export const SKILL_FILE = "SKILL.md";

/** The most of one skill's instructions a load answers with, cut from the end. */
const MAXIMUM_SKILL_CHARS = 20_000;

const FRONT_MATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u;

interface SkillFrontMatter {
  name?: string;
  description?: string;
  enabled?: boolean;
  agents?: readonly string[];
}

function unquoted(value: string): string {
  const trimmed = value.trim();
  const quoted =
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"));
  return quoted ? trimmed.slice(1, -1) : trimmed;
}

function listValue(value: string): readonly string[] {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map(unquoted)
      .filter((entry) => entry.length > 0);
  }
  return trimmed.length > 0 ? [unquoted(trimmed)] : [];
}

/** Reads the few front-matter keys a skill may carry; anything else is left to the file. */
function parseSkillFrontMatter(text: string): SkillFrontMatter {
  const match = FRONT_MATTER.exec(text);
  if (!match?.[1]) return {};
  const parsed: SkillFrontMatter = {};
  for (const line of match[1].split(/\r?\n/u)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1);
    switch (key) {
      case "name":
        parsed.name = unquoted(value);
        break;
      case "description":
        parsed.description = unquoted(value);
        break;
      case "enabled":
        parsed.enabled = unquoted(value).toLowerCase() !== "false";
        break;
      case "agents":
        parsed.agents = listValue(value);
        break;
      default:
        break;
    }
  }
  return parsed;
}

/** A skill directory's descriptor from its SKILL.md, or nothing when the file names no skill. */
export function skillDescriptorFrom(location: string, text: string): SkillDescriptor | undefined {
  const front = parseSkillFrontMatter(text);
  const name = front.name ?? path.basename(path.dirname(location));
  if (!name) return undefined;
  return {
    id: name,
    name,
    description: front.description ?? "",
    location,
    enabled: front.enabled ?? true,
    agents: front.agents ?? [],
  };
}

/** Walks each root one level deep for `<skill>/SKILL.md`; a root that does not exist lists nothing. */
export async function discoverSkills(
  roots: readonly string[],
): Promise<readonly SkillDescriptor[]> {
  const found: SkillDescriptor[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    let entries: string[];
    try {
      entries = await fs.readdir(root);
    } catch {
      continue;
    }
    for (const entry of entries.sort()) {
      const location = path.join(root, entry, SKILL_FILE);
      let text: string;
      try {
        text = await fs.readFile(location, "utf8");
      } catch {
        continue;
      }
      const skill = skillDescriptorFrom(location, text);
      if (!skill || seen.has(skill.id)) continue;
      seen.add(skill.id);
      found.push(skill);
    }
  }
  return found;
}

/** The skills a run of this agent is shown: enabled, and either open to every agent or naming this one. */
export function eligibleSkills(
  skills: readonly SkillDescriptor[],
  agentId: string,
): readonly SkillDescriptor[] {
  return skills.filter(
    (skill) => skill.enabled && (skill.agents.length === 0 || skill.agents.includes(agentId)),
  );
}

export type SkillLoad =
  | { readonly ok: true; readonly instructions: string; readonly truncated: boolean }
  | { readonly ok: false; readonly reason: string };

/**
 * Loads one skill's whole instructions on demand. The location has to be
 * one an eligible descriptor listed: a path the model composed itself is
 * refused, so the read reaches nothing the discovery did not.
 */
export async function loadSkill(
  location: string,
  eligible: readonly SkillDescriptor[],
  maximumChars: number = MAXIMUM_SKILL_CHARS,
): Promise<SkillLoad> {
  if (!eligible.some((skill) => skill.location === location)) {
    return { ok: false, reason: "not an eligible skill" };
  }
  try {
    const text = await fs.readFile(location, "utf8");
    return {
      ok: true,
      instructions: text.slice(0, maximumChars),
      truncated: text.length > maximumChars,
    };
  } catch {
    return { ok: false, reason: "the skill could not be read" };
  }
}
