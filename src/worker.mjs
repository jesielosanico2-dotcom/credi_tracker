import { handleAsNodeRequest } from "cloudflare:node";
import serverModule from "./server.js";
import d1StoreModule from "./d1-store.js";
import d1AuthModule from "./d1-auth.js";

const { createApp } = serverModule;
const { createD1Store } = d1StoreModule;
const { createD1Auth } = d1AuthModule;
const port = 8787;
let configuredDatabase;
let configuredServer;

export default {
  fetch(request, env) {
    if (!env.DB) {
      return new Response("Cloudflare D1 binding DB is not configured.", { status: 503 });
    }
    if (!env.OWNER_SETUP_KEY) {
      return new Response("Set the OWNER_SETUP_KEY secret before using the Worker.", { status: 503 });
    }
    if (configuredDatabase !== env.DB) {
      configuredServer = createApp({
        store: createD1Store(env.DB),
        auth: createD1Auth(env.DB),
        secureCookies: true,
        setupKeyRequired: true,
        setupKey: env.OWNER_SETUP_KEY
      });
      configuredServer.listen(port);
      configuredDatabase = env.DB;
    }
    return handleAsNodeRequest(port, request);
  }
};
