/**
 * skill-discovery.ts -- which folders of a repository's tree hold its skills, found as the `skills` tool finds them.
 *
 * A port of the `skills` tool's discovery over the one tree listing a
 * source is read from: vercel-labs/skills at a80e4c9
 * (https://github.com/vercel-labs/skills/blob/a80e4c9d12d607631249d4d7d059f835d4b2f13a/src/skills.ts),
 * `discoverSkills`, with the plugin manifests' folders as
 * `src/plugin-manifest.ts`'s `getPluginSkillPaths` reads them. From the
 * folder a source names, or the repository's root:
 *
 * - a folder holding a `SKILL.md` is that skill alone;
 * - else its own folders holding one are looked at, then each folder under
 *   `skills/`, its `.curated`, `.experimental`, and `.system`, and every
 *   agent's project skills folder, down to three folders deep, then under
 *   each folder a plugin manifest names, one folder deep;
 * - a walk never goes below a folder holding a `SKILL.md`, whose subfolders
 *   are its own files, nor through a folder the tool skips;
 * - where none is found, every folder holding a `SKILL.md` down to five
 *   folders deep is.
 *
 * `--full-depth` takes a skill at the folder searched as one among the
 * rest rather than alone, and always looks five folders deep.
 *
 * A skill folder under an agent's skills folder is passed over where the
 * repository's `skills-lock.json` names it, as a skill the tool installed
 * there rather than one the repository makes. Note that the tool reads
 * each `SKILL.md` as it walks, so a lock entry or a skill it hides
 * (`metadata.internal`) that it names by its frontmatter is matched here
 * by its folder's name, and a `SKILL.md` that fails to read still counts
 * as found; which copy of a name stands, and which skills are hidden, is
 * `skill-paste-install.ts`'s to say from each `SKILL.md`.
 */

import { INSTALLED_SKILL_MAIN_FILE } from "@luke/features/installed-skill-wire";
import { Option, Schema } from "effect";

/** How many folders deep a skills folder is walked (`DEFAULT_SKILL_CONTAINER_DEPTH`). */
const CONTAINER_DEPTH = 3;

/** How many folders deep the search falls back to where the walk finds nothing (`findSkillDirs`). */
const FALLBACK_DEPTH = 5;

/** The folders no walk goes through (`SKIP_DIRS`). */
const SKIPPED_FOLDERS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "__pycache__",
]);

/** The skills folders of the repository walked deep, before the agents' own (`prioritySearchDirs`). */
const SKILL_CONTAINERS: readonly string[] = [
  "skills",
  "skills/.curated",
  "skills/.experimental",
  "skills/.system",
];

/** Every agent's project skills folder, in the tool's order (`AGENT_PROJECT_SKILL_DIRS`). */
const AGENT_SKILL_FOLDERS: readonly string[] = [
  ".agents/skills",
  ".claude/skills",
  ".cline/skills",
  ".codebuddy/skills",
  ".codex/skills",
  ".commandcode/skills",
  ".continue/skills",
  ".factory/skills",
  ".github/skills",
  ".goose/skills",
  ".grok/skills",
  ".iflow/skills",
  ".junie/skills",
  ".kilo/skills",
  ".kilocode/skills",
  ".kimchi/skills",
  ".kiro/skills",
  ".minimax/skills",
  ".mux/skills",
  ".neovate/skills",
  ".opencode/skills",
  ".openhands/skills",
  ".pi/skills",
  ".posit/assistant/skills",
  ".qoder/skills",
  ".roo/skills",
  ".trae/skills",
  ".windsurf/skills",
  ".zcode/skills",
  ".zencoder/skills",
];

