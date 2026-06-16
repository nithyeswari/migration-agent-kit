# Quarkus migration agent — Node.js harness

JavaScript port of the config-driven Spring Boot -> Quarkus migration agent.
Same loop, same guardrails, same config. The skill / agent / plugin files
(`copilot/`) are language-agnostic and unchanged.

## Files

    config/migration.yaml   the single place to change anything (shared with the Python version)
    harness/tools.js        tool registry + guardrails + tool implementations
    harness/llm.js          pluggable LLM client (Anthropic messages API, tool use)
    harness/agentLoop.js    the harness + think->act->observe->stop loop + CLI

## The loop (harness/agentLoop.js)

    think  -> ask the model what to do        (llm.js)
    act    -> run the tool calls it returned  (tools.js, behind guardrails)
    observe-> feed the results back
    stop?  -> tests_green / max_iterations / model done  -> else loop

## Run

    npm install            # @anthropic-ai/sdk, yaml
    export ANTHROPIC_API_KEY=...
    node harness/agentLoop.js --config config/migration.yaml \
        --task "Migrate this Spring Boot module to Quarkus"

## Notes vs the Python version

- Everything configurable still lives in `migration.yaml` — no code edits to retune.
- Uses ESM (`"type": "module"`). Node 20+.
- Tool execution is synchronous (`spawnSync`); only human approval is async,
  resolved before a gated tool runs so the guardrail decision stays a single
  chokepoint in `tools.execute`.
- Add a provider by writing a class in `llm.js` and registering it in `makeClient`.
- Add a tool with `tool(name, description, schema, run)` in `tools.js` and listing
  its name under `agent.tools` in the config.
