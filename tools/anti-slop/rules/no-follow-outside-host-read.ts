import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { repositoryPathOf } from "../shared/effect-edges.ts";
import {
  FOLLOW_OPENERS,
  isHoldDoor,
  isReadKind,
  isWatchedSource,
  namesHoldDoor,
} from "../shared/host-read-guard.ts";
import { literalText } from "../shared/test-guard.ts";

const REPEATERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["Effect", new Set(["forever", "repeat"])],
  ["Stream", new Set(["fromEffectSchedule"])],
]);

const PROMISE_RUNNERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["Effect", new Set(["tryPromise", "promise"])],
]);

function memberNamed(
  node: ESTree.MemberExpression,
): { readonly object: string; readonly name: string } | undefined {
  const { object, property } = node;
  if (node.computed || object.type !== "Identifier" || property.type !== "Identifier") {
    return undefined;
  }
  return { object: object.name, name: property.name };
}

function answersRead(node: ESTree.MemberExpression): boolean {
  const parent = (node as { parent?: ESTree.Node }).parent;
  if (parent?.type === "Property") return parent.computed && parent.key === node;
  return (
    parent?.type === "BinaryExpression" && (parent.operator === "===" || parent.operator === "!==")
  );
}

export const noFollowOutsideHostReadRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow reading data a surface shows outside useHostRead, and importing the door it holds its reads open by anywhere else.",
    },
    messages: {
      newRead:
        "`{{what}}` reads server data outside `useHostRead`. Read server data through a live read's query (`packages/panel/src/live-reads.ts`), or `useHostRead` (`packages/panel/src/use-host-read.ts`) for a read not moved there yet, over the app-state slice the host fills for the read (`@repo/host`'s `live-collection.ts`).",
      newPoll:
        "`{{what}}` polls a promise, which reads server data outside `useHostRead`. Read server data through `useHostRead` (`packages/panel/src/use-host-read.ts`), which the host keeps current, rather than asking again on a timer.",
      doorImport:
        "`{{source}}` is the door `useHostRead` and the live reads' queries hold their reads open by, which no other module imports. Read server data through a live read's query (`packages/panel/src/live-reads.ts`) or `useHostRead` (`packages/panel/src/use-host-read.ts`) instead.",
    },
  },
  createOnce(context) {
    let reads: { node: ESTree.Node; what: string }[] = [];
    let repeats: { node: ESTree.Node; what: string }[] = [];
    let runsPromise = false;
    let door = false;

    function noteImport(node: ESTree.Node, source: string | undefined): void {
      if (source !== undefined && namesHoldDoor(source)) {
        context.report({ node, messageId: "doorImport", data: { source } });
      }
    }

    return {
      before() {
        const file = repositoryPathOf(context.filename);
        if (!isWatchedSource(file)) return false;
        reads = [];
        repeats = [];
        runsPromise = false;
        door = isHoldDoor(file);
        return true;
      },
      ImportDeclaration(node) {
        noteImport(node, node.source.value);
      },
      ExportAllDeclaration(node) {
        noteImport(node, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source) noteImport(node, node.source.value);
      },
      ImportExpression(node) {
        noteImport(node, literalText(node.source));
      },
      CallExpression(node) {
        const { callee } = node;
        if (callee.type !== "Identifier") return;
        if (FOLLOW_OPENERS.has(callee.name)) reads.push({ node, what: callee.name });
        if (callee.name === "require") noteImport(node, literalText(node.arguments[0]));
      },
      MemberExpression(node) {
        const named = memberNamed(node);
        if (named === undefined) return;
        const { object, name } = named;
        if (object.endsWith("ACT_KIND") && isReadKind(name) && !answersRead(node)) {
          reads.push({ node, what: name });
        }
        if (REPEATERS.get(object)?.has(name)) repeats.push({ node, what: `${object}.${name}` });
        if (PROMISE_RUNNERS.get(object)?.has(name)) runsPromise = true;
      },
      "Program:exit"() {
        if (door) return;
        const polls = runsPromise ? repeats : [];
        for (const { node, what } of reads) {
          context.report({ node, messageId: "newRead", data: { what } });
        }
        for (const { node, what } of polls) {
          context.report({ node, messageId: "newPoll", data: { what } });
        }
      },
    };
  },
});
