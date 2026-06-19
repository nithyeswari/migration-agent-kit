---
name: apply-governed-logging
description: Applies the Lloyds Governed Logging Library (a Quarkus extension) to a Quarkus service —
  adds the logging-starter dependency, configures compliance-aware structured logging with strict PII
  redaction, and wires audit/security/business sinks. Use when adding logging to a Quarkus service,
  when a service is added or migrated to Quarkus, or when the user mentions "governed logging",
  "structured logging", "audit logging", "ECS JSON logs", "PII redaction", or "logging-starter".
license: Apache-2.0
metadata:
  author: Nithyeswari (Wipro / Lloyds, ADE)
  spec: references/SPEC.md
---

# Apply Governed Logging to a Quarkus service

This skill applies the **Governed Logging Library** (`com.lloyds.platform.logging`) to a Quarkus
service. The full contract is in [references/SPEC.md](references/SPEC.md); this file is the
actionable procedure. Tier 1 (automatic operational logging) activates on dependency inclusion with
**no application code changes**; Tier 2 (the fluent audit/security/business API) is opt-in.

## When this applies (gate)

Run this skill against a service ONLY when it is a Quarkus service.

| Gate Check | Gate Result |
|---|---|
| Quarkus BOM + at least one Quarkus extension present in `pom.xml` / `build.gradle(.kts)` | **PASS** → apply |
| Java 21+ (library 1.x targets Quarkus 3.15 LTS) | **PASS** required; stop if < 21 |
| No Quarkus markers (still Spring, or non-JVM) | **SKIP** — log why; do not add the dependency |

Log the gate result as: `Gate result: <STATUS> and <CONDITION_EVALUATED>`.

## Critical rules

- **Never weaken redaction.** `app.logging.redaction.policy` MUST be `strict` (or `standard`) for any
  non-test profile. `off` is forbidden in the `prod` profile and fails the build — never set it to
  silence noise.
- **Never add audit/security/business event codes yourself.** New entries in the sealed `AuditEvent` /
  `SecurityEvent` / `BusinessEvent` hierarchies require a PR to the `logging-events` module with a
  Compliance reviewer (SPEC §7.2). If a service needs a new event code, STOP and leave a
  `// TODO: governed-logging — new <Category> event needs logging-events PR + Compliance review` and
  surface it in your summary. Do not invent codes or log audit data through the operational path to
  work around the gate.
- **Use the starter, not raw loggers.** Do not add Log4j2/Logback or new transport dependencies — all
  transport flows through JBoss LogManager (SPEC §3.3). Prefer the `logging-starter` BOM-managed
  dependency over per-module versions.
- **Only log `@SafeLogField` values via the fluent API.** `attribute(...)` / `withContext(...)` accept
  only types/fields marked `@SafeLogField`; passing anything else is a compile-time (Error Prone) and
  strict-mode runtime rejection. Do not strip the annotation requirement.
- **Don't break the build.** Compile after adding the dependency and after each config change.

## Step 1 — Add the dependency

Import the BOM and add the starter plus the appropriate appender. Do not pin per-module versions.

**Maven** (`pom.xml`):
```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.lloyds.platform.logging</groupId>
      <artifactId>logging-bom</artifactId>
      <version>${governed-logging.version}</version>   <!-- 1.x for Quarkus 3.15 LTS -->
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>

<dependencies>
  <dependency>
    <groupId>com.lloyds.platform.logging</groupId>
    <artifactId>logging-starter</artifactId>   <!-- runtime + interceptors + correlation + tenant enrichers -->
  </dependency>
  <!-- Choose appenders the service actually needs: -->
  <dependency>
    <groupId>com.lloyds.platform.logging</groupId>
    <artifactId>logging-appenders-dynatrace</artifactId>  <!-- OPS sink -->
  </dependency>
  <!-- logging-appenders-pubsub for AUDIT/BUSINESS streams; add only if the service emits them -->
</dependencies>
```

