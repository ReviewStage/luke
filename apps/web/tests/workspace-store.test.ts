import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import {
  GITHUB_ACCOUNT_TYPE,
  GITHUB_INSTALLATION_STATUS,
  type GitHubInstallationStatus,
} from "@luke/database/github-installation-vocabulary";
import { INTEGRATION_ROW_STATUS } from "@luke/database/integration-vocabulary";
import type { WorkspaceSeams } from "@luke/database/models/workspace-seams";
import {
  ensurePersonalWorkspace,
  listWorkspaces,
  personalWorkspaceOf,
  readWorkspacePhoto,
  workspacesLiveStatements,
} from "@luke/database/models/workspace-store";
import { member, organization, user } from "@luke/database/schemas/auth";
import { githubInstallation } from "@luke/database/schemas/github-installation";
import { personalWorkspace } from "@luke/database/schemas/personal-workspace";
import { workspaceIntegrationConnection } from "@luke/database/schemas/workspace-integration";
import {
  fakeWorkspaceSeams,
  getTestDB,
  joinWorkspace,
  WORKSPACE_ROLE,
} from "@luke/database/testing";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { workspacesLiveRowsSchema, workspacesOfLiveRows } from "@luke/features/workspace-live";
import { WORKSPACE_PHOTO_TYPE } from "@luke/features/workspace-wire";
import { openWorkspacePlugin } from "@luke/service/testing/workspace-plugin";
import { eq } from "drizzle-orm";
import { Cause, DateTime, Effect, Option, Schema } from "effect";
import { SqlClient } from "effect/sql";

/**
 * An account's workspaces over a real dialect: its first one is made the
 * first time it is asked for and never again, a workspace a racing ensure
 * made and named the account's is adopted rather than doubled, one anyone
 * else made under the account's slug is never adopted, and a list puts the
 * account's own first workspace first and no teammate's. A workspace's
 * photo is listed as a digest of it and read as its bytes by a member alone,
 * and the account's own first workspace with none lists the account's sign-in
 * picture where the renderer may draw it.
 *
 * The plugin's write is a fake over the same tables (`@luke/database/testing`'s `workspaces.ts`),
 * refusing a slug that is taken as the plugin does, on both dialects, and Better Auth's own plugin
 * over PGlite in the last case. Synthetic accounts throughout.
 */

/** The row naming the workspace the account's first one, as a racing ensure writes it. */
const insertPersonalRow = (userId: string, organizationId: string) =>
  Effect.gen(function* () {
    const createdAt = yield* DateTime.nowAsDate;
    yield* Database.use((db) =>
      db.insert(personalWorkspace).values({ userId, organizationId, createdAt }),
    );
  });

const openUser = (name: string) =>
  Effect.gen(function* () {
    const userId = `user-${randomUUID()}`;
    yield* Database.use((db) =>
      db.insert(user).values({ id: userId, name, email: `${userId}@luke.test` }),
    );
    return userId;
  });

/** A shared workspace the owner made through the plugin, joined by each teammate. */
const openSharedWorkspace = (
  seams: WorkspaceSeams,
  name: string,
  owner: string,
  teammates: readonly string[],
) =>
  Effect.gen(function* () {
    const slug = `${name.toLowerCase()}-${randomUUID()}`;
    const { id } = yield* seams.createOrganization({ name, slug, userId: owner, metadata: {} });
    for (const teammate of teammates) yield* joinWorkspace(id, teammate, WORKSPACE_ROLE.MEMBER);
    return { id, slug };
  });

/** A one-pixel photo's bytes, and another's, each as a `data:` URL of its type keeps them. */
const PNG_BYTES = "iVBORw0KGgo=";
const JPEG_BYTES = "/9j/4AAQSkZJRg==";
const photoUrl = (type: string, base64: string) => `data:${type};base64,${base64}`;

/** The workspace's `logo`, as an upload would write it. */
const keepLogo = (organizationId: string, logo: string | null) =>
  Database.use((db) =>
    db.update(organization).set({ logo }).where(eq(organization.id, organizationId)),
  );

