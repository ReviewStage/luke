import { HostedDeviceAgentClient } from "@repo/features";
import { HOST_WIRE } from "@repo/features/host-wire";
import { Effect, Option } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { type HostDevice, readHostDevice } from "../host-device-record.js";

/**
 * host-leave.ts -- a box removing itself from its account on its own device secret, as `vespin-host uninstall` does before it deletes that secret.
 *
 * The service removes the host as Settings › Hosts' Remove does
 * (`deviceAgents.leave`), so it leaves the member's list without their
 * pressing anything. A box whose record the service already refused, or
 * whose host the service answers as removed, has left already. A box with
 * no record never joined, so there is nothing to leave. A call the service
 * did not answer leaves the host listed, and the uninstall goes on and says
 * so; nothing here retries, since the box is about to delete its secret.
 */

export const HOST_LEAVE_OUTCOME = {
  /** The service removed the host, now or before. */
  LEFT: "left",
  /** The box holds no record, so it never joined. */
  NOT_CONNECTED: "not-connected",
  /** The service did not take the call, so the host may still be listed. */
  UNANSWERED: "unanswered",
} as const;

export type HostLeaveOutcome = (typeof HOST_LEAVE_OUTCOME)[keyof typeof HOST_LEAVE_OUTCOME];

export interface HostLeaveInput {
  /** The daemon's state, where its device record stands. */
  readonly stateRoot: string;
  /** The daemon's version, which every call of a host's carries. */
  readonly version: string;
}

/** The device given removed from its account on its own secret, the version given on the call; whether it is gone. */
export const deviceLeft = (device: HostDevice, version: string) =>
  new HostedDeviceAgentClient({
    serviceBaseUrl: device.serviceOrigin,
    credential: { authorization: () => Effect.succeed(`Bearer ${device.deviceSecret}`) },
  })
    .leave(device.deviceId)
    .pipe(
      Effect.updateService(
        HttpClient.HttpClient,
        HttpClient.mapRequest(HttpClientRequest.setHeader(HOST_WIRE.VERSION_HEADER, version)),
      ),
    );

/** The box removed from its account on its record's secret, its daemon's version on the call; how it went. */
export const leaveHostDevice = Effect.fnUntraced(function* (input: HostLeaveInput) {
  const record = yield* readHostDevice(input.stateRoot);
  if (Option.isNone(record)) return HOST_LEAVE_OUTCOME.NOT_CONNECTED;
  const device = record.value;
  if (device.refused === true) return HOST_LEAVE_OUTCOME.LEFT;
  const left = yield* deviceLeft(device, input.version);
  return left ? HOST_LEAVE_OUTCOME.LEFT : HOST_LEAVE_OUTCOME.UNANSWERED;
});
