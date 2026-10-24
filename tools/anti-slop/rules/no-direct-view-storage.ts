import type { ESTree } from "@oxlint/plugins";
import { defineRule } from "@oxlint/plugins";

import { baselineProblems } from "../shared/baseline.ts";
import { repositoryPathOf, TYPESCRIPT_SOURCE } from "../shared/effect-edges.ts";
import {
  isDoorFile,
  isKeptStorageModule,
  isTestFile,
  KEPT_STORAGE_BASELINE,
  NOT_VIEW_STORAGE,
  STORAGE_OBJECTS,
} from "../shared/kept-guard.ts";

/**
 * A view choice (a fold, a filter, a sort, a view mode, a width, where a list
 * stood scrolled) is read and written through `useKept`, and nothing else
 * stores one. Outside `use-kept.ts` and the storage under it, a read of the
 * window's `localStorage` or `sessionStorage`, or an import of
 * `kept-storage.ts`'s helpers, is refused. Storage that is no view choice (a
 * draft, a credential's handling, a cache, a read mark) is named in
 * `kept-storage-allowed.json` with its reason, and the files that still keep
 * a view choice by hand are on `kept-storage-baseline.json`, which only
 * shrinks.
 */

/** The storage object a member expression names, where it names one: `window.localStorage`, `localStorage.getItem`, `tab["sessionStorage"]`. */
function storageNamed(node: ESTree.MemberExpression): string | undefined {
  const { object, property } = node;
  if (object.type === "Identifier" && STORAGE_OBJECTS.has(object.name)) return object.name;
  if (!node.computed && property.type === "Identifier" && STORAGE_OBJECTS.has(property.name)) {
    return property.name;
  }
  if (node.computed && property.type === "Literal" && typeof property.value === "string") {
    return STORAGE_OBJECTS.has(property.value) ? property.value : undefined;
  }
  return undefined;
}

export const noDirectViewStorageRule = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow storing a view choice outside useKept, from a baseline that only shrinks; storage that is no view choice is named with its reason.",
    },
    messages: {
      newStorage:
        "`{{what}}` keeps a view choice outside `useKept`. Read and write a fold, a filter, a sort, a view mode, a width or a scroll position through `useKept` (`packages/panel/src/use-kept.ts`) with a `keptKey` that holds the stored name and its Schema. Storage that is no view choice goes in `tools/anti-slop/kept-storage-allowed.json` with its reason.",
      staleBaseline:
        "This file touches the window's storage {{found}} time(s), fewer than `tools/anti-slop/kept-storage-baseline.json` allows ({{expected}}). Lower its count to {{found}}, or delete the row at 0.",
      staleAllowed:
        "This file is named in `tools/anti-slop/kept-storage-allowed.json` but touches no storage. Delete its row.",
    },
  },
  createOnce(context) {
    let file = "";
    let places: { node: ESTree.Node; what: string }[] = [];
    let expected = 0;
    let allowed = false;

    return {
      before() {
        file = repositoryPathOf(context.filename);
        if (!TYPESCRIPT_SOURCE.test(file) || isDoorFile(file) || isTestFile(file)) return false;
        places = [];
        expected = KEPT_STORAGE_BASELINE[file] ?? 0;
        allowed = NOT_VIEW_STORAGE[file] !== undefined;
        return true;
      },
      MemberExpression(node) {
        const storage = storageNamed(node);
        if (storage !== undefined) places.push({ node, what: storage });
      },
      ImportDeclaration(node) {
        if (isKeptStorageModule(node.source.value)) {
          places.push({ node, what: "kept-storage" });
        }
      },
      "Program:exit"(program) {
        if (allowed) {
          if (places.length === 0) context.report({ node: program, messageId: "staleAllowed" });
          return;
        }
        const counts = new Map([[file, places.length]]);
        const baseline = expected === 0 ? {} : { [file]: expected };
        for (const problem of baselineProblems(counts, baseline, true)) {
          if (problem.grew) {
            // Note that the places past the baseline's count are the ones reported, since the ones before it were already there.
            for (const { node, what } of places.slice(expected)) {
              context.report({ node, messageId: "newStorage", data: { what } });
            }
          } else {
            context.report({
              node: program,
              messageId: "staleBaseline",
              data: { found: String(places.length), expected: String(expected) },
            });
          }
        }
      },
    };
  },
});