/** The files discovery reads beside the tree, by their path from the folder searched or the root. */
export const DISCOVERY_FILE = {
  /** A catalog of plugins, each naming its skills (`.claude-plugin/marketplace.json`). */
  MARKETPLACE: ".claude-plugin/marketplace.json",
  /** One plugin at the folder searched (`.claude-plugin/plugin.json`). */
  PLUGIN: ".claude-plugin/plugin.json",
  /** The skills the tool installed into the repository, at its root (`skills-lock.json`). */
  LOCK: "skills-lock.json",
} as const;

/** The lock's version from which its entries are read (`CURRENT_VERSION`). */
const LOCK_VERSION = 1;

/** A plugin manifest's skills, as far as discovery reads them. */
const PluginSchema = Schema.Struct({
  source: Schema.optional(Schema.Unknown),
  skills: Schema.optional(Schema.Array(Schema.String)),
});

/** A marketplace manifest, as far as discovery reads it. */
const MarketplaceJson = Schema.fromJsonString(
  Schema.Struct({
    metadata: Schema.optional(Schema.Struct({ pluginRoot: Schema.optional(Schema.String) })),
    plugins: Schema.optional(Schema.Array(PluginSchema)),
  }),
);

/** A single plugin's manifest, as far as discovery reads it. */
const PluginJson = Schema.fromJsonString(PluginSchema);

/** The lock, as far as discovery reads it. */
const LockJson = Schema.fromJsonString(
  Schema.Struct({ version: Schema.Number, skills: Schema.Record(Schema.String, Schema.Unknown) }),
);

/** What discovery is given: every file holding a `SKILL.md`, and the texts of the manifests and the lock where the tree holds them. */
export interface DiscoveryInput {
  readonly skillFiles: ReadonlySet<string>;
  readonly marketplace: string | undefined;
  readonly plugin: string | undefined;
  readonly lock: string | undefined;
}

/** The folder's parent and the folder's own name: `skills/x` is `skills` and `x`. */
export function splitFolder(path: string): { readonly parent: string; readonly name: string } {
  const at = path.lastIndexOf("/");
  return at === -1
    ? { parent: "", name: path }
    : { parent: path.slice(0, at), name: path.slice(at + 1) };
}

/** The path the parts make under the base, with `.` and `..` resolved; nothing where it leaves the base (`isContainedIn`). */
export function pathWithin(base: string, ...parts: readonly string[]): string | undefined {
  const segments = base === "" ? [] : base.split("/");
  const floor = segments.length;
  for (const segment of parts.flatMap((part) => part.split("/"))) {
    if (segment === "" || segment === ".") continue;
    if (segment !== "..") segments.push(segment);
    else if (segments.length > floor) segments.pop();
    else return undefined;
  }
  return segments.join("/");
}

/** A skill's name as the lock keys it (`normalizeSkillName`). */
function lockName(name: string): string {
  return name.toLowerCase().replace(/[\s_]+/gu, "-");
}

/** A manifest path the convention allows: one that starts `./` (`isValidRelativePath`). */
function relative(path: string): boolean {
  return path.startsWith("./");
}

/** The folders a plugin is searched under, from the folder searched: the parent of each skill it names, then its `skills/`; one that leaves the folder searched is none. */
function pluginFolders(
  search: string,
  base: readonly string[],
  skills: readonly string[] | undefined,
): string[] {
  if (pathWithin(search, ...base) === undefined) return [];
  const named = (skills ?? [])
    .filter(relative)
    .flatMap((skill) => pathWithin(search, ...base, skill, "..") ?? []);
  const conventional = pathWithin(search, ...base, "skills");
  return conventional === undefined ? named : [...named, conventional];
}

