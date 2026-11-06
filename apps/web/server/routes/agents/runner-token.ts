import { runnerTokenApp } from "@repo/service/agents/native-events/runner-token-app";
import { routeFromHttpRouter } from "../../route-effect.js";

export default routeFromHttpRouter(runnerTokenApp());
