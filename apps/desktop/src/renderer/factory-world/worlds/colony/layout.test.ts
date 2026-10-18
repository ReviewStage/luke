import assert from "node:assert/strict";
import { factoryWorldViewOf } from "@luke/ui/factory-world";
import { factoryWorldOf, factoryZoneOf } from "@luke/ui/testing";
import { test } from "vitest";
import { burrowsOf } from "./layout";

/**
 * layout.test.ts -- the burrows' tunnels as a dependency graph: however the reduction drops a dependency reached another way, every zone still reaches everything it depends on through the tunnels left.
 */

/** Whether `to` can be reached from `from` along the tunnels, each walked from its dependent to its dependency. */
function reachable(
  tunnels: readonly { from: string; to: string }[],
  from: string,
  to: string,
): boolean {
  const seen = new Set([from]);
  const queue = [from];
  for (let at = queue.shift(); at !== undefined; at = queue.shift()) {
    if (at === to) return true;
    for (const tunnel of tunnels) {
      if (tunnel.from === at && !seen.has(tunnel.to)) {
        seen.add(tunnel.to);
        queue.push(tunnel.to);
      }
    }
  }
  return false;
}

test("a dependency cycle keeps every zone reaching what it depends on, and a dependency reached through another is not bored twice", () => {
  const zones = [
    factoryZoneOf("packages/a", ["packages/b", "packages/c"]),
    factoryZoneOf("packages/b", ["packages/c"]),
    factoryZoneOf("packages/c", ["packages/a"]),
    factoryZoneOf("packages/d", ["packages/e", "packages/a"]),
    factoryZoneOf("packages/e", ["packages/a"]),
    factoryZoneOf("apps/web", ["packages/d"]),
  ];
  const view = factoryWorldViewOf(factoryWorldOf({ zones }));
  const tunnels = burrowsOf(view).tunnels.map((tunnel) => ({
    from: tunnel.from.zone.path,
    to: tunnel.to.zone.path,
  }));
  for (const zone of zones) {
    for (const dependency of zone.dependsOn) {
      assert.ok(reachable(tunnels, zone.path, dependency), `${zone.path} reaches ${dependency}`);
    }
  }
  assert.ok(
    !tunnels.some((tunnel) => tunnel.from === "packages/d" && tunnel.to === "packages/a"),
    "d reaches a through e",
  );
});
