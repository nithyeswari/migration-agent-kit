// tools.js — the TOOLS the agent can call.
//
// A "tool" is one bounded action the model can invoke (same as the Copilot/MCP
// concept). Each tool declares a JSON schema so the model knows how to call it,
// plus a run() function. Tools register into REGISTRY; config (agent.tools)
// decides which are actually exposed. Add a capability by writing a tool() and
// listing its name in migration.yaml — nothing else changes.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// --- Registry ---------------------------------------------------------------

export const REGISTRY = new Map();

function tool(name, description, inputSchema, run) {
  REGISTRY.set(name, { name, description, inputSchema, run });
}

// ToolContext is just a plain object: { cfg, root, audit, approver }

// --- Guardrail enforcement (runs BEFORE any tool) ---------------------------

function withinAllowed(p, ctx) {
  const allowed = ctx.cfg.guardrails.allowed_paths;
  const norm = path.normalize(p);
  return allowed.some(
    (a) => norm === a || norm.startsWith(a.replace(/\/$/, "") + "/"),
  );
}

export function enforceGuardrails(name, args, ctx) {
  const g = ctx.cfg.guardrails;
  if ((g.deny || []).includes(name)) {
    return `BLOCKED: tool '${name}' is on the deny list.`;
  }
  for (const key of ["path", "file"]) {
    if (args[key] && !withinAllowed(args[key], ctx)) {
      return `BLOCKED: '${args[key]}' is outside allowed_paths.`;
    }
  }
  if ((g.require_human_approval || []).includes(name)) {
    if (!ctx.approver(name, args)) {
      return `BLOCKED: human approval declined for '${name}'.`;
    }
  }
  return null;
}

// --- helpers ----------------------------------------------------------------

function run(cmd, ctx) {
  const [bin, ...rest] = Array.isArray(cmd) ? cmd : cmd.split(" ");
  return spawnSync(bin, rest, {
    cwd: ctx.root,
    encoding: "utf-8",
    maxBuffer: 32 * 1024 * 1024,
  });
}

// --- Tool implementations ---------------------------------------------------

tool(
  "read_file",
  "Read a source file's contents.",
  { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  (args, ctx) => ({
    content: readFileSync(path.join(ctx.root, args.path), "utf-8").slice(0, 20000),
  }),
);

tool(
  "search_code",
  "Grep the codebase for a regex; returns matching file:line.",
  { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] },
  (args, ctx) => {
    const r = run(["grep", "-rne", args.pattern, "src"], ctx);
    return { matches: (r.stdout || "").slice(0, 8000) };
  },
);

tool(
  "run_openrewrite",
  "Run the configured OpenRewrite recipes (dry-run first if set).",
  {
    type: "object",
    properties: {
      recipes: {
        type: "array",
        items: { type: "string" },
        description: "Optional override; defaults to config.",
      },
    },
  },
  (args, ctx) => {
    const tc = ctx.cfg.tools.run_openrewrite;
    const recipes = args.recipes || tc.recipes;
    const goal = tc.dry_run_first === false ? "run" : "dryRun";
    const active = recipes.join(",");
    const coords = tc.recipe_artifact_coordinates;
    let cmd;
    if (tc.build_tool === "maven") {
      cmd = ["./mvnw", "-q", `org.openrewrite.maven:rewrite-maven-plugin:${goal}`,
             `-Drewrite.activeRecipes=${active}`];
      if (coords) cmd.push(`-Drewrite.recipeArtifactCoordinates=${coords}`);
    } else {
      cmd = ["./gradlew", goal, `--recipes=${active}`];
    }
    const r = run(cmd, ctx);
    return {
      goal,
      recipes,
      stdout: (r.stdout || "").slice(0, 8000),
      returncode: r.status,
    };
  },
);

tool(
  "apply_patch",
  "Apply a unified diff to a file inside allowed paths.",
  {
    type: "object",
    properties: { path: { type: "string" }, diff: { type: "string" } },
    required: ["path", "diff"],
  },
  (args, ctx) => {
    const r = spawnSync("git", ["apply", "-"], {
      cwd: ctx.root,
      input: args.diff,
      encoding: "utf-8",
    });
    return { applied: r.status === 0, stderr: (r.stderr || "").slice(0, 2000) };
  },
);

tool(
  "build_module",
  "Compile/package the module without tests.",
  { type: "object", properties: {} },
  (args, ctx) => {
    const r = run(ctx.cfg.tools.build_module.command, ctx);
    return { ok: r.status === 0, stdout: (r.stdout || "").slice(-4000) };
  },
);

tool(
  "run_tests",
  "Run the test suite; reports green/red.",
  { type: "object", properties: {} },
  (args, ctx) => {
    const tc = ctx.cfg.tools.run_tests;
    const r = run(tc.command, ctx);
    const green = (r.stdout || "").includes(tc.success_pattern);
    return { tests_green: green, stdout: (r.stdout || "").slice(-4000) };
  },
);

tool(
  "git_commit",
  "Commit staged changes (requires human approval).",
  { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] },
  (args, ctx) => {
    const msg = ctx.cfg.tools.git_commit.message_template.replace(
      "{summary}",
      args.summary,
    );
    run(["git", "add", "-A"], ctx);
    const r = run(["git", "commit", "-m", msg], ctx);
    return { committed: r.status === 0, message: msg };
  },
);

// --- Helpers the harness uses -----------------------------------------------

export function schemasFor(names) {
  return names
    .filter((n) => REGISTRY.has(n))
    .map((n) => {
      const t = REGISTRY.get(n);
      return { name: t.name, description: t.description, input_schema: t.inputSchema };
    });
}

// Guardrail -> audit -> run. The single chokepoint for every tool call.
export function execute(name, args, ctx) {
  const blocked = enforceGuardrails(name, args, ctx);
  const argsHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(args, Object.keys(args).sort()))
    .digest("hex")
    .slice(0, 12);
  if (blocked) {
    ctx.audit({ tool: name, args_hash: argsHash, decision: "blocked", outcome: blocked });
    return { error: blocked };
  }
  // A tool that throws (missing file, bad command, etc.) must NOT crash the
  // loop. Surface it as a normal tool error so the harness can honour
  // on_tool_error ("feed_back" lets the model self-correct; "abort" stops).
  try {
    const result = REGISTRY.get(name).run(args, ctx);
    ctx.audit({ tool: name, args_hash: argsHash, decision: "allowed", outcome: "ok" });
    return result;
  } catch (e) {
    const error = `${name} failed: ${e.message}`;
    ctx.audit({ tool: name, args_hash: argsHash, decision: "allowed", outcome: error });
    return { error };
  }
}