/** The account's sign-in picture, as its provider handed it over. */
const keepImage = (userId: string, image: string | null) =>
  Database.use((db) => db.update(user).set({ image }).where(eq(user.id, userId)));

/** The account's workspaces as the desktop builds them from the live statements' rows, run as Realtime runs them. */
const liveWorkspacesOf = (userId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const statements = Option.getOrThrow(workspacesLiveStatements(userId));
    const rows = yield* Effect.all({
      workspaces: sql.unsafe(statements.workspaces.sql, [...statements.workspaces.params]),
      installations: sql.unsafe(statements.installations.sql, [...statements.installations.params]),
    });
    return workspacesOfLiveRows(yield* Schema.decodeUnknownEffect(workspacesLiveRowsSchema)(rows));
  });

/** An installation connected to the workspace, linked at the instant given. */
const connectInstallation = (
  organizationId: string,
  installationId: number,
  status: GitHubInstallationStatus,
  linkedAt: Date,
) =>
  Database.use((db) =>
    db.insert(githubInstallation).values({
      organizationId,
      installationId,
      accountId: installationId,
      accountLogin: `account-${installationId}`,
      accountType: GITHUB_ACCOUNT_TYPE.ORGANIZATION,
      status,
      createdAt: linkedAt,
      updatedAt: linkedAt,
    }),
  );

/** What one listed workspace shows of its face: its photo's version and its picture's address, where it lists them. */
const faceIn = (
  listed: readonly { id: string; photoVersion?: string; pictureUrl?: string }[],
  id: string,
) => {
  const found = listed.find((workspace) => workspace.id === id);
  assert.ok(found, `${id} is listed`);
  return { photoVersion: found.photoVersion, pictureUrl: found.pictureUrl };
};

