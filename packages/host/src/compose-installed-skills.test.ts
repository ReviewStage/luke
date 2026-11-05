import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import type { InstalledSkillLiveRow } from "@repo/features/installed-skill-live";
import {
  type InstalledSkillSummary,
  UNSUPPORTED_PREVIEW,
} from "@repo/features/installed-skill-route-wire";
import { INSTALLED_SKILL_CALL_FAILURE } from "@repo/features/installed-skill-view";
import { INSTALLED_SKILL_SCOPE, INSTALLED_SKILL_SOURCE } from "@repo/features/installed-skill-wire";
import type { LIVE_SIGNED_OUT } from "@repo/features/live-wire";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayEventKind,
  type GatewayMethod,
} from "@repo/gateway";
import { entityPool } from "@repo/sync";
import type { WireRecord, WireValue } from "@repo/wire";
import { noNetwork } from "@repo/wire/testing";
import { Deferred, Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import type { AppInstalledSkills } from "./app-state.js";
import { composeInstalledSkills, type InstalledSkillsClient } from "./compose-installed-skills.js";
import { type PolledLive, polledLive } from "./testing/polled-live.js";

/**
 * Settings › Skills' asks through the host as a window makes them, over a
 * scripted service: each answer reaches the window as its view, a refusal
 * by why, with the skill it names; behind a closed
 * account gate or on a run that sends nothing the service is never asked;
 * and params of the wrong shape are refused before anything travels. A
 * workspace a window holds is laid on its app-state slice as its live read
 * stands, and a write is drawn over every held workspace that shows its
 * skill the moment it is asked, or, for an install, answered, standing until
 * each read carries its transaction and put back where the service refused
 * it. Synthetic ids and names.
 */

const WORKSPACE_ID = "workspace-stage";
const OTHER_WORKSPACE_ID = "workspace-globex";
const ACCOUNT_ID = "user-dean";
const SKILL_ID = "5d3c2b1a-0f9e-4d8c-b7a6-123456789abc";

const context = { client: { clientId: "desktop", role: GATEWAY_CLIENT_ROLE.OPERATOR } };

const settled = Effect.repeat(Effect.yieldNow, { times: 100 });

/** `settled`, then the host's next poll asked, which waits half a second after the last answered (`live-follow.ts`), then `settled` again. */
const nextPoll = Effect.andThen(
  settled,
  Effect.andThen(TestClock.adjust(Duration.millis(500)), settled),
);

const SKILL: InstalledSkillSummary = {
  id: SKILL_ID,
  scope: INSTALLED_SKILL_SCOPE.WORKSPACE,
  name: "release-notes",
  description: "Write release notes from merged pull requests.",
  userInvocable: true,
  source: {
    type: INSTALLED_SKILL_SOURCE.GITHUB,
    owner: "acme",
    repo: "agent-skills",
    path: "skills/release-notes",
    ref: "main",
    sha: "3f9c2e1aa0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5",
  },
  enabled: true,
  workspaceId: WORKSPACE_ID,
  installedBy: ACCOUNT_ID,
  manageable: true,
  createdAt: 1,
  updatedAt: 1,
};

/** The account's own skill, which every workspace it holds shows. */
const PERSONAL: InstalledSkillSummary = {
  id: "8a1f2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d",
  scope: INSTALLED_SKILL_SCOPE.PERSONAL,
  name: "grilling",
  description: "Grill a plan before it is built.",
  userInvocable: true,
  source: { type: INSTALLED_SKILL_SOURCE.TEXT },
  enabled: true,
  installedBy: ACCOUNT_ID,
  manageable: true,
  createdAt: 2,
  updatedAt: 2,
};

const CONTENT = {
  id: SKILL_ID,
  skillFile: "---\nname: release-notes\ndescription: Write release notes.\n---\n",
  files: [{ path: "SKILL.md", bytes: 58 }],
};

/** A skill as the live read delivers its row. */
function rowOf({ workspaceId, ...skill }: InstalledSkillSummary): InstalledSkillLiveRow {
  return { ...skill, workspaceId: workspaceId ?? null };
}

/** What each write answers, once its gate lets it, which a test may replace. */
interface Replies {
  install: Effect.Success<ReturnType<InstalledSkillsClient["install"]>>;
  toggle: Effect.Success<ReturnType<InstalledSkillsClient["setEnabled"]>>;
  remove: Effect.Success<ReturnType<InstalledSkillsClient["remove"]>>;
  /** What a write waits on before the service answers it; nothing from the start. */
  gate: Effect.Effect<void>;
}

/** The service as a script: what it answers, every call it was asked, in order, and each workspace's live read. */
function fakeService(options: { refuseInstall?: boolean } = {}) {
  const asked: string[] = [];
  const live: Readonly<Record<string, PolledLive<"skills", typeof LIVE_SIGNED_OUT>>> = {
    [WORKSPACE_ID]: polledLive(["skills"]),
    [OTHER_WORKSPACE_ID]: polledLive(["skills"]),
  };
  const replies: Replies = {
    install: options.refuseInstall
      ? {
          ok: false,
          failure: INSTALLED_SKILL_CALL_FAILURE.CREDENTIAL,
          skillName: "release-notes",
        }
      : { ok: true, answer: { skills: [SKILL] } },
    toggle: { ok: true, answer: { skill: { ...SKILL, enabled: false } } },
    remove: { ok: true, answer: { id: SKILL_ID } },
    gate: Effect.void,
  };
  /** A write's ask written down, then answered with `reply` once the gate lets it. */
  const writing = <A>(ask: string, reply: () => A) =>
    Effect.andThen(
      Effect.sync(() => asked.push(ask)),
      Effect.andThen(
        Effect.suspend(() => replies.gate),
        Effect.sync(reply),
      ),
    );
  const client: InstalledSkillsClient = {
    installedSkillsLive: (workspaceId, userId, poll, after) => {
      const read = live[workspaceId] ?? assert.fail(`no live read of ${workspaceId}`);
      return poll
        ? read.poll(after)
        : Effect.sync(() => {
            asked.push(`live:${workspaceId}:${userId}`);
            return read.first();
          });
    },
    read: (skillId) =>
      Effect.sync(() => {
        asked.push(`read:${skillId}`);
        return { ok: true as const, answer: CONTENT };
      }),
    preview: (workspaceId) =>
      Effect.sync(() => {
        asked.push(`preview:${workspaceId}`);
        return { ok: true as const, answer: UNSUPPORTED_PREVIEW };
      }),
    install: (params) => writing(`install:${params.scope}`, () => replies.install),
    setEnabled: (skillId, enabled) => writing(`toggle:${skillId}:${enabled}`, () => replies.toggle),
    update: (_workspaceId, skillId) =>
      Effect.sync(() => {
        asked.push(`update:${skillId}`);
        return { ok: false as const, failure: INSTALLED_SKILL_CALL_FAILURE.GITHUB_UNANSWERED };
      }),
    share: (workspaceId, skillId) =>
      Effect.sync(() => {
        asked.push(`share:${workspaceId}:${skillId}`);
        return { ok: true as const, answer: { skill: SKILL } };
      }),
    remove: (skillId) => writing(`remove:${skillId}`, () => replies.remove),
  };
  return { client, asked, live, replies };
}

function subject(
  options: { signedIn?: boolean; sendsNetwork?: boolean; refuseInstall?: boolean } = {},
) {
  return Effect.gen(function* () {
    const service = fakeService(options);
    const emitted: { kind: GatewayEventKind; payload: WireValue }[] = [];
    const composer = yield* composeInstalledSkills({
      kernel: {
        runMode: { sendsNetwork: options.sendsNetwork ?? true },
        emit: (kind, payload) => emitted.push({ kind, payload }),
      },
      account: { capabilitiesActive: () => options.signedIn ?? true },
      accountId: () => (options.signedIn === false ? undefined : ACCOUNT_ID),
      client: service.client,
      pool: yield* entityPool(),
    }).pipe(Effect.provide(noNetwork));
    const call = (method: GatewayMethod, params: WireRecord = {}) => {
      const handler = composer.methods[method];
      assert.ok(handler, `no handler for ${method}`);
      return handler(params, context);
    };
    /** Each skill a workspace's slice last showed, by its id and whether it is on; none where it showed no rows. */
    const shown = (workspaceId: string) => {
      const told = emitted.filter((each) => each.kind === GATEWAY_EVENT.INSTALLED_SKILLS_CHANGED);
      // SAFETY: the host tells the skills slice whole on this event.
      const held = told.at(-1)?.payload as AppInstalledSkills | undefined;
      return held?.[workspaceId]?.rows?.map(({ id, enabled }) => `${id}:${enabled ? "on" : "off"}`);
    };
    /** Holds each workspace's skills, its read answering `rows` woken by a write, so it hands a wait for the next. */
    const holding = (rows: Readonly<Record<string, readonly InstalledSkillSummary[]>>) =>
      Effect.gen(function* () {
        for (const workspaceId of Object.keys(rows)) {
          yield* call(GATEWAY_METHOD.INSTALLED_SKILLS_FOLLOW, { workspaceId });
        }
        yield* settled;
        for (const [workspaceId, skills] of Object.entries(rows)) {
          service.live[workspaceId]?.set({ skills: skills.map(rowOf) }, ["9100"]);
        }
        yield* nextPoll;
      });
    return {
      call,
      asked: service.asked,
      live: service.live,
      replies: service.replies,
      shown,
      holding,
    };
  });
}

const INSTALL = {
  text: "npx skills add acme/agent-skills",
  workspaceId: WORKSPACE_ID,
  scope: INSTALLED_SKILL_SCOPE.WORKSPACE,
};

it.effect("each ask reaches the service and answers the window its view", () =>
  Effect.gen(function* () {
    const { call, asked } = yield* subject();

    assert.deepEqual(yield* call(GATEWAY_METHOD.INSTALLED_SKILLS_INSTALL, INSTALL), {
      skills: [SKILL],
    });
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.INSTALLED_SKILLS_SET_ENABLED, {
        skillId: SKILL_ID,
        enabled: false,
      }),
      { skill: { ...SKILL, enabled: false } },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.INSTALLED_SKILLS_UPDATE, {
        workspaceId: WORKSPACE_ID,
        skillId: SKILL_ID,
      }),
      { failure: INSTALLED_SKILL_CALL_FAILURE.GITHUB_UNANSWERED },
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.INSTALLED_SKILLS_READ, { skillId: SKILL_ID }),
      CONTENT,
    );
    assert.deepEqual(
      yield* call(GATEWAY_METHOD.INSTALLED_SKILLS_SHARE, {
        workspaceId: WORKSPACE_ID,
        skillId: SKILL_ID,
      }),
      { skill: SKILL },
    );
    assert.deepEqual(yield* call(GATEWAY_METHOD.INSTALLED_SKILLS_REMOVE, { skillId: SKILL_ID }), {
      id: SKILL_ID,
    });
    assert.deepEqual(asked, [
      `install:${INSTALLED_SKILL_SCOPE.WORKSPACE}`,
      `toggle:${SKILL_ID}:false`,
      `update:${SKILL_ID}`,
      `read:${SKILL_ID}`,
      `share:${WORKSPACE_ID}:${SKILL_ID}`,
      `remove:${SKILL_ID}`,
    ]);
  }),
);

