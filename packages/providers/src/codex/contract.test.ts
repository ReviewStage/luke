import { ACT_KIND, adapterAsPlugin } from "@sidecar/session";
import { codexStateDb, describeProviderContract, PROVIDER_OBSERVATION } from "../testing/index.js";
import { CodexSessionAdapter } from "./adapter.js";
import { CODEX_HOOK_EVENT } from "./hooks.js";

const CODEX_SESSION_ID = {
  WAITING: "019b1c22-6f10-7d5e-9a71-2b8c4d5e6f70",
  WORKING: "019b1c22-6f10-7d5e-9a71-2b8c4d5e6f71",
  COMPRESSED: "019b1c22-6f10-7d5e-9a71-2b8c4d5e6f72",
} as const;

describeProviderContract(
  async (input) => {
    await codexStateDb(input.home, await input.sql("state"));
    return adapterAsPlugin(
      new CodexSessionAdapter({
        codexHome: input.home,
        now: input.now,
        hookEventsDirectory: input.hookEventsDirectory,
      }),
    );
  },
  {
    providerId: "codex",
    observation: PROVIDER_OBSERVATION.FILES,
    now: Date.parse("2026-09-01T09:00:00.000Z"),
    sessionId: CODEX_SESSION_ID.WAITING,
    absentSessionId: "019b1c22-6f10-7d5e-9a71-000000000000",
    absentProjectId: "unreported-environment",
    advertised: [],
    unadvertised: [
      ACT_KIND.MESSAGE,
      ACT_KIND.CONTROL,
      ACT_KIND.ADD_AGENT,
      ACT_KIND.RENAME_SESSION,
      ACT_KIND.RENAME_WORKSPACE,
    ],
    transcript: {
      sessionId: CODEX_SESSION_ID.WORKING,
      unrenderableSessionId: CODEX_SESSION_ID.COMPRESSED,
    },
    hookSpool: { events: Object.values(CODEX_HOOK_EVENT) },
  },
);
