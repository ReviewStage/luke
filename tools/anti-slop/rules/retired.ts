import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { baselineProblems } from "../shared/baseline.ts";
import { repositoryPathOf, TYPESCRIPT_SOURCE } from "../shared/effect-edges.ts";
import { attributeName } from "../shared/jsx.ts";
import {
  GLYPH_REGISTRY,
  isAllowed,
  isIconDoor,
  matchesClass,
  matchesGlyph,
  matchesModule,
  RETIRED,
  RETIRED_KIND,
  type Retirement,
} from "../shared/retired.ts";

/**
 * What phase 2 retired stays retired: a class name in a `className`, a glyph
 * imported from `@luke/ui/icons`, a JSX prop, or an import, each refused
 * outside the paths its retired file allows, past the baseline that file
 * gives it. The list is data, one JSON file per kind under
 * `tools/anti-slop/retired/` (`shared/retired.ts` reads it and says how a
 * kind adds its own); the style guard holds the same classes in CSS selectors.
 */

/** The attributes whose strings are class lists. */
const CLASS_ATTRIBUTES: ReadonlySet<string> = new Set(["className", "class"]);

/** Every string literal under `node`, a template's quasis among them. */
function stringsUnder(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) stringsUnder(child, found);
    return found;
  }
  if (node === null || typeof node !== "object") return found;
  const type: unknown = Reflect.get(node, "type");
  const value: unknown = Reflect.get(node, "value");
  if (type === "Literal" && typeof value === "string") found.push(value);
  if (type === "TemplateElement" && value !== null && typeof value === "object") {
    const cooked: unknown = Reflect.get(value, "cooked");
    if (typeof cooked === "string") found.push(cooked);
  }
  // Note that we skip `parent`, which oxlint hangs on every node, so the walk only goes down.
  for (const key of Object.keys(node)) {
    if (key !== "parent") stringsUnder(Reflect.get(node, key), found);
  }
  return found;
}

function specifierName(node: ESTree.Node): string {
  if (node.type === "Identifier") return node.name;
  return node.type === "Literal" ? String(node.value) : "";
}

/** The rule over a given list of retirements; the plugin's own reads `tools/anti-slop/retired/`. */
export function retiredRuleFor(retirements: readonly Retirement[]) {
  return defineRule({
    meta: {
      type: "problem",
      docs: {
        description:
          "Disallow retired class names, glyphs, props and imports outside the paths their retired file allows, from a baseline that only shrinks.",
      },
      messages: {
        retired: "`{{name}}` is retired here (tools/anti-slop/retired/{{file}}): {{instead}}",
        staleBaseline:
          "`{{name}}`: {{says}} (tools/anti-slop/retired/{{file}}'s baseline for this file; delete the row at 0).",
      },
    },
    createOnce(context) {
      let file = "";
      let standing: readonly Retirement[] = [];
      let places = new Map<Retirement, ESTree.Node[]>();
      // The names this file binds to the door's registry and to the door as a namespace.
      let registries = new Set<string>();
      let doors = new Set<string>();

      function place(retirement: Retirement, node: ESTree.Node): void {
        places.set(retirement, [...(places.get(retirement) ?? []), node]);
      }

      function noteGlyph(name: string, node: ESTree.Node): void {
        for (const retirement of standing) {
          if (matchesGlyph(retirement, name)) place(retirement, node);
        }
      }

      /** An import or re-export of `specifier`, binding `imported` names (none for a bare or `*` one). */
      function noteModule(specifier: string, imported: readonly ESTree.Node[], node: ESTree.Node) {
        for (const retirement of standing) {
          if (!matchesModule(retirement, specifier)) continue;
          if (retirement.names.length === 0) place(retirement, node);
          for (const name of imported) {
            if (retirement.names.includes(specifierName(name))) place(retirement, name);
          }
        }
        if (!isIconDoor(specifier, file)) return;
        for (const name of imported) noteGlyph(specifierName(name), name);
      }

      return {
        before() {
          file = repositoryPathOf(context.filename);
          if (!TYPESCRIPT_SOURCE.test(file)) return false;
          standing = retirements.filter((retirement) => !isAllowed(retirement, file));
          places = new Map();
          registries = new Set();
          doors = new Set();
          return standing.length > 0;
        },
        JSXAttribute(node) {
          const name = attributeName(node);
          for (const retirement of standing) {
            if (retirement.kind === RETIRED_KIND.PROP && retirement.name === name)
              place(retirement, node);
          }
          if (!CLASS_ATTRIBUTES.has(name)) return;
          for (const token of stringsUnder(node.value).flatMap((text) => text.split(/\s+/u))) {
            for (const retirement of standing) {
              if (matchesClass(retirement, token)) place(retirement, node);
            }
          }
        },
        ImportDeclaration(node) {
          const specifier = String(node.source.value);
          const door = isIconDoor(specifier, file);
          const imported: ESTree.Node[] = [];
          for (const binding of node.specifiers) {
            if (binding.type === "ImportSpecifier") {
              imported.push(binding.imported);
              if (door && specifierName(binding.imported) === GLYPH_REGISTRY)
                registries.add(binding.local.name);
            } else if (door && binding.type === "ImportNamespaceSpecifier") {
              doors.add(binding.local.name);
            }
          }
          noteModule(specifier, imported, node);
        },
        ExportNamedDeclaration(node) {
          if (!node.source) return;
          const imported = node.specifiers.map((binding) => binding.local);
          noteModule(String(node.source.value), imported, node);
        },
        ExportAllDeclaration(node) {
          noteModule(String(node.source.value), [], node);
        },
        ImportExpression(node) {
          if (node.source.type === "Literal") noteModule(String(node.source.value), [], node);
        },
        CallExpression(node) {
          const callee = node.callee;
          if (callee.type !== "Identifier" || callee.name !== "require") return;
          const argument = node.arguments[0];
          if (argument?.type === "Literal") noteModule(String(argument.value), [], node);
        },
        MemberExpression(node) {
          if (node.object.type !== "Identifier" || node.property.type !== "Identifier") return;
          const key = node.property.name;
          if (registries.has(node.object.name)) noteGlyph(`${GLYPH_REGISTRY}.${key}`, node);
          if (doors.has(node.object.name)) noteGlyph(key, node);
        },
        "Program:exit"(program) {
          for (const retirement of standing) {
            const found = places.get(retirement) ?? [];
            const allowed = retirement.baseline[file];
            const baseline = allowed === undefined ? {} : { [file]: allowed };
            const counts = new Map([[file, found.length]]);
            const data = { name: retirement.name, file: retirement.file };
            for (const problem of baselineProblems(counts, baseline, true)) {
              if (!problem.grew) {
                context.report({
                  node: program,
                  messageId: "staleBaseline",
                  data: { ...data, says: problem.says },
                });
                continue;
              }
              // Note that the places past the baseline's count are the ones reported, since the ones before it were already there.
              for (const node of found.slice(allowed ?? 0)) {
                context.report({
                  node,
                  messageId: "retired",
                  data: { ...data, instead: retirement.instead },
                });
              }
            }
          }
        },
      };
    },
  });
}

export const retiredRule = retiredRuleFor(RETIRED);
