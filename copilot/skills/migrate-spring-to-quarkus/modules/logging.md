# Module: logging (Governed Logging)

**Gate: ALWAYS** — runs after the build/code/frontend/testing/cleanup modules, once the service is a
working Quarkus service. This module applies the platform **Governed Logging Library** so every
service added or migrated emits compliance-aware, ECS-aligned structured logs with PII redaction.

## What to do

Load and follow the **`apply-governed-logging`** skill — its `SKILL.md` is the full procedure. In
summary:

1. **Confirm the gate.** The service must now be Quarkus (Quarkus BOM + extension present) and on Java
   21+. If migration left it non-Quarkus for any reason, log `SKIPPED` and stop this module.
2. **Add the dependency** — `logging-bom` (import) + `logging-starter`, plus only the appenders the
   service needs (`logging-appenders-dynatrace` for OPS; `logging-appenders-pubsub` for AUDIT/BUSINESS
   if the service emits them). No per-module versions, no new transport libs (Log4j2/Logback).
3. **Configure `application.properties`** — `app.logging.formatter=ecs-json`,
   `app.logging.redaction.policy=strict`, and set `app.logging.entry-exit.packages` to the service's
   own root package. Keep `redaction.policy=off` confined to `%test`.
4. **Tier 2 is opt-in.** Tier 1 operational logging is automatic on dependency inclusion. Only add
   `GovernedLogger.audit()/security()/business()` calls at genuine audit/security/business action
   points.

## Hard constraints (carry over from the spec)

- **Redaction stays `strict`/`standard` outside test.** `off` in `prod` fails the build — never set it.
- **Never invent audit/security/business event codes.** New entries in the sealed event hierarchies
  require a `logging-events` PR + Compliance review (SPEC §7.2). If the service needs one, leave a
  `// TODO: governed-logging — new <Category> event needs logging-events PR + Compliance review` and
  report it. Do NOT route audit data through the operational path to dodge the gate.
- **Honour the migration skill's own rules** — never delete code you cannot migrate; don't break the
  build; document every decision.

## Compile gate

After applying, run the project's compile/package command (`./mvnw clean package -DskipTests` or
`./gradlew build -x test`). Fails → diagnose and fix before marking this module done.

## Report

Add a **Governed Logging** section to the migration report: dependency + appenders added,
`application.properties` keys set, Tier 2 call sites added (if any), and every deferred event code or
open question (SPEC §15) the service hit.
