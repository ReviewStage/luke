import assert from "node:assert/strict";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { WORKSPACE_CALL_FAILURE } from "@repo/features";
import { LIVE_READ, type LiveRead } from "@repo/features/live-wire";
import type { SlackListedChannel } from "@repo/features/slack-bot-wire";
import { TASK_CALL_FAILURE, TASKS_READ } from "@repo/features/tasks-view";
import type { WorkspaceIntegrations } from "@repo/features/workspace-integrations-live";
import type { WorkspaceInvitation } from "@repo/features/workspace-invitation-wire";
import {
  WORKSPACE_PHOTO_TYPE,
  WORKSPACE_ROLE,
  WORKSPACE_SLUG_PROBLEM,
  type WorkspaceMember,
} from "@repo/features/workspace-wire";
import { GATEWAY_EVENT, GATEWAY_METHOD, type GatewayEventKind } from "@repo/gateway";
import { temporaryDirectoryScoped } from "@repo/runtime/testing";
import { isRecord, type WireValue } from "@repo/wire";
import { Deferred, Duration, Effect, Exit, Fiber, Layer, Scope } from "effect";
import { TestClock } from "effect/testing";
import {
  GITHUB_LAST_SIGN_IN_REFUSAL,
  WORKSPACE_NOT_PERMITTED_REFUSAL,
  WORKSPACE_SLUG_REFUSAL,
} from "./acts.js";
import { WORKSPACE_ACTS } from "./contract/index.js";
import { KEPT_READ, openEntityStore } from "./entity-store.js";
import { ActRefused } from "./host-acts.js";
import {
  ACME,
  ADA,
  fakeService,
  GRACE,
  INSTALL_URL,
  INVITES,
  nextPoll,
  PERSONAL,
  PHOTO_URL,
  RELAY,
  subject,
  task,
  workspacesLiveRows,
} from "./testing/tasks-subject.js";
import { testCipher } from "./testing/test-cipher.js";
import { toldLive } from "./testing/told-live.js";

it.effect(
  "the first refresh follows the account's workspaces with their GitHub organizations, and a sign-out clears them",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      service.memberships = [PERSONAL, ACME];
      const { call, last, settled, reset } = yield* subject(service);

      yield* call("TASKS_REFRESH", undefined);
      yield* settled;
      assert.deepEqual(last()?.workspaces, [PERSONAL, ACME]);
      assert.equal(last()?.workspacesStatus, TASKS_READ.READY);

      assert.equal(service.live.workspaces.held(), 1, "their poll is held while nothing moves");
      yield* reset;
      assert.deepEqual(last()?.workspaces, []);
      assert.equal(service.live.workspaces.held(), 0, "a sign-out lets their poll go");
    }),
);

it.effect("a teammate's change reaches the view as the followed workspaces answer it", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    service.memberships = [PERSONAL, ACME];
    const { call, last, settled } = yield* subject(service);
    yield* call("TASKS_REFRESH", undefined);
    yield* settled;

    service.memberships = [PERSONAL, { ...ACME, name: "Acme Labs" }];
    yield* settled;
    assert.deepEqual(last()?.workspaces, [PERSONAL, { ...ACME, name: "Acme Labs" }]);
  }),
);

it.effect(
  "a workspaces poll refused as signed out stops the follow, rather than reading the old account again on the backoff",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { call, last, settled } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      yield* settled;
      assert.deepEqual(last()?.workspaces, [PERSONAL, ACME]);

      const before = service.reads.length;
      service.workspacesSignedOut = true;
      service.live.workspaces.move();
      yield* TestClock.adjust(Duration.minutes(5));
      yield* settled;

      assert.deepEqual(
        service.reads.slice(before),
        [],
        "the poll refused as signed out is the last ask: the old account is not read again on the backoff",
      );
      assert.deepEqual(last()?.workspaces, [PERSONAL, ACME], "what was drawn stays");
    }),
);

it.effect(
  "while the service answers nothing the workspaces say reading and the tasks are drawn, and the read is asked again after a pause until it answers",
  () =>
    Effect.gen(function* () {
      const invites = task(INVITES, "Teammate invitations", "# Draft", 10);
      const service = fakeService([invites]);
      service.workspacesFail = true;
      const { call, last, listed, settled } = yield* subject(service);

      yield* call("TASKS_REFRESH", undefined);
      yield* listed();
      yield* settled;
      assert.equal(last()?.listStatus, TASKS_READ.READY);
      assert.deepEqual(
        last()?.tasks.map((each) => each.id),
        [invites.id],
      );
      assert.equal(last()?.workspacesStatus, TASKS_READ.READING);
      assert.deepEqual(last()?.workspaces, []);

      service.workspacesFail = false;
      yield* TestClock.adjust(Duration.seconds(5));
      yield* settled;
      assert.equal(last()?.workspacesStatus, TASKS_READ.READY);
      assert.deepEqual(last()?.workspaces, [PERSONAL]);
    }),
);

it.effect("a workspace list of none kept on disk is not drawn as ready at launch", () =>
  Effect.gen(function* () {
    const directory = yield* temporaryDirectoryScoped("tasks-entities-");
    const earlier = yield* Scope.make();
    const kept = yield* Scope.provide(earlier)(
      openEntityStore({ directory, cipher: testCipher(), accountId: "user-dana" }),
    );
    yield* kept.keep(KEPT_READ.WORKSPACES, []);
    yield* Scope.close(earlier, Exit.void);
    const entities = yield* openEntityStore({
      directory,
      cipher: testCipher(),
      accountId: "user-dana",
    });
    const service = fakeService([]);
    service.workspacesFail = true;
    const { last, settled, open } = yield* subject(service, { entities });

    yield* open;
    yield* settled;

    assert.equal(last()?.workspacesStatus, TASKS_READ.READING);
  }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
);

it.effect(
  "a workspace list of none says failed and leaves the last list drawn, and its Retry reads it again at once",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const { call, last, settled } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      yield* settled;

      service.memberships = [];
      yield* settled;
      assert.equal(last()?.workspacesStatus, TASKS_READ.FAILED);
      assert.deepEqual(last()?.workspaces, [PERSONAL]);

      service.memberships = [PERSONAL];
      yield* call("TASKS_REFRESH", undefined);
      yield* settled;
      assert.equal(last()?.workspacesStatus, TASKS_READ.READY);
      assert.deepEqual(last()?.workspaces, [PERSONAL]);
    }),
);

it.effect(
  "a workspace made reaches the service and the view then holds it over the follow, nothing read again",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const { act, call, last, settled } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      const before = service.reads.length;

      const made = yield* act("WORKSPACE_CREATE", { name: RELAY.name });
      yield* settled;

      assert.deepEqual(made, RELAY);
      assert.deepEqual(last()?.workspaces, [PERSONAL, RELAY]);
      assert.deepEqual(service.reads.slice(before), [`create:${RELAY.name}`]);
    }),
);

it.effect(
  "a workspace renamed reaches the service and the view then holds its new name, nothing read again, and a rename the role does not allow moves nothing",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { act, call, last, settled } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      yield* settled;
      const before = service.reads.length;

      const renamed = yield* act("WORKSPACE_RENAME", {
        workspaceId: ACME.id,
        name: "Acme Labs",
      });
      service.notPermitted = true;
      const refused = yield* act("WORKSPACE_RENAME", {
        workspaceId: ACME.id,
        name: "Acme Research",
      });

      yield* settled;
      assert.deepEqual(renamed, { ...ACME, name: "Acme Labs" });
      assert.deepEqual(refused, { refused: WORKSPACE_NOT_PERMITTED_REFUSAL });
      assert.deepEqual(last()?.workspaces, [PERSONAL, { ...ACME, name: "Acme Labs" }]);
      assert.deepEqual(service.reads.slice(before), [
        `rename:${ACME.id}:Acme Labs`,
        `rename:${ACME.id}:Acme Research`,
      ]);
    }),
);

