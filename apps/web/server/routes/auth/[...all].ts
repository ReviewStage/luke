import { auth } from "../../auth.js";

export default {
  fetch(request: Request): Promise<Response> {
    return auth.handler(request);
  },
};
