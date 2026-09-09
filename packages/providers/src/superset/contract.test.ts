import { ACT_KIND } from "@sidecar/session";
import {
  describeProviderContract,
  PROVIDER_OBSERVATION,
  supersetHostDb,
} from "../testing/index.js";
import { supersetPlugin } from "./plugin.js";

describeProviderContract(
  async (input) => {
    await supersetHostDb(input.home, await input.sql("host"));
    const plugin = supersetPlugin({
      homeDirectory: input.home,
      run: async (executable, argv) => {
        throw new Error(`observation spawned ${executable} ${argv.join(" ")}`);
      },
      query: async (executable, argv) => {
        throw new Error(`observation spawned ${executable} ${argv.join(" ")}`);
      },
    });
    return {
      ...plugin,
      // Superset's rows come from the host-state read its `refresh` performs,
      // so the pass under test is that read and the roster it publishes.
      async observe() {
        await plugin.refresh(undefined);
        return plugin.observe();
      },
    };
  },
  {
    providerId: "superset",
    observation: PROVIDER_OBSERVATION.FILES,
    now: Date.parse("2026-09-01T09:00:00.000Z"),
    sessionId: "workspace-idle",
    absentSessionId: "workspace-never-observed",
    absentProjectId: "project-unreported",
    advertised: [ACT_KIND.CONTROL, ACT_KIND.ADD_AGENT, ACT_KIND.RENAME_WORKSPACE],
    unadvertised: [ACT_KIND.MESSAGE, ACT_KIND.RENAME_SESSION],
  },
);
