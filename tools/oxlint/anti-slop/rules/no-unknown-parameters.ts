import type { ESTree, SourceCode } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { lexicalTypeParameterNames } from "../shared/lexical-type-parameters.ts";

type Parameter = ESTree.ParamPattern;
type ParameterOwner =
  | ESTree.ArrowFunctionExpression
  | ESTree.Function
  | ESTree.TSCallSignatureDeclaration
  | ESTree.TSConstructSignatureDeclaration
  | ESTree.TSConstructorType
  | ESTree.TSFunctionType
  | ESTree.TSMethodSignature;

function parameterAnnotation(parameter: Parameter): ESTree.TSTypeAnnotation | null | undefined {
  if (parameter.type === "TSParameterProperty") {
    return parameterAnnotation(parameter.parameter);
  }
  if (parameter.type === "RestElement") {
    return parameter.typeAnnotation ?? parameterAnnotation(parameter.argument);
  }
  if (parameter.type === "AssignmentPattern") {
    return parameter.typeAnnotation ?? parameter.left.typeAnnotation;
  }
  return parameter.typeAnnotation;
}

function parameterName(parameter: Parameter, sourceCode: SourceCode): string {
  if (parameter.type === "TSParameterProperty") {
    return parameterName(parameter.parameter, sourceCode);
  }
  if (parameter.type === "AssignmentPattern") {
    return parameterName(parameter.left, sourceCode);
  }
  if (parameter.type === "RestElement") {
    return parameterName(parameter.argument, sourceCode);
  }
  return parameter.type === "Identifier"
    ? parameter.name
    : sourceCode.getText(parameter).replace(/\s*:\s*(?:object|unknown)\s*$/u, "");
}

/**
 * Disallow the two unparsed function inputs, `unknown` and the broad `object`,
 * the former except for explicitly named error-cause enrichment.
 */
export const noUnknownParametersRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow explicitly unknown function parameters except `cause`, and the broad object type including local aliases to it; decode input at its I/O boundary instead.",
    },
    messages: {
      unknownParameter:
        "Parameter `{{parameter}}` leaves input unparsed. Accept a named domain type; run the expected schema or parser at the I/O boundary before calling this function.",
      objectParameter:
        "Parameter `{{parameter}}` uses the broad `object` type. Accept a named owner type; parse external input at its boundary before calling this function.",
    },
  },
  createOnce(context) {
    const aliases = new Map<string, ESTree.TSType>();

    const resolvesToObject = (
      type: ESTree.TSType,
      shadowedAliases: ReadonlySet<string>,
      visited = new Set<string>(),
    ): boolean => {
      if (type.type === "TSObjectKeyword") return true;
      if (type.type === "TSParenthesizedType")
        return resolvesToObject(type.typeAnnotation, shadowedAliases, visited);
      if (type.type === "TSUnionType") {
        return type.types.some((member) => resolvesToObject(member, shadowedAliases, visited));
      }
      if (
        type.type !== "TSTypeReference" ||
        type.typeName.type !== "Identifier" ||
        (type.typeArguments !== null &&
          type.typeArguments !== undefined &&
          type.typeArguments.params.length > 0) ||
        visited.has(type.typeName.name) ||
        shadowedAliases.has(type.typeName.name)
      ) {
        return false;
      }
      const alias = aliases.get(type.typeName.name);
      if (alias === undefined) return false;
      const nextVisited = new Set(visited);
      nextVisited.add(type.typeName.name);
      return resolvesToObject(alias, shadowedAliases, nextVisited);
    };

    const unparsedInput = (
      type: ESTree.TSType,
      shadowedAliases: ReadonlySet<string>,
    ): "objectParameter" | "unknownParameter" | null => {
      if (type.type === "TSUnknownKeyword") return "unknownParameter";
      return resolvesToObject(type, shadowedAliases) ? "objectParameter" : null;
    };

    const checkParameters = (node: ParameterOwner) => {
      const shadowedAliases = lexicalTypeParameterNames(node, context.sourceCode.visitorKeys);
      for (const parameter of node.params) {
        const annotation = parameterAnnotation(parameter);
        if (annotation === null || annotation === undefined) continue;
        const messageId = unparsedInput(annotation.typeAnnotation, shadowedAliases);
        if (messageId === null) continue;
        const name = parameterName(parameter, context.sourceCode);
        if (messageId === "unknownParameter" && name === "cause") continue;
        context.report({
          node: annotation.typeAnnotation,
          messageId,
          data: { parameter: name },
        });
      }
    };

    return {
      Program(node) {
        aliases.clear();
        for (const statement of node.body) {
          const declaration =
            statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
          if (
            declaration?.type === "TSTypeAliasDeclaration" &&
            (declaration.typeParameters === null || declaration.typeParameters === undefined)
          ) {
            aliases.set(declaration.id.name, declaration.typeAnnotation);
          }
        }
      },
      ArrowFunctionExpression: checkParameters,
      FunctionDeclaration: checkParameters,
      FunctionExpression: checkParameters,
      TSCallSignatureDeclaration: checkParameters,
      TSConstructSignatureDeclaration: checkParameters,
      TSConstructorType: checkParameters,
      TSDeclareFunction: checkParameters,
      TSEmptyBodyFunctionExpression: checkParameters,
      TSFunctionType: checkParameters,
      TSMethodSignature: checkParameters,
    };
  },
});
