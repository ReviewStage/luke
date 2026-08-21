import assert from "node:assert/strict";
import test from "node:test";
import { adminSeedEmailsFromEnv } from "../server/admin/admin-access";
import { isAdminUser, promoteSeededAdmin, seedAdminsFromEnv } from "../server/admin/admin-grants";

type MembershipDatabase = Parameters<typeof isAdminUser>[0];
type GrantDatabase = Parameters<typeof promoteSeededAdmin>[0];

/** A database whose membership select answers with the given rows. */
function membershipDatabase(rows: Array<{ userId: string }>): MembershipDatabase {
  const double = {
    select: () => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) }),
  };
  // SAFETY: the double implements only the select chain isAdminUser exercises.
  return double as unknown as MembershipDatabase;
}

/** A grant database: one user email for the lookup, capturing inserted user ids. */
function grantDatabase(email: string | undefined, inserted: string[]): GrantDatabase {
  const double = {
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (email === undefined ? [] : [{ email }]) }),
      }),
    }),
    insert: () => ({
      values: (value: { userId: string }) => ({
        onConflictDoNothing: async () => {
          inserted.push(value.userId);
        },
      }),
    }),
  };
  // SAFETY: the double implements only the select-then-insert chain promoteSeededAdmin exercises.
  return double as unknown as GrantDatabase;
}

/** A seed database: the full user table for the sweep, capturing inserted ids. */
function seedDatabase(
  users: Array<{ id: string; email: string }>,
  inserted: string[],
): GrantDatabase {
  const double = {
    select: () => ({ from: async () => users }),
    insert: () => ({
      values: (value: { userId: string }) => ({
        onConflictDoNothing: async () => {
          inserted.push(value.userId);
        },
      }),
    }),
  };
  // SAFETY: the double implements only the select-all-then-insert chain seedAdminsFromEnv exercises.
  return double as unknown as GrantDatabase;
}

test("admin membership is the presence of a row", async () => {
  assert.equal(await isAdminUser(membershipDatabase([{ userId: "user-1" }]), "user-1"), true);
  assert.equal(await isAdminUser(membershipDatabase([]), "user-2"), false);
});

test("a seeded address is promoted on sign-in; anyone else is a no-op", async () => {
  const seeds = adminSeedEmailsFromEnv("dean@example.com");

  const grantedInserts: string[] = [];
  await promoteSeededAdmin(grantDatabase("dean@example.com", grantedInserts), {
    userId: "user-1",
    seedEmails: seeds,
  });
  assert.deepEqual(grantedInserts, ["user-1"]);

  const skippedInserts: string[] = [];
  await promoteSeededAdmin(grantDatabase("stranger@example.com", skippedInserts), {
    userId: "user-2",
    seedEmails: seeds,
  });
  assert.deepEqual(skippedInserts, []);
});

test("promotion with an empty seed list touches nothing", async () => {
  const inserted: string[] = [];
  await promoteSeededAdmin(grantDatabase("dean@example.com", inserted), {
    userId: "user-1",
    seedEmails: adminSeedEmailsFromEnv(undefined),
  });
  assert.deepEqual(inserted, []);
});

test("the build seed grants exactly the existing accounts on the list", async () => {
  const inserted: string[] = [];
  const granted = await seedAdminsFromEnv(
    seedDatabase(
      [
        { id: "user-1", email: "Dean@example.com" },
        { id: "user-2", email: "stranger@example.com" },
        { id: "user-3", email: "charles@example.com" },
      ],
      inserted,
    ),
    adminSeedEmailsFromEnv("dean@example.com, charles@example.com"),
  );
  assert.equal(granted, 2);
  assert.deepEqual(inserted.sort(), ["user-1", "user-3"]);
});

test("the build seed with an empty list makes no query and grants nothing", async () => {
  const inserted: string[] = [];
  const granted = await seedAdminsFromEnv(seedDatabase([], inserted), adminSeedEmailsFromEnv(""));
  assert.equal(granted, 0);
  assert.deepEqual(inserted, []);
});
