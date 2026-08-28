import { pathToFileURL } from "node:url";
import { getDatabase } from "./db/index.js";
import { seedDesktopOAuthClient } from "./seed-desktop-client.js";
import { seedMobileOAuthClient } from "./seed-mobile-client.js";

export async function seedOAuthClients(
  database: Parameters<typeof seedDesktopOAuthClient>[0],
  now = new Date(),
): Promise<void> {
  await seedDesktopOAuthClient(database, now);
  await seedMobileOAuthClient(database, now);
}

const executedPath = process.argv[1];
if (executedPath && import.meta.url === pathToFileURL(executedPath).href) {
  await seedOAuthClients(getDatabase());
}
