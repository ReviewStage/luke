import assert from "node:assert/strict";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@luke/features/workspace-wire";
import { test } from "vitest";
import {
  ACTOR_KIND,
  ACTOR_STATE,
  actorName,
  identityHue,
  identityLetter,
  LUKE_ACTOR,
  personActor,
  SOMEONE_REASON,
} from "./actor-model.js";

/**
 * Whoever did something is named in the reader's own words, "you" and
 * "your" for their own, a teammate by name, and a member read against the
 * workspace's members for their picture, or as having left where the read
 * no longer lists them. Synthetic accounts.
 */

const DANA: WorkspaceMember = {
  userId: "user-dana",
  name: "Dana Reyes",
  email: "dana@example.com",
  role: WORKSPACE_ROLE.OWNER,
  pictureUrl: "https://avatars.githubusercontent.com/u/3",
};
const SAM: WorkspaceMember = {
  userId: "user-sam",
  name: "Sam Okafor",
  email: "sam@example.com",
  role: WORKSPACE_ROLE.MEMBER,
};

test("an actor is named as the reader says them, in a sentence and as whose", () => {
  const you = personActor(DANA, [DANA, SAM], DANA.userId);
  const sam = personActor(SAM, [DANA, SAM], DANA.userId);
  const agent = {
    kind: ACTOR_KIND.AGENT,
    name: "Fix auth flow",
    provider: undefined,
    state: ACTOR_STATE.WORKING,
  } as const;

  assert.deepEqual(
    [
      actorName(you),
      actorName(you, { sentence: true }),
      actorName(you, { sentence: true, possessive: true }),
      actorName(sam, { possessive: true }),
      actorName(LUKE_ACTOR, { sentence: true }),
      actorName(agent, { sentence: true }),
      actorName({ kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.UNNAMED }, { sentence: true }),
    ],
    ["You", "you", "your", "Sam Okafor’s", "Luke", "Fix auth flow", "someone"],
  );
});

test("a member named on the wire is read against the workspace's members: their picture and role, the reader's own as You, and one no longer listed as a former member", () => {
  assert.deepEqual(personActor({ userId: DANA.userId, name: "Dana" }, [DANA, SAM], SAM.userId), {
    kind: ACTOR_KIND.PERSON,
    userId: DANA.userId,
    name: DANA.name,
    email: DANA.email,
    role: WORKSPACE_ROLE.OWNER,
    pictureUrl: DANA.pictureUrl,
    you: false,
  });
  assert.deepEqual(personActor({ userId: "user-lee", name: "Lee Park" }, [DANA, SAM], SAM.userId), {
    kind: ACTOR_KIND.SOMEONE,
    reason: SOMEONE_REASON.FORMER,
    name: "Lee Park",
  });
  // Before the members answer, the wire's name stands alone and nobody is taken for gone.
  assert.deepEqual(personActor({ userId: "user-lee", name: "Lee Park" }, undefined, SAM.userId), {
    kind: ACTOR_KIND.PERSON,
    userId: "user-lee",
    name: "Lee Park",
    you: false,
  });
  assert.deepEqual(personActor(undefined, [DANA, SAM], SAM.userId), {
    kind: ACTOR_KIND.SOMEONE,
    reason: SOMEONE_REASON.UNNAMED,
  });
});

test("an identity's hue is read off its id alone, so a rename keeps it, and its letter is the first character a reader sees", () => {
  assert.equal(identityHue("user-dana"), identityHue("user-dana"));
  assert.ok(identityHue("user-dana") >= 1 && identityHue("user-dana") <= 6);
  assert.notEqual(identityHue("user-dana"), identityHue("user-sam"));
  assert.deepEqual(
    [identityLetter("  dana"), identityLetter("👩🏽‍💻 Ops"), identityLetter("")],
    ["D", "👩🏽‍💻", ""],
  );
});