it.effect("a refused install says why, naming the skill", () =>
  Effect.gen(function* () {
    const { call } = yield* subject({ refuseInstall: true });

    assert.deepEqual(yield* call(GATEWAY_METHOD.INSTALLED_SKILLS_INSTALL, INSTALL), {
      failure: INSTALLED_SKILL_CALL_FAILURE.CREDENTIAL,
      skillName: "release-notes",
    });
  }),
);

it.effect("behind a closed account gate, or on a run that sends nothing, nothing is asked", () =>
  Effect.gen(function* () {
    for (const options of [{ signedIn: false }, { sendsNetwork: false }]) {
      const { call, asked, shown } = yield* subject(options);
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.INSTALLED_SKILLS_FOLLOW, { workspaceId: WORKSPACE_ID }),
        {},
      );
      yield* settled;
      assert.deepEqual(
        yield* call(GATEWAY_METHOD.INSTALLED_SKILLS_PREVIEW, {
          workspaceId: WORKSPACE_ID,
          text: "x",
        }),
        { failure: INSTALLED_SKILL_CALL_FAILURE.UNANSWERED },
      );
      assert.deepEqual(yield* call(GATEWAY_METHOD.INSTALLED_SKILLS_INSTALL, INSTALL), {
        failure: INSTALLED_SKILL_CALL_FAILURE.UNANSWERED,
      });
      assert.deepEqual(asked, []);
      assert.equal(shown(WORKSPACE_ID), undefined);
    }
  }),
);

