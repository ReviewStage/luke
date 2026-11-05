import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { SENTRY_TUNNEL } from "@repo/features/sentry-tunnel";
import { fakeHttpClientLayer } from "@repo/wire/testing";
import { ConfigProvider, Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";
import { HOSTED_HTTP_STATUS } from "../http/http.js";
import { SENTRY_ENVIRONMENT } from "./sentry.js";
import { sentryTunnelApp } from "./sentry-tunnel-app.js";

/**
 * The tunnel, answered by its group the way a function answers it, over a
 * fake of Sentry's ingest: an envelope for another project is refused and
 * nothing is sent, while one for the deployment's own is passed on as it
 * came. Synthetic DSNs throughout.
 */

const ORIGIN = "https://app.test";
const OWN_DSN = "https://publickey@o1.ingest.us.sentry.invalid/42";
const FOREIGN_DSN = "https://otherkey@o9.ingest.us.sentry.invalid/77";

const envelopeFor = (dsn: string) =>
  `${JSON.stringify({ event_id: "0".repeat(32), dsn })}\n{"type":"event"}\n{"message":"blank tab"}\n`;

it.effect(
  "an envelope for another project is refused and sent nowhere, and the deployment's own is passed on",
  () =>
    Effect.gen(function* () {
      const sent: { url: string; body: string }[] = [];
      const services = Layer.merge(
        fakeHttpClientLayer(async (url, init) => {
          sent.push({ url, body: await new Response(init.body).text() });
          return new Response(null, { status: HOSTED_HTTP_STATUS.OK });
        }),
        ConfigProvider.layer(ConfigProvider.fromUnknown({ [SENTRY_ENVIRONMENT.DSN]: OWN_DSN })),
      );
      const web = HttpRouter.toWebHandler(
        sentryTunnelApp().pipe(HttpRouter.provideRequest(services)),
        {
          disableLogger: true,
        },
      );
      yield* Effect.addFinalizer(() => Effect.promise(() => web.dispose()));
      const post = (body: string) =>
        Effect.promise(() =>
          web.handler(new Request(`${ORIGIN}${SENTRY_TUNNEL.ROUTE}`, { method: "POST", body })),
        );

      const foreign = yield* post(envelopeFor(FOREIGN_DSN));
      assert.equal(foreign.status, HOSTED_HTTP_STATUS.FORBIDDEN);
      assert.deepEqual(sent, []);

      const own = yield* post(envelopeFor(OWN_DSN));
      assert.equal(own.status, HOSTED_HTTP_STATUS.OK);
      assert.deepEqual(sent, [
        {
          url: "https://o1.ingest.us.sentry.invalid/api/42/envelope/",
          body: envelopeFor(OWN_DSN),
        },
      ]);
    }),
);
