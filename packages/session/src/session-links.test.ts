import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeSession,
  ReportedSessionLinks,
  SESSION_STATUS,
  type Session,
  type SessionProvider,
} from "@sidecar/session";

const conductor: SessionProvider = { id: "conductor", displayName: "Conductor" };
const cursor: SessionProvider = { id: "cursor", displayName: "Cursor" };

function session(provider: SessionProvider, providerSessionId: string, link?: string): Session {
  return normalizeSession(provider, {
    providerSessionId,
    title: `Session ${providerSessionId}`,
    status: SESSION_STATUS.WORKING,
    observedAt: 100,
    detail: link ? { link } : {},
  });
}

test("remembers the last address a session reported, outliving the roster row", () => {
  const links = new ReportedSessionLinks();
  links.remember([session(conductor, "chat-1", "conductor://workspace?id=w1&session=chat-1")]);

  // The pass that no longer lists the session — archived away — erases nothing.
  links.remember([session(conductor, "chat-2")]);

  assert.equal(
    links.lastReported({ providerId: conductor.id, providerSessionId: "chat-1" }),
    "conductor://workspace?id=w1&session=chat-1",
  );
});

test("the latest reported address wins", () => {
  const links = new ReportedSessionLinks();
  links.remember([session(conductor, "chat-1", "conductor://workspace?id=w1&session=chat-1")]);
  links.remember([session(conductor, "chat-1", "conductor://workspace?id=w2&session=chat-1")]);

  assert.equal(
    links.lastReported({ providerId: conductor.id, providerSessionId: "chat-1" }),
    "conductor://workspace?id=w2&session=chat-1",
  );
});

test("a pass reporting the session with no address keeps the last one", () => {
  const links = new ReportedSessionLinks();
  links.remember([session(conductor, "chat-1", "conductor://workspace?id=w1&session=chat-1")]);
  links.remember([session(conductor, "chat-1")]);

  assert.equal(
    links.lastReported({ providerId: conductor.id, providerSessionId: "chat-1" }),
    "conductor://workspace?id=w1&session=chat-1",
  );
});

test("an identity answers only under its own provider, and never unreported", () => {
  const links = new ReportedSessionLinks();
  links.remember([
    session(conductor, "chat-1", "conductor://workspace?id=w1&session=chat-1"),
    session(cursor, "chat-1"),
  ]);

  assert.equal(
    links.lastReported({ providerId: cursor.id, providerSessionId: "chat-1" }),
    undefined,
  );
  assert.equal(
    links.lastReported({ providerId: conductor.id, providerSessionId: "chat-9" }),
    undefined,
  );
});
