import assert from "node:assert/strict";
import { DICTATION_BOUNDS } from "@sidecar/hosted/dictation-wire";
import { test } from "vitest";
import { dictationKeywords } from "./dictation-keywords";

/**
 * The words a dictation listens for, read off a plan: the repository, the
 * title, and the paths and files the document spells, each once, and none
 * the wire would refuse.
 */

test("the repository, its own name, the title, then the paths and files the document names, each once", () => {
  const body = [
    "# Teammate invitations",
    "Change `apps/web/server/invite-app.ts` and apps/web/server/invite-app.ts again,",
    "then the form in invite-form.tsx, read with pnpm and useEffect.",
  ].join("\n");

  assert.deepEqual(
    dictationKeywords({ repository: "acme/relay", title: "Teammate invitations", body }),
    [
      "acme/relay",
      "relay",
      "Teammate invitations",
      "apps/web/server/invite-app.ts",
      "invite-app.ts",
      "invite-form.tsx",
    ],
  );
});

test("a plan with no repository, no title, and no document listens for nothing", () => {
  assert.deepEqual(dictationKeywords({ repository: null, title: undefined, body: undefined }), []);
});

test("a word the wire would refuse is left out rather than cut, and no more words go than the wire takes", () => {
  const long = `src/${"deep/".repeat(30)}file.ts`;
  const many = Array.from({ length: DICTATION_BOUNDS.MAX_KEYWORDS + 10 }, (_, n) => `dir/f${n}.ts`);

  const words = dictationKeywords({
    repository: null,
    title: "<b>Bold</b> title",
    body: [long, ...many].join(" "),
  });

  assert.equal(words.length, DICTATION_BOUNDS.MAX_KEYWORDS);
  assert.ok(!words.includes(long), "a path past the bound is not cut to fit");
  assert.ok(words.every((word) => !/[<>]/u.test(word)));
  assert.ok(words.every((word) => word.length <= DICTATION_BOUNDS.MAX_KEYWORD_CHARS));
});
