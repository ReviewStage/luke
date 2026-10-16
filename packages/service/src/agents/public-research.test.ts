import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { unparsedWire, type WireBoundaryInput } from "@luke/wire";
import { type RecordedRequest, recordingHttpClient } from "@luke/wire/testing";
import { Effect, Redacted } from "effect";
import {
  HostResolver,
  HostUnresolved,
  PUBLIC_RESEARCH_BOUNDS,
  READ_WEB_PAGE_REFUSAL,
  READ_WEB_PAGE_STATUS,
  ResearchBudget,
  type ResearchCall,
  runReadWebPage,
  runSearchWeb,
  SEARCH_WEB_REFUSAL,
  SEARCH_WEB_STATUS,
} from "./public-research.js";

/**
 * The planning model's public research at its HTTP boundary: OpenAI's
 * Responses API answering a search as a scripted table, and public sites
 * answering page reads the same way, with the resolver a table too, so no
 * test reaches the network or the real DNS. What each test asserts is the
 * result the model reads and the requests that left, never how either was
 * built.
 *
 * Synthetic keys, queries, hosts, and pages throughout.
 */

const OPENAI_KEY = "sk-test-research-key";
const MODEL_ID = "gpt-test";

function researchCall(overrides: Partial<ResearchCall> = {}): ResearchCall {
  return {
    turnId: "turn-1",
    budget: new ResearchBudget(),
    openAi: { apiKey: Redacted.make(OPENAI_KEY), modelId: MODEL_ID },
    spend: Effect.void,
    ...overrides,
  };
}

function wire(value: WireBoundaryInput) {
  return unparsedWire(value);
}

function searchWith(respond: (request: RecordedRequest) => Response, call = researchCall()) {
  const http = recordingHttpClient(respond);
  const search = (input: WireBoundaryInput) =>
    runSearchWeb(call, wire(input)).pipe(Effect.provide(http.layer));
  return { http, search };
}

const PUBLIC_HOSTS = new Map([
  ["docs.example.com", ["93.184.215.14", "2606:2800:21f:cb07:6820:80da:af6b:8b2c"]],
  ["moved.example.com", ["93.184.215.15"]],
  ["intranet.example.com", ["10.0.0.5"]],
  ["metadata.example.com", ["169.254.169.254"]],
  ["split.example.com", ["93.184.215.16", "192.168.1.20"]],
  ["ula.example.com", ["fd12:3456:789a::1"]],
  ["cgnat.example.com", ["100.64.1.1"]],
  ["mapped.example.com", ["::ffff:127.0.0.1"]],
]);

/** A resolver over the table above; any other name does not resolve. */
const tableResolver = (hostname: string) => {
  const addresses = PUBLIC_HOSTS.get(hostname);
  return addresses === undefined
    ? Effect.fail(new HostUnresolved({ hostname }))
    : Effect.succeed(addresses);
};

function readWith(respond: (request: RecordedRequest) => Response, call = researchCall()) {
  const http = recordingHttpClient(respond);
  const read = (input: WireBoundaryInput) =>
    runReadWebPage(call, wire(input)).pipe(
      Effect.provide(http.layer),
      Effect.provideService(HostResolver, tableResolver),
    );
  return { http, read };
}

function redirectTo(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

const unreached = () => {
  throw new Error("this test sends no request");
};

it.effect(
  "a query carrying code, a secret, or another field is refused before anything is sent",
  () =>
    Effect.gen(function* () {
      const refused: readonly WireBoundaryInput[] = [
        { query: "" },
        { query: "x".repeat(PUBLIC_RESEARCH_BOUNDS.MAX_QUERY_CHARS + 1) },
        { query: "why does this fail\nconst token = process.env.SECRET" },
        { query: "is sk-proj-abcdefghijklmnopqrstuvwx valid" },
        { query: "ghp_abcdefghijklmnopqrstuvwx scopes" },
        { query: "-----BEGIN OPENSSH KEY----- format" },
        { query: "commit 4f2c9e1a7b3d5f60718293a4b5c6d7e8f9012345 changelog" },
        { query: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0 decode" },
        { query: "Stripe idempotency", planId: "plan-1" },
        { query: 42 },
      ];
      const { http, search } = searchWith(unreached);

      for (const input of refused) {
        const result = yield* search(input);
        assert.equal(result.status, SEARCH_WEB_STATUS.NOT_SEARCHED, JSON.stringify(input));
        assert.equal(
          result.status === SEARCH_WEB_STATUS.NOT_SEARCHED && result.reason,
          SEARCH_WEB_REFUSAL.UNREADABLE,
        );
      }
      assert.equal(http.requests.length, 0);
    }),
);

it.effect("a host that is not on the public internet is refused before anything is sent", () =>
  Effect.gen(function* () {
    const refused = [
      "https://intranet.example.com/wiki",
      "https://metadata.example.com/latest/meta-data/",
      "https://split.example.com/",
      "https://ula.example.com/",
      "https://cgnat.example.com/",
      "https://mapped.example.com/",
      "https://169.254.169.254/latest/meta-data/",
      "https://127.0.0.1/",
      "https://2130706433/",
      "https://[::1]/",
      "https://[fd00::1]/",
      "https://[::ffff:10.0.0.1]/",
      "https://localhost/",
      "https://printer.local/",
      "https://service.internal/",
      "https://intranet/",
    ];
    for (const url of refused) {
      const { http, read } = readWith(unreached);
      const result = yield* read({ url });
      assert.deepEqual(
        result.status === READ_WEB_PAGE_STATUS.NOT_READ && result.reason,
        READ_WEB_PAGE_REFUSAL.NOT_PUBLIC,
        url,
      );
      assert.equal(http.requests.length, 0);
    }
  }),
);

it.effect(
  "every redirect hop is checked again, and one into a private network is not followed",
  () =>
    Effect.gen(function* () {
      const { http, read } = readWith((request) =>
        request.url.startsWith("https://docs.example.com/")
          ? redirectTo("https://metadata.example.com/latest/")
          : unreached(),
      );

      const result = yield* read({ url: "https://docs.example.com/start" });

      assert.equal(
        result.status === READ_WEB_PAGE_STATUS.NOT_READ && result.reason,
        READ_WEB_PAGE_REFUSAL.NOT_PUBLIC,
      );
      assert.deepEqual(
        http.requests.map((request) => request.url),
        ["https://docs.example.com/start"],
      );
    }),
);
