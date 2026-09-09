/**
 * The Gateway over a socket. This door stands apart from the package's main
 * barrel because it reaches `ws`, which a process hosting the runtime has and
 * the web functions that door the main barrel do not.
 */
export {
  bearerAuthentication,
  GATEWAY_FRAME,
  GATEWAY_REFUSAL_HEADER,
  type GatewayAdmission,
  type GatewayAuthenticate,
  WEB_SOCKET_GATEWAY_DEFAULTS,
  WebSocketTransport,
  type WebSocketTransportOptions,
} from "./gateway/local-host.js";
export {
  connectWebSocketGateway,
  GATEWAY_UNREACHABLE,
  type GatewayConnectResult,
  WEB_SOCKET_GATEWAY_CONNECT_DEFAULTS,
  WebSocketGatewayConnection,
  type WebSocketGatewayConnectOptions,
} from "./gateway/local-transport.js";
