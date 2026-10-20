import assert from "node:assert/strict";
import * as Sentry from "@sentry/core";
import { Predicate } from "effect";
import { test } from "vitest";
import {
  eventWithoutAccessTokens,
  SPANS_NAMING_ACCESS_TOKENS,
  spanWithoutAccessTokens,
  withoutAccessTokens,
} from "./sentry-breadcrumbs.js";

/**
 * sentry-breadcrumbs.test.ts -- a renderer's breadcrumbs, events, and spans as Sentry would carry them: LiveKit's token never among them.
 *
 * Spans go through a client of Sentry's own core, on its default streamed
 * lifecycle, over a transport that writes down what it would have sent, so
 * what is asserted is what would have left the process.
 */

/** A DSN on a reserved domain, which the recording transport never posts to. */
const FIXTURE_SENTRY_DSN = "https://public@sentry.invalid/1";

const TOKEN = "eyJhbGciOiJIUzI1NiJ9.participant-token-never-reported";

test("a failed join's validate fetch, its token in the query, is dropped", () => {
  const breadcrumb = {
    category: "fetch",
    type: "http",
    level: "error" as const,
    data: {
      method: "GET",
      url: `https://luke-avatar.livekit.cloud/rtc/v1/validate?access_token=${TOKEN}&auto_subscribe=1`,
    },
  };
  assert.equal(withoutAccessTokens(breadcrumb), null);
});

test("the same request over XHR is dropped too", () => {
  const breadcrumb = {
    category: "xhr",
    type: "http",
    data: {
      method: "GET",
      url: `https://x.livekit.cloud/rtc/validate?access_token=${TOKEN}`,
      status_code: 401,
    },
  };
  assert.equal(withoutAccessTokens(breadcrumb), null);
});

test("a console line that prints the URL is dropped", () => {
  const breadcrumb = {
    category: "console",
    level: "warning" as const,
    message: `could not connect to wss://x.livekit.cloud/rtc?access_token=${TOKEN}`,
  };
  assert.equal(withoutAccessTokens(breadcrumb), null);
});

test("a breadcrumb carrying no token is kept as it was", () => {
  const breadcrumb = {
    category: "fetch",
    type: "http",
    data: { method: "GET", url: "https://luke.example.test/status", status_code: 200 },
  };
  assert.equal(withoutAccessTokens(breadcrumb), breadcrumb);
});

test("an error whose message carries a failed join's validate URL is dropped", () => {
  const event = {
    type: undefined,
    exception: {
      values: [
        {
          type: "ConnectionError",
          value: `could not establish signal connection: https://x.livekit.cloud/rtc/v1/validate?access_token=${TOKEN}`,
        },
      ],
    },
  };
  assert.equal(eventWithoutAccessTokens(event), null);
});

test("an event whose request or message names the token is dropped", () => {
  const url = `https://x.livekit.cloud/rtc/v1/validate?access_token=${TOKEN}`;
  assert.equal(eventWithoutAccessTokens({ type: undefined, request: { url } }), null);
  assert.equal(eventWithoutAccessTokens({ type: undefined, message: `join failed: ${url}` }), null);
});

test("an event carrying no token is sent as it was", () => {
  const event = {
    type: undefined,
    exception: { values: [{ type: "TypeError", value: "x is undefined" }] },
    request: { url: "app://renderer/call.html" },
  };
  assert.equal(eventWithoutAccessTokens(event), event);
});

/** A sent attribute's value, as Sentry's span protocol types it. */
type AttributeValue = string | number | boolean;

/** A span as it would have been sent: its name and its attributes' values. */
interface SentSpan {
  readonly name: string;
  readonly attributes: Readonly<Record<string, AttributeValue>>;
}

/** What a streamed span item's payload is read for. */
interface SpanContainer {
  readonly items?: readonly {
    readonly name: string;
    readonly attributes?: Readonly<Record<string, { readonly value: AttributeValue }>>;
  }[];
}

/** A client of Sentry's core, as the browser and Electron SDKs' clients are, building no error events, which these tests send none of. */
class FixtureClient extends Sentry.Client {
  constructor(options: Sentry.ClientOptions) {
    super(options);
  }
  eventFromException(): PromiseLike<Sentry.Event> {
    return Promise.resolve({});
  }
  eventFromMessage(): PromiseLike<Sentry.Event> {
    return Promise.resolve({});
  }
}

/** The spans in a serialized envelope: a header line, then a line of item header and a line of payload per item. */
function spansOf(body: string): SentSpan[] {
  const [, ...lines] = body.split("\n").filter((line) => line.length > 0);
  const spans: SentSpan[] = [];
  for (let at = 0; at + 1 < lines.length; at += 2) {
    const header: { type?: string } = JSON.parse(lines[at] ?? "{}");
    if (header.type !== "span") continue;
    const container: SpanContainer = JSON.parse(lines[at + 1] ?? "{}");
    for (const item of container.items ?? []) {
      const attributes = Object.entries(item.attributes ?? {}).map(([name, { value }]) => [
        name,
        value,
      ]);
      spans.push({ name: item.name, attributes: Object.fromEntries(attributes) });
    }
  }
  return spans;
}

/**
 * Sentry started as a renderer and a tab start it, every trace kept, on the
 * SDK's default lifecycle, with the clients' span filters, over a
 * recording transport; answers every span sent once `traced` has run.
 */
