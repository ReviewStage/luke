import { auth } from "../../server/auth";

export default {
  fetch(request: Request): Promise<Response> {
    return auth.handler(request);
  },
};
