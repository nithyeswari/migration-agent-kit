#!/usr/bin/env node
// openrewrite-migrate.js — the DETERMINISTIC migration path (no LLM).
//
// Same recipes the agent's `run_openrewrite` tool uses, but run straight from
// the command line against a target module. Reads the SAME migration.yaml, so
// the recipe list / coordinates / build tool stay in one place.
//
//   Preview (dry-run, writes target/rewrite/rewrite.patch — touches nothing):
//     node scripts/openrewrite-migrate.js --module C:/path/to/spring-app
//
//   Apply (rewrites the tree in place):
//     node scripts/openrewrite-migrate.js --module C:/path/to/spring-app --apply
//
// Use this when you want a reproducible, auditable rewrite without a model in
// the loop. Follow it with your own build + tests (the agent loop automates
// that part and self-heals; this script intentionally does not).

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import YAML from "yaml";

function parseArgs(argv) {
  const out = { config: "config/migration.yaml", module: null, apply: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--config") out.config = argv[++i];
    else if (a === "--module") out.module = argv[++i];
    else if (a === "--apply") out.apply = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function usage() {
  console.log(`Run the configured Spring->Quarkus OpenRewrite recipes directly.

  node scripts/openrewrite-migrate.js --module <dir> [--config <yaml>] [--apply]

  --module <dir>   Target module to migrate (default: project.module_path from config)
  --config <yaml>  Config file (default: config/migration.yaml)
  --apply          Apply changes. Without it, runs dryRun (preview only).`);
}

// Resolve the build command for the chosen tool, preferring a wrapper in the
// module so we use the project's pinned build version when present.
function buildCommand(tc, moduleDir, apply) {
  const recipes = (tc.recipes || []).join(",");
  if (!recipes) throw new Error("No recipes configured under tools.run_openrewrite.recipes");
  const coords = tc.recipe_artifact_coordinates;

  if (tc.build_tool === "gradle") {
    const goal = apply ? "rewriteRun" : "rewriteDryRun";
    const wrapper = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
    const bin = existsSync(path.join(moduleDir, "gradlew")) ? wrapper : "gradle";
    return [bin, [goal, `--recipes=${recipes}`]];
  }

  // maven (default)
  const goal = apply ? "run" : "dryRun";
  const wrapper = process.platform === "win32" ? "mvnw.cmd" : "./mvnw";
  const bin = existsSync(path.join(moduleDir, "mvnw")) ? wrapper : "mvn";
  const argsList = [
    "-U",
    `org.openrewrite.maven:rewrite-maven-plugin:${goal}`,
    `-Drewrite.activeRecipes=${recipes}`,
  ];
  if (coords) argsList.push(`-Drewrite.recipeArtifactCoordinates=${coords}`);
  return [bin, argsList];
}

function main() {
  const args = parseArgs(process.argv);
  if (args.help) return usage();

  const cfg = YAML.parse(readFileSync(args.config, "utf-8"));
  const tc = cfg?.tools?.run_openrewrite;
  if (!tc) throw new Error(`No tools.run_openrewrite section in ${args.config}`);

  const moduleDir = path.resolve(args.module || cfg.project?.module_path || ".");
  if (!existsSync(moduleDir)) throw new Error(`Module path not found: ${moduleDir}`);

  // Guard: maven needs a pom, gradle needs a build script — fail loud, early.
  const isMaven = (tc.build_tool || "maven") === "maven";
  const marker = isMaven ? "pom.xml" : "build.gradle";
  if (!existsSync(path.join(moduleDir, marker)) &&
      !existsSync(path.join(moduleDir, `${marker}.kts`))) {
    throw new Error(`No ${marker} in ${moduleDir} — is this the right --module?`);
  }

  const [bin, cmdArgs] = buildCommand(tc, moduleDir, args.apply);
  const mode = args.apply ? "APPLY (rewriting in place)" : "DRY-RUN (preview only)";
  console.log(`\n[openrewrite] ${mode}`);
  console.log(`[openrewrite] module : ${moduleDir}`);
  console.log(`[openrewrite] recipes: ${(tc.recipes || []).join(", ")}`);
  console.log(`[openrewrite] $ ${bin} ${cmdArgs.join(" ")}\n`);

  const r = spawnSync(bin, cmdArgs, { cwd: moduleDir, stdio: "inherit", shell: process.platform === "win32" });
  if (r.error) throw r.error;

  if (!args.apply) {
    const patch = path.join(moduleDir, "target", "rewrite", "rewrite.patch");
    console.log(`\n[openrewrite] Preview complete. Patch (if any changes):\n  ${patch}`);
    console.log(`[openrewrite] Re-run with --apply to write the changes.`);
  } else {
    console.log(`\n[openrewrite] Applied. Now build + test the module, then review the diff.`);
  }
  process.exit(r.status ?? 0);
}

try {
  main();
} catch (e) {
  console.error(`\n[openrewrite] error: ${e.message}`);
  process.exit(1);
}
