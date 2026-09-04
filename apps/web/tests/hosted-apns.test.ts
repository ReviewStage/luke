import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { PUSH_ENVIRONMENT } from "@sidecar/hosted";
import type { UnparsedWireValue } from "../server/core";
import {
  APNS_DELIVERY,
  APNS_ENVIRONMENT,
  APNS_HOST,
  APNS_INTERRUPTION_LEVEL,
  APNS_PROVIDER_TOKEN_LIFETIME_MS,
  type ApnsCredentials,
  type ApnsNotification,
  ApnsSender,
  type ApnsTransport,
  type ApnsTransportAnswer,
  type ApnsTransportRequest,
  apnsCredentialsFromEnvironment,
  apnsProviderToken,
  apnsWireBody,
} from "../server/hosted/apns";

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const PRIVATE_KEY_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const CREDENTIALS: ApnsCredentials = {
  teamId: "TEAM123456",
  keyId: "KEY1234567",
  privateKey: PRIVATE_KEY_PEM,
  bundleId: "dev.tryluke.ios",
};

const NOW = 1_800_000_000_000;
const TOKEN = "0a".repeat(32);

function notification(overrides: Partial<ApnsNotification> = {}): ApnsNotification {
  return {
    token: TOKEN,
    environment: PUSH_ENVIRONMENT.PRODUCTION,
    payload: {
      aps: {
        alert: { title: "Fix flaky test", body: "Needs your answer" },
        sound: "default",
        "interruption-level": APNS_INTERRUPTION_LEVEL.TIME_SENSITIVE,
        "thread-id": "conductor:abc",
      },
      custom: { providerId: "conductor", sessionId: "abc" },
    },
    collapseId: "conductor:abc",
    ...overrides,
  };
}

function scripted(answers: ApnsTransportAnswer[]): () => ApnsTransportAnswer {
  return () => {
    const answer = answers.shift();
    if (!answer) throw new Error("no answer scripted");
    return answer;
  };
}

function fakeTransport(answer: (request: ApnsTransportRequest) => ApnsTransportAnswer) {
  const sent: ApnsTransportRequest[] = [];
  let closed = 0;
  const transport: ApnsTransport = {
    async send(request) {
      sent.push(request);
      return answer(request);
    },
    async close() {
      closed += 1;
    },
  };
  return { transport, sent, closed: () => closed };
}

function decodeSegment(segment: string): UnparsedWireValue {
  // SAFETY: a JWT segment is JSON the test itself asserts against with deepEqual.
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as UnparsedWireValue;
}

/**
 * ECDSA signs with a fresh random nonce, so two tokens over the same claims
 * never match byte for byte; what a test can hold a token to is that Apple's
 * side of the key accepts it.
 */