it.effect(
  "a rename another Mac renames again just after draws the newer name the follow carries",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { act, call, last, settled } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      service.renamedAgain = "Acme Research";

      yield* act("WORKSPACE_RENAME", { workspaceId: ACME.id, name: "Acme Labs" });
      yield* settled;

      assert.deepEqual(last()?.workspaces, [PERSONAL, { ...ACME, name: "Acme Research" }]);
    }),
);

it.effect(
  "a rename stands while it is out over a newer name the follow delivers, which stands once it is answered",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { act, call, last, settled } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      yield* settled;
      service.renamedAgain = "Acme Research";
      const answered = yield* Deferred.make<void>();
      service.renameAnswered = Deferred.await(answered);

      const renaming = yield* Effect.forkChild(
        act("WORKSPACE_RENAME", { workspaceId: ACME.id, name: "Acme Labs" }),
      );
      yield* settled;
      assert.deepEqual(last()?.workspaces, [PERSONAL, { ...ACME, name: "Acme Labs" }]);
      yield* Deferred.succeed(answered, undefined);
      yield* Fiber.join(renaming);
      yield* settled;

      assert.deepEqual(last()?.workspaces, [PERSONAL, { ...ACME, name: "Acme Research" }]);
    }),
);

it.effect(
  "an experiment turned on for a workspace is drawn at once as the member's own change, and the service's choice stands once it is answered",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { act, call, last, settled } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      yield* settled;
      const answered = yield* Deferred.make<void>();
      service.experimentAnswered = Deferred.await(answered);

      const turning = yield* Effect.forkChild(
        act("WORKSPACE_EXPERIMENT_SET", { workspaceId: ACME.id, experiment: "pilot", on: true }),
      );
      yield* settled;
      const drawn = { experiment: "pilot", on: true, changedAt: 0 };
      assert.deepEqual(last()?.workspaces, [
        PERSONAL,
        { ...ACME, experiments: [{ ...drawn, changedBy: { id: "user-dana", name: "Dana" } }] },
      ]);
      yield* Deferred.succeed(answered, undefined);
      yield* Fiber.join(turning);
      yield* settled;

      assert.deepEqual(last()?.workspaces, [
        PERSONAL,
        {
          ...ACME,
          experiments: [{ ...drawn, changedAt: 5, changedBy: { id: "user-dana", name: "Dana" } }],
        },
      ]);
    }),
);

it.effect(
  "a rename's answer is drawn though the follow moved another workspace while it was out, where the follow never answered the rename itself",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { act, call, last, settled } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      yield* settled;
      const answered = yield* Deferred.make<void>();
      service.renameAnswered = Deferred.await(answered);
      service.followMisses = true;

      const renaming = yield* Effect.forkChild(
        act("WORKSPACE_RENAME", { workspaceId: ACME.id, name: "Acme Labs" }),
      );
      yield* settled;
      // Only the other workspace's change reaches the follow; the rename's own is lost.
      const missed = workspacesLiveRows([{ ...PERSONAL, name: "Dana's own" }, ACME]);
      service.live.workspaces.set({ workspaces: missed.workspaces });
      yield* settled;
      yield* Deferred.succeed(answered, undefined);
      yield* Fiber.join(renaming);

      assert.deepEqual(last()?.workspaces, [
        { ...PERSONAL, name: "Dana's own" },
        { ...ACME, name: "Acme Labs" },
      ]);
    }),
);

it.effect(
  "a rename's answer that lands after the follow moved the workspace and moved it back is not drawn over the latest delivery",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { act, call, last, settled } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      yield* settled;
      const answered = yield* Deferred.make<void>();
      service.renameAnswered = Deferred.await(answered);

      const renaming = yield* Effect.forkChild(
        act("WORKSPACE_RENAME", { workspaceId: ACME.id, name: "Acme Labs" }),
      );
      yield* settled;
      assert.deepEqual(last()?.workspaces, [PERSONAL, { ...ACME, name: "Acme Labs" }]);
      // A teammate renames it back before the first rename's answer lands.
      service.memberships = [PERSONAL, ACME];
      yield* nextPoll(settled);
      yield* Deferred.succeed(answered, undefined);
      yield* Fiber.join(renaming);

      assert.deepEqual(last()?.workspaces, [PERSONAL, ACME]);
    }),
);

it.effect(
  "of two renames asked at once, the second is sent once the first is answered and stands over it, where the follow answers neither",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { act, call, last, settled } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      yield* settled;
      service.followMisses = true;
      const firstAnswered = yield* Deferred.make<void>();
      service.renameAnswered = Deferred.await(firstAnswered);
      const before = service.reads.length;

      const first = yield* Effect.forkChild(
        act("WORKSPACE_RENAME", { workspaceId: ACME.id, name: "Alpha" }),
      );
      yield* settled;
      service.renameAnswered = Effect.void;
      const second = yield* Effect.forkChild(
        act("WORKSPACE_RENAME", { workspaceId: ACME.id, name: "Beta" }),
      );
      yield* settled;
      assert.deepEqual(last()?.workspaces, [PERSONAL, { ...ACME, name: "Beta" }]);
      assert.deepEqual(service.reads.slice(before), [`rename:${ACME.id}:Alpha`]);
      yield* Deferred.succeed(firstAnswered, undefined);
      yield* Fiber.join(first);
      yield* Fiber.join(second);

      assert.deepEqual(last()?.workspaces, [PERSONAL, { ...ACME, name: "Beta" }]);
      assert.deepEqual(service.reads.slice(before), [
        `rename:${ACME.id}:Alpha`,
        `rename:${ACME.id}:Beta`,
      ]);
    }),
);

it.effect("a rename still being written when the account signs out is drawn for nobody after", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    service.memberships = [PERSONAL, ACME];
    const { act, call, last, settled, open, reset } = yield* subject(service);
    yield* call("TASKS_REFRESH", undefined);
    yield* settled;
    service.followMisses = true;
    const answered = yield* Deferred.make<void>();
    service.renameAnswered = Deferred.await(answered);

    const renaming = yield* Effect.forkChild(
      act("WORKSPACE_RENAME", { workspaceId: ACME.id, name: "Acme Labs" }),
    );
    yield* settled;
    // A second rename waits behind the first, so it would be sent only after the sign-out.
    const queued = yield* Effect.forkChild(
      act("WORKSPACE_RENAME", { workspaceId: ACME.id, name: "Acme Research" }),
    );
    yield* settled;
    yield* reset;
    // A teammate names it back before the next sign-in reads it, so the rename's answer is the only "Acme Labs" left.
    service.memberships = [PERSONAL, ACME];
    yield* open;
    yield* settled;
    yield* Deferred.succeed(answered, undefined);
    yield* Fiber.join(renaming);
    const unsent = yield* Fiber.join(queued);
    yield* settled;

    assert.deepEqual(unsent, { refused: WORKSPACE_ACTS.WORKSPACE_RENAME.refusal });
    assert.deepEqual(last()?.workspaces, [PERSONAL, ACME]);
    assert.deepEqual(
      service.reads.filter((read) => read.startsWith("rename:")),
      [`rename:${ACME.id}:Acme Labs`],
    );
  }),
);

it.effect(
  "a slug another workspace holds is drawn, then taken back with the service's refusal",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      service.slugTaken = "acme-labs";
      const { act, call, last, settled } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      yield* settled;
      const answered = yield* Deferred.make<void>();
      service.slugAnswered = Deferred.await(answered);

      const setting = yield* Effect.forkChild(
        act("WORKSPACE_SLUG_SET", { workspaceId: ACME.id, slug: "acme-labs" }),
      );
      yield* settled;
      assert.deepEqual(last()?.workspaces, [PERSONAL, { ...ACME, slug: "acme-labs" }]);
      yield* Deferred.succeed(answered, undefined);
      const refused = yield* Fiber.join(setting);

      assert.deepEqual(refused, { refused: WORKSPACE_SLUG_REFUSAL[WORKSPACE_SLUG_PROBLEM.TAKEN] });
      assert.deepEqual(last()?.workspaces, [PERSONAL, ACME]);
    }),
);

