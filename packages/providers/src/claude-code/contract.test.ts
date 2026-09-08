import { ACTION_KIND } from "@sidecar/session";
import { describeProviderContract, PROVIDER_OBSERVATION } from "../testing/index.js";
import { CLAUDE_HOOK_EVENT } from "./hooks.js";
import { claudeCodePlugin } from "./index.js";

const CLAUDE_SESSION_ID = {
  WAITING: "0f3a1c22-6f10-4d5e-9a71-2b8c4d5e6f70",
  WORKING: "0f3a1c22-6f10-4d5e-9a71-2b8c4d5e6f71",
} as const;

describeProviderContract(
  (input) =>
    claudeCodePlugin({
      claudeHome: input.home,
      now: input.now,
      hookEventsDirectory: input.hookEventsDirectory,
    }),
  {
    providerId: "claude-code",
    observation: PROVIDER_OBSERVATION.FILES,
    now: Date.parse("2026-09-01T09:00:00.000Z"),
    sessionId: CLAUDE_SESSION_ID.WAITING,
    absentSessionId: "0f3a1c22-6f10-4d5e-9a71-000000000000",
    absentProjectId: "unreported-project",
    advertised: [],
    unadvertised: [
      ACTION_KIND.MESSAGE,
      ACTION_KIND.CONTROL,
      ACTION_KIND.ADD_AGENT,
      ACTION_KIND.RENAME_SESSION,
      ACTION_KIND.RENAME_WORKSPACE,
    ],
    transcript: { sessionId: CLAUDE_SESSION_ID.WORKING },
    hookSpool: { events: Object.values(CLAUDE_HOOK_EVENT) },
  },
);
