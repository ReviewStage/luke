import assert from "node:assert/strict";
import { PLAN_ACTOR, type PlanSectionEdit } from "@luke/features/task-wire";
import { WORKSPACE_ROLE, type WorkspaceMember } from "@luke/features/workspace-wire";
import { test } from "vitest";
import {
  ACTOR_KIND,
  ACTOR_STATE,
  type Actor,
  type ActorActivity,
  accountActor,
  activityWords,
  actorName,
  creatorActor,
  distinctActors,
  type EditReader,
  editActor,
  editCallOwner,
  githubActor,
  identityHue,
  identityLetter,
  LUKE_ACTOR,
  latestActivity,
  personActor,
  SOMEONE_REASON,
  teammateCreator,
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
      actorName(you, { possessive: true }),
      actorName(you, { sentence: true, possessive: true }),
      actorName(sam, { possessive: true }),
      actorName(LUKE_ACTOR, { sentence: true }),
      actorName(agent, { sentence: true }),
      actorName({ kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.UNNAMED }, { sentence: true }),
    ],
    ["You", "you", "Your", "your", "Sam Okafor’s", "Luke", "Fix auth flow", "someone"],
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
    userId: "user-lee",
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

const SAM_READS: EditReader = { members: [DANA, SAM], readerId: SAM.userId };
const DANA_REF = { userId: DANA.userId, name: DANA.name };

/** What an actor is called, as `actorName` says it; nothing for no actor. */
function called(actor: Actor | undefined, possessive = false): string | undefined {
  return actor === undefined ? undefined : actorName(actor, { possessive });
}

/** An activity in a line, as `activityWords` says it; nothing for none. */
function said(activity: ActorActivity | undefined): string | undefined {
  return activity === undefined ? undefined : activityWords(activity);
}

test("a plan's edit is named by who wrote it: a member as the members read them, Luke with whose call it was, an agent by its name, and nobody before history", () => {
  const onDanasCall = { actor: PLAN_ACTOR.NOTETAKER, by: DANA_REF, at: 0, duringCall: true };
  const byAgent = { actor: PLAN_ACTOR.AGENT, label: "Fix auth flow", at: 0, duringCall: false };
  const byDana = { actor: PLAN_ACTOR.DEVELOPER, by: DANA_REF, at: 0, duringCall: false };

  assert.equal(editActor(byDana, SAM_READS)?.kind, ACTOR_KIND.PERSON);
  assert.equal(called(editActor(byDana, { ...SAM_READS, readerId: DANA.userId })), "You");
  assert.deepEqual(editActor(onDanasCall, SAM_READS), LUKE_ACTOR);
  assert.equal(called(editCallOwner(onDanasCall, SAM_READS), true), "Dana Reyes’s");
  assert.equal(editCallOwner(byDana, SAM_READS), undefined);
  const { by: _named, ...onUnnamedCall } = onDanasCall;
  assert.equal(editCallOwner(onUnnamedCall, SAM_READS), undefined);
  assert.deepEqual(
    editActor(byAgent, SAM_READS, { provider: "anthropic", state: ACTOR_STATE.WORKING }),
    {
      kind: ACTOR_KIND.AGENT,
      name: "Fix auth flow",
      provider: "anthropic",
      state: ACTOR_STATE.WORKING,
    },
  );
  assert.equal(
    editActor({ actor: PLAN_ACTOR.EARLIER, at: 0, duringCall: false }, SAM_READS),
    undefined,
  );
});

test("where every edit is the reader's own, as the template's are, each names the reader whatever member it names", () => {
  const owner = { kind: ACTOR_KIND.PERSON, userId: SAM.userId, name: SAM.name, you: true } as const;
  const unnamed = { actor: PLAN_ACTOR.DEVELOPER, at: 0, duringCall: false };

  assert.deepEqual(editActor(unnamed, { members: undefined, readerId: undefined, owner }), owner);
});

