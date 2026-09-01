import { Layer } from "effect";
import { getDatabase } from "../db/index.js";
import { HostedDatabaseService } from "./tags.js";

export const HostedDatabaseLive = Layer.sync(HostedDatabaseService, () => getDatabase());
