import { runnerLinesApp } from "@repo/service/agents/native-events/runner-lines-app";
import { routeFromHttpRouter } from "../../route-effect.js";

export default routeFromHttpRouter(runnerLinesApp());