test("what someone last did in a plan is the sections whose last change is theirs, the newest change's moment, and a few named before the rest are counted", () => {
  const edit = (section: string, at: number, by = DANA_REF): PlanSectionEdit => ({
    section,
    actor: PLAN_ACTOR.DEVELOPER,
    by,
    at,
    duringCall: false,
  });
  const edits = [
    edit("", 1),
    edit("Goal", 5),
    { section: "Approach", actor: PLAN_ACTOR.NOTETAKER, at: 9, duringCall: true },
    edit("Rollout", 3, { userId: SAM.userId, name: SAM.name }),
  ];
  const dana = personActor(DANA_REF, [DANA, SAM], SAM.userId);
  const danas = latestActivity(edits, dana);

  assert.deepEqual(danas, { sections: ["Opening", "Goal"], at: 5 });
  assert.equal(said(danas), "Edited Opening and Goal");
  assert.equal(said(latestActivity(edits, LUKE_ACTOR)), "Edited Approach");
  assert.equal(
    activityWords({ sections: ["Goal", "Approach", "Rollout", "Risks", "Open questions"], at: 0 }),
    "Edited Goal, Approach, and 3 more",
  );
  assert.equal(
    latestActivity(edits, { kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.UNNAMED }),
    undefined,
  );
});

test("a facepile of who did a thing draws each of them once, where they first stand", () => {
  const dana = personActor(DANA_REF, [DANA, SAM], SAM.userId);
  const sam = personActor(SAM, [DANA, SAM], SAM.userId);

  assert.deepEqual(distinctActors([dana, LUKE_ACTOR, dana, sam, LUKE_ACTOR]), [
    dana,
    LUKE_ACTOR,
    sam,
  ]);
});

test("two who left under one name each keep a face, told apart by their account ids", () => {
  const left = (userId: string) => ({
    kind: ACTOR_KIND.SOMEONE,
    reason: SOMEONE_REASON.FORMER,
    name: "Alex",
    userId,
  });

  assert.equal(distinctActors([left("user-1"), left("user-2"), left("user-1")]).length, 2);
});

test("two agents of one name each keep a face, told apart by their ids, and agents an older service sent no id for are told apart by name", () => {
  const edit = (agentId?: string) => ({
    actor: PLAN_ACTOR.AGENT,
    label: "claude-opus-5.5",
    ...(agentId === undefined ? undefined : { agentId }),
    at: 0,
    duringCall: false,
  });
  const editors = (edits: ReturnType<typeof edit>[]) =>
    distinctActors(edits.flatMap((each) => editActor(each, SAM_READS) ?? []));

  assert.equal(editors([edit("agent-1"), edit("agent-2"), edit("agent-1")]).length, 2);
  assert.equal(editors([edit(), edit()]).length, 1);
  // An edit with no id never hides two agents its name matches, whichever section stands first.
  assert.equal(editors([edit(), edit("agent-1"), edit("agent-2")]).length, 3);
  assert.equal(editors([edit("agent-1"), edit("agent-2"), edit()]).length, 3);
});

test("a plan's creator is the member it names, or, from a service that names only the owner's id, the reader as their account or a member the read lists, and never a face with no name", () => {
  const you = accountActor({ id: SAM.userId, email: SAM.email, name: SAM.name });
  const someone = { kind: ACTOR_KIND.SOMEONE, reason: SOMEONE_REASON.UNNAMED };
  const unread: EditReader = { members: undefined, readerId: SAM.userId };

  assert.equal(
    called(creatorActor({ createdBy: DANA_REF, ownerId: DANA.userId }, SAM_READS, you)),
    "Dana Reyes",
  );
  assert.deepEqual(creatorActor({ ownerId: SAM.userId }, unread, you), you);
  assert.equal(called(creatorActor({ ownerId: DANA.userId }, SAM_READS, you)), "Dana Reyes");
  assert.deepEqual(creatorActor({ ownerId: SAM.userId }, unread, undefined), someone);
  assert.deepEqual(creatorActor({ ownerId: DANA.userId }, unread, you), someone);
});

test("a task wears its creator only where someone other than the reader created it, a member by their face and one whose account is gone on the outline", () => {
  const dana = { createdBy: DANA_REF, ownerId: DANA.userId };
  assert.equal(called(teammateCreator(dana, SAM_READS)), "Dana Reyes");
  assert.equal(teammateCreator(dana, { ...SAM_READS, readerId: DANA.userId }), undefined);
  // A member who left is drawn as having left, and an account that is gone sends only its id.
  assert.deepEqual(teammateCreator(dana, { members: [SAM], readerId: SAM.userId }), {
    kind: ACTOR_KIND.SOMEONE,
    reason: SOMEONE_REASON.FORMER,
    name: "Dana Reyes",
    userId: DANA.userId,
  });
  assert.deepEqual(teammateCreator({ ownerId: "user-gone" }, SAM_READS), {
    kind: ACTOR_KIND.SOMEONE,
    reason: SOMEONE_REASON.UNNAMED,
  });
  // Nobody is worn where the row cannot tell the task is someone else's.
  assert.equal(teammateCreator({}, SAM_READS), undefined);
  assert.equal(teammateCreator(dana, { members: [DANA, SAM], readerId: undefined }), undefined);
});

