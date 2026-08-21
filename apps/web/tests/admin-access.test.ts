import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_GITHUB_ACCOUNT,
  adminEmailsFromEnv,
  type AdminViewer,
  isAdminViewer,
} from "../server/admin/admin-access";

const NO_EMAILS: ReadonlySet<string> = new Set();

function viewer(overrides: Partial<AdminViewer> = {}): AdminViewer {
  return { userId: "user-1", email: undefined, githubAccountIds: [], ...overrides };
}

test("the two maintainers' GitHub ids are admitted with no env allowlist", () => {
  for (const id of Object.values(ADMIN_GITHUB_ACCOUNT)) {
    assert.equal(isAdminViewer(viewer({ githubAccountIds: [id] }), NO_EMAILS), true);
  }
});

test("a signed-in account that is neither is refused", () => {
  assert.equal(
    isAdminViewer(viewer({ githubAccountIds: ["99999999"], email: "someone@example.com" }), NO_EMAILS),
    false,
  );
});

test("the env allowlist admits by email, case- and space-insensitively", () => {
  const admins = adminEmailsFromEnv("  Dean@Example.com , charles@example.com ");
  assert.equal(isAdminViewer(viewer({ email: "dean@example.com" }), admins), true);
  assert.equal(isAdminViewer(viewer({ email: "CHARLES@EXAMPLE.COM" }), admins), true);
  assert.equal(isAdminViewer(viewer({ email: "intruder@example.com" }), admins), false);
});

test("a GitHub id admits even when the email is not on the env list", () => {
  const admins = adminEmailsFromEnv("only@example.com");
  assert.equal(
    isAdminViewer(viewer({ githubAccountIds: [ADMIN_GITHUB_ACCOUNT.DEAN], email: "dean@work.com" }), admins),
    true,
  );
});

test("a blank or absent env value is an empty allowlist, not a wildcard", () => {
  assert.equal(adminEmailsFromEnv(undefined).size, 0);
  assert.equal(adminEmailsFromEnv("   ").size, 0);
  assert.equal(adminEmailsFromEnv(",, ,").size, 0);
  assert.equal(isAdminViewer(viewer({ email: "anyone@example.com" }), adminEmailsFromEnv("")), false);
});

test("a viewer with no email and no linked id is never an admin", () => {
  assert.equal(isAdminViewer(viewer(), adminEmailsFromEnv("someone@example.com")), false);
});
