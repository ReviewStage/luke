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
import { isClassList } from "../shared/style-guard.ts";

const CLASS_ATTRIBUTES: ReadonlySet<string> = new Set(["className", "class"]);

const COMPARISONS: ReadonlySet<string> = new Set(["===", "!==", "==", "!="]);

function couldBeClass(node: ESTree.Node): boolean {
  const parent = (node as { parent?: ESTree.Node }).parent;
  if (parent === undefined) return true;
  switch (parent.type) {
    case "ImportDeclaration":
    case "ExportNamedDeclaration":
    case "ExportAllDeclaration":
    case "ImportExpression":
    case "TSLiteralType":
    case "TSExternalModuleReference":
      return false;
    case "BinaryExpression":
      return !COMPARISONS.has(parent.operator);
    case "SwitchCase":
      return parent.test !== node;
    case "Property":
      return parent.key !== node;
    case "JSXAttribute":
      return CLASS_ATTRIBUTES.has(attributeName(parent));
    case "JSXExpressionContainer":
      return couldBeClass(parent);
    case "CallExpression":
      return parent.callee.type !== "Identifier" || parent.callee.name !== "require";
    default:
      return true;
  }
}

function specifierName(node: ESTree.Node): string {
  if (node.type === "Identifier") return node.name;
  return node.type === "Literal" ? String(node.value) : "";
}

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
      let registries = new Set<string>();
      let namespaces = new Map<string, string>();

      function place(retirement: Retirement, node: ESTree.Node): void {
        places.set(retirement, [...(places.get(retirement) ?? []), node]);
      }

      function noteGlyph(name: string, node: ESTree.Node): void {
        for (const retirement of standing) {
          if (matchesGlyph(retirement, name)) place(retirement, node);
        }
      }

      function noteClasses(text: string, node: ESTree.Node): void {
        if (!isClassList(text) || !couldBeClass(node)) return;
        for (const token of text.split(/\s+/u)) {
          for (const retirement of standing) {
            if (matchesClass(retirement, token)) place(retirement, node);
          }
        }
      }

      function noteModule(
        specifier: string,
        imported: readonly ESTree.Node[],
        node: ESTree.Node,
        whole = false,
      ) {
        for (const retirement of standing) {
          if (!matchesModule(retirement, specifier)) continue;
          if (retirement.names.length === 0 || whole) place(retirement, node);
          for (const name of imported) {
            if (retirement.names.includes(specifierName(name))) place(retirement, name);
          }
        }
        if (!isIconDoor(specifier, file)) return;
        for (const name of imported) noteGlyph(specifierName(name), name);
      }

      function noteMember(object: string, key: string, node: ESTree.Node): void {
        if (registries.has(object)) noteGlyph(`${GLYPH_REGISTRY}.${key}`, node);
        const specifier = namespaces.get(object);
        if (specifier === undefined) return;
        if (isIconDoor(specifier, file)) noteGlyph(key, node);
        for (const retirement of standing) {
          if (matchesModule(retirement, specifier) && retirement.names.includes(key))
            place(retirement, node);
        }
      }

      return {
        before() {
          file = repositoryPathOf(context.filename);
          if (!TYPESCRIPT_SOURCE.test(file)) return false;
          standing = retirements.filter((retirement) => !isAllowed(retirement, file));
          places = new Map();
          registries = new Set();
          namespaces = new Map();
          return standing.length > 0;
        },
        JSXAttribute(node) {
          const name = attributeName(node);
          for (const retirement of standing) {
            if (retirement.kind === RETIRED_KIND.PROP && retirement.name === name)
              place(retirement, node);
          }
        },
        Literal(node) {
          if (typeof node.value === "string") noteClasses(node.value, node);
        },
        TemplateElement(node) {
          noteClasses(node.value.cooked ?? "", node);
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
            } else {
              namespaces.set(binding.local.name, specifier);
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
          noteModule(String(node.source.value), [], node, true);
        },
        ImportExpression(node) {
          if (node.source.type === "Literal") noteModule(String(node.source.value), [], node, true);
        },
        CallExpression(node) {
          const callee = node.callee;
          if (callee.type !== "Identifier" || callee.name !== "require") return;
          const argument = node.arguments[0];
          if (argument?.type === "Literal") noteModule(String(argument.value), [], node, true);
        },
        MemberExpression(node) {
          if (node.object.type !== "Identifier" || node.property.type !== "Identifier") return;
          noteMember(node.object.name, node.property.name, node);
        },
        JSXOpeningElement(node) {
          const name = node.name;
          if (name.type !== "JSXMemberExpression" || name.object.type !== "JSXIdentifier") return;
          noteMember(name.object.name, name.property.name, name);
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