it.effect(
  "a workspace's photo set reaches the service and the view then holds its version, removing it takes the version away, and a photo the role does not allow moves nothing",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { act, call, last, settled } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      yield* settled;
      const before = service.reads.length;

      const set = yield* act("WORKSPACE_PHOTO_SET", {
        workspaceId: ACME.id,
        photo: PHOTO_URL,
      });
      const drawn = last()?.workspaces;
      const removed = yield* act("WORKSPACE_PHOTO_SET", {
        workspaceId: ACME.id,
        photo: null,
      });
      service.notPermitted = true;
      const refused = yield* act("WORKSPACE_PHOTO_SET", {
        workspaceId: ACME.id,
        photo: PHOTO_URL,
      });

      yield* nextPoll(settled);
      assert.deepEqual(set, { ...ACME, photoVersion: PHOTO_URL });
      assert.deepEqual(drawn, [PERSONAL, { ...ACME, photoVersion: PHOTO_URL }]);
      assert.deepEqual(removed, ACME);
      assert.deepEqual(refused, { refused: WORKSPACE_NOT_PERMITTED_REFUSAL });
      assert.deepEqual(last()?.workspaces, [PERSONAL, ACME]);
      assert.deepEqual(
        service.reads.slice(before).filter((read) => read.startsWith("photoSet:")),
        [
          `photoSet:${ACME.id}:${PHOTO_URL}`,
          `photoSet:${ACME.id}:none`,
          `photoSet:${ACME.id}:${PHOTO_URL}`,
        ],
      );
    }),
);

it.effect(
  "connecting GitHub answers the service's install address and reads nothing, and disconnecting draws the workspace without its organization",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { act, call, last, settled } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      const before = service.reads.length;

      const begun = yield* act("WORKSPACE_GITHUB_CONNECT", { workspaceId: ACME.id });
      const disconnected = yield* act("WORKSPACE_GITHUB_DISCONNECT", {
        workspaceId: ACME.id,
      });

      assert.deepEqual(begun, INSTALL_URL);
      yield* settled;
      const unlinked = { ...ACME, github: null, githubInstallations: [] };
      assert.equal(disconnected, undefined);
      assert.deepEqual(last()?.workspaces, [PERSONAL, unlinked]);
      assert.deepEqual(service.reads.slice(before), [
        `connect:${ACME.id}`,
        `disconnect:${ACME.id}`,
      ]);
    }),
);

it.effect(
  "a connection or a disconnection the account's role does not allow answers not-permitted",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      service.notPermitted = true;
      const { act } = yield* subject(service);
      const refused = { refused: WORKSPACE_NOT_PERMITTED_REFUSAL };

      assert.deepEqual(yield* act("WORKSPACE_GITHUB_CONNECT", { workspaceId: ACME.id }), refused);
      assert.deepEqual(
        yield* act("WORKSPACE_GITHUB_DISCONNECT", { workspaceId: ACME.id }),
        refused,
      );
    }),
);

/** A member's row as the people's live read carries it: the plugin's role text, and no picture. */
function memberRow(member: WorkspaceMember, role: string = member.role) {
  return { userId: member.userId, name: member.name, email: member.email, role, image: null };
}

/** The account signed in under `subject`, a member of the workspace whose people a test holds. */
const DANA: WorkspaceMember = {
  userId: "user-dana",
  name: "Dana Scully",
  email: "dana@app.test",
  role: WORKSPACE_ROLE.OWNER,
};

const ALAN: WorkspaceMember = {
  userId: "user-alan",
  name: "Alan Turing",
  email: "alan@app.test",
  role: WORKSPACE_ROLE.MEMBER,
};

const LEE = { userId: "user-lee", name: "Lee Park" };

/** Every telling of the live follow's slice `read` the host told the windows, whole, the latest last. */
function toldOn(
  pushed: readonly (readonly [GatewayEventKind, WireValue])[],
  read: LiveRead,
): WireValue[] {
  return toldLive(
    pushed.map(([kind, payload]) => ({ kind, payload })),
    read,
  );
}

/** Each workspace's people the host told the windows, the latest last. */
function heldMembers(pushed: readonly (readonly [GatewayEventKind, WireValue])[]): WireValue[] {
  return toldOn(pushed, LIVE_READ.WORKSPACE_MEMBERS);
}

it.effect(
  "a workspace's people kept on disk are drawn as a window holds them, before the service answers them",
  () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectoryScoped("tasks-people-");
      const opened = openEntityStore({ directory, cipher: testCipher(), accountId: "user-dana" });
      const earlier = yield* Scope.make();
      const kept = yield* Scope.provide(earlier)(opened);
      yield* kept.keepIn(KEPT_READ.MEMBERS, ACME.id, { members: [memberRow(DANA)], former: [] });
      yield* Scope.close(earlier, Exit.void);
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      service.members[ACME.id] = [];
      const { workspaces, pushed, settled } = yield* subject(service, { entities: yield* opened });

      yield* workspaces.acts.WORKSPACE_MEMBERS_FOLLOW.hold({ workspaceId: ACME.id });
      yield* settled;

      assert.deepEqual(heldMembers(pushed).at(-1), { [ACME.id]: { rows: { members: [DANA] } } });
    }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer))),
);

it.effect(
  "a role change, a removal, and a handover stand until the held read carries them, through a poll answered before them",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, { ...ACME, role: WORKSPACE_ROLE.OWNER }];
      service.members[ACME.id] = [DANA, GRACE, ALAN];
      const { workspaces, act, pushed, settled } = yield* subject(service);
      const people = service.live.people;
      const shown = () => heldMembers(pushed).at(-1);
      const standing = (members: readonly WorkspaceMember[], former?: readonly unknown[]) => ({
        [ACME.id]: { rows: { members, ...(former === undefined ? undefined : { former }) } },
      });
      yield* workspaces.acts.WORKSPACE_MEMBERS_FOLLOW.hold({ workspaceId: ACME.id });
      yield* settled;
      people.set({ members: [DANA, GRACE, ALAN].map((each) => memberRow(each)), former: [] });
      yield* settled;
      assert.deepEqual(shown(), standing([DANA, ALAN, GRACE]));
      const before = service.reads.length;

      // A role change stands, through a poll read before it that lands after its answer.
      yield* act("WORKSPACE_MEMBER_ROLE", {
        workspaceId: ACME.id,
        userId: GRACE.userId,
        role: WORKSPACE_ROLE.ADMIN,
      });
      const admin = { ...GRACE, role: WORKSPACE_ROLE.ADMIN };
      assert.deepEqual(shown(), standing([DANA, admin, ALAN]));
      const leeRow = { ...LEE, image: null };
      people.set({ former: [leeRow] });
      yield* nextPoll(settled);
      assert.deepEqual(shown(), standing([DANA, admin, ALAN], [LEE]));
      // Note that the read's own role text may list several roles.
      people.set({
        members: [memberRow(DANA), memberRow(GRACE, "member,admin"), memberRow(ALAN)],
      });
      yield* nextPoll(settled);
      assert.deepEqual(shown(), standing([DANA, admin, ALAN], [LEE]));
      // Once the read carries it, the read alone stands.
      people.set({ members: [DANA, GRACE, ALAN].map((each) => memberRow(each)) });
      yield* nextPoll(settled);
      assert.deepEqual(shown(), standing([DANA, ALAN, GRACE], [LEE]));

      // A removal stands until the read no longer carries the member.
      people.set({ members: [DANA, admin, ALAN].map((each) => memberRow(each)) });
      yield* nextPoll(settled);
      yield* act("WORKSPACE_MEMBER_REMOVE", {
        workspaceId: ACME.id,
        userId: ALAN.userId,
      });
      assert.deepEqual(shown(), standing([DANA, admin], [LEE]));
      people.set({ former: [] });
      yield* nextPoll(settled);
      assert.deepEqual(shown(), standing([DANA, admin]));
      people.set({ members: [memberRow(DANA), memberRow(admin)] });
      yield* nextPoll(settled);

      // A handover stands as the heir's role and the account's own from its answer.
      yield* act("WORKSPACE_TRANSFER", {
        workspaceId: ACME.id,
        userId: GRACE.userId,
      });
      const heir = { ...GRACE, role: WORKSPACE_ROLE.OWNER };
      const handedOver = standing([heir, { ...DANA, role: WORKSPACE_ROLE.ADMIN }]);
      assert.deepEqual(shown(), handedOver);
      people.set({ members: [memberRow(DANA), memberRow(heir)] });
      yield* nextPoll(settled);
      assert.deepEqual(shown(), handedOver, "the account's own role is not carried yet");
      people.set({ members: [memberRow(DANA, WORKSPACE_ROLE.ADMIN), memberRow(heir)] });
      yield* nextPoll(settled);
      assert.deepEqual(shown(), handedOver);

      assert.deepEqual(service.reads.slice(before), [
        `role:${ACME.id}:${GRACE.userId}:${WORKSPACE_ROLE.ADMIN}`,
        `remove:${ACME.id}:${ALAN.userId}`,
        `transfer:${ACME.id}:${GRACE.userId}`,
      ]);
    }),
);

