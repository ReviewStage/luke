import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_READ_ERROR,
  type AdminRead,
  type AdminReader,
  adminReadFailure,
  adminReadFromResponse,
  settleRead,
} from "../src/admin/use-admin-read";

const QUESTION = {
  NARROW: "/api/admin/metrics",
  WIDE: "/api/admin/metrics?scope=all",
} as const;

const ENDPOINT_DETAIL = "The metrics endpoint did not answer. Try again shortly.";

interface Answer {
  n: number;
}

// SAFETY: every body this suite hands the reader is an Answer it built itself.
const readAnswer: AdminReader<Answer> = async (response) => (await response.json()) as Answer;

const refuseToRead: AdminReader<Answer> = () => {
  throw new Error("the body must not be read");
};

function answer(status: number, body: Answer = { n: 0 }): Response {
  return new Response(JSON.stringify(body), { status });
}

/** `Response` cannot be constructed as redirected, so the flag is set on it. */
function redirected(status: number): Response {
  const response = answer(status, { n: 1 });
  Object.defineProperty(response, "redirected", { value: true });
  return response;
}

function read(response: Response, reader: AdminReader<Answer> = readAnswer) {
  return adminReadFromResponse(response, reader, QUESTION.NARROW, ENDPOINT_DETAIL);
}

test("a 200 is the answer the reader read, carrying the question it was asked", async () => {
  assert.deepEqual(await read(answer(200, { n: 1 })), {
    status: "ready",
    value: { n: 1 },
    question: QUESTION.NARROW,
    refreshFailure: undefined,
  });
});

test("a followed redirect is the deployment-protection error, whatever the status says", async () => {
  // The body of a redirected answer is a login page, not this endpoint's JSON,
  // so it is never read at all.
  assert.deepEqual(await read(redirected(200), refuseToRead), {
    status: "error",
    detail: ADMIN_READ_ERROR.PROTECTED,
  });
});

test("the gate's own refusals are distinct, and none of their bodies is read", async () => {
  const gate: readonly [number, AdminRead<Answer>][] = [
    [401, { status: "signed-out" }],
    [403, { status: "forbidden" }],
    [404, { status: "missing" }],
  ];
  for (const [status, expected] of gate) {
    assert.deepEqual(await read(answer(status), refuseToRead), expected);
  }
});

test("an unavailable service says so, rather than posing as the endpoint's own failure", async () => {
  assert.deepEqual(await read(answer(503), refuseToRead), {
    status: "error",
    detail: ADMIN_READ_ERROR.UNAVAILABLE,
  });
});

test("any other refusal is the endpoint's own detail, whatever the status", async () => {
  for (const status of [400, 418, 500]) {
    assert.deepEqual(await read(answer(status), refuseToRead), {
      status: "error",
      detail: ENDPOINT_DETAIL,
    });
  }
});

test("a body the reader cannot read raises rather than settling as a half-built answer", async () => {
  // The hook's own catch turns this into the endpoint's detail; what matters
  // here is that no `ready` state is ever built from a body that did not parse.
  await assert.rejects(read(new Response("<html>", { status: 200 })));
});

test("a failed refresh of the same question keeps the shown answer and rides the failure on it", async () => {
  const shown = await read(answer(200, { n: 1 }));
  const failed = await read(answer(500), refuseToRead);
  assert.deepEqual(settleRead(shown, failed, QUESTION.NARROW), {
    status: "ready",
    value: { n: 1 },
    question: QUESTION.NARROW,
    refreshFailure: ENDPOINT_DETAIL,
  });
});

test("a failed refresh of a different question replaces the shown answer", async () => {
  const shown = await read(answer(200, { n: 1 }));
  const failed = await read(answer(500), refuseToRead);
  assert.deepEqual(settleRead(shown, failed, QUESTION.WIDE), failed);
});

test("the gate's outcomes replace a shown answer whatever was asked", async () => {
  const shown = await read(answer(200, { n: 1 }));
  for (const status of [401, 403]) {
    const refusal = await read(answer(status), refuseToRead);
    assert.deepEqual(settleRead(shown, refusal, QUESTION.NARROW), refusal);
    assert.deepEqual(settleRead(shown, refusal, QUESTION.WIDE), refusal);
  }
});

test("a fresh answer for another subject replaces the shown one whole", async () => {
  const shown = await read(answer(200, { n: 1 }));
  const next = await adminReadFromResponse(
    answer(200, { n: 2 }),
    readAnswer,
    QUESTION.WIDE,
    ENDPOINT_DETAIL,
  );
  assert.deepEqual(settleRead(shown, next, QUESTION.WIDE), next);
});

test("a status carrying no detail of its own reads as the endpoint's failure", () => {
  assert.equal(adminReadFailure({ status: "missing" }, ENDPOINT_DETAIL), ENDPOINT_DETAIL);
  assert.equal(
    adminReadFailure({ status: "error", detail: "its own" }, ENDPOINT_DETAIL),
    "its own",
  );
});
