# GitHub OAuth app

Create an OAuth app at [https://github.com/settings/applications/new] (or your organization’s **Settings → Developer settings → OAuth Apps**).

- **Application name**: for example:
  ```
  {{org}} LFS Server
  ```
- **Homepage URL:** (matching `GITHUB_APP_HOME` in the generated `wrangler.jsonc`)
  ```
  {{github.appHome}}
  ```
- **Application description**: for example:
  ```
  Enable automatic LFS Server login from `gh`, `git-credential-manager` etc.
  ```
- **Authorization callback URL:**
  ```
  {{github.appHome}}/login/oauth/callback
  ```

**Generate a new client secret**. After GitHub shows the client credentials, store them with Wrangler (**you won't see them again**):

```sh
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
```

Access is controlled by `GITHUB_ORG`/`GITHUB_ORGS` (org mode — active members only) or `GITHUB_USER` (user mode — single login). Configure one or the other in `wrangler.jsonc`.
