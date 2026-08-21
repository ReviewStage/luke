import assert from "node:assert/strict";
import test from "node:test";
import type { AdminViewer } from "../server/admin/admin-access";
import { type AdminFavoriteOptions, handleAdminFavorite } from "../server/admin/admin-favorite";
import { ADMIN_ERROR, ADMIN_USER_ID_PARAM } from "../server/admin/http";

const ADMIN_VIEWER: AdminViewer = { userId: "admin-1", role: "admin" };

function favoriteRequest(method: string, id?: string): Request {
  const query = id === undefined ? "" : `?${ADMIN_USER_ID_PARAM}=${encodeURIComponent(id)}`;
  return new Request(`https://luke.test/api/admin/favorite${query}`, { method });
}

function respond(overrides: Partial<AdminFavoriteOptions> = {}): Promise<Response> {
  return handleAdminFavorite({
    request: favoriteRequest("PUT", "user-9"),
    resolveViewer: async () => ADMIN_VIEWER,
    writeFavorite: async () => true,
    ...overrides,
  });
}

test("only the two star methods are answered, and the gate refuses in its own words", async () => {
  for (const method of ["GET", "POST", "PATCH"]) {
    assert.equal((await respond({ request: favoriteRequest(method, "user-9") })).status, 405);
  }

  const anonymous = await respond({ resolveViewer: async () => undefined });
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, ADMIN_ERROR.NOT_SIGNED_IN);

  const forbidden = await respond({
    resolveViewer: async () => ({ ...ADMIN_VIEWER, role: "user" }),
  });
  assert.equal(forbidden.status, 403);
  assert.equal((await forbidden.json()).error, ADMIN_ERROR.NOT_AUTHORIZED);
});

test("the write is the viewer's own star on the named account, PUT on and DELETE off", async () => {
  const writes: Array<{ adminId: string; userId: string; favorite: boolean }> = [];
  const writeFavorite = async (adminId: string, userId: string, favorite: boolean) => {
    writes.push({ adminId, userId, favorite });
    return true;
  };

  const starred = await respond({ writeFavorite });
  assert.equal(starred.status, 200);
  assert.equal((await starred.json()).favorite, true);

  const unstarred = await respond({ request: favoriteRequest("DELETE", "user-9"), writeFavorite });
  assert.equal(unstarred.status, 200);
  assert.equal((await unstarred.json()).favorite, false);

  assert.deepEqual(writes, [
    { adminId: ADMIN_VIEWER.userId, userId: "user-9", favorite: true },
    { adminId: ADMIN_VIEWER.userId, userId: "user-9", favorite: false },
  ]);
});

test("a request naming no account is a 400 before the seam, and an unknown one a 404", async () => {
  let written = false;
  const writeFavorite = async () => {
    written = true;
    return true;
  };

  const unnamed = await respond({ request: favoriteRequest("PUT"), writeFavorite });
  assert.equal(unnamed.status, 400);
  assert.equal((await unnamed.json()).error, ADMIN_ERROR.MISSING_USER_ID);
  assert.equal(written, false);

  const unknown = await respond({ writeFavorite: async () => false });
  assert.equal(unknown.status, 404);
  assert.equal((await unknown.json()).error, ADMIN_ERROR.USER_NOT_FOUND);
});

test("a seam that throws is a 503 refusal rather than a crash", async () => {
  const viewerThrew = await respond({
    resolveViewer: async () => {
      throw new Error("auth is down");
    },
  });
  assert.equal(viewerThrew.status, 503);
  assert.equal((await viewerThrew.json()).error, ADMIN_ERROR.UNAVAILABLE);

  const writeThrew = await respond({
    writeFavorite: async () => {
      throw new Error("database is down");
    },
  });
  assert.equal(writeThrew.status, 503);
  assert.equal((await writeThrew.json()).error, ADMIN_ERROR.UNAVAILABLE);
});
