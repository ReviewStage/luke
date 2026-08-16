import { auth } from "../../server/auth.js";

export default {
  fetch(request: Request): Promise<Response> {
    return auth.handler(request);
  },
};