async function sentSpans(traced: () => void): Promise<SentSpan[]> {
  const sent: SentSpan[] = [];
  const client = new FixtureClient({
    dsn: FIXTURE_SENTRY_DSN,
    integrations: [Sentry.spanStreamingIntegration({ flushOnSegmentEnd: false })],
    stackParser: Sentry.createStackParser(),
    tracesSampleRate: 1,
    ignoreSpans: SPANS_NAMING_ACCESS_TOKENS,
    beforeSendSpan: Sentry.withStreamedSpan(spanWithoutAccessTokens),
    transport: (transportOptions: Sentry.BaseTransportOptions) =>
      Sentry.createTransport(transportOptions, (request) => {
        const body = Predicate.isString(request.body)
          ? request.body
          : new TextDecoder().decode(request.body);
        sent.push(...spansOf(body));
        return Promise.resolve({});
      }),
  });
  Sentry.setCurrentClient(client);
  client.init();
  traced();
  await client.close(1_000);
  return sent;
}

/** Every word a sent span carries, its name and its attributes' values, as one text to search. */
function sentText(spans: readonly SentSpan[]): string {
  return JSON.stringify(spans);
}

test("a request span whose address names the avatar's token as it starts is never sent", async () => {
  const url = `https://x.livekit.cloud/rtc/v1/validate?access_token=${TOKEN}&auto_subscribe=1`;
  const spans = await sentSpans(() => {
    Sentry.startSpan({ name: "/panel.html", op: "pageload" }, () => {
      Sentry.startSpan(
        { name: "GET x.livekit.cloud", op: "http.client", attributes: { "url.full": url } },
        () => {},
      );
    });
  });
  assert.deepEqual(
    spans.map((span) => span.name),
    ["/panel.html"],
  );
});

test("a span whose name names the token as it starts is never sent", async () => {
  const spans = await sentSpans(() => {
    Sentry.startSpan({ name: "/panel.html", op: "pageload" }, () => {
      Sentry.startSpan({ name: `GET /rtc?access_token=${TOKEN}`, op: "http.client" }, () => {});
    });
  });
  assert.deepEqual(
    spans.map((span) => span.name),
    ["/panel.html"],
  );
});

test("a token in a span's fragment, path, or query is scrubbed from what is sent", async () => {
  const pathToken = "0f".repeat(20);
  const spans = await sentSpans(() => {
    Sentry.startSpan({ name: "/app", op: "pageload" }, (page) => {
      // Note that the page's own address is set once the span stands, as the SDK's HTTP context does.
      page.setAttribute("url.full", `https://luke.example.test/app#access_token=${TOKEN}`);
      page.setAttribute("url.fragment", `access_token=${TOKEN}`);
      Sentry.startSpan(
        {
          name: "GET api.example.test",
          op: "http.client",
          attributes: {
            "url.full": `https://api.example.test/files/${pathToken}/raw?code=fixture-code&state=fixture-state&sig=fixture-sig`,
            "url.query": "code=fixture-code&state=fixture-state&sig=fixture-sig",
          },
        },
        () => {},
      );
    });
  });
  const text = sentText(spans);
  for (const secret of [TOKEN, pathToken, "fixture-code", "fixture-state", "fixture-sig"]) {
    assert.equal(text.includes(secret), false, secret);
  }
  const attributes = Object.fromEntries(spans.map((span) => [span.name, span.attributes]));
  assert.deepEqual(
    [attributes["/app"]?.["url.full"], attributes["/app"]?.["url.fragment"]],
    ["https://luke.example.test/app#[redacted]", "[redacted]"],
  );
  assert.deepEqual(
    [
      attributes["GET api.example.test"]?.["url.full"],
      attributes["GET api.example.test"]?.["url.query"],
    ],
    [
      "https://api.example.test/files/[redacted]/raw?code=[redacted]&state=[redacted]&sig=[redacted]",
      "code=[redacted]&state=[redacted]&sig=[redacted]",
    ],
  );
});

test("an address in a span's name is scrubbed, and other words of the name are kept", async () => {
  const spans = await sentSpans(() => {
    Sentry.startSpan(
      { name: "GET https://luke.example.test/oauth/callback?code=fixture-code&sig=fixture-sig" },
      () => {},
    );
    Sentry.startSpan(
      { name: "proxy url=https://fixture-user:fixture-pass@luke.example.test/x" },
      () => {},
    );
    Sentry.startSpan({ name: "ui.click button#send" }, () => {});
  });
  assert.deepEqual(spans.map((span) => span.name).sort(), [
    "GET https://luke.example.test/oauth/callback?code=[redacted]&sig=[redacted]",
    "proxy url=https://[redacted]@luke.example.test/x",
    "ui.click button#send",
  ]);
});

test("a token named after a span starts, in its name or any attribute, is replaced", async () => {
  const spans = await sentSpans(() => {
    Sentry.startSpan({ name: "/panel.html", op: "pageload" }, () => {
      Sentry.startSpan({ name: "avatar.join", op: "function" }, (join) => {
        join.updateName(`join wss://x.livekit.cloud/rtc?access_token=${TOKEN}`);
        join.setAttribute("avatar.failure", `could not connect: /rtc?access_token=${TOKEN}`);
      });
    });
  });
  assert.equal(sentText(spans).includes(TOKEN), false);
  assert.deepEqual(
    spans.map((span) => [span.name, span.attributes["avatar.failure"]]),
    [
      ["[redacted]", "[redacted]"],
      ["/panel.html", undefined],
    ],
  );
});

test("a span carrying no address and no token is sent as it was", async () => {
  const spans = await sentSpans(() => {
    Sentry.startSpan(
      { name: "plan.render", op: "ui.render", attributes: { "plan.sections": 4 } },
      () => {},
    );
  });
  assert.deepEqual(
    spans.map((span) => [span.name, span.attributes["plan.sections"]]),
    [["plan.render", 4]],
  );
});