it.effect("a role change draws before the service answers, and one it refuses is taken back", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    service.memberships = [PERSONAL, { ...ACME, role: WORKSPACE_ROLE.OWNER }];
    service.members[ACME.id] = [DANA, GRACE];
    const { workspaces, act, pushed, settled } = yield* subject(service);
    const shown = () => heldMembers(pushed).at(-1);
    const standing = (members: readonly WorkspaceMember[]) => ({
      [ACME.id]: { rows: { members } },
    });
    yield* workspaces.acts.WORKSPACE_MEMBERS_FOLLOW.hold({ workspaceId: ACME.id });
    yield* settled;
    service.live.people.set({ members: [memberRow(DANA), memberRow(GRACE)], former: [] });
    yield* settled;
    const answered = yield* Deferred.make<void>();
    service.roleAnswered = Deferred.await(answered);
    service.notPermitted = true;

    const giving = yield* Effect.forkChild(
      act("WORKSPACE_MEMBER_ROLE", {
        workspaceId: ACME.id,
        userId: GRACE.userId,
        role: WORKSPACE_ROLE.ADMIN,
      }),
    );
    yield* settled;
    assert.deepEqual(shown(), standing([DANA, { ...GRACE, role: WORKSPACE_ROLE.ADMIN }]));
    yield* Deferred.succeed(answered, undefined);
    const refused = yield* Fiber.join(giving);

    assert.deepEqual(refused, { refused: WORKSPACE_NOT_PERMITTED_REFUSAL });
    assert.deepEqual(shown(), standing([DANA, GRACE]));
  }),
);

it.effect(
  "a leave draws the account gone from the workspace's people, and the read ending as the account no longer reaches it puts nothing back",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      service.members[ACME.id] = [DANA, GRACE];
      const { workspaces, act, pushed, settled } = yield* subject(service);
      const people = service.live.people;
      yield* workspaces.acts.WORKSPACE_MEMBERS_FOLLOW.hold({ workspaceId: ACME.id });
      yield* settled;
      people.set({ members: [memberRow(DANA), memberRow(GRACE)], former: [] });
      yield* settled;

      yield* act("WORKSPACE_LEAVE", { workspaceId: ACME.id });
      const left = { [ACME.id]: { rows: { members: [GRACE] } } };
      assert.deepEqual(heldMembers(pushed).at(-1), left);
      people.refuse({ failure: WORKSPACE_CALL_FAILURE.NOT_FOUND });
      yield* settled;
      yield* TestClock.adjust(Duration.minutes(1));
      yield* settled;

      assert.deepEqual(heldMembers(pushed).at(-1), left);
    }),
);

/** An active Sentry installation of the workspace, as the integrations read delivers it. */
const SENTRY_ROW = { installationId: "sentry-installation-1", account: "acme", createdAt: 1 };

/** The workspace's Slack bot, connected, as the integrations read delivers it. */
const SLACK_ROW = {
  workspaceId: ACME.id,
  teamId: "T0001",
  teamName: "Acme",
  defaultRepository: null,
};

/** A channel of the workspace's Slack team, the bot not in it, as Slack lists it. */
const ENG_CHANNEL = { id: "C0001", name: "eng", private: false, member: false };

/** What the host last told the windows of `workspaceId`'s integrations; none where it told none. */
function integrationsShown(
  pushed: readonly (readonly [GatewayEventKind, WireValue])[],
  workspaceId: string,
): WorkspaceIntegrations | undefined {
  const told = toldOn(pushed, LIVE_READ.WORKSPACE_INTEGRATIONS).at(-1);
  const read = isRecord(told) ? told[workspaceId] : undefined;
  // SAFETY: the host tells its held integrations whole on its slice, each workspace's read under its id.
  return (isRecord(read) ? read.rows : undefined) as WorkspaceIntegrations | undefined;
}

/** What the host last told the windows of `workspaceId`'s Slack channels; none where it told none. */
function channelsShown(
  pushed: readonly (readonly [GatewayEventKind, WireValue])[],
  workspaceId: string,
): readonly SlackListedChannel[] | undefined {
  const told = toldOn(pushed, LIVE_READ.SLACK_CHANNELS).at(-1);
  const read = isRecord(told) ? told[workspaceId] : undefined;
  // SAFETY: the host tells its held channels whole on its slice, each workspace's list under its id.
  return (isRecord(read) ? read.rows : undefined) as readonly SlackListedChannel[] | undefined;
}

it.effect(
  "a Sentry disconnect draws its installation gone before the service answers and keeps it gone through a poll from before it until the read carries its transaction, and a refused Slack disconnect puts the bot back",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, { ...ACME, role: WORKSPACE_ROLE.OWNER }];
      const { workspaces, act, pushed, settled } = yield* subject(service);
      const integrations = service.live.integrations;
      const installations = () =>
        integrationsShown(pushed, ACME.id)?.sentry.installations.map((one) => one.installationId);
      const team = () => integrationsShown(pushed, ACME.id)?.slack.team?.name;
      yield* workspaces.acts.WORKSPACE_INTEGRATIONS_FOLLOW.hold({ workspaceId: ACME.id });
      yield* settled;
      // The read is woken by a write once, so it hands a wait for the next.
      integrations.set(
        {
          sentryInstallations: [SENTRY_ROW],
          slackInstallation: [SLACK_ROW],
          slackChannelRepositories: [],
        },
        ["9100"],
      );
      yield* nextPoll(settled);
      assert.deepEqual(installations(), [SENTRY_ROW.installationId]);
      assert.equal(team(), "Acme");

      const answering = yield* Deferred.make<void>();
      service.integrationsGate = Deferred.await(answering);
      service.sentryAnswer = {
        ok: true,
        answer: { configured: true, installations: [], txid: "9200" },
      };
      const disconnecting = yield* Effect.forkChild(
        act("WORKSPACE_SENTRY_DISCONNECT", {
          workspaceId: ACME.id,
          installationId: SENTRY_ROW.installationId,
        }),
      );
      yield* settled;
      assert.equal(disconnecting.pollUnsafe(), undefined, "no answer while the service is asked");
      assert.deepEqual(installations(), [], "gone before the service answers");

      yield* Deferred.succeed(answering, undefined);
      assert.deepEqual(yield* Fiber.join(disconnecting), { configured: true, installations: [] });
      // The read answers once more from before the disconnect, which still stands over it.
      integrations.set({ sentryInstallations: [SENTRY_ROW] });
      yield* nextPoll(settled);
      assert.deepEqual(installations(), []);
      integrations.set({ sentryInstallations: [] }, ["9200"]);
      yield* nextPoll(settled);
      assert.deepEqual(installations(), []);

      const refusing = yield* Deferred.make<void>();
      service.integrationsGate = Deferred.await(refusing);
      service.slackBotAnswer = { ok: false, failure: WORKSPACE_CALL_FAILURE.NOT_PERMITTED };
      const refused = yield* Effect.forkChild(
        act("WORKSPACE_SLACK_BOT_DISCONNECT", { workspaceId: ACME.id }),
      );
      yield* settled;
      assert.equal(team(), undefined, "gone before the service answers");
      yield* Deferred.succeed(refusing, undefined);
      assert.deepEqual(yield* Fiber.join(refused), { refused: WORKSPACE_NOT_PERMITTED_REFUSAL });
      yield* settled;
      assert.equal(team(), "Acme", "put back once the service refused it");
    }),
);

