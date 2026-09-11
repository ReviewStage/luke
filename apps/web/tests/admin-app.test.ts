import assert from "node:assert/strict";
import { HttpApp } from "@effect/platform";
import { test } from "vitest";
import type { AdminViewer } from "../server/admin/admin-access";
import { handleAdminFavorite } from "../server/admin/admin-favorite";
import { ADMIN_ERROR, ADMIN_HTTP_STATUS, ADMIN_ROUTE_PATH } from "../server/admin/http";
import { type AdminSeams, adminApp } from "../server/admin-app";
import { recordedAnswer } from "./support/response-golden";

/**
 * The group's own decisions: which address reaches which read, which methods
 * each declares, and that a read's answer is carried to the caller as the
 * read wrote it. What each read answers for its own parameters is that read's
 * test, and the gate's four refusals are `admin-viewer.test.ts`'s.
 */

const ADMIN_VIEWER: AdminViewer = { userId: "admin-1", role: "admin" };
const READ = {
  METRICS: "metrics",
  USERS: "users",
  USER: "user",
  DAY: "day",
  FAVORITE: "favorite",
} as const;

type ReadName = (typeof READ)[keyof typeof READ];

/**
 * Seams that record which read a request reached and then fail, because what
 * each read builds is its own test's; the refusal a failed seam answers is
 * the same for all five, so the recorder is what distinguishes them.
 */
function recordingSeams(reached: ReadName[]): AdminSeams {
  const reach = (name: ReadName) => {
    reached.push(name);
    return Promise.reject(new Error("the read itself is not under test here"));
  };
  return {
    resolveViewer: async () => ADMIN_VIEWER,
    readMetrics: () => reach(READ.METRICS),
    readUsers: () => reach(READ.USERS),
    readUser: () => reach(READ.USER),
    readDay: () => reach(READ.DAY),
    writeFavorite: () => reach(READ.FAVORITE),
  };
}

function answer(seams: AdminSeams, url: string, method = "GET"): Promise<Response> {
  return HttpApp.toWebHandler(adminApp(seams))(new Request(`https://luke.test${url}`, { method }));
}

const ADDRESSES = [
  { url: ADMIN_ROUTE_PATH.METRICS, method: "GET", read: READ.METRICS },
  { url: ADMIN_ROUTE_PATH.USERS, method: "GET", read: READ.USERS },
  { url: `${ADMIN_ROUTE_PATH.USER}?id=user-1`, method: "GET", read: READ.USER },
  { url: `${ADMIN_ROUTE_PATH.DAY}?date=2026-09-07`, method: "GET", read: READ.DAY },
  { url: `${ADMIN_ROUTE_PATH.FAVORITE}?id=user-1`, method: "PUT", read: READ.FAVORITE },
  { url: `${ADMIN_ROUTE_PATH.FAVORITE}?id=user-1`, method: "DELETE", read: READ.FAVORITE },
] as const;

test("each address the group declares reaches its own read", async () => {
  const reached: ReadName[] = [];
  const seams = recordingSeams(reached);
  for (const address of ADDRESSES) {
    const response = await answer(seams, address.url, address.method);
    assert.equal(response.status, ADMIN_HTTP_STATUS.SERVICE_UNAVAILABLE);
  }
  assert.deepEqual(reached, [
    READ.METRICS,
    READ.USERS,
    READ.USER,
    READ.DAY,
    READ.FAVORITE,
    READ.FAVORITE,
  ]);
});

test("a read answers only the methods its address declares", async () => {
  const reached: ReadName[] = [];
  const seams = recordingSeams(reached);
  const refused = [
    await answer(seams, ADMIN_ROUTE_PATH.METRICS, "POST"),
    await answer(seams, ADMIN_ROUTE_PATH.FAVORITE, "GET"),
  ];
  for (const response of refused) {
    assert.equal(response.status, ADMIN_HTTP_STATUS.METHOD_NOT_ALLOWED);
  }
  assert.deepEqual(reached, []);
});

test("a path the group declares no route for is refused as not found", async () => {
  const reached: ReadName[] = [];
  const response = await answer(recordingSeams(reached), "/api/admin/everything");
  assert.equal(response.status, ADMIN_HTTP_STATUS.NOT_FOUND);
  // SAFETY: the group's own refusal body, which the fixtures record.
  assert.equal(((await response.json()) as { error: string }).error, ADMIN_ERROR.NOT_FOUND);
  assert.deepEqual(reached, []);
});

test("a read's own answer is carried to the caller as the read wrote it", async () => {
  const seams: AdminSeams = { ...recordingSeams([]), writeFavorite: async () => true };
  const carried = await recordedAnswer(
    await answer(seams, `${ADMIN_ROUTE_PATH.FAVORITE}?id=user-1`, "PUT"),
  );
  const direct = await recordedAnswer(
    await handleAdminFavorite({
      request: new Request(`https://luke.test${ADMIN_ROUTE_PATH.FAVORITE}?id=user-1`, {
        method: "PUT",
      }),
      viewer: ADMIN_VIEWER,
      writeFavorite: async () => true,
    }),
  );
  assert.deepEqual(carried, direct);
});
