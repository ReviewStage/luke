import { ACTION_KIND } from "@sidecar/session";
import { describeProviderContract, PROVIDER_OBSERVATION } from "../testing/index.js";
import { conductorPlugin } from "./index.js";

const CONDUCTOR_SESSION_ID = {
  IDLE: "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e50",
  WORKING: "6c1f2f14-9a0b-4c2d-8e3f-0a1b2c3d4e51",
} as const;

describeProviderContract(
  (input) =>
    conductorPlugin({
      readApiKey: input.readApiKey,
      baseUrl: "https://api.conductor.test",
      fetch: input.api.fetch,
      now: input.now,
      minimumPassIntervalMs: input.minimumPassIntervalMs,
    }),
  {
    providerId: "conductor",
    observation: PROVIDER_OBSERVATION.KEY,
    now: Date.parse("2026-09-01T09:00:00.000Z"),
    sessionId: CONDUCTOR_SESSION_ID.IDLE,
    absentSessionId: "6c1f2f14-9a0b-4c2d-8e3f-000000000000",
    absentProjectId: "project-unreported",
    advertised: [
      ACTION_KIND.MESSAGE,
      ACTION_KIND.CONTROL,
      ACTION_KIND.ADD_AGENT,
      ACTION_KIND.RENAME_SESSION,
      ACTION_KIND.RENAME_WORKSPACE,
    ],
    unadvertised: [],
    targetedControlId: "archive-workspace",
    transcript: { sessionId: CONDUCTOR_SESSION_ID.IDLE, throughMessagesEndpoint: true },
    conversation: { sessionId: CONDUCTOR_SESSION_ID.IDLE },
  },
);
