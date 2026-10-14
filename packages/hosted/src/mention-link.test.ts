import assert from "node:assert/strict";
import { test } from "vitest";
import {
  decodeMention,
  encodeMention,
  isMentionLabel,
  MENTION_KIND,
  type Mention,
  mentionMarkdown,
  mentionName,
} from "./mention-link.js";

const PLAN: Mention = { kind: MENTION_KIND.PLAN, planId: "pl_7Hq2Xc" };

test("a plan and a section read back as the mention they were written from", () => {
  const section: Mention = { kind: MENTION_KIND.SECTION, planId: "pl_7Hq2Xc", heading: "Rollout" };

  assert.deepEqual(decodeMention(encodeMention(PLAN)), PLAN);
  assert.deepEqual(decodeMention(encodeMention(section)), section);
});

test("a heading keeps every character it is spelled in through its target", () => {
  for (const heading of [
    "Auth token refresh",
    "Step #2: (re)try once!",
    "Größe & Ölçü — 次の手順",
    "100% done, then *ship*",
    "a/b?c=d",
  ]) {
    const section: Mention = { kind: MENTION_KIND.SECTION, planId: "pl_1", heading };

    assert.deepEqual(decodeMention(encodeMention(section)), section, heading);
  }
});

test("a section's target never closes the markdown link it is written in", () => {
  const target = encodeMention({ kind: MENTION_KIND.SECTION, planId: "pl_1", heading: "a) b (c" });

  assert.equal(/[\s()]/u.test(target), false);
});

test("a link that names no mention reads as none", () => {
  for (const target of [
    "https://linear.app/luke/issue/LUKE-142",
    "luke://page/pg_1",
    "luke://plan/",
    "luke://plan/pl_1#%E0%A4%A",
    "not a link",
    `luke://plan/pl_1#${"x".repeat(5_000)}`,
  ]) {
    assert.equal(decodeMention(target), undefined, target);
  }
});

test("a mention is written as a link whose label starts with @, its brackets escaped", () => {
  const written = mentionMarkdown(
    { kind: MENTION_KIND.SECTION, planId: "pl_1", heading: "Rollout" },
    "Rollout [draft]",
  );

  assert.equal(written, "[@Rollout \\[draft\\]](luke://plan/pl_1#Rollout)");
});

test("only a label that starts with @ and says more is a mention's, which its chip names without the @", () => {
  assert.equal(isMentionLabel("@Rollout"), true);
  assert.equal(isMentionLabel("Rollout"), false);
  assert.equal(isMentionLabel("@"), false);
  assert.equal(mentionName("@Rollout"), "Rollout");
});

test("a heading at its bound in the widest characters still reads back from its target", () => {
  const section: Mention = {
    kind: MENTION_KIND.SECTION,
    planId: "pl_1",
    heading: "語".repeat(1_000),
  };

  assert.deepEqual(decodeMention(encodeMention(section)), section);
});
