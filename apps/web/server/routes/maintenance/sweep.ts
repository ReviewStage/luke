import { maintenanceApp } from "@repo/service/maintenance/maintenance-app";
import { nativeAgents } from "../../native-agents.js";
import { routeFromHttpRouter } from "../../route-effect.js";

export default routeFromHttpRouter(maintenanceApp(), nativeAgents);
