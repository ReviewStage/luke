import {
  describeProviderContract,
  PROVIDER_OBSERVATION,
  supersetHostDb,
} from "@sidecar/providers/testing";
import { ACT_KIND, adapterAsPlugin } from "@sidecar/session";
import { SupersetCli, SupersetWorkspaceAdapter } from "./cli.js";
import { SupersetWorkspaceReader } from "./workspaces.js";

/** The organization the fixture's host database is filed under. */
const FIXTURE_ORGANIZATION_ID = "fixture-organization";

describeProviderContract(
  async (input) => {
    await supersetHostDb(input.home, await input.sql("host"));
    const cli = new SupersetCli({
      homeDirectory: input.home,
      run: async (executable, argv) => {
        throw new Error(`observation spawned ${executable} ${argv.join(" ")}`);
      },
      query: async (executable, argv) => {
        throw new Error(`observation spawned ${executable} ${argv.join(" ")}`);
      },
      organizationId: async () => FIXTURE_ORGANIZATION_ID,
    });
    const adapter = new SupersetWorkspaceAdapter(cli);
    const reader = new SupersetWorkspaceReader({ homeDirectory: input.home });
    const shim = adapterAsPlugin(adapter);
    return {
      ...shim,
      // Superset's rows are handed to the adapter by the host-state read
      // rather than read inside it, so the pass under test is both halves.
      async observe() {
        const snapshot = await reader.read();
        await adapter.refresh(
          undefined,
          false,
          snapshot.workspaceRowObservations(FIXTURE_ORGANIZATION_ID),
        );
        return shim.observe();
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
