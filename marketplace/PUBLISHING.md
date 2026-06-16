# Publishing the quarkus-migration plugin

A Copilot plugin is "published" by hosting it in a Git repo that acts as a
*marketplace*. There is no central app-store submission.

## Repo layout (this folder)

    marketplace-repo/
      .github/plugin/marketplace.json     <- the registry (lists your plugins)
      plugins/
        quarkus-migration/                <- the plugin itself
          plugin.json
          skills/spring-to-quarkus/SKILL.md
          agents/quarkus-migrator.agent.md
          hooks.json
          .mcp.json

`source` in marketplace.json points at the plugin directory, relative to the
repo root. `.claude-plugin/marketplace.json` is also recognised if you want the
Claude-format location.

## Publish

    cd marketplace-repo
    git init && git add -A && git commit -m "Publish quarkus-migration plugin"
    git remote add origin https://github.com/your-org/platform-eng-plugins.git
    git push -u origin main

That's it — the repo is now a marketplace.

## How teammates install it

VS Code (settings.json), add the marketplace then install from the Extensions
view (search `@agentPlugins`):

    "chat.plugins.marketplaces": [ "your-org/platform-eng-plugins" ]

Or install directly from source without registering a marketplace:
Command Palette -> "Chat: Install Plugin From Source" -> paste the repo URL.

CLI:  copilot plugin marketplace add your-org/platform-eng-plugins
      copilot plugin install quarkus-migration

## Auto-recommend to the whole team (no manual marketplace step)

Put this in the *consuming* repo's .github/copilot/settings.json so VS Code
suggests the plugin on first chat message:

    {
      "extraKnownMarketplaces": {
        "platform-eng": { "source": { "source": "github",
                                       "repo": "your-org/platform-eng-plugins" } }
      },
      "enabledPlugins": { "quarkus-migration@platform-eng": true }
    }

## Versioning

Bump `version` in BOTH plugins/quarkus-migration/plugin.json AND its entry in
marketplace.json, then push. Teammates pick it up via
"Extensions: Check for Extension Updates".

## Regulated-context notes
- Use a PRIVATE org repo as the marketplace; private repos are supported.
- `chat.plugins.enabled` is org-managed — confirm it's on with your VS Code admin.
- Installs are per-developer and local; nothing activates repo-wide on its own.
- Plugin MCP servers are implicitly trusted on install (no separate prompt), so
  the marketplace repo itself is your trust boundary — gate merges to it.
