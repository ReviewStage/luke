import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { unparsedWire, type WireBoundaryInput } from "@sidecar/wire";
import {
  HTTP_STATUS,
  type JsonValue,
  jsonResponse,
  type RecordedRequest,
  recordedRequest,
  recordingHttpClient,
} from "@sidecar/wire/testing";
import { Effect, Redacted, Schema } from "effect";
import {
  HostResolver,
  HostUnresolved,
  PUBLIC_RESEARCH_BOUNDS,
  READ_WEB_PAGE_REFUSAL,
  READ_WEB_PAGE_STATUS,
  type ReadWebPageResult,
  ResearchBudget,
  type ResearchCall,
  runReadWebPage,
  runSearchWeb,
  SEARCH_WEB_REFUSAL,
  SEARCH_WEB_STATUS,
  type SearchWebResult,
} from "../server/hosted/public-research";

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
const RESPONSES_URL = "https://api.openai.com/v1/responses";

function researchCall(overrides: Partial<ResearchCall> = {}): ResearchCall {
  return {
    turnId: "turn-1",
    budget: new ResearchBudget(),
    openAi: { apiKey: Redacted.make(OPENAI_KEY), modelId: MODEL_ID },
    ...overrides,
  };
}

function wire(value: WireBoundaryInput) {
  return unparsedWire(value);
}

interface Citation {
  readonly url: string;
  readonly title?: string;
  readonly start: number;
}

/** A Responses answer as OpenAI shapes one: a search call, then a message whose text cites its sources. */
function responsesAnswer(text: string, citations: readonly Citation[]): JsonValue {
  return {
    id: "resp_test",
    status: "completed",
    output: [
      { type: "web_search_call", id: "ws_test", status: "completed" },
      {
        type: "message",
        id: "msg_test",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text,
            annotations: citations.map((citation) => ({
              type: "url_citation",
              url: citation.url,
              ...(citation.title === undefined ? undefined : { title: citation.title }),
              start_index: citation.start,
              end_index: citation.start + 10,
            })),
          },
        ],
      },
    ],
  };
}

const IDEMPOTENCY_TEXT =
  "Stripe keeps idempotency keys for at least 24 hours. (stripe.com) Keys are compared by value. (docs)";
const IDEMPOTENCY_URL = "https://docs.stripe.com/api/idempotent_requests";

function searchWith(respond: (request: RecordedRequest) => Response, call = researchCall()) {
  const http = recordingHttpClient(respond);
  const search = (input: WireBoundaryInput) =>
    runSearchWeb(call, wire(input)).pipe(Effect.provide(http.layer));
  return { http, search };
}

function found(result: SearchWebResult) {
  assert.equal(result.status, SEARCH_WEB_STATUS.FOUND);
  return result.status === SEARCH_WEB_STATUS.FOUND ? result : assert.fail("not found");
}

const readSentJson = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

