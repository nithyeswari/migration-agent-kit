# Quarkus migration agent — Node.js harness

JavaScript port of the config-driven Spring Boot -> Quarkus migration agent.
Same loop, same guardrails, same config. The skill / agent / plugin files
(`copilot/`) are language-agnostic and unchanged.

## Files

    config/migration.yaml          the single place to change anything (shared with the Python version)
    harness/tools.js               tool registry + guardrails + tool implementations
    harness/llm.js                 pluggable LLM client (Anthropic messages API, tool use)
    harness/agentLoop.js           the harness + think->act->observe->stop loop + CLI
    scripts/openrewrite-migrate.js deterministic OpenRewrite-only migration (no LLM)

## The loop (harness/agentLoop.js)

    think  -> ask the model what to do        (llm.js)
    act    -> run the tool calls it returned  (tools.js, behind guardrails)
    observe-> feed the results back
    stop?  -> tests_green / max_iterations / model done  -> else loop

## Run

    npm install            # @anthropic-ai/sdk, yaml
    # Put ANTHROPIC_API_KEY in a .env file at the repo root (auto-loaded),
    # or export it. On Windows PowerShell:  $env:ANTHROPIC_API_KEY="sk-ant-..."
    node harness/agentLoop.js --config config/migration.yaml \
        --task "Migrate this Spring Boot module to Quarkus"

## Two migration paths

**1. Agentic (LLM-driven)** — the loop above. The model drives recipes + hand-edits,
then builds and runs tests, self-healing from failures. Needs `ANTHROPIC_API_KEY`.

**2. Deterministic (OpenRewrite-only, no LLM)** — runs just the configured
OpenRewrite recipes against a module. Reproducible, auditable, no API key, no model
in the loop. Same `migration.yaml` (`tools.run_openrewrite`), so the recipe list and
build tool stay in one place.

    # Preview — writes target/rewrite/rewrite.patch, changes nothing:
    npm run migrate:openrewrite -- --module C:/path/to/spring-app
    # Apply — rewrites the tree in place:
    npm run migrate:openrewrite:apply -- --module C:/path/to/spring-app

Defaults to `project.module_path` from the config if `--module` is omitted. Prefers a
build wrapper (`mvnw`/`gradlew`) in the module, falling back to `mvn`/`gradle` on PATH.
After applying, build + test the module yourself and review the diff — see
`copilot/OPENREWRITE-RECIPES.md` for what the recipes do and do not cover.

## Notes vs the Python version

- Everything configurable still lives in `migration.yaml` — no code edits to retune.
- Uses ESM (`"type": "module"`). Node 20+.
- Tool execution is synchronous (`spawnSync`); only human approval is async,
  resolved before a gated tool runs so the guardrail decision stays a single
  chokepoint in `tools.execute`.
- Add a provider by writing a class in `llm.js` and registering it in `makeClient`.
- Add a tool with `tool(name, description, schema, run)` in `tools.js` and listing
  its name under `agent.tools` in the config.