test("the signed-in account is drawn as the reader, by the name, address, and picture their sign-in holds", () => {
  assert.deepEqual(
    accountActor({
      id: SAM.userId,
      email: SAM.email,
      name: SAM.name,
      pictureUrl: "https://avatars.githubusercontent.com/u/4",
    }),
    {
      kind: ACTOR_KIND.PERSON,
      userId: SAM.userId,
      name: SAM.name,
      email: SAM.email,
      pictureUrl: "https://avatars.githubusercontent.com/u/4",
      you: true,
    },
  );
});

test("someone a pull request names on GitHub is a teammate where their GitHub account is a member's, and themself on GitHub otherwise, Luke's own bot among them", () => {
  const place = { members: [DANA, SAM], readerId: SAM.userId };

  assert.deepEqual(
    githubActor({ login: "danareyes", bot: false, userId: DANA.userId }, place),
    personActor(DANA, [DANA, SAM], SAM.userId),
    "a linked login is the member, by the members' name and picture",
  );
  assert.deepEqual(
    githubActor({ login: "leepark", bot: false, userId: "user-lee" }, place),
    {
      kind: ACTOR_KIND.SOMEONE,
      reason: SOMEONE_REASON.FORMER,
      name: "leepark",
      userId: "user-lee",
    },
    "a linked login the members no longer list has left",
  );

  const stranger = githubActor(
    { login: "octocat", bot: false, avatarUrl: "https://avatars.githubusercontent.com/u/1" },
    place,
  );
  assert.deepEqual(stranger, {
    kind: ACTOR_KIND.GITHUB,
    login: "octocat",
    bot: false,
    avatarUrl: "https://avatars.githubusercontent.com/u/1",
  });
  const devin = githubActor({ login: "devin-ai-integration[bot]", bot: true }, place);
  assert.deepEqual(devin, {
    kind: ACTOR_KIND.GITHUB,
    login: "devin-ai-integration[bot]",
    bot: true,
  });
  assert.deepEqual(
    githubActor({ login: "luke-agent[bot]", bot: true }, place),
    { kind: ACTOR_KIND.GITHUB, login: "luke-agent[bot]", bot: true },
    "Luke's own App's bot is an App's bot like any other",
  );
  assert.deepEqual(
    [actorName(stranger), actorName(devin, { possessive: true })],
    ["octocat", "devin-ai-integration’s"],
  );
  assert.equal(
    distinctActors([stranger, devin, { ...stranger, login: "OctoCat" }]).length,
    2,
    "one GitHub account is one face, whatever case its login is spelled in",
  );
});

test("a member who left keeps the picture the read of who left names them by, and nobody else takes one from it", () => {
  const lee = { userId: "user-lee", name: "Lee Park" };
  const former = [{ ...lee, pictureUrl: "https://avatars.githubusercontent.com/u/7" }];

  assert.deepEqual(personActor(lee, [DANA, SAM], SAM.userId, former), {
    kind: ACTOR_KIND.SOMEONE,
    reason: SOMEONE_REASON.FORMER,
    name: "Lee Park",
    userId: "user-lee",
    pictureUrl: "https://avatars.githubusercontent.com/u/7",
  });
  assert.equal(
    "pictureUrl" in
      personActor({ userId: "user-kim", name: "Kim Ito" }, [DANA], SAM.userId, former),
    false,
  );
});

test("a linked GitHub login who left keeps their picture and their account's name now, from the read of who left", () => {
  const former = [
    {
      userId: "user-lee",
      name: "Lee Chen",
      pictureUrl: "https://avatars.githubusercontent.com/u/7",
    },
  ];
  assert.deepEqual(
    githubActor(
      { login: "leepark", bot: false, userId: "user-lee" },
      { members: [DANA, SAM], readerId: SAM.userId, former },
    ),
    {
      kind: ACTOR_KIND.SOMEONE,
      reason: SOMEONE_REASON.FORMER,
      name: "Lee Chen",
      userId: "user-lee",
      pictureUrl: "https://avatars.githubusercontent.com/u/7",
    },
  );
});