it.effect(
  "Slack's channels are asked for an owner's window as it holds them and again as the bot is connected or disconnected, a channel joined lays the channels its answer carries, and a window holding the integrations alone asks for none",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, { ...ACME, role: WORKSPACE_ROLE.OWNER }];
      const { workspaces, act, pushed, settled } = yield* subject(service);
      const integrations = service.live.integrations;
      const channelAsks = () =>
        service.reads.filter((read) => read === `slack-bot:${ACME.id}`).length;
      const connected = {
        configured: true,
        team: { id: SLACK_ROW.teamId, name: SLACK_ROW.teamName },
        channels: [ENG_CHANNEL],
      };
      service.slackBotAnswer = { ok: true, answer: { configured: true } };
      // A member's window holds the workspace's integrations and never its channels.
      yield* workspaces.acts.WORKSPACE_INTEGRATIONS_FOLLOW.hold({ workspaceId: ACME.id });
      yield* settled;
      integrations.set({
        sentryInstallations: [],
        slackInstallation: [],
        slackChannelRepositories: [],
      });
      yield* nextPoll(settled);
      service.slackBotAnswer = { ok: true, answer: connected };
      integrations.set({ slackInstallation: [SLACK_ROW] });
      yield* nextPoll(settled);
      assert.equal(channelAsks(), 0, "no window holds the channels");

      // An owner's window holds them, and they are asked as it does.
      yield* workspaces.acts.WORKSPACE_SLACK_CHANNELS_FOLLOW.hold({ workspaceId: ACME.id });
      yield* settled;
      assert.equal(channelAsks(), 1);
      assert.deepEqual(channelsShown(pushed, ACME.id), [ENG_CHANNEL]);

      // A teammate's disconnect, then a connect, each move the bot's row, and each asks again.
      service.slackBotAnswer = { ok: true, answer: { configured: true } };
      integrations.set({ slackInstallation: [] });
      yield* nextPoll(settled);
      assert.equal(channelAsks(), 2);
      assert.deepEqual(channelsShown(pushed, ACME.id), []);
      service.slackBotAnswer = { ok: true, answer: connected };
      integrations.set({ slackInstallation: [SLACK_ROW] });
      yield* nextPoll(settled);
      assert.equal(channelAsks(), 3);
      assert.deepEqual(channelsShown(pushed, ACME.id), [ENG_CHANNEL]);

      // A channel joined lays the channels its answer carries, the bot in it.
      const joined = { ...ENG_CHANNEL, member: true };
      service.slackBotAnswer = { ok: true, answer: { ...connected, channels: [joined] } };
      yield* act("WORKSPACE_SLACK_BOT_CHANNEL", {
        workspaceId: ACME.id,
        channelId: ENG_CHANNEL.id,
        member: true,
      });
      yield* settled;
      assert.deepEqual(channelsShown(pushed, ACME.id), [joined]);
      assert.deepEqual(
        service.reads.filter((read) => read.startsWith("slack-bot-channel:")),
        [`slack-bot-channel:${ACME.id}:${ENG_CHANNEL.id}`],
      );
    }),
);

/** Every telling of the workspaces' photos the host holds for the windows, whole, in order. */
function heldPhotos(pushed: readonly (readonly [GatewayEventKind, WireValue])[]): WireValue[] {
  return pushed.flatMap(([kind, payload]) =>
    kind === GATEWAY_EVENT.WORKSPACE_PHOTOS_CHANGED ? [payload] : [],
  );
}

it.effect(
  "a listed workspace's photo is fetched once per version, laid under it, and fetched again as the version moves",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, { ...ACME, photoVersion: "v1" }];
      const photo = { contentType: WORKSPACE_PHOTO_TYPE.PNG, base64: "iVBORw0KGgo=" };
      service.photos[ACME.id] = photo;
      const { act, call, pushed, settled } = yield* subject(service);
      const fetches = () => service.reads.filter((read) => read.startsWith("photo:"));

      yield* call("TASKS_REFRESH", undefined);
      yield* settled;
      const first = heldPhotos(pushed).at(-1);
      yield* act("WORKSPACE_RENAME", { workspaceId: ACME.id, name: "Acme Labs" });
      yield* nextPoll(settled);
      const renamed = fetches().length;
      yield* act("WORKSPACE_PHOTO_SET", { workspaceId: ACME.id, photo: PHOTO_URL });
      yield* settled;

      const url = "data:image/png;base64,iVBORw0KGgo=";
      assert.deepEqual(first, { [ACME.id]: { rows: { version: "v1", url } } });
      assert.equal(renamed, 1, "a move that leaves the version fetches nothing");
      assert.deepEqual(fetches(), [`photo:${ACME.id}`, `photo:${ACME.id}`]);
      assert.deepEqual(heldPhotos(pushed).at(-1), {
        [ACME.id]: { rows: { version: PHOTO_URL, url } },
      });
    }),
);

/** Each workspace's pending invitations the host told the windows, the latest last. */
function heldInvitations(pushed: readonly (readonly [GatewayEventKind, WireValue])[]): WireValue[] {
  return toldOn(pushed, LIVE_READ.WORKSPACE_INVITATIONS);
}

/** A pending invitation's row as the invitations' live read carries it: the plugin's role text, and when it expires in epoch milliseconds. */
function invitationRow(id: string, expiresAt: number) {
  return { id, email: `${id}@example.com`, role: WORKSPACE_ROLE.MEMBER, expiresAt };
}

/** The invitation `invitationRow` carries, as the held read lists it: its expiry in ISO, and its accept link on the origin the service answered with. */
function pendingInvitation(id: string, expiresAt: number): WorkspaceInvitation {
  return {
    id,
    email: `${id}@example.com`,
    role: WORKSPACE_ROLE.MEMBER,
    expiresAt: new Date(expiresAt).toISOString(),
    acceptUrl: `https://app.test/accept-invitation?id=${id}&email=${id}%40example.com`,
  };
}

/** An hour, in the epoch milliseconds an invitation's expiry is counted in. */
const HOUR = 3_600_000;

