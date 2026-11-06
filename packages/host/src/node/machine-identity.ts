import childProcess from "node:child_process";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import { DEVICE_MODEL_MAX_CHARS, type DeviceMachine } from "@repo/features/device-agent-wire";

const APP_KEY = Buffer.from("03efad7e1cf04d1592434cb89b617d34", "hex");

const READ_TIMEOUT_MS = 2_000;

const MAC_UUID =
  /"IOPlatformUUID" = "([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})"/u;

const MAC_PRODUCT_NAME = /"product-name" = <"([^"]+)">/u;

const LINUX_MACHINE_ID = /^[0-9a-f]{32}$/u;

const LINUX_MACHINE_ID_FILES = ["/etc/machine-id", "/var/lib/dbus/machine-id"] as const;

function printed(command: string, args: readonly string[]): string {
  try {
    return childProcess
      .execFileSync(command, [...args], {
        encoding: "utf8",
        timeout: READ_TIMEOUT_MS,
        stdio: ["ignore", "pipe", "ignore"],
      })
      .trim();
  } catch {
    return "";
  }
}

function held(file: string): string {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

function keyed(raw: string): string {
  return createHmac("sha256", APP_KEY).update(raw.toLowerCase()).digest("hex");
}

function machineOf(raw: string | undefined, model: string): DeviceMachine {
  return {
    ...(raw === undefined ? undefined : { machineId: keyed(raw) }),
    ...(model.length === 0 ? undefined : { model: model.slice(0, DEVICE_MODEL_MAX_CHARS) }),
  };
}

export function macMachine(): DeviceMachine {
  const platform = printed("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"]);
  const productName = MAC_PRODUCT_NAME.exec(platform)?.[1]?.replaceAll("\0", "").trim() ?? "";
  const model =
    productName.length > 0 ? productName : printed("/usr/sbin/sysctl", ["-n", "hw.model"]);
  return machineOf(MAC_UUID.exec(platform)?.[1], model);
}

export function linuxMachine(): DeviceMachine {
  const raw = LINUX_MACHINE_ID_FILES.map(held).find((id) => LINUX_MACHINE_ID.test(id));
  return machineOf(raw, "");
}
