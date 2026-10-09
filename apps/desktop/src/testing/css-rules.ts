// css-rules.ts -- the style rules of a compiled stylesheet, read as a test reads them: jsdom computes no cascade, so a test reads the rule where it lives.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";

/** The renderer's stylesheets, whose entry the build bundles into the one sheet the window links. */
const STYLES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../renderer/styles");
const STYLESHEET_ENTRY = path.join(STYLES, "index.css");
const TAILWIND_ENTRY = path.join(STYLES, "tailwind.css");

export interface CssRule {
  readonly selectors: readonly string[];
  readonly declarations: ReadonlyMap<string, string>;
  /** The cascade layer the rule sits in, innermost; none for a rule outside every layer. */
  readonly layer: string | undefined;
}

/** The declarations written directly in a block, between its nested rules. */
function declarationsIn(loose: string): ReadonlyMap<string, string> {
  const declarations = new Map<string, string>();
  for (const declaration of loose.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;
    declarations.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
  }
  return declarations;
}

/** A nested rule's selectors resolved against the rule it sits in, as the browser resolves nesting. */
function nestedSelectors(prelude: string, parents: readonly string[]): readonly string[] {
  const own = prelude.split(",").map((each) => each.trim());
  if (parents.length === 0) return own;
  return own.flatMap((selector) =>
    parents.map((parent) =>
      selector.includes("&") ? selector.replaceAll("&", parent) : `${parent} ${selector}`,
    ),
  );
}

const LAYER_PRELUDE = /^@layer\s+([\w.-]+)$/u;
const COMMENT = /\/\*[\s\S]*?\*\//gu;
const KEYFRAMES = /^@(?:-webkit-)?keyframes\b/u;

/**
 * Every style rule in the sheet, however deep inside `@layer`, `@media`,
 * or a parent rule it sits: Tailwind writes a variant as a rule nested in
 * its utility, so a nested selector is resolved against its parent before
 * it is read, and the layer a rule sits in is kept, because an unlayered
 * rule outranks every layered one whatever their specificity.
 */
export function cssRules(css: string): readonly CssRule[] {
  const rules: CssRule[] = [];
  const bare = css.replaceAll(COMMENT, "");
  const walk = (block: string, parents: readonly string[], layer: string | undefined): void => {
    let at = 0;
    let loose = "";
    for (;;) {
      const open = block.indexOf("{", at);
      if (open === -1) {
        loose += block.slice(at);
        break;
      }
      const preludeStart =
        Math.max(block.lastIndexOf(";", open), block.lastIndexOf("}", open), at - 1) + 1;
      loose += block.slice(at, preludeStart);
      const prelude = block.slice(preludeStart, open).trim();
      let depth = 1;
      let close = open + 1;
      while (depth > 0 && close < block.length) {
        if (block[close] === "{") depth += 1;
        else if (block[close] === "}") depth -= 1;
        close += 1;
      }
      const body = block.slice(open + 1, close - 1);
      const named = LAYER_PRELUDE.exec(prelude)?.[1];
      // A keyframe's steps are no selectors, so an animation's body is passed over.
      if (!KEYFRAMES.test(prelude)) {
        if (prelude.startsWith("@")) walk(body, parents, named ?? layer);
        else walk(body, nestedSelectors(prelude, parents), layer);
      }
      at = close;
    }
    const declarations = declarationsIn(loose);
    if (parents.length > 0 && declarations.size > 0)
      rules.push({ selectors: parents, declarations, layer });
  };
  walk(bare, [], undefined);
  return rules;
}

/** The cascade layers in the order the sheet first names them, which is the order they rank in: a later layer wins. */
export function layerOrder(css: string): readonly string[] {
  const order: string[] = [];
  for (const match of css.matchAll(/@layer\s+([\w.-]+(?:\s*,\s*[\w.-]+)*)\s*[{;]/gu)) {
    for (const name of (match[1] ?? "").split(",").map((each) => each.trim())) {
      if (!order.includes(name)) order.push(name);
    }
  }
  return order;
}

/** The utilities the Tailwind entry compiles to, over the same sources the build scans. */
export async function compiledTailwind(): Promise<string> {
  const compiler = await compile(await readFile(TAILWIND_ENTRY, "utf8"), {
    base: STYLES,
    from: TAILWIND_ENTRY,
    // The build watches what the entry imports; a test reads it once.
    onDependency: () => undefined,
  });
  const scanner = new Scanner({ sources: compiler.sources });
  return compiler.build(scanner.scan());
}

const LOCAL_IMPORT = /^@import\s+"(\.\/[^"]+)";/gmu;

/**
 * The stylesheet the renderer ships, assembled as the build assembles it:
 * the entry's own imports inlined in the order it names them, which is
 * the order the cascade layers rank in, with the Tailwind entry compiled
 * where it stands. Note that esbuild does not run under jsdom, so the
 * test assembles the sheet rather than bundling it, and the package
 * imports (motion tokens) are left out, since they set tokens alone.
 */
export async function builtStylesheet(): Promise<string> {
  const entry = await readFile(STYLESHEET_ENTRY, "utf8");
  const parts: string[] = [];
  for (const match of entry.matchAll(LOCAL_IMPORT)) {
    const file = path.join(STYLES, match[1] ?? "");
    parts.push(file === TAILWIND_ENTRY ? await compiledTailwind() : await readFile(file, "utf8"));
  }
  if (parts.length === 0) throw new Error("the entry names no stylesheet");
  return parts.join("\n");
}

/** A class as Tailwind spells it in a selector: every character beyond a word escaped. */
function escaped(className: string): string {
  return `.${className.replace(/[^a-zA-Z0-9_-]/gu, (character) => `\\${character}`)}`;
}

/** Whether the selector styles the element carrying the class itself, rather than something inside or beside it. */
function stylesSelf(selector: string, className: string): boolean {
  const own = escaped(className);
  if (!selector.startsWith(own)) return false;
  const rest = selector.slice(own.length);
  return rest === "" || rest.startsWith(":");
}

export interface OwnDeclaration {
  readonly property: string;
  readonly value: string;
  readonly className: string;
  /** The selector the declaration stood under, so a caller can tell a `:disabled` variant from the plain utility. */
  readonly selector: string;
}

/** The declarations the sheet gives an element's own box, from every class it carries. */
export function ownDeclarations(
  rules: readonly CssRule[],
  element: Element,
): readonly OwnDeclaration[] {
  return [...element.classList].flatMap((className) =>
    rules.flatMap((rule) =>
      rule.selectors
        .filter((selector) => stylesSelf(selector, className))
        .flatMap((selector) =>
          [...rule.declarations].map(([property, value]) => ({
            property,
            value,
            className,
            selector,
          })),
        ),
    ),
  );
}
