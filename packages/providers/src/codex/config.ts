import os from "node:os";
import path from "node:path";
import { readTextFile } from "../shared/local-files.js";

/**
 * Where Codex keeps its own state, as Codex itself decides it: the
 * environment it reads, and the one key of its `config.toml` that moves the
 * state database. Nothing here opens a database or a rollout — it only says
 * which directory to look in.
 */

const CODEX_ENVIRONMENT = {
  CONFIG_DIRECTORY: "CODEX_HOME",
  SQLITE_DIRECTORY: "CODEX_SQLITE_HOME",
} as const;

const CODEX_CONFIG_FILE = {
  USER: "config.toml",
} as const;

const CODEX_CONFIG_KEY = {
  SQLITE_DIRECTORY: "sqlite_home",
} as const;

export function defaultCodexHome(): string {
  const configuredHome = process.env[CODEX_ENVIRONMENT.CONFIG_DIRECTORY]?.trim();
  return configuredHome || path.join(os.homedir(), ".codex");
}

export function normalizeDirectory(
  value: string | undefined,
  baseDirectory: string,
): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  if (normalized === "~") return os.homedir();
  if (normalized.startsWith("~/")) return path.join(os.homedir(), normalized.slice(2));
  if (path.isAbsolute(normalized)) return normalized;
  return path.resolve(baseDirectory, normalized);
}

export function sqliteHomeFromEnvironment(codexHome: string): string | undefined {
  return normalizeDirectory(process.env[CODEX_ENVIRONMENT.SQLITE_DIRECTORY], codexHome);
}

function unescapeBasicTomlString(value: string): string {
  return value.replace(/\\(["\\bfnrt])/g, (_match, character: string) => {
    if (character === "b") return "\b";
    if (character === "f") return "\f";
    if (character === "n") return "\n";
    if (character === "r") return "\r";
    if (character === "t") return "\t";
    return character;
  });
}

function tomlStringValue(value: string): string | undefined {
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.startsWith('"') && normalized.endsWith('"')) {
    return unescapeBasicTomlString(normalized.slice(1, -1)).trim() || undefined;
  }
  if (normalized.startsWith("'") && normalized.endsWith("'")) {
    return normalized.slice(1, -1).trim() || undefined;
  }
  return normalized.trim() || undefined;
}

function topLevelTomlString(source: string, key: string): string | undefined {
  let inTopLevel = true;
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inTopLevel = false;
      continue;
    }
    if (!inTopLevel) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex < 0) continue;
    if (trimmed.slice(0, separatorIndex).trim() !== key) continue;
    return tomlStringValue(trimmed.slice(separatorIndex + 1).replace(/\s+#.*$/, ""));
  }
  return undefined;
}

export async function sqliteHomeFromConfig(codexHome: string): Promise<string | undefined> {
  const config = await readTextFile(path.join(codexHome, CODEX_CONFIG_FILE.USER));
  return config
    ? normalizeDirectory(topLevelTomlString(config, CODEX_CONFIG_KEY.SQLITE_DIRECTORY), codexHome)
    : undefined;
}
