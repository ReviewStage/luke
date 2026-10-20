import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { accountBearer, HostedMacCommandClient } from "@luke/features";
import {
  MAC_COMMAND_IMAGE_TYPE,
  type MacBrowserResult,
  type MacCommandResult,
} from "@luke/features/mac-command-wire";
import { fakeCloudApi } from "@luke/wire/testing";
import { Effect } from "effect";
import { macScreenshotEncoding, settleMacCommandResult } from "./mac-browser-result.js";

/**
 * What this Mac answers for a browser command, as the service observes it:
 * a browser command's result, image and all, is posted to its own route,
 * and any other result, a refusal among them, to the commands' route; and
 * a capture is downscaled to the size it is sent at, never up.
 *
 * Synthetic bearers, ids, and results throughout.
 */

const COMMAND_ID = "7c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";

const BROWSER_RESULT: MacBrowserResult = {
  output: { address: "http://localhost:3000/", title: "Preview" },
  image: {
    mediaType: MAC_COMMAND_IMAGE_TYPE.JPEG,
    data: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]).toString("base64"),
  },
};

const REFUSAL: MacCommandResult = { refused: "Not run: no Browser tab shows this task." };

function client(): HostedMacCommandClient {
  return new HostedMacCommandClient({
    serviceBaseUrl: "https://luke.test",
    credential: accountBearer({
      readAccessToken: () => Effect.succeed("token-1"),
      refreshAccount: () => Effect.void,
      readAccountKey: () => Effect.succeed("account-1"),
    }),
  });
}

it.effect("a browser result is posted to its own route, and any other to the commands' route", () =>
  Effect.gen(function* () {
    const api = fakeCloudApi({
      "POST /api/mac-commands/browser": { answer: () => ({ settled: true }) },
      "POST /api/mac-commands": { answer: () => ({ settled: true }) },
    });

    const browser = yield* Effect.provide(
      settleMacCommandResult(client(), COMMAND_ID, BROWSER_RESULT),
      api.layer,
    );
    const refusal = yield* Effect.provide(
      settleMacCommandResult(client(), COMMAND_ID, REFUSAL),
      api.layer,
    );

    assert.equal(browser, true);
    assert.equal(refusal, true);
    assert.deepEqual(
      api.requests().map((posted) => [posted.pathname, JSON.parse(posted.body ?? "")]),
      [
        ["/api/mac-commands/browser", { id: COMMAND_ID, result: BROWSER_RESULT }],
        ["/api/mac-commands", { id: COMMAND_ID, result: REFUSAL }],
      ],
    );
  }),
);

it("a capture is downscaled to its longest side, its proportions kept, and never scaled up", () => {
  const sized = (width: number, height: number) => {
    const encoding = macScreenshotEncoding({ width, height });
    return [encoding.width, encoding.height];
  };

  assert.deepEqual(sized(2_880, 1_800), [1_568, 980], "a Retina capture");
  assert.deepEqual(sized(1_000, 3_000), [523, 1_568], "a tall capture");
  assert.deepEqual(sized(1_280, 800), [1_280, 800], "a capture already small enough");
});