it.effect(
  "an invitation made and one canceled stand until the held read carries them, through a poll answered before them",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { workspaces, act, pushed, settled } = yield* subject(service);
      const invitations = service.live.invitations;
      const shown = () => heldInvitations(pushed).at(-1);
      const standing = (rows: readonly WorkspaceInvitation[]) => ({ [ACME.id]: { rows } });
      const graceRow = invitationRow("grace", HOUR);
      const leeRow = invitationRow("lee", 2 * HOUR);
      const grace = pendingInvitation("grace", HOUR);
      const lee = pendingInvitation("lee", 2 * HOUR);
      yield* workspaces.acts.WORKSPACE_INVITATIONS_FOLLOW.hold({ workspaceId: ACME.id });
      yield* settled;
      invitations.set({ invitations: [graceRow] });
      yield* settled;
      const before = service.reads.length;

      // The invitation made is answered as the service made it, and stands from its answer, its link on the read's own origin.
      const made = yield* act("WORKSPACE_INVITE", {
        workspaceId: ACME.id,
        email: "alan@example.com",
        role: WORKSPACE_ROLE.MEMBER,
      });
      assert.deepEqual(made, {
        id: "inv-alan@example.com",
        email: "alan@example.com",
        role: WORKSPACE_ROLE.MEMBER,
        expiresAt: "2026-10-16T12:00:00.000Z",
        acceptUrl: "https://vespin.dev/accept-invitation.html?id=inv-alan@example.com",
      });
      const alan = {
        id: "inv-alan@example.com",
        email: "alan@example.com",
        role: WORKSPACE_ROLE.MEMBER,
        expiresAt: "2026-10-16T12:00:00.000Z",
        acceptUrl:
          "https://app.test/accept-invitation?id=inv-alan%40example.com&email=alan%40example.com",
      };
      assert.deepEqual(shown(), standing([grace, alan]));
      // A poll read before the invite and answered after it takes nothing away, and what else it moved lands at once.
      invitations.set({ invitations: [graceRow, leeRow] });
      yield* nextPoll(settled);
      assert.deepEqual(shown(), standing([grace, lee, alan]));
      invitations.set({
        invitations: [
          graceRow,
          leeRow,
          { ...invitationRow(alan.id, Date.parse(alan.expiresAt)), email: alan.email },
        ],
      });
      yield* nextPoll(settled);
      assert.deepEqual(shown(), standing([grace, lee, alan]));
      // Once the read carries it, the read alone stands, so its acceptance elsewhere takes it away.
      invitations.set({ invitations: [graceRow, leeRow] });
      yield* nextPoll(settled);
      assert.deepEqual(shown(), standing([grace, lee]));

      // A cancel stands until the read no longer carries the invitation, whatever list it answered.
      yield* act("WORKSPACE_INVITATION_CANCEL", {
        workspaceId: ACME.id,
        invitationId: "lee",
      });
      assert.deepEqual(shown(), standing([grace]));
      invitations.set({ invitations: [graceRow, leeRow] });
      yield* nextPoll(settled);
      assert.deepEqual(shown(), standing([grace]));
      invitations.set({ invitations: [graceRow] });
      yield* nextPoll(settled);
      assert.deepEqual(shown(), standing([grace]));

      // A refused invite draws nothing.
      service.notPermitted = true;
      const refused = yield* act("WORKSPACE_INVITE", {
        workspaceId: ACME.id,
        email: "ada@example.com",
        role: WORKSPACE_ROLE.ADMIN,
      });
      assert.deepEqual(refused, { refused: WORKSPACE_NOT_PERMITTED_REFUSAL });
      assert.deepEqual(shown(), standing([grace]));
      assert.deepEqual(service.reads.slice(before), [
        `invite:${ACME.id}:alan@example.com`,
        `cancel:${ACME.id}:lee`,
        `invite:${ACME.id}:ada@example.com`,
      ]);
    }),
);

it.effect(
  "an invitation canceled while its invite still waits on the read stays gone once that wait gives up",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      const { workspaces, act, pushed, settled } = yield* subject(service);
      yield* workspaces.acts.WORKSPACE_INVITATIONS_FOLLOW.hold({ workspaceId: ACME.id });
      yield* settled;
      service.live.invitations.set({ invitations: [] });
      yield* settled;

      // The read never carries the invitation, so the invite stands until its wait gives up, past the cancel that answered after it.
      yield* act("WORKSPACE_INVITE", {
        workspaceId: ACME.id,
        email: "alan@example.com",
        role: WORKSPACE_ROLE.MEMBER,
      });
      yield* act("WORKSPACE_INVITATION_CANCEL", {
        workspaceId: ACME.id,
        invitationId: "inv-alan@example.com",
      });
      yield* TestClock.adjust(Duration.seconds(11));
      yield* settled;

      assert.deepEqual(heldInvitations(pushed).at(-1), { [ACME.id]: { rows: [] } });
    }),
);

it.effect("the workspaces land on the view while the GitHub connection read is still out", () =>
  Effect.gen(function* () {
    const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
    service.memberships = [PERSONAL, ACME];
    service.connection = { connected: true, login: "ada" };
    const held = yield* Deferred.make<void>();
    service.githubGate = Deferred.await(held);
    const { call, last, settled } = yield* subject(service);

    const refreshing = yield* Effect.forkChild(call("TASKS_REFRESH", undefined));
    yield* settled;

    assert.deepEqual(last()?.workspaces, [PERSONAL, ACME]);
    assert.equal(last()?.github, undefined);

    yield* Deferred.succeed(held, undefined);
    yield* Fiber.join(refreshing);
    assert.deepEqual(last()?.github, { connected: true, login: "ada" });
  }),
);

it.effect(
  "the workspaces are sealed once, on the first refresh, and followed rather than read again on a refresh, the panel coming forward, or a write, until a sign-out",
  () =>
    Effect.gen(function* () {
      const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
      const { call, reset } = yield* subject(service);
      const seals = () => service.reads.filter((read) => read === "workspaces-live").length;

      yield* call("TASKS_REFRESH", undefined);
      yield* call("TASKS_REFRESH", undefined);
      yield* call(GATEWAY_METHOD.WORKSPACES_REFRESH);
      yield* call("TASKS_DELETE", { taskId: INVITES });
      yield* TestClock.adjust(Duration.minutes(1));
      yield* call(GATEWAY_METHOD.WORKSPACES_REFRESH);
      yield* call("TASKS_REFRESH", undefined);
      assert.equal(seals(), 1);

      yield* reset;
      yield* call("TASKS_REFRESH", undefined);
      assert.equal(seals(), 2);
    }),
);

it.effect(
  "the view carries whether GitHub is connected, read beside the workspaces, and a read the service did not answer keeps it",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.connection = { connected: true, login: "ada" };
      const { call, last, reset } = yield* subject(service);

      yield* call("TASKS_REFRESH", undefined);
      assert.deepEqual(last()?.github, { connected: true, login: "ada" });

      service.connection = undefined;
      yield* TestClock.adjust(Duration.minutes(1));
      yield* call(GATEWAY_METHOD.WORKSPACES_REFRESH);
      assert.deepEqual(last()?.github, { connected: true, login: "ada" });

      yield* reset;
      assert.equal(last()?.github, undefined);
    }),
);

it.effect(
  "connecting GitHub answers the service's page, and the panel coming forward then reads the connection again at once",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const { call, last } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      assert.deepEqual(last()?.github, { connected: false, login: null });

      const page = yield* call("GITHUB_CONNECT", undefined);
      service.connection = { connected: true, login: "ada" };
      yield* call(GATEWAY_METHOD.WORKSPACES_REFRESH);

      assert.deepEqual(page, { url: service.connectPages[0] });
      assert.deepEqual(last()?.github, { connected: true, login: "ada" });
    }),
);

it.effect(
  "an admin read and a star ask the service and answer the caller as the service answered, holding nothing in the view",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const { call, last } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      const readsBefore = service.reads.length;
      const viewBefore = last();

      const read = yield* call("ADMIN_READ", {
        procedure: "users",
        query: { window: "7" },
      });
      const starred = yield* call("ADMIN_FAVORITE", {
        id: "user-ada",
        favorite: true,
      });

      assert.deepEqual(read, { answer: { procedure: "users", query: { window: "7" } } });
      assert.equal(starred, true);
      assert.deepEqual(service.reads.slice(readsBefore), [
        "admin:users",
        "admin-favorite:user-ada:true",
      ]);
      assert.equal(last(), viewBefore);
    }),
);

