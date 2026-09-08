import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { GATEWAY_PROTOCOL_VERSION } from "@sidecar/runtime-contracts";
import {
  GATEWAY_PROCESS_ARGUMENT,
  gatewayBuildIdentity,
  gatewayDiscoveryPath,
  gatewayLockPath,
  gatewayProcessArguments,
  gatewayProfilePath,
  gatewayStateRootArgument,
  isGatewayProcess,
} from "./process-mode";

test("the Gateway mode is one argument, and the state root travels beside it", () => {
  const argv = ["electron", ".", ...gatewayProcessArguments("/state/Luke Dev")];
  assert.equal(isGatewayProcess(argv), true);
  assert.equal(gatewayStateRootArgument(argv), "/state/Luke Dev");
  assert.equal(isGatewayProcess(["electron", "."]), false);
  assert.equal(gatewayStateRootArgument(["electron", "."]), undefined);
  assert.equal(
    gatewayStateRootArgument([GATEWAY_PROCESS_ARGUMENT, "--state-root", "/root"]),
    "/root",
  );
});

test("the Gateway's profile and state files sit under the state root, apart from each other", () => {
  const root = "/state/Luke";
  assert.equal(gatewayProfilePath(root), path.join(root, "gateway-profile"));
  assert.equal(gatewayDiscoveryPath(root), path.join(root, "gateway", "discovery.json"));
  assert.equal(gatewayLockPath(root), path.join(root, "gateway", "instance.lock"));
});

test("a packaged build is its name and version; a development run carries its bundle stamp", () => {
  assert.deepEqual(
    gatewayBuildIdentity({
      appName: "Luke",
      version: "0.5.0",
      packaged: true,
      developmentStamp: "x",
    }),
    { protocolVersion: GATEWAY_PROTOCOL_VERSION, buildVersion: "Luke@0.5.0" },
  );
  assert.deepEqual(
    gatewayBuildIdentity({
      appName: "Luke Dev",
      version: "0.5.0",
      packaged: false,
      developmentStamp: "1700000000",
    }),
    { protocolVersion: GATEWAY_PROTOCOL_VERSION, buildVersion: "Luke Dev@0.5.0+dev.1700000000" },
  );
});
