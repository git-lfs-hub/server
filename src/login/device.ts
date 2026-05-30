import { Hono } from "hono";
import type { AppEnv } from "../app";
import { githubProxyFetch } from "@git-lfs-hub/lib/github";

// ---------------------------------------------------------------------------
// Device (cmd line) login flow
// ---------------------------------------------------------------------------

export const deviceApi = new Hono<AppEnv>();

// ---------------------------------------------------------------------------
// GET /login/device/code
// ---------------------------------------------------------------------------
// Device flow needs no server-side callback, so we proxy directly to GitHub
// substituting our client_id for whatever the client sends.
deviceApi.post("/code", async (c) => {
  const upstream = new URLSearchParams(await c.req.text());
  upstream.set("client_id", c.env.GITHUB_CLIENT_ID);

  return githubProxyFetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: c.req.header("Accept") ?? "application/json",
    },
    body: upstream,
  });
});