function verifiesUnderPublicKey(token: string): boolean {
  const [header, claims, signature] = token.split(".");
  if (!header || !claims || !signature) return false;
  return createVerify("SHA256")
    .update(`${header}.${claims}`)
    .verify({ key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64url"));
}

test("the credential reads from the environment whole or not at all", () => {
  const environment = {
    [APNS_ENVIRONMENT.TEAM_ID]: " TEAM123456 ",
    [APNS_ENVIRONMENT.KEY_ID]: "KEY1234567",
    [APNS_ENVIRONMENT.PRIVATE_KEY]: "-----BEGIN PRIVATE KEY-----\\nabc\\n-----END PRIVATE KEY-----",
    [APNS_ENVIRONMENT.BUNDLE_ID]: "dev.tryluke.ios",
  };
  assert.deepEqual(apnsCredentialsFromEnvironment(environment), {
    teamId: "TEAM123456",
    keyId: "KEY1234567",
    privateKey: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
    bundleId: "dev.tryluke.ios",
  });

  for (const name of Object.values(APNS_ENVIRONMENT)) {
    assert.equal(apnsCredentialsFromEnvironment({ ...environment, [name]: "  " }), undefined);
    assert.equal(apnsCredentialsFromEnvironment({ ...environment, [name]: undefined }), undefined);
  }
});

test("the provider token is an ES256 JWT Apple can verify against the key", () => {
  const token = apnsProviderToken(CREDENTIALS, NOW);
  const [header, claims, signature] = token.split(".");
  assert.ok(header && claims && signature);

  assert.deepEqual(decodeSegment(header), { alg: "ES256", kid: "KEY1234567" });
  assert.deepEqual(decodeSegment(claims), { iss: "TEAM123456", iat: Math.floor(NOW / 1000) });

  assert.equal(verifiesUnderPublicKey(token), true);
});

test("a send carries the payload untouched and the headers Apple routes by", async () => {
  const { transport, sent } = fakeTransport(scripted([{ status: 200, body: "" }]));
  const sender = new ApnsSender({ credentials: CREDENTIALS, transport, now: () => NOW });

  const delivery = await sender.send(notification());

  assert.equal(delivery, APNS_DELIVERY.DELIVERED);
  assert.equal(sent.length, 1);
  const request = sent[0];
  assert.ok(request);
  assert.equal(request.host, APNS_HOST[PUSH_ENVIRONMENT.PRODUCTION]);
  assert.equal(request.path, `/3/device/${TOKEN}`);
  const authorization = request.headers.authorization ?? "";
  assert.equal(authorization.startsWith("bearer "), true);
  const token = authorization.slice("bearer ".length);
  const [header, claims] = token.split(".");
  assert.ok(header && claims);
  assert.deepEqual(decodeSegment(header), { alg: "ES256", kid: "KEY1234567" });
  assert.deepEqual(decodeSegment(claims), { iss: "TEAM123456", iat: Math.floor(NOW / 1000) });
  assert.equal(verifiesUnderPublicKey(token), true);
  assert.equal(request.headers["apns-topic"], "dev.tryluke.ios");
  assert.equal(request.headers["apns-push-type"], "alert");
  assert.equal(request.headers["apns-priority"], "10");
  assert.equal(request.headers["apns-collapse-id"], "conductor:abc");
  assert.equal(request.body, apnsWireBody(notification().payload));
  assert.deepEqual(JSON.parse(request.body), {
    providerId: "conductor",
    sessionId: "abc",
    aps: notification().payload.aps,
  });
});

test("a sandbox token goes to the sandbox gateway, without a collapse id when none is given", async () => {
  const { transport, sent } = fakeTransport(scripted([{ status: 200, body: "" }]));
  const sender = new ApnsSender({ credentials: CREDENTIALS, transport, now: () => NOW });

  await sender.send(notification({ environment: PUSH_ENVIRONMENT.SANDBOX, collapseId: undefined }));

  assert.equal(sent[0]?.host, APNS_HOST[PUSH_ENVIRONMENT.SANDBOX]);
  assert.equal("apns-collapse-id" in (sent[0]?.headers ?? {}), false);
});

test("Apple's answers map to the four deliveries", async () => {
  const cases: Array<[ApnsTransportAnswer, string]> = [
    [{ status: 200, body: "" }, APNS_DELIVERY.DELIVERED],
    [{ status: 410, body: '{"reason":"Unregistered"}' }, APNS_DELIVERY.TOKEN_GONE],
    [{ status: 400, body: '{"reason":"BadDeviceToken"}' }, APNS_DELIVERY.TOKEN_GONE],
    [{ status: 400, body: '{"reason":"DeviceTokenNotForTopic"}' }, APNS_DELIVERY.TOKEN_GONE],
    [{ status: 400, body: '{"reason":"BadCollapseId"}' }, APNS_DELIVERY.REFUSED],
    [{ status: 403, body: '{"reason":"InvalidProviderToken"}' }, APNS_DELIVERY.REFUSED],
    [{ status: 429, body: '{"reason":"TooManyRequests"}' }, APNS_DELIVERY.FAILED],
    [{ status: 503, body: "" }, APNS_DELIVERY.FAILED],
    [{ status: 500, body: "not json" }, APNS_DELIVERY.FAILED],
  ];
  for (const [answer, expected] of cases) {
    const { transport } = fakeTransport(scripted([answer]));
    const sender = new ApnsSender({ credentials: CREDENTIALS, transport, now: () => NOW });
    assert.equal(await sender.send(notification()), expected, JSON.stringify(answer));
  }
});

test("a transport failure is a failed delivery, never a throw", async () => {
  const transport: ApnsTransport = {
    async send() {
      throw new Error("connection reset");
    },
    async close() {},
  };
  const sender = new ApnsSender({ credentials: CREDENTIALS, transport, now: () => NOW });
  assert.equal(await sender.send(notification()), APNS_DELIVERY.FAILED);
});

test("the provider token is reused inside its lifetime and re-signed after it", async () => {
  let now = NOW;
  const { transport, sent } = fakeTransport(() => ({ status: 200, body: "" }));
  const sender = new ApnsSender({ credentials: CREDENTIALS, transport, now: () => now });

  await sender.send(notification());
  now += APNS_PROVIDER_TOKEN_LIFETIME_MS - 1;
  await sender.send(notification());
  now += 1;
  await sender.send(notification());

  const tokens = sent.map((request) => request.headers.authorization);
  assert.equal(tokens[0], tokens[1]);
  assert.notEqual(tokens[1], tokens[2]);
});

test("closing the sender closes its transport", async () => {
  const { transport, closed } = fakeTransport(scripted([]));
  const sender = new ApnsSender({ credentials: CREDENTIALS, transport });
  await sender.close();
  assert.equal(closed(), 1);
});