it.effect("params of the wrong shape are refused before anything travels", () =>
  Effect.gen(function* () {
    const { call, asked } = yield* subject();

    const refused = yield* Effect.flip(
      call(GATEWAY_METHOD.INSTALLED_SKILLS_SET_ENABLED, { skillId: "not-an-id", enabled: true }),
    );

    assert.equal(refused._tag, "InvalidParamsRefusal");
    assert.deepEqual(asked, []);
  }),
);

it.effect(
  "a toggle of the account's own skill draws in every held workspace before the service answers, and stands through an answer from before it until each read carries its transaction",
  () =>
    Effect.gen(function* () {
      const { call, live, replies, shown, holding } = yield* subject();
      const workspaces = [WORKSPACE_ID, OTHER_WORKSPACE_ID];
      const shownEach = () => workspaces.map(shown);
      yield* holding({ [WORKSPACE_ID]: [SKILL, PERSONAL], [OTHER_WORKSPACE_ID]: [PERSONAL] });
      assert.deepEqual(shownEach(), [
        [`${SKILL_ID}:on`, `${PERSONAL.id}:on`],
        [`${PERSONAL.id}:on`],
      ]);

      const answering = yield* Deferred.make<void>();
      replies.toggle = {
        ok: true,
        answer: { skill: { ...PERSONAL, enabled: false }, txid: "9200" },
      };
      replies.gate = Deferred.await(answering);
      const toggling = yield* Effect.forkChild(
        call(GATEWAY_METHOD.INSTALLED_SKILLS_SET_ENABLED, { skillId: PERSONAL.id, enabled: false }),
      );
      yield* settled;
      assert.equal(toggling.pollUnsafe(), undefined, "no answer while the service is asked");
      const drawnOff = [[`${SKILL_ID}:on`, `${PERSONAL.id}:off`], [`${PERSONAL.id}:off`]];
      assert.deepEqual(shownEach(), drawnOff, "off in both before the service answers");

      yield* Deferred.succeed(answering, undefined);
      assert.deepEqual(yield* Fiber.join(toggling), {
        skill: { ...PERSONAL, enabled: false },
        txid: "9200",
      });
      // Each read answers once more from before the toggle, which still stands over it.
      live[WORKSPACE_ID]?.set({ skills: [rowOf(SKILL), rowOf(PERSONAL)] });
      live[OTHER_WORKSPACE_ID]?.set({ skills: [rowOf(PERSONAL)] });
      yield* nextPoll;
      assert.deepEqual(shownEach(), drawnOff);
      const off = rowOf({ ...PERSONAL, enabled: false });
      live[WORKSPACE_ID]?.set({ skills: [rowOf(SKILL), off] }, ["9200"]);
      live[OTHER_WORKSPACE_ID]?.set({ skills: [off] }, ["9200"]);
      yield* nextPoll;
      assert.deepEqual(shownEach(), drawnOff);
    }),
);

