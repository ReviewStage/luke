import path from "node:path";
import ts from "typescript";

const DESCRIPTION_BRAND = {
  EFFECT: "~effect/Effect",
  STREAM: "~effect/Stream",
  LAYER: "~effect/Layer",
};

const SETTLED_BRAND = "~effect/Exit";

function hasBrand(propertyNames, brand) {
  return propertyNames.includes(brand);
}

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

function discardedExpression(statement) {
  let expression = withoutParentheses(statement.expression);
  while (ts.isVoidExpression(expression)) expression = withoutParentheses(expression.expression);
  const called = ts.isAwaitExpression(expression)
    ? withoutParentheses(expression.expression)
    : expression;
  return ts.isCallExpression(called) ? expression : null;
}

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

export function discardedAt(one) {
  return `${one.file}:${one.line}:${one.description}`;
}

export function compilerOptionsFrom(root, baseCompilerOptions) {
  const parsed = ts.parseJsonConfigFileContent(
    { compilerOptions: { ...baseCompilerOptions, types: ["node"] }, files: [] },
    ts.sys,
    root,
  );
  return parsed.options;
}
