import assert from "node:assert/strict";
import test from "node:test";
import { UPDATE_STATUS, type UpdateSnapshot } from "../src/shared/contracts";
import { UPDATE_ENDPOINT, UpdateService } from "../src/update-service";

function releaseResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("a newer published release is offered by its version, without the tag's v", async () => {
  const requests: { url: string; headers: Record<string, string> }[] = [];
  const states: UpdateSnapshot[] = [];
  const service = new UpdateService({
    currentVersion: "0.1.0",
    onChange: (update) => states.push(update),
    fetch: async (url, init) => {
      requests.push({ url, headers: (init.headers ?? {}) as Record<string, string> });
      return releaseResponse({ tag_name: "v0.2.0" });
    },
  });

  const answered = await service.check();

  assert.deepEqual(answered, {
    status: UPDATE_STATUS.UPDATE_AVAILABLE,
    currentVersion: "0.1.0",
    latestVersion: "0.2.0",
  });
  assert.deepEqual(service.snapshot(), answered);
  // The row is told about the check under way as well as its answer.
  assert.deepEqual(
    states.map((state) => state.status),
    [UPDATE_STATUS.CHECKING, UPDATE_STATUS.UPDATE_AVAILABLE],
  );
  // One read, of the fixed address, spoken in GitHub's documented media type.
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, UPDATE_ENDPOINT.LATEST_RELEASE_URL);
  assert.equal(requests[0]?.headers.Accept, "application/vnd.github+json");
});

test("the running release reads as up to date", async () => {
  const service = new UpdateService({
    currentVersion: "0.2.0",
    onChange: () => undefined,
    fetch: async () => releaseResponse({ tag_name: "v0.2.0" }),
  });

  assert.deepEqual(await service.check(), {
    status: UPDATE_STATUS.UP_TO_DATE,
    currentVersion: "0.2.0",
  });
});

test("a refusal, an unreachable service, and an unreadable answer all read as unreachable", async () => {
  const refused = new UpdateService({
    currentVersion: "0.1.0",
    onChange: () => undefined,
    fetch: async () => new Response("", { status: 503 }),
  });
  assert.equal((await refused.check()).status, UPDATE_STATUS.UNREACHABLE);

  const unreachable = new UpdateService({
    currentVersion: "0.1.0",
    onChange: () => undefined,
    fetch: async () => {
      throw new Error("offline");
    },
  });
  assert.equal((await unreachable.check()).status, UPDATE_STATUS.UNREACHABLE);

  const unreadable = new UpdateService({
    currentVersion: "0.1.0",
    onChange: () => undefined,
    fetch: async () => new Response("not json", { status: 200 }),
  });
  assert.equal((await unreadable.check()).status, UPDATE_STATUS.UNREACHABLE);
});

test("a release this build cannot name is not offered as an update", async () => {
  // A prerelease suffix and a missing tag both leave nothing to compare, and
  // an unnamed update would send someone to fetch an unknown.
  const prerelease = new UpdateService({
    currentVersion: "0.1.0",
    onChange: () => undefined,
    fetch: async () => releaseResponse({ tag_name: "v0.2.0-beta.1" }),
  });
  assert.equal((await prerelease.check()).status, UPDATE_STATUS.UNREACHABLE);

  const unnamed = new UpdateService({
    currentVersion: "0.1.0",
    onChange: () => undefined,
    fetch: async () => releaseResponse({}),
  });
  assert.equal((await unnamed.check()).status, UPDATE_STATUS.UNREACHABLE);
});

test("the timer and the button share a check already in flight", async () => {
  let requests = 0;
  let release: ((response: Response) => void) | undefined;
  const service = new UpdateService({
    currentVersion: "0.1.0",
    onChange: () => undefined,
    fetch: () => {
      requests += 1;
      return new Promise((resolve) => {
        release = resolve;
      });
    },
  });

  const first = service.check();
  const second = service.check();
  release?.(releaseResponse({ tag_name: "v0.1.1" }));

  assert.equal((await first).status, UPDATE_STATUS.UPDATE_AVAILABLE);
  assert.equal((await second).status, UPDATE_STATUS.UPDATE_AVAILABLE);
  assert.equal(requests, 1);

  // A finished check is let go of, so the next ask is a fresh read.
  const third = service.check();
  assert.equal(requests, 2);
  release?.(releaseResponse({ tag_name: "v0.1.1" }));
  await third;
});

test("a listener that throws neither fails the check nor jams the next one", async () => {
  // The broadcast can outlive the window it reaches. A throw there must not
  // park a dead check in flight — the row would say "checking" forever and
  // every later ask would reuse the failure.
  let requests = 0;
  const service = new UpdateService({
    currentVersion: "0.1.0",
    onChange: () => {
      throw new Error("window already torn down");
    },
    fetch: async () => {
      requests += 1;
      return releaseResponse({ tag_name: "v0.2.0" });
    },
  });

  const first = await service.check();
  assert.equal(first.status, UPDATE_STATUS.UPDATE_AVAILABLE);
  assert.equal(service.snapshot().status, UPDATE_STATUS.UPDATE_AVAILABLE);

  const second = await service.check();
  assert.equal(second.status, UPDATE_STATUS.UPDATE_AVAILABLE);
  assert.equal(requests, 2);
});

test("the timed check starts at once and stops when asked", async () => {
  let requests = 0;
  const service = new UpdateService({
    currentVersion: "0.1.0",
    onChange: () => undefined,
    intervalMs: 10,
    fetch: async () => {
      requests += 1;
      return releaseResponse({ tag_name: "v0.1.0" });
    },
  });

  service.setAutomatic(true);
  await sleep(35);
  assert.ok(requests >= 2, `expected the timer to have checked again, saw ${requests}`);

  service.setAutomatic(false);
  const settled = requests;
  await sleep(30);
  assert.equal(requests, settled);
});
