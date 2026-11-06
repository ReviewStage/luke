import { Schema as EffectSchema } from "effect";
import { BROWSER_LIVE } from "./browser-live-wire.js";

export const BROWSER_LIVE_PORT_CHANNEL = "browser-live:port";

export const BROWSER_LIVE_PORT_MESSAGE = {
  MESSAGE: "message",
  CLOSED: "closed",
  SEND: "send",
} as const;

export const BROWSER_LIVE_ABNORMAL_CLOSE = 1006;

const BROWSER_LIVE_SEND_MAX_CHARS = 16_384;

const browserLiveTargetSchema = EffectSchema.Struct({
  agentId: EffectSchema.NonEmptyString,
  tabId: EffectSchema.NonEmptyString,
});

export type BrowserLiveTarget = typeof browserLiveTargetSchema.Type;

export const browserLivePortTicketSchema = EffectSchema.Struct({
  viewId: EffectSchema.NonEmptyString,
});

export type BrowserLivePortTicket = typeof browserLivePortTicketSchema.Type;

export const browserLiveAttachParamsSchema = EffectSchema.Struct({
  ...browserLivePortTicketSchema.fields,
  ...browserLiveTargetSchema.fields,
});

export const browserLiveDetachParamsSchema = browserLivePortTicketSchema;

export const browserLivePortInboundSchema = EffectSchema.Struct({
  type: EffectSchema.Literal(BROWSER_LIVE_PORT_MESSAGE.SEND),
  text: EffectSchema.String.check(EffectSchema.isMaxLength(BROWSER_LIVE_SEND_MAX_CHARS)),
});

export const browserLivePortOutboundSchema = EffectSchema.Union([
  EffectSchema.Struct({
    type: EffectSchema.Literal(BROWSER_LIVE_PORT_MESSAGE.MESSAGE),
    text: EffectSchema.String,
  }),
  EffectSchema.Struct({
    type: EffectSchema.Literal(BROWSER_LIVE_PORT_MESSAGE.CLOSED),
    code: EffectSchema.Int,
  }),
]);

export type BrowserLivePortOutbound = typeof browserLivePortOutboundSchema.Type;

export function browserLivePath(target: BrowserLiveTarget): string {
  const query = new URLSearchParams({
    [BROWSER_LIVE.QUERY.AGENT]: target.agentId,
    [BROWSER_LIVE.QUERY.TAB]: target.tabId,
  });
  return `${BROWSER_LIVE.PATH}?${query.toString()}`;
}

export const browserLiveConnectionParamsSchema = EffectSchema.Struct({
  connectionId: EffectSchema.NonEmptyString,
});

export const browserLiveConnectParamsSchema = EffectSchema.Struct({
  ...browserLiveConnectionParamsSchema.fields,
  ...browserLiveTargetSchema.fields,
});

export const browserLiveSendParamsSchema = EffectSchema.Struct({
  ...browserLiveConnectionParamsSchema.fields,
  text: browserLivePortInboundSchema.fields.text,
});

export const browserLiveMessageEventSchema = EffectSchema.Struct({
  ...browserLiveConnectionParamsSchema.fields,
  text: EffectSchema.String,
});

export type BrowserLiveMessageEvent = typeof browserLiveMessageEventSchema.Type;

export const browserLiveClosedEventSchema = EffectSchema.Struct({
  ...browserLiveConnectionParamsSchema.fields,
  code: EffectSchema.Int,
});

export type BrowserLiveClosedEvent = typeof browserLiveClosedEventSchema.Type;
