/**
 * sandbox-sdk-probe.ts -- throwaway: runs `@vercel/sandbox` from the deployed bundle under the deployment's OIDC token, once per POST, and logs each step. Never merged.
 */

import { deploymentOidcToken } from "@repo/service/agents/vercel-sandbox-api";
import type { Route } from "@repo/service/route";
import { APIError, Sandbox } from "@vercel/sandbox";

/** Each poll is one lookup's round trip, so this bounds the wait for the stop at about a minute. */
const STOP_POLLS = 300;

function claimsOf(token: string): { teamId: string; projectId: string } {
  const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
  return { teamId: payload.owner_id, projectId: payload.project_id };
}

async function probe(): Promise<readonly string[]> {
  const steps: string[] = [];
  const started = Date.now();
  const log = (step: string) => {
    const line = `sandbox-sdk-probe +${Date.now() - started}ms ${step}`;
    steps.push(line);
    // biome-ignore lint/suspicious/noConsole: the probe's result is read from the Preview's runtime logs.
    console.log(line);
  };
  const token = await deploymentOidcToken();
  const credentials = { token, ...claimsOf(token) };
  log("oidc token read");
  const name = `sdk-probe-${started}`;
  const created = await Sandbox.create({
    ...credentials,
    name,
    persistent: true,
    timeout: 120_000,
  });
  log(`create ok: ${created.name} status=${created.status}`);
  await created.stop();
  log("stop asked");
  let status = "unknown";
  for (let poll = 0; poll < STOP_POLLS && status !== "stopped"; poll += 1) {
    status = (await Sandbox.get({ ...credentials, name, resume: false })).status;
  }
  log(`after stop: status=${status}`);
  const resumed = await Sandbox.get({ ...credentials, name, resume: true });
  log(`get(resume) ok: status=${resumed.status}`);
  const ran = await resumed.runCommand("echo", ["ok"]);
  log(`runCommand exit=${ran.exitCode} stdout=${JSON.stringify((await ran.stdout()).trim())}`);
  // The delete exactly as `vercelSandboxApi`'s `deleteSandbox` asks it.
  const found = await Sandbox.get({ ...credentials, name, resume: false });
  await found.delete({ deleteOrphanSnapshots: true });
  log("delete ok");
  const gone = await Sandbox.get({ ...credentials, name, resume: false }).then(
    () => "still found",
    (error: unknown) => (error instanceof APIError ? `answered ${error.response.status}` : "threw"),
  );
  log(`get after delete: ${gone}`);
  return steps;
}

const route: Route = {
  async fetch(request) {
    if (request.method !== "POST") return new Response(null, { status: 405 });
    try {
      return Response.json({ ok: true, steps: await probe() });
    } catch (error) {
      const said =
        error instanceof APIError
          ? `APIError ${error.response.status} ${error.message}`
          : error instanceof Error
            ? `${error.name}: ${error.message}`
            : "unknown";
      // biome-ignore lint/suspicious/noConsole: the probe's result is read from the Preview's runtime logs.
      console.log(`sandbox-sdk-probe failed: ${said}`);
      return Response.json({ ok: false, failure: said }, { status: 500 });
    }
  },
};

export default route;
