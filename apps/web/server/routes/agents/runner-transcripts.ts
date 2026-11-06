import { runnerTranscriptsApp } from "@repo/service/agents/native-events/runner-transcripts-app";
import { routeFromHttpRouter } from "../../route-effect.js";

/** Where a cloud runner keeps its CLI's transcript (POST), admitted by the runner's own bearer rather than an account's. The logic lives in `packages/service/src/agents/native-events/runner-transcripts-app.ts`; this file only hands it to the deployment. */
export default routeFromHttpRouter(runnerTranscriptsApp());
