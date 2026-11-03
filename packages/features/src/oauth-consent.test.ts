import { expect, it } from "vitest";
import { oauthRedirectDestination } from "./oauth-consent.js";

/**
 * oauth-consent.test.ts -- the consent page names a redirect on the member's
 * own machine as an app on this computer, and any other by its host, a name
 * that only begins like a loopback address among them.
 */

it.each([
  ["http://127.0.0.1:4810/callback", "an app on this computer"],
  ["cursor://anysphere.cursor-mcp/oauth/callback", "an app on this computer"],
  ["https://notes.acme.example:8443/oauth/callback", "notes.acme.example:8443"],
  ["http://127.acme.example/callback", "127.acme.example"],
])("the answer to a client redirecting to %s goes to %s", (redirectUri, destination) => {
  expect(oauthRedirectDestination(redirectUri)).toBe(destination);
});
