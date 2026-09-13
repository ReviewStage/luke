import path from "node:path";
import ts from "typescript";

/**
 * An Effect describes work: writing one as a statement and then walking past
 * it runs nothing at all. That is not a style complaint but a silent bug: a
 * `void ...(...)` left behind when a call turns into an Effect quietly drops
 * whatever it was meant to do, and nothing before this check said so.
 *
 * Deciding it needs types: the expression is an ordinary call, and only its
 * type says whether what came back was a description or a result. The oxlint
 * plugins in `tools/oxlint/anti-slop` see an AST and no checker, so this check
 * lives here instead, over a program of its own.
 *
 * The compiler is the one `apps/web` already compiles under (6.0.3, `catalog:web`)
 * rather than the repository's own 7.0.2: TypeScript 7 is the native compiler
 * and ships `tsc` alone, with no `createProgram` for a checker to be asked
 * questions through. Nothing is emitted and no diagnostic is read, so the two
 * compilers only have to agree about which values are Effects.
 */

/**
 * Effect brands each of its three descriptions with a property whose name is a
 * plain string literal — v4 retired the `unique symbol` variance keys the
 * checker used to name `__@EffectTypeId@<id>`. A value carrying one is a
 * description of work and nothing else.
 */
const DESCRIPTION_BRAND = {
  EFFECT: "~effect/Effect",
  STREAM: "~effect/Stream",
  LAYER: "~effect/Layer",
};

/**
 * An `Exit` has already run, and it carries `~effect/Effect` too, since
 * `Exit.Success` and `Exit.Failure` each extend `Effect`. What tells it apart
 * is the brand of its own that v4 gives it. This is what keeps
 * `await Effect.runPromise(Fiber.interrupt(fiber))` — an awaited `Exit` — from
 * reading as a dropped description, and `valid.ts` pins it.
 *
 * A `Fiber` needs no such exclusion: v4's `Fiber` extends `Pipeable` alone, so
 * a fiber somebody detached and walked past carries no description brand at
 * all. `valid.ts` pins that too, so the day it stops being true the canary
 * says so rather than the repository quietly gaining a false positive.
 */
const SETTLED_BRAND = "~effect/Exit";

/**
 * Whole names, never a prefix: `~effect/Layer/MemoMap` is a brand of its own,
 * and a prefix test would read a memo map as the layer it memoizes.
 */
function hasBrand(propertyNames, brand) {
  return propertyNames.includes(brand);
}

/** The description a type is, or `null` where it is not one. */
function describedBy(checker, type) {
  const parts = type.isUnion() || type.isIntersection() ? type.types : [type];
  for (const part of parts) {
    const names = checker.getPropertiesOfType(part).map((property) => property.getName());
    if (hasBrand(names, SETTLED_BRAND)) continue;
    for (const [described, brand] of Object.entries(DESCRIPTION_BRAND)) {
      if (hasBrand(names, brand)) return described;
    }
  }
  return null;
}

function withoutParentheses(expression) {
  let inner = expression;
  while (ts.isParenthesizedExpression(inner)) inner = inner.expression;
  return inner;
}

/**
 * The expression a statement discards, or `null` where it discards none. What
 * is read is always a call: `yield*` has already handed the work to the fiber
 * running the generator, an assignment keeps the description for a later step,
 * and a bare identifier says nothing about where the value came from.
 *
 * `void` in front of a call is the shape that hides the bug rather than one
 * that excuses it, and `await` is the same: an `Effect` is not thenable, so
 * `await deleteConversation(...)` answers the description itself and runs
 * nothing, which is exactly the leftover a Promise-to-Effect migration
 * strands. So the await is read too, and what is typed is the awaited value:
 * a call that really did answer a `Promise<void>` types as `void` here and is
 * no discard at all.
 */
function discardedExpression(statement) {
  let expression = withoutParentheses(statement.expression);
  while (ts.isVoidExpression(expression)) expression = withoutParentheses(expression.expression);
  const called = ts.isAwaitExpression(expression)
    ? withoutParentheses(expression.expression)
    : expression;
  return ts.isCallExpression(called) ? expression : null;
}

/** Every statement in `rootNames` that describes work and drops it. */
export function findDiscardedEffects({ root, rootNames, compilerOptions }) {
  const program = ts.createProgram({ rootNames, options: compilerOptions });
  const checker = program.getTypeChecker();
  const discarded = [];

  for (const file of program.getSourceFiles()) {
    if (file.isDeclarationFile) continue;
    const relativePath = path.relative(root, file.fileName).split(path.sep).join("/");
    if (relativePath.startsWith("..") || relativePath.includes("node_modules")) continue;
    const visit = (node) => {
      if (ts.isExpressionStatement(node)) {
        const dropped = discardedExpression(node);
        const description =
          dropped === null ? null : describedBy(checker, checker.getTypeAtLocation(dropped));
        if (description !== null) {
          discarded.push({
            file: relativePath,
            line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
            description,
            text: node.getText(file).split("\n", 1)[0].trim(),
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }

  return discarded;
}

/**
 * The fixture pair under `scripts/fixtures/discarded-effect`, compiled inside
 * the same program the repository is read through and asserted against before
 * its answer is believed. A program that resolved no `effect` types would
 * report nothing and read as a clean repository; this is what tells the two
 * apart, and it is the same pair `scripts/discarded-effect.test.mjs` pins.
 */
export const CANARY = {
  DIRECTORY: "scripts/fixtures/discarded-effect",
  DISCARDED: [
    "scripts/fixtures/discarded-effect/invalid.ts:8:EFFECT",
    "scripts/fixtures/discarded-effect/invalid.ts:10:EFFECT",
    "scripts/fixtures/discarded-effect/invalid.ts:11:EFFECT",
    "scripts/fixtures/discarded-effect/invalid.ts:12:EFFECT",
    "scripts/fixtures/discarded-effect/invalid.ts:13:STREAM",
    "scripts/fixtures/discarded-effect/invalid.ts:14:LAYER",
  ],
};

/** A discard as `CANARY.DISCARDED` writes one. */
export function discardedAt(one) {
  return `${one.file}:${one.line}:${one.description}`;
}

/** The repository's own compiler options, with the type packages every workspace uses. */
export function compilerOptionsFrom(root, baseCompilerOptions) {
  const parsed = ts.parseJsonConfigFileContent(
    { compilerOptions: { ...baseCompilerOptions, types: ["node"] }, files: [] },
    ts.sys,
    root,
  );
  return parsed.options;
}
