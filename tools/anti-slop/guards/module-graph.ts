import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { parseSync } from "oxc-parser";

export interface ModuleEdge {
  readonly specifier: string;
  readonly typeOnly: boolean;
  readonly names: readonly { readonly imported: string; readonly local: string }[];
}

export interface ModuleRecord {
  readonly imports: readonly ModuleEdge[];
  readonly reexports: readonly ModuleEdge[];
  readonly declared: readonly { readonly name: string; readonly typeOnly: boolean }[];
  readonly program: unknown;
}

function nameOf(name: { kind: string; name: string | null }): string {
  return name.kind === "Name" && name.name !== null ? name.name : "*";
}

export function moduleRecord(file: string, source: string): ModuleRecord {
  const parsed = parseSync(file, source);
  const imports = parsed.module.staticImports.map((one) => ({
    specifier: one.moduleRequest.value,
    typeOnly: one.entries.length > 0 && one.entries.every((entry) => entry.isType),
    names: one.entries.map((entry) => ({
      imported: nameOf(entry.importName),
      local: entry.localName.value,
    })),
  }));
  const reexports: ModuleEdge[] = [];
  const declared: { name: string; typeOnly: boolean }[] = [];
  for (const statement of parsed.module.staticExports) {
    for (const entry of statement.entries) {
      const exported = nameOf(entry.exportName);
      if (entry.moduleRequest === null) {
        declared.push({ name: exported, typeOnly: entry.isType });
        continue;
      }
      reexports.push({
        specifier: entry.moduleRequest.value,
        typeOnly: entry.isType,
        names: [{ imported: nameOf(entry.importName), local: exported }],
      });
    }
  }
  return { imports, reexports, declared, program: parsed.program };
}

export function resolveRelative(from: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = path.resolve(path.dirname(from), specifier.replace(/\.js$/u, ""));
  return [`${base}.tsx`, `${base}.ts`, path.join(base, "index.ts")].find((candidate) =>
    existsSync(candidate),
  );
}

export function readModule(file: string): ModuleRecord {
  return moduleRecord(file, readFileSync(file, "utf8"));
}

export function namesUsed(program: unknown): ReadonlySet<string> {
  const used = new Set<string>();
  const visit = (value: unknown): void => {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const node = value as { type?: unknown; name?: unknown };
    if (node.type === "ImportDeclaration") return;
    if (
      (node.type === "Identifier" || node.type === "JSXIdentifier") &&
      typeof node.name === "string"
    )
      used.add(node.name);
    for (const child of Object.values(value)) visit(child);
  };
  visit(program);
  return used;
}