/** The JSON object a request carried, which the client sends as bytes. */
function sentBody(request: RecordedRequest) {
  const { body } = request.init;
  assert.ok(body instanceof Uint8Array);
  return readSentJson(new TextDecoder().decode(body));
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

function pageText(result: ReadWebPageResult) {
  assert.equal(result.status, READ_WEB_PAGE_STATUS.READ);
  return result.status === READ_WEB_PAGE_STATUS.READ ? result : assert.fail("not read");
}

function htmlResponse(html: string, status: number = HTTP_STATUS.OK): Response {
  return new Response(html, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

function redirectTo(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

const unreached = () => {
  throw new Error("this test sends no request");
};

it.effect(
  "a search answers each cited source with its URL, title, and the words that cited it",
  () =>
    Effect.gen(function* () {
      const { http, search } = searchWith(() =>
        jsonResponse(
          responsesAnswer(IDEMPOTENCY_TEXT, [
            {
              url: IDEMPOTENCY_URL,
              title: "Idempotent requests",
              start: IDEMPOTENCY_TEXT.indexOf("(stripe"),
            },
            {
              url: IDEMPOTENCY_URL,
              title: "Idempotent requests",
              start: IDEMPOTENCY_TEXT.indexOf("(docs"),
            },
            { url: "ftp://mirror.example.com/stripe", start: IDEMPOTENCY_TEXT.indexOf("(docs") },
          ]),
        ),
      );

      const result = found(yield* search({ query: "  Stripe idempotency key expiry  " }));

      assert.equal(result.query, "Stripe idempotency key expiry");
      assert.deepEqual(result.findings, [
        {
          url: IDEMPOTENCY_URL,
          title: "Idempotent requests",
          context: "Stripe keeps idempotency keys for at least 24 hours.",
        },
      ]);
      assert.equal(result.summary, IDEMPOTENCY_TEXT);
      assert.equal(http.requests.length, 1);
      const sent = recordedRequest(http.requests);
      assert.equal(sent.url, RESPONSES_URL);
      assert.equal(sent.authorization, `Bearer ${OPENAI_KEY}`);
    }),
);

it.effect(
  "a search sends the query, the fixed instructions, and nothing of the account or plan",
  () =>
    Effect.gen(function* () {
      const { http, search } = searchWith(() => jsonResponse(responsesAnswer("", [])));

      yield* search({ query: "RFC 9110 status 308 semantics" });

      const body = sentBody(recordedRequest(http.requests));
      assert.deepEqual(Object.keys(body).sort(), [
        "include",
        "input",
        "instructions",
        "max_output_tokens",
        "model",
        "store",
        "tool_choice",
        "tools",
      ]);
      assert.deepEqual(
        { ...body, instructions: undefined },
        {
          model: MODEL_ID,
          instructions: undefined,
          input: "RFC 9110 status 308 semantics",
          tools: [{ type: "web_search" }],
          tool_choice: "required",
          include: ["web_search_call.action.sources"],
          max_output_tokens: PUBLIC_RESEARCH_BOUNDS.MAX_SEARCH_OUTPUT_TOKENS,
          store: false,
        },
      );
    }),
);

it.effect("a search keeps at most the bounded number of distinct sources", () =>
  Effect.gen(function* () {
    const citations = Array.from({ length: 8 }, (_, index) => ({
      url: `https://site${index}.example.com/page`,
      start: 0,
    }));
    const { search } = searchWith(() => jsonResponse(responsesAnswer("Many sources.", citations)));

    const result = found(yield* search({ query: "widely documented fact" }));

    assert.deepEqual(
      result.findings.map((finding) => finding.url),
      citations.slice(0, PUBLIC_RESEARCH_BOUNDS.MAX_FINDINGS).map((citation) => citation.url),
    );
  }),
);

it.effect("an answer that cites no source is no-results, and its words go no further", () =>
  Effect.gen(function* () {
    const unsourced = "Stripe keeps keys for 7 days.";
    const { search } = searchWith(() => jsonResponse(responsesAnswer(unsourced, [])));

    const result = yield* search({ query: "Stripe idempotency key expiry" });

    assert.deepEqual(result, {
      status: SEARCH_WEB_STATUS.NO_RESULTS,
      reason: SEARCH_WEB_REFUSAL.NO_RESULTS,
      query: "Stripe idempotency key expiry",
    });
    assert.ok(!JSON.stringify(result).includes(unsourced));
  }),
);

it.effect("a failed, rate-limited, unreadable, or dropped search is not-searched and says so", () =>
  Effect.gen(function* () {
    const cases: readonly [() => Response, string][] = [
      [
        () => jsonResponse({ error: { message: "boom" } }, HTTP_STATUS.SERVER_ERROR),
        SEARCH_WEB_REFUSAL.FAILED,
      ],
      [
        () => jsonResponse({ error: { message: "slow down" } }, 429),
        SEARCH_WEB_REFUSAL.RATE_LIMITED,
      ],
      [() => jsonResponse({ unexpected: true }), SEARCH_WEB_REFUSAL.FAILED],
      [
        () => {
          throw new Error("fixture: connection reset");
        },
        SEARCH_WEB_REFUSAL.FAILED,
      ],
    ];
    for (const [respond, reason] of cases) {
      const { search } = searchWith(respond);
      assert.deepEqual(yield* search({ query: "Node 24 fetch redirect default" }), {
        status: SEARCH_WEB_STATUS.NOT_SEARCHED,
        reason,
        query: "Node 24 fetch redirect default",
      });
    }
  }),
);

it.effect(
  "a query carrying code, a secret, or another field is refused before anything is sent",
  () =>
    Effect.gen(function* () {
      const refused: readonly WireBoundaryInput[] = [
        { query: "" },
        { query: "x".repeat(PUBLIC_RESEARCH_BOUNDS.MAX_QUERY_CHARS + 1) },
        { query: "why does this fail\nconst token = process.env.SECRET" },
        { query: "is sk-proj-abcdefghijklmnopqrstuvwx valid" },
        { query: "ghp_abcdefghijklmnopqrstuvwxyz0123456789 scopes" },
        { query: "-----BEGIN OPENSSH PRIVATE KEY----- format" },
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

it.effect("a deployment without the key searches nothing", () =>
  Effect.gen(function* () {
    const { http, search } = searchWith(unreached, researchCall({ openAi: undefined }));

    const result = yield* search({ query: "Stripe idempotency key expiry" });

    assert.equal(
      result.status === SEARCH_WEB_STATUS.NOT_SEARCHED && result.reason,
      SEARCH_WEB_REFUSAL.UNAVAILABLE,
    );
    assert.equal(http.requests.length, 0);
  }),
);

it.effect("a turn's searches stop at the bound, and the next turn has its own", () =>
  Effect.gen(function* () {
    const budget = new ResearchBudget();
    const answer = () =>
      jsonResponse(responsesAnswer("Sourced. (x)", [{ url: IDEMPOTENCY_URL, start: 9 }]));
    const first = searchWith(answer, researchCall({ budget }));
    const next = searchWith(answer, researchCall({ budget, turnId: "turn-2" }));

    for (let index = 0; index < PUBLIC_RESEARCH_BOUNDS.SEARCHES_PER_TURN; index += 1) {
      found(yield* first.search({ query: `fact ${index}` }));
    }
    const over = yield* first.search({ query: "one more fact" });

    assert.equal(
      over.status === SEARCH_WEB_STATUS.NOT_SEARCHED && over.reason,
      SEARCH_WEB_REFUSAL.OVER_BUDGET,
    );
    assert.equal(first.http.requests.length, PUBLIC_RESEARCH_BOUNDS.SEARCHES_PER_TURN);
    found(yield* next.search({ query: "a fact in the next turn" }));
  }),
);

it.effect("a page read returns an HTML page's title and words, with scripts and markup gone", () =>
  Effect.gen(function* () {
    const { http, read } = readWith(() =>
      htmlResponse(
        "<html><head><title>Idempotent requests &amp; retries</title><script>steal()</script></head>" +
          "<body><nav>Menu</nav><h1>Idempotent requests</h1><p>Keys expire after&nbsp;24&#32;hours.</p>" +
          "<ul><li>Retry safely</li></ul><style>p{}</style></body></html>",
      ),
    );

    const result = pageText(yield* read({ url: "https://docs.example.com/api/idempotency#keys" }));

    assert.equal(result.url, "https://docs.example.com/api/idempotency");
    assert.equal(result.title, "Idempotent requests & retries");
    assert.equal(
      result.text,
      "Menu\n\nIdempotent requests\n\nKeys expire after 24 hours.\n\n- Retry safely",
    );
    assert.equal(result.truncated, false);
    assert.equal(result.finalUrl, undefined);
    const sent = recordedRequest(http.requests);
    assert.equal(sent.url, "https://docs.example.com/api/idempotency");
    assert.equal(sent.authorization, undefined);
  }),
);

it.effect("a long page is cut at the bound and marked", () =>
  Effect.gen(function* () {
    const long = "word ".repeat(PUBLIC_RESEARCH_BOUNDS.MAX_PAGE_CHARS).trim();
    const { read } = readWith(
      () => new Response(long, { headers: { "content-type": "text/plain" } }),
    );

    const result = pageText(yield* read({ url: "https://docs.example.com/big.txt" }));

    assert.equal(result.truncated, true);
    assert.equal(result.characters, long.length);
    assert.equal(result.text, long.slice(0, PUBLIC_RESEARCH_BOUNDS.MAX_PAGE_CHARS));
  }),
);

it.effect("no more than the byte bound of a page is read off the wire", () =>
  Effect.gen(function* () {
    const chunk = new TextEncoder().encode("a".repeat(64 * 1024));
    let pulled = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += chunk.length;
        controller.enqueue(chunk);
      },
    });
    const { read } = readWith(
      () => new Response(endless, { headers: { "content-type": "text/plain" } }),
    );

    const result = pageText(yield* read({ url: "https://docs.example.com/stream" }));

    assert.equal(result.characters, PUBLIC_RESEARCH_BOUNDS.MAX_PAGE_BYTES);
    assert.ok(pulled < PUBLIC_RESEARCH_BOUNDS.MAX_PAGE_BYTES + 4 * chunk.length);
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

it.effect("a host that does not resolve is refused before anything is sent", () =>
  Effect.gen(function* () {
    const { http, read } = readWith(unreached);

    const result = yield* read({ url: "https://nowhere.example.com/" });

    assert.equal(
      result.status === READ_WEB_PAGE_STATUS.NOT_READ && result.reason,
      READ_WEB_PAGE_REFUSAL.UNRESOLVED,
    );
    assert.equal(http.requests.length, 0);
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

it.effect("a redirect to a public page is followed and names where the text came from", () =>
  Effect.gen(function* () {
    const { read } = readWith((request) =>
      request.url === "https://docs.example.com/old"
        ? redirectTo("https://moved.example.com/new")
        : htmlResponse("<title>New</title><p>Moved here.</p>"),
    );

    const result = pageText(yield* read({ url: "https://docs.example.com/old" }));

    assert.equal(result.url, "https://docs.example.com/old");
    assert.equal(result.finalUrl, "https://moved.example.com/new");
    assert.equal(result.text, "Moved here.");
  }),
);

it.effect(
  "a redirect loop, a redirect off https, and a refused or missing page each say nothing was read",
  () =>
    Effect.gen(function* () {
      const cases: readonly [(request: RecordedRequest) => Response, string][] = [
        [() => redirectTo("/again"), READ_WEB_PAGE_REFUSAL.TOO_MANY_REDIRECTS],
        [() => redirectTo("http://docs.example.com/plain"), READ_WEB_PAGE_REFUSAL.BAD_REDIRECT],
        [() => htmlResponse("gone", 404), READ_WEB_PAGE_REFUSAL.NOT_FOUND],
        [() => htmlResponse("sign in", 401), READ_WEB_PAGE_REFUSAL.ACCESS_DENIED],
        [() => htmlResponse("slow down", 429), READ_WEB_PAGE_REFUSAL.RATE_LIMITED],
        [() => htmlResponse("oops", HTTP_STATUS.SERVER_ERROR), READ_WEB_PAGE_REFUSAL.FAILED],
        [
          () => new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } }),
          READ_WEB_PAGE_REFUSAL.UNSUPPORTED,
        ],
        [
          () => {
            throw new Error("fixture: connection reset");
          },
          READ_WEB_PAGE_REFUSAL.FAILED,
        ],
      ];
      for (const [respond, reason] of cases) {
        const { read } = readWith(respond);
        assert.deepEqual(yield* read({ url: "https://docs.example.com/page" }), {
          status: READ_WEB_PAGE_STATUS.NOT_READ,
          reason,
          url: "https://docs.example.com/page",
        });
      }
    }),
);

it.effect("a URL that is not plain public https is refused before anything is sent", () =>
  Effect.gen(function* () {
    const refused: readonly WireBoundaryInput[] = [
      { url: "http://docs.example.com/" },
      { url: "https://user:pass@docs.example.com/" },
      { url: "https://docs.example.com:8443/" },
      { url: "file:///etc/passwd" },
      { url: "not a url" },
      { url: `https://docs.example.com/${"a".repeat(PUBLIC_RESEARCH_BOUNDS.MAX_URL_CHARS)}` },
      { url: "https://docs.example.com/", headers: { cookie: "x" } },
    ];
    const { http, read } = readWith(unreached);

    for (const input of refused) {
      const result = yield* read(input);
      assert.equal(
        result.status === READ_WEB_PAGE_STATUS.NOT_READ && result.reason,
        READ_WEB_PAGE_REFUSAL.UNREADABLE,
        JSON.stringify(input),
      );
    }
    assert.equal(http.requests.length, 0);
  }),
);

it.effect("a turn's page reads stop at the bound", () =>
  Effect.gen(function* () {
    const { http, read } = readWith(() => htmlResponse("<p>ok</p>"));

    for (let index = 0; index < PUBLIC_RESEARCH_BOUNDS.PAGE_READS_PER_TURN; index += 1) {
      pageText(yield* read({ url: `https://docs.example.com/${index}` }));
    }
    const over = yield* read({ url: "https://docs.example.com/more" });

    assert.equal(
      over.status === READ_WEB_PAGE_STATUS.NOT_READ && over.reason,
      READ_WEB_PAGE_REFUSAL.OVER_BUDGET,
    );
    assert.equal(http.requests.length, PUBLIC_RESEARCH_BOUNDS.PAGE_READS_PER_TURN);
  }),
);