it.effect(
  "disconnecting GitHub asks the service, and the view reads disconnected at once without a workspaces read",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.connection = { connected: true, login: "ada" };
      const { call, last } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      const readsBefore = service.reads.length;

      yield* call("GITHUB_DISCONNECT", undefined);

      assert.deepEqual(last()?.github, { connected: false, login: null });
      assert.deepEqual(service.reads.slice(readsBefore), ["github-disconnect"]);
    }),
);

it.effect(
  "a connection read that saw GitHub connected before a disconnect answered does not put it back",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      service.connection = { connected: true, login: "ada" };
      const held = yield* Deferred.make<void>();
      service.githubGate = Deferred.await(held);
      const { call, last } = yield* subject(service);

      const refreshing = yield* Effect.forkChild(call(GATEWAY_METHOD.WORKSPACES_REFRESH));
      for (let tick = 0; tick < 200; tick += 1) yield* Effect.yieldNow;
      yield* call("GITHUB_DISCONNECT", undefined);
      yield* Deferred.succeed(held, undefined);
      yield* Fiber.join(refreshing);

      assert.deepEqual(last()?.github, { connected: false, login: null });
    }),
);

it.effect("GitHub as the account's only sign-in stays connected, and says so", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    service.connection = { connected: true, login: "ada" };
    const { call, last, workspaces } = yield* subject(service);
    yield* call("TASKS_REFRESH", undefined);
    service.notPermitted = true;

    const refused = yield* Effect.flip(workspaces.acts.GITHUB_DISCONNECT(undefined));

    assert.deepEqual(refused, new ActRefused({ sentence: GITHUB_LAST_SIGN_IN_REFUSAL }));
    assert.deepEqual(last()?.github, { connected: true, login: "ada" });
  }),
);

it.effect("behind a closed account gate a GitHub page is never asked for", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    const { call, workspaces } = yield* subject(service, { signedIn: false });

    const connect = yield* call("GITHUB_CONNECT", undefined);
    const disconnect = yield* Effect.flip(workspaces.acts.GITHUB_DISCONNECT(undefined));

    assert.deepEqual(connect, { failure: TASK_CALL_FAILURE.UNANSWERED });
    assert.deepEqual(disconnect, new ActRefused({}));
    assert.deepEqual(service.connectPages, []);
  }),
);

it.effect("behind a closed account gate the panel coming forward reads no workspaces", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    const { call } = yield* subject(service, { signedIn: false });

    yield* call(GATEWAY_METHOD.WORKSPACES_REFRESH);

    assert.deepEqual(service.reads, []);
  }),
);

it.effect("leaving a workspace reaches the service and the view then holds it no more", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    service.memberships = [PERSONAL, ACME];
    const { act, call, last, settled } = yield* subject(service);
    yield* call("TASKS_REFRESH", undefined);

    const left = yield* act("WORKSPACE_LEAVE", { workspaceId: ACME.id });
    yield* settled;

    assert.equal(left, undefined);
    assert.deepEqual(last()?.workspaces, [PERSONAL]);
  }),
);

it.effect(
  "leaving the open plan's workspace closes the plan, and a refused leave keeps it open",
  () =>
    Effect.gen(function* () {
      const acmeTask = {
        ...task(INVITES, "Teammate invitations", "# Draft", 10),
        workspaceId: ACME.id,
      };
      const service = fakeService([acmeTask]);
      service.memberships = [PERSONAL, ACME];
      service.notPermitted = true;
      const { act, call, last, listed, openTask } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      yield* listed();
      yield* openTask(INVITES);

      const refused = yield* act("WORKSPACE_LEAVE", { workspaceId: ACME.id });

      assert.deepEqual(refused, { refused: WORKSPACE_NOT_PERMITTED_REFUSAL });
      assert.equal(last()?.activeTaskId, INVITES);

      service.notPermitted = false;
      const left = yield* act("WORKSPACE_LEAVE", { workspaceId: ACME.id });

      assert.equal(left, undefined);
      assert.equal(last()?.activeTaskId, undefined);
    }),
);

it.effect("leaving another workspace than the open plan's keeps the plan open", () =>
  Effect.gen(function* () {
    const service = fakeService([task(INVITES, "Teammate invitations", "# Draft", 10)]);
    service.memberships = [PERSONAL, ACME];
    const { act, call, last, openTask } = yield* subject(service);
    yield* call("TASKS_REFRESH", undefined);
    yield* openTask(INVITES);

    yield* act("WORKSPACE_LEAVE", { workspaceId: ACME.id });

    assert.equal(last()?.activeTaskId, INVITES);
  }),
);

it.effect(
  "a removal or a leave the account's role does not allow answers not-permitted, and the view keeps the workspace",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      service.members[ACME.id] = [ADA, GRACE];
      service.notPermitted = true;
      const { act, call, last, settled } = yield* subject(service);
      yield* call("TASKS_REFRESH", undefined);
      yield* settled;

      const removed = yield* act("WORKSPACE_MEMBER_REMOVE", {
        workspaceId: ACME.id,
        userId: ADA.userId,
      });
      const left = yield* act("WORKSPACE_LEAVE", { workspaceId: ACME.id });

      assert.deepEqual(removed, { refused: WORKSPACE_NOT_PERMITTED_REFUSAL });
      assert.deepEqual(left, { refused: WORKSPACE_NOT_PERMITTED_REFUSAL });
      assert.deepEqual(last()?.workspaces, [PERSONAL, ACME]);
      assert.deepEqual(service.members[ACME.id], [ADA, GRACE]);
    }),
);

it.effect("behind a closed account gate no workspace call reaches the service", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    const { workspaces, act } = yield* subject(service, { signedIn: false });
    /** The act refused in its own sentence, as the window hears an act the host could not answer. */
    const unanswered = (name: keyof typeof WORKSPACE_ACTS) => ({
      refused: WORKSPACE_ACTS[name].refusal,
    });

    assert.deepEqual(
      yield* act("WORKSPACE_CREATE", { name: RELAY.name }),
      unanswered("WORKSPACE_CREATE"),
    );
    assert.deepEqual(
      yield* act("WORKSPACE_RENAME", { workspaceId: ACME.id, name: "Acme Labs" }),
      unanswered("WORKSPACE_RENAME"),
    );
    assert.deepEqual(
      yield* act("WORKSPACE_PHOTO_SET", { workspaceId: ACME.id, photo: null }),
      unanswered("WORKSPACE_PHOTO_SET"),
    );
    assert.deepEqual(
      yield* act("WORKSPACE_GITHUB_CONNECT", { workspaceId: ACME.id }),
      unanswered("WORKSPACE_GITHUB_CONNECT"),
    );
    assert.deepEqual(
      yield* act("WORKSPACE_GITHUB_DISCONNECT", { workspaceId: ACME.id }),
      unanswered("WORKSPACE_GITHUB_DISCONNECT"),
    );
    yield* workspaces.acts.WORKSPACE_MEMBERS_FOLLOW.hold({ workspaceId: ACME.id });
    assert.deepEqual(
      yield* act("WORKSPACE_MEMBER_REMOVE", {
        workspaceId: ACME.id,
        userId: GRACE.userId,
      }),
      unanswered("WORKSPACE_MEMBER_REMOVE"),
    );
    assert.deepEqual(
      yield* act("WORKSPACE_LEAVE", { workspaceId: ACME.id }),
      unanswered("WORKSPACE_LEAVE"),
    );
    assert.deepEqual(service.reads, []);
  }),
);

it.effect(
  "a workspace's people held for a window are laid on the app state in the held read's order, who left among them, read with nothing else, and dropped with the session",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.memberships = [PERSONAL, ACME];
      service.members[ACME.id] = [ADA];
      const { workspaces, pushed, settled, reset } = yield* subject(service);

      yield* workspaces.acts.WORKSPACE_MEMBERS_FOLLOW.hold({ workspaceId: ACME.id });
      yield* settled;
      service.live.people.set({ members: [memberRow(GRACE), memberRow(ADA)], former: [] });
      yield* settled;
      service.live.people.set({ former: [{ ...LEE, image: null }] });
      yield* nextPoll(settled);

      assert.deepEqual(heldMembers(pushed), [
        { [ACME.id]: { rows: { members: [ADA, GRACE] } } },
        { [ACME.id]: { rows: { members: [ADA, GRACE], former: [LEE] } } },
      ]);
      assert.deepEqual(service.reads, [`people-live:${ACME.id}`]);
      yield* reset;
      yield* settled;
      assert.equal(service.live.people.held(), 0, "a sign-out lets its poll go");
      assert.deepEqual(heldMembers(pushed).at(-1), {});
    }),
);