it.layer(getTestDB())("an account's workspaces over effect/unstable/sql", (it) => {
  it.effect(
    "a workspace holding a photo lists a digest of it and none of its bytes, a digest that moves when the photo does, and any other text lists none",
    () =>
      Effect.gen(function* () {
        const seams = yield* fakeWorkspaceSeams;
        const owner = yield* openUser("Owner");
        const acme = yield* openSharedWorkspace(seams, "Acme", owner, []);

        yield* keepLogo(acme.id, photoUrl(WORKSPACE_PHOTO_TYPE.PNG, PNG_BYTES));
        const first = yield* listWorkspaces(owner);
        yield* keepLogo(acme.id, photoUrl(WORKSPACE_PHOTO_TYPE.JPEG, JPEG_BYTES));
        const second = yield* listWorkspaces(owner);
        const others = [];
        for (const logo of [
          "https://example.test/acme.png",
          photoUrl("image/svg+xml", "PHN2Zz48L3N2Zz4="),
          "data:image/png;base64,not base64!",
          null,
        ]) {
          yield* keepLogo(acme.id, logo);
          others.push(faceIn(yield* listWorkspaces(owner), acme.id));
        }

        const firstVersion = faceIn(first, acme.id).photoVersion;
        const secondVersion = faceIn(second, acme.id).photoVersion;
        assert.match(firstVersion ?? "", /^[0-9a-f]{16}$/u);
        assert.match(secondVersion ?? "", /^[0-9a-f]{16}$/u);
        assert.notEqual(secondVersion, firstVersion);
        assert.ok(!JSON.stringify(first).includes(PNG_BYTES), "the list carries no photo bytes");
        assert.deepEqual(faceIn(first, acme.id).pictureUrl, undefined);
        const none = { photoVersion: undefined, pictureUrl: undefined };
        assert.deepEqual(others, [none, none, none, none]);
      }),
  );

  it.effect("a workspace's photo is read as its bytes by a member, and by no one else", () =>
    Effect.gen(function* () {
      const seams = yield* fakeWorkspaceSeams;
      const owner = yield* openUser("Owner");
      const teammate = yield* openUser("Teammate");
      const stranger = yield* openUser("Stranger");
      const acme = yield* openSharedWorkspace(seams, "Acme", owner, [teammate]);
      const plain = yield* openSharedWorkspace(seams, "Plain", owner, []);
      yield* keepLogo(acme.id, photoUrl(WORKSPACE_PHOTO_TYPE.PNG, PNG_BYTES));

      const read = yield* readWorkspacePhoto(teammate, acme.id);

      assert.ok(Option.isSome(read));
      assert.equal(read.value.contentType, WORKSPACE_PHOTO_TYPE.PNG);
      assert.equal(Buffer.from(read.value.bytes).toString("base64"), PNG_BYTES);
      assert.deepEqual(yield* readWorkspacePhoto(stranger, acme.id), Option.none());
      assert.deepEqual(yield* readWorkspacePhoto(owner, plain.id), Option.none());
    }),
  );

  it.effect(
    "the account's own first workspace with no photo lists its sign-in picture where the renderer may draw it, and a shared one lists none",
    () =>
      Effect.gen(function* () {
        const seams = yield* fakeWorkspaceSeams;
        const owner = yield* openUser("Owner");
        const teammate = yield* openUser("Teammate");
        const personal = yield* ensurePersonalWorkspace(owner, seams);
        assert.ok(Option.isSome(personal));
        const acme = yield* openSharedWorkspace(seams, "Acme", owner, [teammate]);
        const faces = (image: string) =>
          Effect.gen(function* () {
            yield* keepImage(owner, image);
            return faceIn(yield* listWorkspaces(owner), personal.value).pictureUrl;
          });

        const google = "https://lh3.googleusercontent.com/a/owner";
        const github = "https://avatars.githubusercontent.com/u/1";
        const pinned = [yield* faces(google), yield* faces(github)];
        const unpinned = [
          yield* faces("http://lh3.googleusercontent.com/a/owner"),
          yield* faces("https://avatars.example.test/u/1"),
          yield* faces("https://googleusercontent.com.example.test/a/owner"),
        ];
        yield* keepImage(owner, google);
        const shared = faceIn(yield* listWorkspaces(owner), acme.id);
        const teammates = faceIn(yield* listWorkspaces(teammate), acme.id);
        yield* keepLogo(personal.value, photoUrl(WORKSPACE_PHOTO_TYPE.PNG, PNG_BYTES));
        const photographed = faceIn(yield* listWorkspaces(owner), personal.value);

        assert.deepEqual(pinned, [google, github]);
        assert.deepEqual(unpinned, [undefined, undefined, undefined]);
        assert.deepEqual(shared, { photoVersion: undefined, pictureUrl: undefined });
        assert.deepEqual(teammates, { photoVersion: undefined, pictureUrl: undefined });
        assert.match(photographed.photoVersion ?? "", /^[0-9a-f]{16}$/u);
        assert.equal(photographed.pictureUrl, undefined);
      }),
  );

  it.effect(
    "the live statements deliver the workspaces the held read lists, photos, installations, and Linear among them, to each member and none of them to an outsider",
    () =>
      Effect.gen(function* () {
        const seams = yield* fakeWorkspaceSeams;
        const owner = yield* openUser("Owner");
        const teammate = yield* openUser("Teammate");
        const outsider = yield* openUser("Outsider");
        assert.ok(Option.isSome(yield* ensurePersonalWorkspace(owner, seams)));
        assert.ok(Option.isSome(yield* ensurePersonalWorkspace(outsider, seams)));
        yield* keepImage(owner, "https://avatars.githubusercontent.com/u/1");
        const acme = yield* openSharedWorkspace(seams, "Acme", owner, [teammate]);
        const beta = yield* openSharedWorkspace(seams, "Beta", teammate, [owner]);
        yield* keepLogo(acme.id, photoUrl(WORKSPACE_PHOTO_TYPE.PNG, PNG_BYTES));
        yield* keepLogo(beta.id, "https://example.test/beta.png");
        const now = yield* DateTime.nowAsDate;
        const later = new Date(now.getTime() + 1000);
        yield* connectInstallation(acme.id, 902, GITHUB_INSTALLATION_STATUS.ACTIVE, later);
        yield* connectInstallation(acme.id, 901, GITHUB_INSTALLATION_STATUS.SUSPENDED, now);
        yield* Database.use((db) =>
          db.insert(workspaceIntegrationConnection).values({
            organizationId: beta.id,
            provider: INTEGRATION_PROVIDER.LINEAR,
            status: INTEGRATION_ROW_STATUS.EXPIRED,
          }),
        );

        for (const reader of [owner, teammate, outsider]) {
          assert.deepEqual(yield* liveWorkspacesOf(reader), yield* listWorkspaces(reader));
        }
        const theirs = (yield* liveWorkspacesOf(outsider)).map((workspace) => workspace.id);
        assert.ok(!theirs.includes(acme.id) && !theirs.includes(beta.id));
        const acmeListed = (yield* liveWorkspacesOf(teammate)).find((one) => one.id === acme.id);
        assert.deepEqual(acmeListed?.github, { login: "account-902", active: true });

        // A logo the held read refuses as a photo lists none live either, so the owner's own first workspace keeps the sign-in picture.
        const own = Option.getOrThrow(yield* personalWorkspaceOf(owner));
        for (const logo of [
          photoUrl(WORKSPACE_PHOTO_TYPE.PNG, JPEG_BYTES),
          "data:image/png;base64,not base64!",
          photoUrl(WORKSPACE_PHOTO_TYPE.PNG, "iVBORw0KGg"),
          photoUrl("image/svg+xml", "PHN2Zz48L3N2Zz4="),
          photoUrl(WORKSPACE_PHOTO_TYPE.JPEG, JPEG_BYTES),
        ]) {
          yield* keepLogo(own, logo);
          assert.deepEqual(yield* liveWorkspacesOf(owner), yield* listWorkspaces(owner), logo);
        }
      }),
  );

  it.effect("an account's first ensure makes its first workspace and the second makes none", () =>
    Effect.gen(function* () {
      const seams = yield* fakeWorkspaceSeams;
      const userId = yield* openUser("Ada Lovelace");
      assert.deepEqual(yield* personalWorkspaceOf(userId), Option.none());

      const first = yield* ensurePersonalWorkspace(userId, seams);
      const second = yield* ensurePersonalWorkspace(userId, seams);

      assert.ok(Option.isSome(first));
      assert.deepEqual(second, first);
      assert.deepEqual(yield* personalWorkspaceOf(userId), first);
      assert.deepEqual(yield* listWorkspaces(userId), [
        {
          id: first.value,
          name: "Ada Lovelace",
          slug: `personal-${userId}`,
          role: WORKSPACE_ROLE.OWNER,
          github: null,
          githubInstallations: [],
          memberCount: 1,
          personal: true,
        },
      ]);
    }),
  );

  it.effect(
    "an account's first workspace is listed under its owner's name as it stands now, to its owner and a teammate in it alike, one made as Personal included, while a team keeps its own",
    () =>
      Effect.gen(function* () {
        const seams = yield* fakeWorkspaceSeams;
        const owner = yield* openUser("Ada Lovelace");
        const teammate = yield* openUser("Teammate");
        const personal = yield* ensurePersonalWorkspace(owner, seams);
        assert.ok(Option.isSome(personal));
        yield* joinWorkspace(personal.value, teammate, WORKSPACE_ROLE.MEMBER);
        const acme = yield* openSharedWorkspace(seams, "Acme", owner, [teammate]);
        const namesOf = (userId: string) =>
          Effect.map(listWorkspaces(userId), (listed) =>
            listed.map((workspace) => [workspace.id, workspace.name]),
          );

        const before = yield* namesOf(owner);
        yield* Database.use((db) =>
          db.update(user).set({ name: "Ada King" }).where(eq(user.id, owner)),
        );
        // The name an account's first workspace was made under between 2026-10-15 and its revert.
        yield* Database.use((db) =>
          db
            .update(organization)
            .set({ name: "Personal" })
            .where(eq(organization.id, personal.value)),
        );

        assert.deepEqual(before, [
          [personal.value, "Ada Lovelace"],
          [acme.id, "Acme"],
        ]);
        assert.deepEqual(yield* namesOf(owner), [
          [personal.value, "Ada King"],
          [acme.id, "Acme"],
        ]);
        assert.deepEqual(yield* namesOf(teammate), [
          [acme.id, "Acme"],
          [personal.value, "Ada King"],
        ]);
      }),
  );

  it.effect(
    "an account's first workspace outlives the account under the name the account had when it was made",
    () =>
      Effect.gen(function* () {
        const seams = yield* fakeWorkspaceSeams;
        const owner = yield* openUser("Ada Lovelace");
        const teammate = yield* openUser("Teammate");
        const personal = yield* ensurePersonalWorkspace(owner, seams);
        assert.ok(Option.isSome(personal));
        yield* joinWorkspace(personal.value, teammate, WORKSPACE_ROLE.MEMBER);

        yield* Database.use((db) => db.delete(user).where(eq(user.id, owner)));

        const listed = yield* listWorkspaces(teammate);
        assert.deepEqual(
          listed.map((workspace) => [workspace.id, workspace.name]),
          [[personal.value, "Ada Lovelace"]],
        );
      }),
  );

  it.effect("a first workspace a racing ensure made first is adopted, not doubled", () =>
    Effect.gen(function* () {
      const plugin = yield* fakeWorkspaceSeams;
      const database = yield* Database;
      const userId = yield* openUser("Grace Hopper");
      const raced: string[] = [];
      // The racing ensure makes the workspace and names it the account's while this one asks the plugin, which then refuses the slug.
      const racing: WorkspaceSeams = {
        createOrganization: (creation) =>
          Effect.gen(function* () {
            const { id } = yield* plugin.createOrganization(creation);
            yield* insertPersonalRow(userId, id).pipe(
              Effect.orDie,
              Effect.provideService(Database, database),
            );
            raced.push(id);
            return yield* Effect.fail(new Cause.UnknownError(undefined, "Organization exists"));
          }),
      };

      const ensured = yield* ensurePersonalWorkspace(userId, racing);

      assert.deepEqual(ensured, Option.some(raced[0]));
      assert.deepEqual(yield* listWorkspaces(userId), [
        {
          id: raced[0],
          name: "Grace Hopper",
          slug: `personal-${userId}`,
          role: WORKSPACE_ROLE.OWNER,
          github: null,
          githubInstallations: [],
          memberCount: 1,
          personal: true,
        },
      ]);
    }),
  );

  it.effect(
    "a first workspace a racing ensure made but has not yet named the account's is adopted, not doubled",
    () =>
      Effect.gen(function* () {
        const plugin = yield* fakeWorkspaceSeams;
        const userId = yield* openUser("Katherine Johnson");
        const raced: string[] = [];
        // The racing ensure has made the workspace, the account its owner, and not yet written the row naming it.
        const racing: WorkspaceSeams = {
          createOrganization: (creation) =>
            Effect.gen(function* () {
              const { id } = yield* plugin.createOrganization(creation);
              raced.push(id);
              return yield* Effect.fail(new Cause.UnknownError(undefined, "Organization exists"));
            }),
        };

        const ensured = yield* ensurePersonalWorkspace(userId, racing);

        assert.deepEqual(ensured, Option.some(raced[0]));
        assert.deepEqual(yield* listWorkspaces(userId), [
          {
            id: raced[0],
            name: "Katherine Johnson",
            slug: `personal-${userId}`,
            role: WORKSPACE_ROLE.OWNER,
            github: null,
            githubInstallations: [],
            memberCount: 1,
            personal: true,
          },
        ]);
      }),
  );

  it.effect(
    "a list puts the account's own first workspace first, and the shared ones by name",
    () =>
      Effect.gen(function* () {
        const seams = yield* fakeWorkspaceSeams;
        const owner = yield* openUser("Owner");
        const teammate = yield* openUser("Teammate");
        const ownerPersonal = yield* ensurePersonalWorkspace(owner, seams);
        const teammatePersonal = yield* ensurePersonalWorkspace(teammate, seams);
        assert.ok(Option.isSome(ownerPersonal) && Option.isSome(teammatePersonal));
        const zeta = yield* openSharedWorkspace(seams, "Zeta", owner, [teammate]);
        const acme = yield* openSharedWorkspace(seams, "Acme", teammate, [owner]);

        assert.deepEqual(yield* listWorkspaces(owner), [
          {
            id: ownerPersonal.value,
            name: "Owner",
            slug: `personal-${owner}`,
            role: WORKSPACE_ROLE.OWNER,
            github: null,
            githubInstallations: [],
            memberCount: 1,
            personal: true,
          },
          {
            ...acme,
            name: "Acme",
            role: WORKSPACE_ROLE.MEMBER,
            github: null,
            githubInstallations: [],
            memberCount: 2,
          },
          {
            ...zeta,
            name: "Zeta",
            role: WORKSPACE_ROLE.OWNER,
            github: null,
            githubInstallations: [],
            memberCount: 2,
          },
        ]);
        assert.deepEqual(yield* listWorkspaces(teammate), [
          {
            id: teammatePersonal.value,
            name: "Teammate",
            slug: `personal-${teammate}`,
            role: WORKSPACE_ROLE.OWNER,
            github: null,
            githubInstallations: [],
            memberCount: 1,
            personal: true,
          },
          {
            ...acme,
            name: "Acme",
            role: WORKSPACE_ROLE.OWNER,
            github: null,
            githubInstallations: [],
            memberCount: 2,
          },
          {
            ...zeta,
            name: "Zeta",
            role: WORKSPACE_ROLE.MEMBER,
            github: null,
            githubInstallations: [],
            memberCount: 2,
          },
        ]);
      }),
  );

  it.effect("an account gone has no first workspace to make", () =>
    Effect.gen(function* () {
      const seams = yield* fakeWorkspaceSeams;
      const gone = `user-${randomUUID()}`;

      assert.deepEqual(yield* ensurePersonalWorkspace(gone, seams), Option.none());
      assert.deepEqual(yield* listWorkspaces(gone), []);
    }),
  );
});

