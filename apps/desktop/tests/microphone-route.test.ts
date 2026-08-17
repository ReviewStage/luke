import assert from "node:assert/strict";
import test from "node:test";
import {
  MICROPHONE_ROUTE_PROBE,
  type MicrophoneRouteProcess,
  MicrophoneRouteWatcher,
  parseMicrophoneRouteLine,
} from "../src/microphone-route";
import { LID_STATE, MICROPHONE_TRANSPORT, type MicrophoneRoute } from "../src/shared/contracts";

test("a route line parses into its three facts", () => {
  assert.deepEqual(
    parseMicrophoneRouteLine("input transport=bluetooth lid=open builtin=MacBook Pro Microphone"),
    {
      defaultTransport: MICROPHONE_TRANSPORT.BLUETOOTH,
      lid: LID_STATE.OPEN,
      builtInName: "MacBook Pro Microphone",
    },
  );
});

test("the built-in name is the line's tail, whatever it contains", () => {
  const route = parseMicrophoneRouteLine(
    "input transport=built-in lid=shut builtin=Microphone (Built-in) = odd name",
  );
  assert.equal(route?.builtInName, "Microphone (Built-in) = odd name");
});

test("a machine with no built-in microphone reports none", () => {
  assert.deepEqual(parseMicrophoneRouteLine("input transport=other lid=unknown"), {
    defaultTransport: MICROPHONE_TRANSPORT.OTHER,
    lid: LID_STATE.UNKNOWN,
  });
});

test("a line outside the vocabulary is dropped rather than guessed at", () => {
  assert.equal(parseMicrophoneRouteLine("input transport=telepathy lid=open"), undefined);
  assert.equal(parseMicrophoneRouteLine("input transport=bluetooth lid=ajar"), undefined);
  assert.equal(parseMicrophoneRouteLine("output muted=0 volume=1.00"), undefined);
  assert.equal(parseMicrophoneRouteLine(""), undefined);
});

interface Harness {
  watcher: MicrophoneRouteWatcher;
  routes: MicrophoneRoute[];
  unavailable: () => number;
  written: string[];
  emit: (chunk: string) => void;
  die: () => void;
}

function harness(): Harness {
  const routes: MicrophoneRoute[] = [];
  const written: string[] = [];
  let unavailable = 0;
  let listener: ((chunk: string) => void) | undefined;
  const exits: (() => void)[] = [];

  const child: MicrophoneRouteProcess = {
    stdin: {
      write: (chunk) => {
        written.push(chunk);
      },
    },
    stdout: {
      setEncoding: () => undefined,
      on: (_event, dataListener) => {
        listener = dataListener;
      },
    },
    on: (event, exitListener) => {
      if (event === "exit") exits.push(exitListener);
    },
    removeAllListeners: () => {
      exits.length = 0;
    },
    kill: () => undefined,
  };

  const watcher = new MicrophoneRouteWatcher({
    spawnHelper: () => child,
    onRoute: (route) => {
      routes.push(route);
    },
    onUnavailable: () => {
      unavailable += 1;
    },
  });

  return {
    watcher,
    routes,
    unavailable: () => unavailable,
    written,
    emit: (chunk) => listener?.(chunk),
    die: () => {
      for (const exit of [...exits]) exit();
    },
  };
}

test("routes arrive as lines, split however the pipe delivered them", () => {
  const context = harness();
  assert.equal(context.watcher.start(), true);

  context.emit("input transport=bluetooth ");
  context.emit("lid=open builtin=MacBook Pro Microphone\ninput transport=built-in lid=open\n");

  assert.equal(context.routes.length, 2);
  assert.equal(context.routes[0]?.builtInName, "MacBook Pro Microphone");
  assert.equal(context.routes[1]?.defaultTransport, MICROPHONE_TRANSPORT.BUILT_IN);
});

test("a probe is one word to the helper", () => {
  const context = harness();
  context.watcher.start();

  context.watcher.probe();

  assert.deepEqual(context.written, [`${MICROPHONE_ROUTE_PROBE}\n`]);
});

test("a helper that dies withdraws the route rather than freezing it", () => {
  const context = harness();
  context.watcher.start();
  context.emit("input transport=bluetooth lid=open\n");

  context.die();

  assert.equal(context.unavailable(), 1);
  // A probe after the death asks nobody and says nothing.
  context.watcher.probe();
  assert.deepEqual(context.written, []);
});

test("a watcher that cannot spawn says so once", () => {
  let unavailable = 0;
  const watcher = new MicrophoneRouteWatcher({
    spawnHelper: () => undefined,
    onRoute: () => undefined,
    onUnavailable: () => {
      unavailable += 1;
    },
  });

  assert.equal(watcher.start(), false);
  assert.equal(unavailable, 1);
});
