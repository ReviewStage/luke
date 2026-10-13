import assert from "node:assert/strict";
import { PLAN_FILE_REFUSAL } from "@sidecar/hosted/plan-wire";
import { PLAN_CALL_FAILURE, type PlanningSkillsAnswer } from "@sidecar/hosted/planning-view";
import { test } from "vitest";
import { keptSkills } from "./repository-skills";

/**
 * The open plan's skills as the `/` list reads them: kept once read, so
 * the list opened again shows what it showed; a refusal said in the list's
 * words and not kept, so the next `/` asks again; and a read that did not
 * land, or failed outright, said as GitHub unreadable and asked again too.
 */

const READ: PlanningSkillsAnswer = {
  skills: {
    repository: "acme/relay",
    branch: "main",
    skills: [{ name: "release-notes", description: "Use for release notes." }],
  },
};

/** A service answering the answers given in turn, the last one again once they run out. */
function answering(...answers: readonly (PlanningSkillsAnswer | Error)[]) {
  let at = 0;
  return () => {
    const answer = answers[Math.min(at, answers.length - 1)];
    at += 1;
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer ?? READ);
  };
}

test("skills once read are kept, so the list shows the same skills however often it opens", async () => {
  const source = keptSkills(
    answering(READ, { skills: { repository: "acme/relay", branch: "main", skills: [] } }),
  );
  assert.deepEqual(await source(), { skills: READ.skills.skills });
  assert.deepEqual(await source(), { skills: READ.skills.skills });
});

test("a refusal is said in the list's words and asked again next time; a read that did not land or failed is said as GitHub unreadable and asked again too", async () => {
  const source = keptSkills(
    answering(
      { refusal: PLAN_FILE_REFUSAL.SIGN_IN_REQUIRED },
      { failure: PLAN_CALL_FAILURE.UNANSWERED },
      new Error("the window went away"),
      READ,
    ),
  );
  assert.deepEqual(await source(), {
    unread: "Connect GitHub in Settings to read this repository's skills.",
  });
  assert.deepEqual(await source(), { unread: "GitHub could not be read just now." });
  assert.deepEqual(await source(), { unread: "GitHub could not be read just now." });
  assert.deepEqual(await source(), { skills: READ.skills.skills });
});
