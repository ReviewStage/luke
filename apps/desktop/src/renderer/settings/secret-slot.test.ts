import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type SecretEntry, SecretSlot } from "./secret-slot";

function render(entry: SecretEntry, live = true): string {
  return renderToStaticMarkup(
    createElement(SecretSlot, {
      label: "API key",
      mark: null,
      ariaLabel: "Acme API key",
      entry,
      live,
      placeholder: "Paste it here",
      hint: { lead: "Acme issues one from", destination: "its keys page" },
      verb: "Save",
      running: "Saving…",
      onChange: () => undefined,
      onCommit: () => undefined,
      onCancel: () => undefined,
      onFetch: () => undefined,
    }),
  );
}

test("the field says what to paste, whose it is, and where to get one", () => {
  const markup = render({ draft: "", busy: false });
  assert.match(markup, /key-slot-label[^>]*>API key/);
  assert.match(markup, /aria-label="Acme API key"/);
  assert.match(markup, /type="password"/);
  assert.match(markup, /Paste it here/);
  assert.match(markup, /its keys page/);
  assert.match(markup, /key-slot-foot/);
});

test("the confirm is quiet until the secret lands, and pressable only then", () => {
  const empty = render({ draft: "", busy: false });
  assert.match(empty, /key-slot-confirm" data-ready="false" disabled=""/);
  // Whitespace is not a secret, so the field holding some is still not filled.
  const blank = render({ draft: "   ", busy: false });
  assert.match(blank, /key-slot-confirm" data-ready="false" disabled=""/);
  const filled = render({ draft: "sk-1", busy: false });
  assert.match(filled, /key-slot-confirm" data-ready="true"/);
  assert.doesNotMatch(filled, /key-slot-confirm" data-ready="true" disabled/);
});

test("a secret being sent says so and stays up to size", () => {
  const markup = render({ draft: "sk-1", busy: true });
  assert.match(markup, /Saving…/);
  assert.match(markup, /key-slot-confirm" data-ready="true" disabled=""/);
});

test("a slot the entry has left behind keeps drawing it and takes no more", () => {
  // The exit's own state: what is on screen is what it last held, and there is
  // nothing behind it to send any more.
  const markup = render({ draft: "sk-1", busy: false }, false);
  assert.match(markup, /value="sk-1"/);
  assert.match(markup, /key-slot-confirm" data-ready="true" disabled=""/);
});

test("a refusal is drawn under the field that was refused", () => {
  const markup = render({ draft: "sk-1", busy: false, rejection: "Acme refused that key." });
  assert.match(markup, /role="alert"/);
  assert.match(markup, /Acme refused that key\./);
});
