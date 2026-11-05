import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";
import {
  FOLLOW_OPENERS,
  isHoldDoor,
  isReadKind,
  isWatchedSource,
  namesHoldDoor,
} from "../shared/host-read-guard.ts";
import { repositoryPathOf } from "../shared/repository-path.ts";
import { literalText } from "../shared/test-guard.ts";

/**
 * Server data reaches a surface only through `useHostRead`
 * (`packages/panel/src/use-host-read.ts`), over the app-state slice the host
 * fills for each read. Outside that module, the panel's and the design
 * system's code reads none of its own: no call of `streamFrom` or
 * `followStream`, no act kind `@repo/host`'s `PORT_ACT_USE` declares a READ,
 * however it is spelled, but as a fixture's answer or a comparison, and no
 * poll of a promise. The hook holds its reads open through one door,
 * `act-stream.ts`, which opens and polls on the hook's behalf and so is
 * excused all three; no module but the hook imports it, in any form.
 */

/** The Effect and Stream members that run an effect again and again: a poll, where what they run is a promise. */
const REPEATERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["Effect", new Set(["forever", "repeat"])],
  ["Stream", new Set(["fromEffectSchedule"])],
]);

/** The Effect members that run a promise, such as an act sent on the port. */
const PROMISE_RUNNERS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ["Effect", new Set(["tryPromise", "promise"])],
]);

/** The object and member a member expression spells, as `ACT_KIND.TASKS_COMMENTS_FOLLOW` or `Effect.forever`, where it spells both by name. */
function memberNamed(
  node: ESTree.MemberExpression,
): { readonly object: string; readonly name: string } | undefined {
  const { object, property } = node;
  if (node.computed || object.type !== "Identifier" || property.type !== "Identifier") {
    return undefined;
  }
  return { object: object.name, name: property.name };
}

/**
 * Whether a read kind stands where it reads nothing: an object literal's
 * computed key, as a fixture answers a kind, or one side of `===` or `!==`,
 * as a fixture tells which kind it was asked. Anywhere else, a call's
 * argument, the port's member, or a local it is kept in, it reads.
 */
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
        "`{{what}}` reads server data outside `useHostRead`. Read server data through `useHostRead` (`packages/panel/src/use-host-read.ts`) over the app-state slice the host fills for the read (`@repo/host`'s `live-collection.ts`).",
      newPoll:
        "`{{what}}` polls a promise, which reads server data outside `useHostRead`. Read server data through `useHostRead` (`packages/panel/src/use-host-read.ts`), which the host keeps current, rather than asking again on a timer.",
      doorImport:
        "`{{source}}` is the door `useHostRead` holds its reads open by, which no other module imports. Read server data through `useHostRead` (`packages/panel/src/use-host-read.ts`) instead.",
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
        // Note that a repeat counts only beside a promise, because a clock's tick repeats too.
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
