# Quarkus Migration Agent Kit

A config-driven agent that migrates a **Spring Boot** module to **Quarkus**,
packaged two ways: as a **GitHub Copilot plugin** you run inside VS Code, and as
a **standalone harness** (Python *or* Node) you run from the terminal. Both do
the same job — pick one.

---

## TL;DR — pick your route

| You want to…                                  | Use            | Setup |
|-----------------------------------------------|----------------|-------|
| Try it in VS Code chat, one repo              | `copilot/`     | copy 2 folders |
| Share it with your team                       | `marketplace/` | push to GitHub, install plugin |
| Run it from the terminal / CI                 | `harness-python/` or `harness-node/` | API key + deps |
| Just run OpenRewrite, no agent                | `copilot/skills/spring-to-quarkus/recipes.md` | one `mvn` command |
| Understand / present the design               | `diagrams/migration-agent.drawio` | open in draw.io |

Everything tunable lives in one file: **`config/migration.yaml`** (model, loop
limits, enabled tools, recipes, guardrails). Edit that, not the code.

## The three plugins (in `marketplace/`)

A marketplace can host many plugins; install only what you need.

1. **quarkus-migration** — bundles the official `migrate-spring-to-quarkus` skill
   from quarkusio/skills (modular, gate-driven) plus 10 Quarkus framework-dev
   skills, the `quarkus-migrator` agent, and a verified OpenRewrite reference.
2. **react-modernization** — `modernize-react` skill (React 18->19 via the
   official codemod recipe, class->Hooks, TypeScript types, CRA->Vite) and the
   `react-modernizer` agent.
3. **sdlc-toolkit** — cross-cutting. `peer-review` and `sdlc-workflow` skills, a
   read-only `@reviewer` agent, and **real** Jira (Atlassian) + GitHub MCP
   servers. Install it alongside either migration plugin to update tickets, open
   PRs, and run reviews. See `plugins/sdlc-toolkit/README.md` for the Cloud vs
   Data Center / Enterprise MCP variants.

---

## Folder map

    kit/
      README.md                 <- you are here
      copilot/                  ROUTE A — drop into a repo's .github/ and use in chat
        plugin.json
        skills/spring-to-quarkus/             migration procedure + OpenRewrite recipes
        skills/<10 quarkus skills>/           bundled from quarkusio/quarkus (see ATTRIBUTION.md)
        agents/quarkus-migrator.agent.md      the bounded agent persona
        hooks.json              guardrail hooks (path allow-list, audit)
        .mcp.json               OPTIONAL extra tools (placeholder names — see note)
        ATTRIBUTION.md          licence/source for the bundled Quarkus skills
      marketplace/              ROUTE A (shared) — publish as its own git repo
        .github/plugin/marketplace.json       lists all 3 plugins below
        plugins/quarkus-migration/            official migrate skill + framework skills + agent
        plugins/react-modernization/          React 18->19, class->Hooks, CRA->Vite
        plugins/sdlc-toolkit/                 peer-review + Jira/GitHub MCP (cross-cutting)
        PUBLISHING.md           exact publish + install steps
      harness-python/           ROUTE B (Python)
        config/migration.yaml
        harness/{agent_loop,tools,llm}.py
        README.md
      harness-node/             ROUTE B (Node.js)
        config/migration.yaml
        harness/{agentLoop,tools,llm}.js
        package.json, README.md
      diagrams/migration-agent.drawio

> `copilot/` and `marketplace/plugins/quarkus-migration/` are the SAME plugin.
> `copilot/` is for dropping into a single repo; `marketplace/` is for pushing
> as its own repo so your team can install it. Keep whichever you need.

---

## ROUTE A — use it in Copilot (fastest)

Copy the skill and agent into the Spring Boot repo you want to migrate:

    cp -r copilot/skills  <your-spring-repo>/.github/skills
    cp -r copilot/agents  <your-spring-repo>/.github/agents

Reload VS Code, open Copilot chat in that repo, then either:

- `@quarkus-migrator`  — invoke the agent (multi-step: recipe → build → test)
- `/spring-to-quarkus` — run just the skill's procedure

The agent uses Copilot's built-in `codebase` / `editFiles` / `runCommands`
tools, so it reads your code, runs the OpenRewrite command, builds and tests —
no extra servers required.

**Note on `.mcp.json`:** it references `@example/openrewrite-mcp` and
`@example/build-mcp`, which are **placeholder names for illustration** — they
are not real npm packages. Delete the file, or point it at real MCP servers you
run. The agent works without it.

### Share with the team
Push `marketplace/` as its own GitHub repo and follow `marketplace/PUBLISHING.md`
(add the marketplace in settings → install the `quarkus-migration` plugin).
Plugins are an org-managed preview feature, so confirm `chat.plugins.enabled`
with your VS Code admin first.

---

## ROUTE B — run the standalone harness

Pick **one** language. First, point the harness at your repo: set
`project.module_path` in `config/migration.yaml` to your Spring Boot repo path
(default `.`). The harness runs `./mvnw` and `git` in that path, so it must be a
Maven-wrapper repo.

### Python
    cd harness-python
    pip install anthropic pyyaml
    export ANTHROPIC_API_KEY=...
    python -m harness.agent_loop --config config/migration.yaml \
        --task "Migrate this Spring Boot module to Quarkus"

### Node
    cd harness-node
    npm install
    export ANTHROPIC_API_KEY=...
    node harness/agentLoop.js --config config/migration.yaml \
        --task "Migrate this Spring Boot module to Quarkus"

Either way the loop is: **think** (ask the model) → **act** (run tools through
the guardrail gate) → **observe** (feed results back) → **stop?**
(`tests_green` / `max_iterations` / model done). OpenRewrite runs as `dryRun`
first (writes a reviewable patch), and `git_commit` pauses for your approval.

---

## Just OpenRewrite, no agent

If you only want the recipe, skip everything above and run (in your repo):

    mvn -U org.openrewrite.maven:rewrite-maven-plugin:dryRun \
        -Drewrite.recipeArtifactCoordinates=org.openrewrite.recipe:rewrite-spring-to-quarkus:RELEASE \
        -Drewrite.activeRecipes=org.openrewrite.quarkus.spring.SpringBootToQuarkus

Swap `dryRun` for `run` to apply. Full recipe list, a custom-subset `rewrite.yml`,
the Gradle variant, and licence/caveat notes are in
`copilot/skills/spring-to-quarkus/recipes.md`.

> Precondition: the recipe only fires on **Spring Boot 3.x**. On 2.x, run the
> Spring Boot 3 upgrade recipe first.

---

## What to change vs. never touch

- **Change:** `config/migration.yaml` — model, `loop.*`, `agent.tools`,
  `tools.run_openrewrite.recipes`, `guardrails.*`, `audit.*`.
- **Knowledge:** `SKILL.md` + `recipes.md` (the how-to the agent follows).
- **Engine (rarely):** `harness/*.py` / `harness/*.js`. Add a tool with the
  `tool(...)` helper + list it under `agent.tools`. Add a model provider in
  `llm.*` + register it in `make_client` / `makeClient`.

## Regulated-context notes
- Guardrails (`allowed_paths`, `deny`, `require_human_approval`) are enforced in
  one chokepoint before every tool call; every call is written to an OTel-style
  audit line.
- OpenRewrite's Spring→Quarkus recipes are under the Moderne Source Available
  Licence (not Apache) — get an OSS-review sign-off before at-scale/SaaS use.
- The migration is not autopilot: WebFlux→Mutiny, Spring Security, and
  reflection-based config need manual review. The build+test loop is the safety
  net that catches what the recipe can't.