it.effect(
  "a removal draws its skill gone before the service answers, and one the service refused is put back",
  () =>
    Effect.gen(function* () {
      const { call, replies, shown, holding } = yield* subject();
      yield* holding({ [WORKSPACE_ID]: [SKILL] });

      const refusing = yield* Deferred.make<void>();
      replies.remove = { ok: false, failure: INSTALLED_SKILL_CALL_FAILURE.NOT_PERMITTED };
      replies.gate = Deferred.await(refusing);
      const removing = yield* Effect.forkChild(
        call(GATEWAY_METHOD.INSTALLED_SKILLS_REMOVE, { skillId: SKILL_ID }),
      );
      yield* settled;
      assert.deepEqual(shown(WORKSPACE_ID), [], "gone before the service answers");

      yield* Deferred.succeed(refusing, undefined);
      assert.deepEqual(yield* Fiber.join(removing), {
        failure: INSTALLED_SKILL_CALL_FAILURE.NOT_PERMITTED,
      });
      yield* settled;
      assert.deepEqual(shown(WORKSPACE_ID), [`${SKILL_ID}:on`], "put back once refused");
    }),
);

it.effect(
  "an install's skills draw as it answers in each held workspace their scope is in, and stand through an answer from before it until the read carries its transaction",
  () =>
    Effect.gen(function* () {
      const { call, live, replies, shown, holding } = yield* subject();
      yield* holding({ [WORKSPACE_ID]: [], [OTHER_WORKSPACE_ID]: [] });

      replies.install = { ok: true, answer: { skills: [SKILL], txid: "9300" } };
      yield* call(GATEWAY_METHOD.INSTALLED_SKILLS_INSTALL, INSTALL);
      assert.deepEqual(shown(WORKSPACE_ID), [`${SKILL_ID}:on`]);
      assert.deepEqual(shown(OTHER_WORKSPACE_ID), [], "another workspace's skill is not its");

      live[WORKSPACE_ID]?.set({ skills: [] });
      yield* nextPoll;
      assert.deepEqual(shown(WORKSPACE_ID), [`${SKILL_ID}:on`]);
      live[WORKSPACE_ID]?.set({ skills: [rowOf(SKILL)] }, ["9300"]);
      yield* nextPoll;
      assert.deepEqual(shown(WORKSPACE_ID), [`${SKILL_ID}:on`]);
    }),
);
