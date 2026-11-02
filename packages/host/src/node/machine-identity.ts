import childProcess from "node:child_process";
import { createHmac } from "node:crypto";
import fs from "node:fs";
import { DEVICE_MODEL_MAX_CHARS, type DeviceMachine } from "@luke/features/device-agent-wire";

/**
 * machine-identity.ts -- which machine a host runs on, as it reports it: a keyed hash of the OS's own id for the machine, and on a Mac its model as a person reads it.
 *
 * Every read here asks nothing of the member and needs no privilege:
 * `ioreg` and `sysctl` answer any user on a Mac, and a Linux box's machine
 * id is readable by all (machine-id(5)). Each waits a short while and
 * answers nothing where it fails, as `mac-device-name.ts` does, so a
 * machine whose id cannot be read reports as a host older than the field.
 *
 * The OS's id never leaves the machine and is never logged: what crosses
 * the wire is its HMAC-SHA256 under a key of our own (`APP_KEY`), as
 * systemd advises an app that needs a stable id for the machine, so every
 * install on one machine answers the same id to us and to nothing else.
 */

/**
 * The key the OS's id is hashed under: a fixed 128-bit id of the app's own,
 * as systemd's `sd_id128_get_machine_app_specific` takes one. Note that it
 * is no secret, since its job is only to make the hash ours: changing it
 * gives every machine a new id, so it never changes.
 */
const APP_KEY = Buffer.from("03efad7e1cf04d1592434cb89b617d34", "hex");

/** How long `ioreg` and `sysctl` are waited for, which answer from the kernel's registry at once. */
const READ_TIMEOUT_MS = 2_000;

/** A Mac's hardware UUID, as `IOPlatformUUID` holds it. */
const MAC_UUID =
  /"IOPlatformUUID" = "([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})"/u;

/** An Apple silicon Mac's model as `ioreg` prints its `product-name` data: `<"MacBook Air (M2, 2022)">`. */
const MAC_PRODUCT_NAME = /"product-name" = <"([^"]+)">/u;

/** A Linux machine id: 32 lower-case hex digits, so `uninitialized` and an empty file are none. */
const LINUX_MACHINE_ID = /^[0-9a-f]{32}$/u;

/** Where a Linux box keeps its machine id, the first that holds one: systemd's, then D-Bus's older one. */
const LINUX_MACHINE_ID_FILES = ["/etc/machine-id", "/var/lib/dbus/machine-id"] as const;

/** What the command given printed, trimmed; nothing where it failed or printed nothing. */
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

/** What the file given holds, trimmed; nothing where it cannot be read. */
function held(file: string): string {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    return "";
  }
}

/** The id given as the wire carries it: its keyed hash, in hex. */
function keyed(raw: string): string {
  return createHmac("sha256", APP_KEY).update(raw.toLowerCase()).digest("hex");
}

/** The machine as the reads found it, each part left out where its read found nothing, and its model cut to what the wire takes. */
function machineOf(raw: string | undefined, model: string): DeviceMachine {
  return {
    ...(raw === undefined ? undefined : { machineId: keyed(raw) }),
    ...(model.length === 0 ? undefined : { model: model.slice(0, DEVICE_MODEL_MAX_CHARS) }),
  };
}

/**
 * A Mac: its hardware UUID, and its model by its `product-name`, which an
 * Apple silicon Mac's platform device holds, else by `hw.model`
 * ("MacBookPro16,1"), else none. Note that `ioreg` is asked for the
 * platform device alone, whose serial number is read past and never kept.
 */
export function macMachine(): DeviceMachine {
  const platform = printed("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"]);
  const productName = MAC_PRODUCT_NAME.exec(platform)?.[1]?.replaceAll("\0", "").trim() ?? "";
  const model =
    productName.length > 0 ? productName : printed("/usr/sbin/sysctl", ["-n", "hw.model"]);
  return machineOf(MAC_UUID.exec(platform)?.[1], model);
}

/** A Linux box: its machine id, from the first file that holds one; it reports no model. */
export function linuxMachine(): DeviceMachine {
  const raw = LINUX_MACHINE_ID_FILES.map(held).find((id) => LINUX_MACHINE_ID.test(id));
  return machineOf(raw, "");
}
