import assert from "node:assert/strict";
import type { HostedStoreTestRun } from "@luke/database/testing";
import { LINK_OUTCOME } from "@luke/service/github/github-installations";
import type { Layer } from "effect";
import type * as HttpClient from "effect/http/HttpClient";
import type { GitHubApp } from "../../server/github/github-app";
import {
  connectWorkspaceGitHub,
  githubReaching,
  type InstallationFixture,
} from "./github-app-fake";

/**
 * fake-coder-eve.ts -- eve's coding-agent service as a script beside the fake GitHub, for a test of the tools that start and steer coding agents.
 *
 * The workspace given is connected to an installation of its own that
 * reaches the repository; every opening of a session is answered with a
 * session of its own, every message to a session is answered taken, and
 * each request is written down for the test to read.
 */

/** The repository every installation the fake connects reaches. */
const FAKE_CODER_REPOSITORY = { owner: "Acme", name: "Relay" } as const;

/** The repository as a plan or an agent names it. */
export const FAKE_CODER_REPOSITORY_FULL_NAME = `${FAKE_CODER_REPOSITORY.owner}/${FAKE_CODER_REPOSITORY.name}`;

/** One request the fake took: its path, its headers, and its body. */
export interface SentToCoderEve {
  readonly path: string;
  readonly headers: Headers;
  readonly body: string;
}

/** The installation ids handed out so far: one installation stands for one workspace, so each workspace connects its own. */
let installationsConnected = 0;

/** The fake over the test's store: the services a call reaches it through, and what it was sent. */
export async function fakeCoderEve(
  run: HostedStoreTestRun,
  workspaceId: string,
  mintSession: () => string,
): Promise<{
  readonly services: Layer.Layer<GitHubApp | HttpClient.HttpClient>;
  readonly sent: SentToCoderEve[];
}> {
  installationsConnected += 1;
  const installation: InstallationFixture = {
    id: 7 + installationsConnected,
    login: FAKE_CODER_REPOSITORY.owner,
    repositories: [FAKE_CODER_REPOSITORY],
  };
  assert.equal(await run(connectWorkspaceGitHub(workspaceId, installation)), LINK_OUTCOME.LINKED);
  const sent: SentToCoderEve[] = [];
  const github = githubReaching([installation], undefined, undefined, (request) => {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith("/eve/coder/v1/session")) return undefined;
    sent.push({ path: pathname, headers: request.headers, body: request.body });
    if (pathname === "/eve/coder/v1/session") {
      return Response.json({ sessionId: mintSession() }, { status: 202 });
    }
    return Response.json(
      { sessionId: pathname.slice("/eve/coder/v1/session/".length), deliveryId: "delivery-1" },
      { status: 202 },
    );
  });
  return { services: github.layer, sent };
}