**Gradle** (`build.gradle(.kts)`):
```kotlin
implementation(platform("com.lloyds.platform.logging:logging-bom:1.x"))
implementation("com.lloyds.platform.logging:logging-starter")
implementation("com.lloyds.platform.logging:logging-appenders-dynatrace")
```

Add `logging-enrichers-otel` only if the service already uses `quarkus-opentelemetry`. Add
`logging-junit5` to `test` scope to enable the compliance test kit.

## Step 2 — Configure `application.properties`

Tier 1 works on defaults, but set these explicitly so behaviour is reviewable. See the configuration
reference in SPEC §12 and §4.

```properties
# --- Formatter & redaction (compliance-critical) ---
app.logging.formatter=ecs-json
app.logging.redaction.policy=strict
app.logging.redaction.fields.last-chars-visible=4

# --- Tier 1 automatic logging ---
app.logging.entry-exit.enabled=true
app.logging.entry-exit.packages=<service root package, e.g. com.lloyds.payments>
# app.logging.entry-exit.enabled=false   # ONLY for services with extreme p99 sensitivity, with sign-off

# --- Sinks (logical names mapped to concrete appenders by deployment config) ---
app.logging.audit.sink=audit-stream

# --- Dev-only conveniences (NEVER in prod) ---
%dev.app.logging.formatter=pretty
%test.app.logging.redaction.policy=off
```

Set `app.logging.entry-exit.packages` to the service's own root package(s) — the `com.lloyds` default
is broad. Build-time validation will warn if a configured package has no CDI bean.

## Step 3 — Wire Tier 2 events where they belong (opt-in)

Tier 1 covers operational logging automatically. Add Tier 2 fluent calls only at the points the
service performs an auditable/security/business action. Inject the logger:

```java
@Inject GovernedLogger log;
```

Audit example (event code must already exist in `logging-events` — see Critical rules):
```java
log.audit()
   .event(PaymentEvent.PAYMENT_INITIATED)
   .withCustomer(customer)
   .withAmount(amount)
   .withChannel(channel)
   .emit("payment accepted for processing");
```

Operational example (no sealed event hierarchy; still redacted + formatted):
```java
log.operational()
   .level(Level.WARN)
   .withRetryHint(RetryHint.BACKOFF)
   .withContext("downstream", serviceName)   // serviceName type must be @SafeLogField
   .emit("downstream call degraded");
```

Mark domain value types whose `toString` excludes PII with `@SafeLogField` so they can pass through
`attribute(...)` / `withContext(...)`:
```java
@SafeLogField
public record Money(BigDecimal value, Currency currency) { }
```

## Step 4 — Verify

| # | Check | How | Pass criteria |
|---|-------|-----|---------------|
| 1 | Builds | `./mvnw clean package -DskipTests` / `./gradlew build -x test` | Exit 0 |
| 2 | Starter present | Search build file for `logging-starter` | Present, BOM-managed (no hardcoded version) |
| 3 | Redaction safe | Search `application.properties` for `redaction.policy` | `strict`/`standard` in prod; `off` only under `%test` |
| 4 | No rogue transport | Search build file for `log4j`, `logback`, `ch.qos` | None added by this change |
| 5 | Emits ECS-JSON | `./mvnw quarkus:dev`, hit an endpoint | Logs are structured JSON with `correlationId`; PII fields show `*****NNNN` |
| 6 | Compliance suite (if events added) | `@GovernedLoggingComplianceTest` / `logging-junit5` | Every audit event has code, name, retention, tenant; no PII pattern leaks |

## Step 5 — Report

Summarise: dependency + appenders added, `application.properties` keys set, any Tier 2 call sites
added, and — critically — any **deferred audit/security/business event codes** left as TODOs awaiting a
`logging-events` PR + Compliance review. List every open question from SPEC §15 that the service hits
(e.g. correlation ID format, tenant precedence) so they are not silently assumed.