const PERSONAL_COLUMNS = { slug: organization.slug, metadata: organization.metadata };

it.effect(
  "the plugin makes the first workspace the account owns, and one squatting its slug is never adopted",
  () =>
    Effect.gen(function* () {
      const { seams, database } = yield* openWorkspacePlugin;
      yield* Effect.gen(function* () {
        const ada = yield* openUser("Ada Lovelace");
        const grace = yield* openUser("Grace Hopper");
        const squatted = yield* seams.createOrganization({
          name: "Grace Hopper",
          slug: `personal-${grace}`,
          userId: ada,
          metadata: { personal: true },
        });

        const adas = yield* ensurePersonalWorkspace(ada, seams);
        const graces = yield* ensurePersonalWorkspace(grace, seams);

        assert.ok(Option.isSome(adas));
        assert.ok(Option.isSome(graces));
        assert.notEqual(graces.value, squatted.id);
        assert.deepEqual(
          yield* Database.use((db) =>
            db.select(PERSONAL_COLUMNS).from(organization).where(eq(organization.id, adas.value)),
          ),
          [{ slug: `personal-${ada}`, metadata: '{"personal":true}' }],
        );
        assert.deepEqual(
          yield* Database.use((db) =>
            db
              .select({ userId: member.userId, role: member.role })
              .from(member)
              .where(eq(member.organizationId, adas.value)),
          ),
          [{ userId: ada, role: WORKSPACE_ROLE.OWNER }],
        );
        const [gracesSlug] = yield* Database.use((db) =>
          db
            .select({ slug: organization.slug })
            .from(organization)
            .where(eq(organization.id, graces.value)),
        );
        assert.ok(gracesSlug?.slug.startsWith(`personal-${grace}-`));
        assert.deepEqual(yield* listWorkspaces(grace), [
          {
            id: graces.value,
            name: "Grace Hopper",
            slug: gracesSlug?.slug,
            role: WORKSPACE_ROLE.OWNER,
            github: null,
            githubInstallations: [],
            memberCount: 1,
            personal: true,
          },
        ]);
      }).pipe(Effect.provide(database));
    }),
);