/** The folders the manifests at the folder searched name, as `getPluginSkillPaths` reads them; a manifest that does not read names none. */
function manifestFolders(search: string, input: DiscoveryInput): string[] {
  const marketplace = Option.getOrUndefined(
    Schema.decodeUnknownOption(MarketplaceJson)(input.marketplace),
  );
  const pluginRoot = marketplace?.metadata?.pluginRoot;
  const cataloged =
    marketplace === undefined || (pluginRoot !== undefined && !relative(pluginRoot))
      ? []
      : (marketplace.plugins ?? []).flatMap((plugin) => {
          if (plugin.source !== undefined && typeof plugin.source !== "string") return [];
          if (typeof plugin.source === "string" && !relative(plugin.source)) return [];
          return pluginFolders(search, [pluginRoot ?? "", plugin.source ?? ""], plugin.skills);
        });
  const plugin = Option.getOrUndefined(Schema.decodeUnknownOption(PluginJson)(input.plugin));
  return [...cataloged, ...(plugin === undefined ? [] : pluginFolders(search, [], plugin.skills))];
}

/** The names the lock holds, folded as the tool folds them; none where it does not read or is older than the tool reads. */
function lockedNames(lock: string | undefined): ReadonlySet<string> {
  const read = Option.getOrUndefined(Schema.decodeUnknownOption(LockJson)(lock));
  if (read === undefined || read.version < LOCK_VERSION) return new Set();
  return new Set(Object.keys(read.skills).map(lockName));
}

/**
 * The folders holding a skill under the folder searched, the root where
 * none is named, in the order the module's header says; each folder once.
 */
export function discoverSkillFolders(
  input: DiscoveryInput,
  within: string | undefined,
  fullDepth: boolean,
): string[] {
  const search = within ?? "";
  const holding = (folder: string) =>
    input.skillFiles.has(
      folder === "" ? INSTALLED_SKILL_MAIN_FILE : `${folder}/${INSTALLED_SKILL_MAIN_FILE}`,
    );
  const locked = lockedNames(input.lock);
  const installed = (folder: string) =>
    locked.size > 0 &&
    AGENT_SKILL_FOLDERS.some((root) => folder === root || folder.startsWith(`${root}/`)) &&
    locked.has(lockName(splitFolder(folder).name));
  // Note that only a folder on the way to some `SKILL.md` can hold a skill, so a walk goes down those alone.
  const onTheWay = new Set<string>();
  for (const file of input.skillFiles) {
    for (
      let folder = splitFolder(file).parent;
      folder !== "";
      folder = splitFolder(folder).parent
    ) {
      onTheWay.add(folder);
    }
  }
  const childrenOf = (parent: string) =>
    [...onTheWay]
      .filter((folder) => splitFolder(folder).parent === parent)
      .sort((a, b) => a.localeCompare(b));

  const atSearch = holding(search) && !installed(search);
  if (atSearch && !fullDepth) return [search];
  const seen = new Set<string>(holding(search) ? [search] : []);
  const found: string[] = atSearch ? [search] : [];
  const take = (folder: string) => {
    if (seen.has(folder)) return;
    seen.add(folder);
    if (!installed(folder)) found.push(folder);
  };
  const walk = (folder: string, deepest: number, depth: number) => {
    for (const child of childrenOf(folder)) {
      if (holding(child)) take(child);
      else if (depth < deepest && !SKIPPED_FOLDERS.has(splitFolder(child).name)) {
        walk(child, deepest, depth + 1);
      }
    }
  };
  walk(search, 1, 1);
  for (const container of [...SKILL_CONTAINERS, ...AGENT_SKILL_FOLDERS]) {
    walk(pathWithin(search, container) ?? search, CONTAINER_DEPTH, 1);
  }
  for (const folder of manifestFolders(search, input)) walk(folder, 1, 1);
  if (found.length > 0 && !fullDepth) return found;

  // Note that the fallback looks below a skill too, as `findSkillDirs` does.
  const deep = (folder: string, depth: number): string[] => [
    ...(holding(folder) ? [folder] : []),
    ...(depth < FALLBACK_DEPTH
      ? childrenOf(folder)
          .filter((child) => !SKIPPED_FOLDERS.has(splitFolder(child).name))
          .flatMap((child) => deep(child, depth + 1))
      : []),
  ];
  for (const folder of deep(search, 0)) take(folder);
  return found;
}
