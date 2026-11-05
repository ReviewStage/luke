import { describe, expect, it } from "vitest";
import { CALL_FAULT } from "./account-call.js";
import { CLI_EXIT, cliExitOfHostedFailure } from "./cli-exit.js";
import { HostedRefused, HostedUnanswered } from "./hosted-link.js";
import { HOSTED_API_ERROR } from "./service-wire.js";

// Note that the regression these catch is a failure read as the wrong kind, so a script retries a
// lapsed sign-in as an outage, or signs in again over a refusal.
describe("cliExitOfHostedFailure", () => {
  it.each([
    [
      "a lapsed bearer",
      new HostedRefused({ refusal: HOSTED_API_ERROR.INVALID_TOKEN }),
      CLI_EXIT.AUTH,
    ],
    [
      "no sign-in to send",
      new HostedUnanswered({ fault: CALL_FAULT.NO_CREDENTIAL }),
      CLI_EXIT.AUTH,
    ],
    ["a refusal", new HostedRefused({ refusal: HOSTED_API_ERROR.NOT_FOUND }), CLI_EXIT.REFUSED],
    ["no network", new HostedUnanswered({ fault: CALL_FAULT.NETWORK }), CLI_EXIT.UNAVAILABLE],
    ["a server error", new HostedUnanswered({ status: 502 }), CLI_EXIT.UNAVAILABLE],
  ])("ends %s as its exit code", (_case, failed, exit) => {
    expect(cliExitOfHostedFailure(failed)).toBe(exit);
  });
});
