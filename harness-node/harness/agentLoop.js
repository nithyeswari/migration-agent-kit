#!/usr/bin/env node
// agentLoop.js — THE HARNESS and THE AGENT LOOP.
//
//   Harness = everything around the model: config loading, tool wiring,
//             guardrails, audit logging, checkpoint/resume, stop conditions,
//             human-approval prompts.
//   Loop    = think -> act -> observe -> stop?:
//                1. ask the model what to do            (think)
//                2. run the tool calls it returned      (act)
//                3. feed the results back               (observe)
//                4. repeat until a stop condition fires
//
// Run:  node harness/agentLoop.js --config config/migration.yaml \
//            --task "Migrate this Spring Boot module to Quarkus"

import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import YAML from "yaml";

import * as tools from "./tools.js";
import { makeClient } from "./llm.js";

// --- Environment ------------------------------------------------------------
// Load .env into process.env so credentials (e.g. ANTHROPIC_API_KEY) are
// available regardless of the working directory the harness is launched from.
// Resolved relative to this file, not the cwd. Missing file is non-fatal:
// the key may instead be exported in the shell or injected by the platform.
function loadEnv() {
  const candidates = [
    path.resolve(import.meta.dirname, "../../.env"), // repo root
    path.resolve(import.meta.dirname, "../.env"), // harness-node/
    path.resolve(process.cwd(), ".env"), // wherever it was launched
  ];
  for (const file of candidates) {
    try {
      process.loadEnvFile(file);
      return;
    } catch {
      // file not present at this location; try the next candidate
    }
  }
}
loadEnv();

// --- Harness pieces ---------------------------------------------------------

function loadConfig(p) {
  return YAML.parse(readFileSync(p, "utf-8"));
}

function makeAuditor(cfg) {
  const a = cfg.audit;
  if (!a?.enabled) return () => {};
  mkdirSync(path.dirname(a.path), { recursive: true });
  return (event) => {
    event.timestamp ??= Date.now() / 1000;
    appendFileSync(a.path, JSON.stringify(event) + "\n");
  };
}

// Human-in-the-loop gate. Swap for a Jira/ServiceNow ticket in prod.
function makeApprover(rl) {
  // NOTE: kept synchronous-feeling for the guardrail call site by pre-prompting.
  // Here we resolve approvals eagerly via a queue the loop awaits before acting.
  return async (toolName, args) => {
    const ans = await rl.question(
      `\n[APPROVAL NEEDED] ${toolName}(${JSON.stringify(args).slice(0, 200)})\nApprove? [y/N] `,
    );
    return ans.trim().toLowerCase() === "y";
  };
}

function buildSystemPrompt(cfg) {
  const a = cfg.agent;
  const p = cfg.project;
  return a.system_prompt
    .replaceAll("{agent_name}", a.name)
    .replaceAll("{quarkus_version}", p.quarkus_version)
    .replaceAll("{java_version}", p.java_version);
}

function stopReason(state, cfg) {
  const rules = cfg.loop.stop_when;
  if (rules.includes("tests_green") && state.tests_green) return "tests_green";
  if (rules.includes("model_signalled_done") && state.no_tool_calls)
    return "model_signalled_done";
  if (
    rules.includes("max_iterations_reached") &&
    state.iteration >= cfg.loop.max_iterations
  )
    return "max_iterations_reached";
  return null;
}

// --- The loop ---------------------------------------------------------------

async function runMigration(configPath, task) {
  const cfg = loadConfig(configPath);
  const audit = makeAuditor(cfg);
  const rl = readline.createInterface({ input: stdin, output: stdout });
  const approverAsync = makeApprover(rl);

  const client = makeClient(cfg);
  const enabled = cfg.agent.tools;
  const toolSchemas = tools.schemasFor(enabled);
  const system = buildSystemPrompt(cfg);

  const root = path.resolve(cfg.project.module_path);
  const messages = [{ role: "user", content: task }];
  const state = { iteration: 0, tests_green: false, no_tool_calls: false };

  // The guardrail check in tools.js is synchronous; for tools that need human
  // approval we resolve it here (async) and hand the decision to the context.
  let pendingApproval = true;
  const ctx = {
    cfg,
    root,
    audit,
    approver: () => pendingApproval, // set per-call below
  };

  try {
    while (true) {
      state.iteration += 1;
      audit({ iteration: state.iteration, phase: "think" });

      const resp = await client.turn(system, messages, toolSchemas, cfg);
      messages.push({ role: "assistant", content: resp.raw.content });

      if (resp.toolCalls.length === 0) {
        state.no_tool_calls = true;
        console.log(`\n[agent] ${resp.text}`);
      } else {
        const results = [];
        for (const call of resp.toolCalls) {
          // Resolve human approval up front for gated tools.
          const gated = (cfg.guardrails.require_human_approval || []).includes(
            call.name,
          );
          pendingApproval = gated ? await approverAsync(call.name, call.input) : true;

          const out = tools.execute(call.name, call.input, ctx);
          if ("tests_green" in out) state.tests_green = out.tests_green;
          if (out.error && cfg.loop.on_tool_error === "abort") {
            console.log(`[abort] ${out.error}`);
            return;
          }
          results.push({
            type: "tool_result",
            tool_use_id: call.id,
            content: JSON.stringify(out).slice(0, 8000),
          });
        }
        messages.push({ role: "user", content: results });
      }

      if (state.iteration % cfg.loop.checkpoint_every === 0) {
        mkdirSync("./audit", { recursive: true });
        writeFileSync(
          "./audit/checkpoint.json",
          JSON.stringify({ state, messages_len: messages.length }),
        );
      }

      const reason = stopReason(state, cfg);
      if (reason) {
        audit({ iteration: state.iteration, phase: "stop", reason });
        console.log(`\n[done] stopped because: ${reason}`);
        return;
      }
    }
  } finally {
    rl.close();
  }
}

// --- CLI --------------------------------------------------------------------

function parseArgs(argv) {
  const out = { config: "config/migration.yaml", task: null };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--config") out.config = argv[++i];
    else if (argv[i] === "--task") out.task = argv[++i];
  }
  return out;
}

const args = parseArgs(process.argv);
if (!args.task) {
  console.error('Usage: node harness/agentLoop.js --task "..." [--config path]');
  process.exit(1);
}
runMigration(args.config, args.task).catch((e) => {
  console.error(e);
  process.exit(1);
});