/** Every telling of the token repositories the host holds for the windows, whole, in order. */
function heldTokenRepositories(
  pushed: readonly (readonly [GatewayEventKind, WireValue])[],
): WireValue[] {
  return toldOn(pushed, LIVE_READ.TOKEN_REPOSITORIES);
}

it.effect(
  "a workspace's token repositories asked before an addition land behind the addition's answer, never over it",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const listed = (fullName: string) => ({
        fullName,
        addedBy: "Ada",
        addedAt: 1,
        removable: true,
      });
      const before = [listed("acme/relay")];
      const after = [listed("acme/side"), ...before];
      const answering = yield* Deferred.make<void>();
      Object.assign(service.workspaces, {
        tokenRepositories: () =>
          Effect.as(Deferred.await(answering), { ok: true as const, answer: before }),
        setTokenRepository: () => Effect.succeed({ ok: true as const, answer: after }),
      });
      const { workspaces, act, pushed, settled } = yield* subject(service);

      yield* workspaces.acts.WORKSPACE_TOKEN_REPOSITORIES_FOLLOW.hold({ workspaceId: ACME.id });
      yield* settled;
      yield* act("WORKSPACE_TOKEN_REPOSITORY_SET", {
        workspaceId: ACME.id,
        repository: "acme/side",
        added: true,
      });
      yield* Deferred.succeed(answering, undefined);
      yield* settled;

      assert.deepEqual(heldTokenRepositories(pushed).at(-1), { [ACME.id]: { rows: after } });
    }),
);

it.effect("two holds and a remount read one workspace's people once", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    service.memberships = [PERSONAL, ACME];
    service.members[ACME.id] = [ADA];
    const { workspaces, pushed, settled } = yield* subject(service);

    const surfaces = yield* Scope.make();
    yield* workspaces.acts.WORKSPACE_MEMBERS_FOLLOW.hold({ workspaceId: ACME.id }).pipe(
      Scope.provide(surfaces),
    );
    yield* workspaces.acts.WORKSPACE_MEMBERS_FOLLOW.hold({ workspaceId: ACME.id }).pipe(
      Scope.provide(surfaces),
    );
    yield* settled;
    service.live.people.set({ members: [memberRow(ADA)], former: [] });
    yield* nextPoll(settled);
    // Let go, the people stay followed among those let go lately, so a surface drawn again reads nothing anew.
    yield* Scope.close(surfaces, Exit.void);
    yield* settled;
    yield* workspaces.acts.WORKSPACE_MEMBERS_FOLLOW.hold({ workspaceId: ACME.id });
    yield* settled;

    assert.deepEqual(service.reads, [`people-live:${ACME.id}`]);
    assert.equal(service.live.people.held(), 1);
    assert.deepEqual(heldMembers(pushed), [{ [ACME.id]: { rows: { members: [ADA] } } }]);
  }),
);

it.effect(
  "a people read that fails for now stands failed where it never answered, is asked again on its own, and Try again reads it at once",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      service.members[ACME.id] = [ADA];
      service.workspacesFail = true;
      const { workspaces, pushed, settled } = yield* subject(service);
      const seals = () => service.reads.filter((read) => read === `people-live:${ACME.id}`).length;

      yield* workspaces.acts.WORKSPACE_MEMBERS_FOLLOW.hold({ workspaceId: ACME.id });
      yield* settled;
      assert.deepEqual(heldMembers(pushed).at(-1), { [ACME.id]: { failed: true } });
      yield* TestClock.adjust(Duration.seconds(5));
      yield* settled;
      assert.equal(seals(), 2, "the read is asked again");

      service.workspacesFail = false;
      yield* workspaces.acts.WORKSPACE_MEMBERS_FOLLOW.retry({ workspaceId: ACME.id });
      yield* settled;
      assert.equal(seals(), 3, "Try again reads at once");
      assert.deepEqual(heldMembers(pushed).at(-1), { [ACME.id]: {} });
      service.live.people.set({ members: [memberRow(ADA)], former: [] });
      yield* settled;
      assert.deepEqual(heldMembers(pushed).at(-1), { [ACME.id]: { rows: { members: [ADA] } } });
    }),
);

it.effect("a workspace the account is not in is told failed once, and not asked again", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    const { workspaces, pushed, settled } = yield* subject(service);

    yield* workspaces.acts.WORKSPACE_MEMBERS_FOLLOW.hold({ workspaceId: ACME.id });
    yield* settled;
    yield* TestClock.adjust(Duration.minutes(1));
    yield* settled;

    assert.deepEqual(heldMembers(pushed), [{ [ACME.id]: { failed: true } }]);
    assert.deepEqual(service.reads, [`people-live:${ACME.id}`]);
  }),
);

it.effect(
  "a workspace's invitations held for an owner or an admin are laid on the app state soonest first, the expired left out by the host's clock and each with its accept link, and one the account may not manage is told failed once",
  () =>
    Effect.gen(function* () {
      const service = fakeService([]);
      const { workspaces, pushed, settled } = yield* subject(service);

      service.notPermitted = true;
      yield* workspaces.acts.WORKSPACE_INVITATIONS_FOLLOW.hold({ workspaceId: RELAY.id });
      yield* settled;
      yield* TestClock.adjust(Duration.minutes(1));
      yield* settled;
      service.notPermitted = false;
      yield* workspaces.acts.WORKSPACE_INVITATIONS_FOLLOW.hold({ workspaceId: ACME.id });
      yield* settled;
      service.live.invitations.set({
        invitations: [
          invitationRow("late", 2 * HOUR),
          invitationRow("spent", 0),
          invitationRow("soon", HOUR),
        ],
      });
      yield* settled;

      assert.deepEqual(heldInvitations(pushed), [
        { [RELAY.id]: { failed: true } },
        {
          [RELAY.id]: { failed: true },
          [ACME.id]: {
            rows: [pendingInvitation("soon", HOUR), pendingInvitation("late", 2 * HOUR)],
          },
        },
      ]);
      assert.deepEqual(service.reads, [
        `invitations-live:${RELAY.id}`,
        `invitations-live:${ACME.id}`,
      ]);
    }),
);

it.effect("an invitation leaves the held list at its expiry with no row moving", () =>
  Effect.gen(function* () {
    const service = fakeService([]);
    const { workspaces, pushed, settled } = yield* subject(service);
    yield* workspaces.acts.WORKSPACE_INVITATIONS_FOLLOW.hold({ workspaceId: ACME.id });
    yield* settled;
    service.live.invitations.set({
      invitations: [invitationRow("soon", HOUR), invitationRow("late", 2 * HOUR)],
    });
    yield* settled;
    const soon = pendingInvitation("soon", HOUR);
    const late = pendingInvitation("late", 2 * HOUR);

    yield* TestClock.adjust(Duration.millis(HOUR - 1));
    yield* settled;
    assert.deepEqual(heldInvitations(pushed).at(-1), { [ACME.id]: { rows: [soon, late] } });
    yield* TestClock.adjust(Duration.millis(1));
    yield* settled;
    assert.deepEqual(heldInvitations(pushed).at(-1), { [ACME.id]: { rows: [late] } });
    yield* TestClock.adjust(Duration.millis(HOUR));
    yield* settled;
    assert.deepEqual(heldInvitations(pushed).at(-1), { [ACME.id]: { rows: [] } });
  }),
);
