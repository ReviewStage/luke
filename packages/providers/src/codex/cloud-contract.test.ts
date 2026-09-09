import { ACT_KIND } from "@sidecar/session";
import { describeProviderContract, PROVIDER_OBSERVATION } from "../testing/index.js";
import { codexCloudPlugin } from "./cloud.js";

describeProviderContract(
  (input) =>
    codexCloudPlugin({
      run: input.run,
      now: input.now,
      minimumRefreshIntervalMs: input.minimumRefreshIntervalMs,
    }),
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
