import { expect, it } from "vitest";
import { oauthRedirectDestination } from "./oauth-consent.js";

it.each([
  ["http://127.0.0.1:4810/callback", "an app on this computer"],
  ["cursor://anysphere.cursor-mcp/oauth/callback", "an app on this computer"],
  ["https://notes.acme.example:8443/oauth/callback", "notes.acme.example:8443"],
  ["http://127.acme.example/callback", "127.acme.example"],
])("the answer to a client redirecting to %s goes to %s", (redirectUri, destination) => {
  expect(oauthRedirectDestination(redirectUri)).toBe(destination);
});
