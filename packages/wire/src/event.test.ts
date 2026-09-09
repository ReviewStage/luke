import assert from "node:assert/strict";
import test from "node:test";
import { Emitter } from "./event.js";
import { DisposableStore, type IDisposable } from "./lifecycle.js";

test("every listener standing when a round opens hears the value", () => {
  const emitter = new Emitter<number>();
  const heard: string[] = [];
  emitter.event((value) => heard.push(`first:${value}`));
  emitter.event((value) => heard.push(`second:${value}`));

  emitter.fire(7);

  assert.deepEqual(heard, ["first:7", "second:7"]);
});

test("the event is the same function however often it is read", () => {
  const emitter = new Emitter<void>();

  assert.equal(emitter.event, emitter.event);
});

test("a listener subscribing from inside a round hears the next value, not that one", () => {
  const emitter = new Emitter<number>();
  const heard: string[] = [];
  emitter.event((value) => {
    heard.push(`opener:${value}`);
    if (value === 1) emitter.event((later) => heard.push(`joiner:${later}`));
  });

  emitter.fire(1);
  emitter.fire(2);

  assert.deepEqual(heard, ["opener:1", "opener:2", "joiner:2"]);
});

test("a listener unsubscribed by an earlier one in the same round is not called", () => {
  const emitter = new Emitter<number>();
  const heard: string[] = [];
  let second: IDisposable | undefined;
  emitter.event(() => {
    heard.push("first");
    second?.dispose();
  });
  second = emitter.event(() => heard.push("second"));
  emitter.event(() => heard.push("third"));

  emitter.fire(1);

  assert.deepEqual(heard, ["first", "third"]);
});

test("a listener unsubscribing itself mid-round hears nothing further", () => {
  const emitter = new Emitter<number>();
  const heard: number[] = [];
  const subscription = emitter.event((value) => {
    heard.push(value);
    subscription.dispose();
  });

  emitter.fire(1);
  emitter.fire(2);

  assert.deepEqual(heard, [1]);
});

test("the same function subscribed twice is two subscriptions, ended separately", () => {
  const emitter = new Emitter<number>();
  const heard: number[] = [];
  const listener = (value: number) => heard.push(value);
  const first = emitter.event(listener);
  emitter.event(listener);

  emitter.fire(1);
  first.dispose();
  emitter.fire(2);

  assert.deepEqual(heard, [1, 1, 2]);
});

test("unsubscribing twice ends only that one subscription", () => {
  const emitter = new Emitter<number>();
  const heard: string[] = [];
  const first = emitter.event(() => heard.push("first"));
  emitter.event(() => heard.push("second"));

  first.dispose();
  first.dispose();
  emitter.fire(1);

  assert.deepEqual(heard, ["second"]);
});

test("a throwing listener stops none of the rest, and the failures are reported together", () => {
  const emitter = new Emitter<number>();
  const heard: string[] = [];
  const failure = new Error("the first listener");
  emitter.event(() => {
    heard.push("first");
    throw failure;
  });
  emitter.event(() => heard.push("second"));

  assert.throws(() => emitter.fire(1), {
    name: "AggregateError",
    message: "1 of 2 listeners failed",
    errors: [failure],
  });

  assert.deepEqual(heard, ["first", "second"]);
});

test("a disposed emitter drops its listeners and fires nothing", () => {
  const emitter = new Emitter<number>();
  const heard: number[] = [];
  emitter.event((value) => heard.push(value));

  emitter.dispose();
  emitter.dispose();
  emitter.fire(1);

  assert.deepEqual(heard, []);
});

test("subscribing to a disposed emitter answers an unsubscribe that is safe to dispose", () => {
  const emitter = new Emitter<number>();
  emitter.dispose();

  const subscription = emitter.event(() => assert.fail("a disposed emitter fires nothing"));
  subscription.dispose();

  emitter.fire(1);
});

test("a store ends the subscriptions it holds", () => {
  const emitter = new Emitter<number>();
  const store = new DisposableStore();
  const heard: number[] = [];
  store.add(emitter.event((value) => heard.push(value)));

  emitter.fire(1);
  store.dispose();
  emitter.fire(2);

  assert.deepEqual(heard, [1]);
});
