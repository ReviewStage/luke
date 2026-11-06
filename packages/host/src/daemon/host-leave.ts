import { HostedDeviceAgentClient } from "@repo/features";
import { HOST_WIRE } from "@repo/features/host-wire";
import { Effect, Option } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { readHostDevice } from "../host-device-record.js";

export const HOST_LEAVE_OUTCOME = {
  LEFT: "left",
  NOT_CONNECTED: "not-connected",
  UNANSWERED: "unanswered",
} as const;

export type HostLeaveOutcome = (typeof HOST_LEAVE_OUTCOME)[keyof typeof HOST_LEAVE_OUTCOME];

export interface HostLeaveInput {
  readonly stateRoot: string;
  readonly version: string;
}

export const leaveHostDevice = Effect.fnUntraced(function* (input: HostLeaveInput) {
  const record = yield* readHostDevice(input.stateRoot);
  if (Option.isNone(record)) return HOST_LEAVE_OUTCOME.NOT_CONNECTED;
  const device = record.value;
  if (device.refused === true) return HOST_LEAVE_OUTCOME.LEFT;
  const client = new HostedDeviceAgentClient({
    serviceBaseUrl: device.serviceOrigin,
    credential: { authorization: () => Effect.succeed(`Bearer ${device.deviceSecret}`) },
  });
  const left = yield* client
    .leave(device.deviceId)
    .pipe(
      Effect.updateService(
        HttpClient.HttpClient,
        HttpClient.mapRequest(HttpClientRequest.setHeader(HOST_WIRE.VERSION_HEADER, input.version)),
      ),
    );
  return left ? HOST_LEAVE_OUTCOME.LEFT : HOST_LEAVE_OUTCOME.UNANSWERED;
});
