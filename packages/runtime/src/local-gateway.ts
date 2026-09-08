/**
 * The Gateway over a loopback socket. This door stands apart from the
 * package's main barrel because it reaches `ws`, which the desktop's main
 * process has and the web functions that door the main barrel do not.
 */
export {
  GATEWAY_REFUSAL_HEADER,
  LOCAL_GATEWAY_DEFAULTS,
  LOCAL_GATEWAY_FRAME,
  LocalGatewayHost,
  type LocalGatewayHostOptions,
  responseToWire,
} from "./gateway/local-host.js";
export {
  connectLocalGateway,
  LOCAL_GATEWAY_CONNECT_DEFAULTS,
  LocalGatewayConnection,
  type LocalGatewayConnectOptions,
} from "./gateway/local-transport.js";
