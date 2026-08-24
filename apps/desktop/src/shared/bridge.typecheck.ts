import { channels } from "./bridge";

const bootstrapChannel: typeof channels.getBootstrap = channels.getBootstrap;
void bootstrapChannel;

// @ts-expect-error A method cannot be paired with another method's channel.
const mismatchedChannel: typeof channels.getBootstrap = channels.beginSignIn;
void mismatchedChannel;
