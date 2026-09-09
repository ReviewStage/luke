import { ACT_KIND, adapterAsPlugin } from "@sidecar/session";
import { describeProviderContract, PROVIDER_OBSERVATION } from "../testing/index.js";
import { CodexCloudSessionAdapter } from "./cloud-adapter.js";

describeProviderContract(
  (input) => {
    const adapter = new CodexCloudSessionAdapter({
      run: input.run,
      now: input.now,
      minimumRefreshIntervalMs: input.minimumRefreshIntervalMs,
    });
    // What the latest pass learned about the login is not one of the acts the
    // adapter interface declares, so it rides beside the shim until the
    // plugin itself carries it.
    return { ...adapterAsPlugin(adapter), connection: () => adapter.connection() };
  },
  {
    providerId: "codex-cloud",
    observation: PROVIDER_OBSERVATION.CLI,
    cli: { loginProbeArgv: ["login", "status"] },
    now: Date.parse("2026-09-01T09:00:00.000Z"),
    sessionId: "task-flaky-check",
    absentSessionId: "task-never-observed",
    absentProjectId: "env-unreported",
    advertised: [],
    unadvertised: [
      ACT_KIND.MESSAGE,
      ACT_KIND.CONTROL,
      ACT_KIND.ADD_AGENT,
      ACT_KIND.RENAME_SESSION,
      ACT_KIND.RENAME_WORKSPACE,
    ],
  },
);
