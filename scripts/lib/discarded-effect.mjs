import path from "node:path";
import ts from "typescript";

/**
 * An Effect describes work: writing one as a statement and then walking past
 * it runs nothing at all. That is not a style complaint but a silent bug —
 * #1332 turned `deleteConversation` into an Effect and left a `void ...(...)`
 * caller behind it, so Conversation Clear stopped deleting the local thread
 * and said nothing about it until #1342 found the dropped effect by hand.
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
 * Effect brands each of its three descriptions with a variance property keyed
 * by a `unique symbol`, which the checker names `__@EffectTypeId@<id>`. A
 * value carrying one is a description of work and nothing else.
 */
const DESCRIPTION_TYPE_ID = {
  EFFECT: "EffectTypeId",
  STREAM: "StreamTypeId",
  LAYER: "LayerTypeId",
};

/**
 * A `Fiber` is already running: awaiting it is what running it as an effect
 * means, so it carries `EffectTypeId` without being a description of work
 * nobody began.
 */
const RUNNING_TYPE_ID = "FiberTypeId";

/**
 * An `Exit` has already run, and it carries `EffectTypeId` too, since
 * `Exit.Success` and `Exit.Failure` each extend `Effect`. It has no TypeId of
 * its own, so what tells it apart is the pair of discriminants those two
 * declare and an ordinary `Effect` does not: `_tag` beside `_op`. This is what
 * keeps `await Effect.runPromise(Fiber.interrupt(fiber))` — an awaited `Exit`
 * — from reading as a dropped description.
 */
const SETTLED_DISCRIMINANT = ["_tag", "_op"];

function hasTypeIdNamed(propertyNames, typeId) {
  return propertyNames.some((name) => name.startsWith(`__@${typeId}@`));
}

/** The description a type is, or `null` where it is not one. */
function describedBy(checker, type) {
  const parts = type.isUnion() || type.isIntersection() ? type.types : [type];
  for (const part of parts) {
    const names = checker.getPropertiesOfType(part).map((property) => property.getName());
    if (hasTypeIdNamed(names, RUNNING_TYPE_ID)) continue;
    if (SETTLED_DISCRIMINANT.every((discriminant) => names.includes(discriminant))) continue;
    for (const [described, typeId] of Object.entries(DESCRIPTION_TYPE_ID)) {
      if (hasTypeIdNamed(names, typeId)) return described;
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
