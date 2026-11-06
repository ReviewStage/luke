import { triggerIngressApp } from "@repo/service/triggers/trigger-ingress-app";
import { routeFromHttpRouter } from "../../route-effect.js";

export default routeFromHttpRouter(triggerIngressApp());
