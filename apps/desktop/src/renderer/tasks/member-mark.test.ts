// @vitest-environment jsdom

import assert from "node:assert/strict";
import { MEMBER_KIND, type MemberKind } from "@luke/features/chat-wire";
import { MemberMark } from "@luke/panel/tasks/chat-pane";
import type { ChatWho } from "@luke/ui/chat-model";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";

/**
 * member-mark.test.ts -- the mark a member's lines lead with: a person by
 * their letter, Luke by his face and an agent by its harness, neither by a
 * letter, at either size a line draws it.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

/** Someone in a channel, of `kind`, named `name`. */
function who(kind: MemberKind, name: string): ChatWho {
  return {
    member: {
      id: "00000000-0000-4000-8000-000000000001",
      kind,
      handle: name.toLowerCase(),
      left: false,
    },
    name,
    handle: name.toLowerCase(),
    agent: undefined,
    taskName: undefined,
  };
}

function drawn(member: ChatWho, small: boolean): HTMLElement {
  const container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => root?.render(createElement(MemberMark, { who: member, small })));
  return container;
}

for (const small of [false, true]) {
  test(`a person leads with their letter, Luke and an agent with a glyph and no letter${small ? ", small" : ""}`, () => {
    assert.equal(drawn(who(MEMBER_KIND.HUMAN, "ada"), small).textContent, "A");
    act(() => root?.unmount());

    const luke = drawn(who(MEMBER_KIND.LUKE, "Luke"), small);
    assert.equal(luke.textContent, "", "Luke's mark holds no letter");
    assert.ok(luke.querySelector("svg"), "Luke's mark is his face");
    act(() => root?.unmount());

    const agent = drawn(who(MEMBER_KIND.AGENT, "Builder"), small);
    assert.equal(agent.textContent, "", "an agent's mark holds no letter");
    assert.ok(agent.querySelector("svg"), "an agent's mark is its harness");
  });
}
