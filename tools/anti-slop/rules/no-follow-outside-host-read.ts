import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { repositoryPathOf } from "../shared/effect-edges.ts";
import {
  FOLLOW_OPENERS,
  isFollowKind,
  isWatchedPanelSource,
  UNMIGRATED_FOLLOWS,
} from "../shared/host-read-guard.ts";

/**
 * Server data reaches a surface only through `useHostRead`
 * (`packages/panel/src/use-host-read.ts`), over the app-state slice the host
 * fills for each read. Outside that module, panel code opens no follow of
 * its own: no call of `streamFrom` or `followStream`, and no act of a follow
 * kind, handed to a call or read off the act port, nor of a one-shot read
 * whose rows a host read already carries. The files not yet moved
 * are named in `follows-unmigrated.json` with the migration step that moves
 * each, and one that opens none fails, so the list only shrinks.
 */

/** The follow kind a member expression names, where it names one: `ACT_KIND.CHANNELS_FOLLOW`. */
function followKindNamed(node: ESTree.MemberExpression): string | undefined {
  const { object, property } = node;
  if (node.computed || object.type !== "Identifier" || property.type !== "Identifier") {
    return undefined;
  }
  if (!object.name.endsWith("ACT_KIND")) return undefined;
  return isFollowKind(property.name) ? property.name : undefined;
}

/** Whether a follow kind stands where it opens a follow: handed to a call, or read off the act port by it. */
function opensFollow(node: ESTree.MemberExpression): boolean {
  const parent = (node as { parent?: ESTree.Node }).parent;
  if (parent?.type === "CallExpression") return parent.arguments.includes(node);
  return parent?.type === "MemberExpression" && parent.computed && parent.property === node;
}

export const noFollowOutsideHostReadRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow opening a follow, or a read a host read replaces, outside useHostRead; the files not yet moved are named with their migration step.",
    },
    messages: {
      newFollow:
        "`{{what}}` reads server data outside `useHostRead`. Read server data through `useHostRead` (`packages/panel/src/use-host-read.ts`) over the app-state slice the host fills for the read (`@luke/host`'s `live-collection.ts`).",
      staleListed:
        "This file is named in `tools/anti-slop/follows-unmigrated.json` but reads nothing outside `useHostRead`. Delete its row.",
    },
  },
  createOnce(context) {
    let follows: { node: ESTree.Node; what: string }[] = [];
    let listed = false;

    return {
      before() {
        const file = repositoryPathOf(context.filename);
        if (!isWatchedPanelSource(file)) return false;
        follows = [];
        listed = UNMIGRATED_FOLLOWS[file] !== undefined;
        return true;
      },
      CallExpression(node) {
        const { callee } = node;
        if (callee.type === "Identifier" && FOLLOW_OPENERS.has(callee.name)) {
          follows.push({ node, what: callee.name });
        }
      },
      MemberExpression(node) {
        const kind = followKindNamed(node);
        if (kind !== undefined && opensFollow(node)) follows.push({ node, what: kind });
      },
      "Program:exit"(program) {
        if (listed) {
          if (follows.length === 0) context.report({ node: program, messageId: "staleListed" });
          return;
        }
        for (const { node, what } of follows) {
          context.report({ node, messageId: "newFollow", data: { what } });
        }
      },
    };
  },
});
