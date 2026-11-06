import assert from "node:assert/strict";
import { it } from "vitest";
import { type ListedMachine, machineName, type ThisMac } from "./machine-name.js";

const HERE = "a".repeat(64);

const STUDIO: ListedMachine = {
  deviceId: "7a1c9e3b-2f4d-4c6a-8b0e-5d7f9a1c3e52",
  name: "Studio",
  machineId: HERE,
  model: "Mac Studio (M2 Max, 2023)",
};

const OTHER_STUDIO: ListedMachine = {
  deviceId: "3f6b0c2e-8d1a-4b5e-9c7d-2a4e6f8b0d14",
  name: "Studio",
  machineId: "b".repeat(64),
  model: "Mac mini (M2, 2023)",
};

const RECORDED = "2d4f6a8c-0e1b-4c3d-9e5f-7a9b1c3d5e60";

const UNREPORTED: ListedMachine = { deviceId: RECORDED, name: "Air" };

it.each<{ case: string; machine: ListedMachine; thisMac: ThisMac; named: string }>([
  {
    case: "this Mac, by its machine id",
    machine: STUDIO,
    thisMac: { machineId: HERE },
    named: "This Mac",
  },
  {
    case: "this Mac, by its host's record, where the host reported no machine",
    machine: UNREPORTED,
    thisMac: { machineId: HERE, deviceId: RECORDED },
    named: "This Mac",
  },
  {
    case: "a Mac of This Mac's name, which needs no model",
    machine: OTHER_STUDIO,
    thisMac: { machineId: HERE },
    named: "Studio",
  },
  {
    case: "two Macs of one name in a browser tab, told apart by their models",
    machine: OTHER_STUDIO,
    thisMac: undefined,
    named: "Studio · Mac mini (M2, 2023)",
  },
])("names $case", ({ machine, thisMac, named }) => {
  assert.equal(machineName(machine, [STUDIO, OTHER_STUDIO, UNREPORTED], thisMac), named);
});
