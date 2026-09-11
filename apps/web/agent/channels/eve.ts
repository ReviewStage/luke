import { eveChannel } from "eve/channels/eve";
import { brainHostChannelInput } from "../../server/hosted/brain-host/channel.js";
import { productionBrainHostSeams } from "../../server/hosted/brain-host/production.js";

/** The one door into the hosted brain: eve's own HTTP API under the host's auth and queue policy. */
const seams = productionBrainHostSeams();

export default eveChannel(brainHostChannelInput(seams.userInfo, seams.ownership));
