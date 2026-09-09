import { ACT_KIND } from "@sidecar/session";
import { describeProviderContract, PROVIDER_OBSERVATION } from "../testing/index.js";
import { ompPlugin } from "./index.js";

const OMP_SESSION_ID = {
  SETTLED: "01a0540a-c238-7264-80d8-546b0c7be0d8",
  WORKING: "01a0540a-c238-7264-80d8-546b0c7be0d9",
  BARE: "01a0540a-c238-7264-80d8-546b0c7be0da",
} as const;

describeProviderContract((input) => ompPlugin({ ompHome: input.home, now: input.now }), {
  providerId: "omp",
  observation: PROVIDER_OBSERVATION.FILES,
  now: Date.parse("2026-09-01T09:00:00.000Z"),
  sessionId: OMP_SESSION_ID.SETTLED,
  absentSessionId: "01a0540a-c238-7264-80d8-000000000000",
  absentProjectId: "unreported-project",
  advertised: [],
  unadvertised: [
    ACT_KIND.MESSAGE,
    ACT_KIND.CONTROL,
    ACT_KIND.ADD_AGENT,
    ACT_KIND.RENAME_SESSION,
    ACT_KIND.RENAME_WORKSPACE,
  ],
  transcript: {
    sessionId: OMP_SESSION_ID.WORKING,
    unrenderableSessionId: OMP_SESSION_ID.BARE,
  },
});
