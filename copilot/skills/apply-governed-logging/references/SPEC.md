# Governed Logging Library for Quarkus — Technical Specification

| Field | Value |
|---|---|
| **Status** | Draft v0.1 |
| **Author** | Nithyeswari (Wipro / Lloyds, ADE) |
| **Audience** | Platform engineering, library maintainers, consuming service teams |
| **Companion** | *Governed Logging Library — Options Paper, v0.2* |
| **Last updated** | 2026-04-23 |

---

## 1. Overview

This document specifies the implementation contract for the **Governed Logging Library**, a Quarkus extension that provides Lloyds engineering services with (a) automatic, compliance-aware operational logging on inclusion of the dependency and (b) an opt-in, type-state fluent API for domain-specific events. It is the build-side counterpart to the Options Paper which establishes the *why*; this document specifies the *what* and *how*.

The library is a thin façade over the existing Quarkus / JBoss LogManager stack. It does **not** introduce a new logging transport layer. It constrains the entry point.

---

## 2. Goals and non-goals

### 2.1 Goals

1. Every Quarkus service that includes the library emits structured, schema-consistent, ECS-aligned JSON logs by default with no application code changes.
2. Method entry/exit, unhandled exceptions, HTTP request/response (inbound and outbound), database operations, and messaging events are logged automatically with correlation context.
3. PII is redacted on the default path — opt-out is explicit, traceable, and reviewable.
4. Audit, security, business, and operational logs are routed to distinct sinks with distinct retention semantics.
5. Audit and security events are typed: their schemas are closed sealed hierarchies, reviewed by Compliance through a single artefact.
6. The fluent API uses staged builders so that omitting a mandatory field is a compile error, not a runtime issue.
7. The library is native-image clean and adds zero new third-party transport dependencies.

### 2.2 Non-goals

1. Replacing JBoss LogManager, SLF4J, or any existing transport.
2. Inventing a new wire format. ECS-aligned JSON is the contract.
3. Providing an appender for every conceivable destination. Appenders for Dynatrace, Pub/Sub, BigQuery, and SIEM are sufficient at v1.
4. Solving distributed tracing. The library propagates trace IDs and is OpenTelemetry-compatible but does not produce spans.
5. Solving metrics. Micrometer remains the metrics path.
6. Solving multi-language. The library targets Java + Quarkus only.

---

## 3. Architecture

### 3.1 Layered view

```
┌──────────────────────────────────────────────────────────────────┐
│                     Quarkus consuming service                    │
│            (CDI beans, JAX-RS resources, Rest Clients,           │
│              Hibernate entities, SmallRye consumers)             │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────┬─────────────────────────────────────┐
│   TIER 1 — Automatic       │   TIER 2 — Fluent API (opt-in)      │
│   (CDI interceptors,       │                                     │
│   JAX-RS filters,          │   GovernedLogger.audit()…           │
│   Rest Client / Hibernate  │   GovernedLogger.security()…        │
│   / SmallRye listeners)    │   GovernedLogger.business()…        │
│                            │   GovernedLogger.operational()…     │
└────────────────────────────┴─────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│                      Core pipeline                               │
│   LogEvent → Enrichers (correlation, tenant, trace, principal)   │
│            → Redaction filter (declarative policy)               │
│            → ECS-JSON formatter                                  │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│              JBoss LogManager (existing Quarkus default)         │
└──────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┬─────────────┐
              ▼               ▼               ▼             ▼
           OPS sink      AUDIT sink      SEC sink     BIZ sink
          (Dynatrace)    (BigQuery,      (SIEM)      (Dashboards)
                          7y retention)
```

### 3.2 Module structure

Modules are published as Maven artefacts under the group `com.lloyds.platform.logging`.

| Module | Artefact ID | Purpose | Depends on |
|---|---|---|---|
| API | `logging-api` | Pure interfaces; LogEvent model; SPI contracts. JDK only. | — |
| Core | `logging-core` | Default implementations of API; reference enrichers, formatter, redaction. | api, slf4j-api |
| Runtime | `logging-runtime` | Quarkus runtime: CDI producers, recorders. | core, quarkus-arc |
| Deployment | `logging-deployment` | Quarkus build steps: registers interceptors, validates config at build time. | runtime, quarkus-core-deployment |
| Interceptors | `logging-interceptors` | Tier 1: CDI entry/exit and exception interceptors; JAX-RS filter; Rest Client and HttpClient interceptors; Hibernate event listener; SmallRye interceptor. | runtime, quarkus-resteasy-reactive, quarkus-rest-client, quarkus-hibernate-orm, quarkus-smallrye-reactive-messaging |
| Enrichers (Correlation) | `logging-enrichers-correlation` | Correlation ID extraction/generation, propagation through ManagedExecutor. | runtime |
| Enrichers (Tenant) | `logging-enrichers-tenant` | Tenant context from header or JWT claim. | runtime |
| Enrichers (Trace) | `logging-enrichers-otel` | OpenTelemetry trace ID and span ID extraction. | runtime, quarkus-opentelemetry |
| Appenders (Dynatrace) | `logging-appenders-dynatrace` | OTLP appender targeting Dynatrace. | core |
| Appenders (Pub/Sub) | `logging-appenders-pubsub` | Google Cloud Pub/Sub appender for AUDIT/BUSINESS streams. | core |
| Test kit | `logging-junit5` | `@GovernedLoggingTest` JUnit extension; assertions over emitted events. | core, junit-jupiter-api |

The starter POM `logging-starter` aggregates `runtime`, `interceptors`, `enrichers-correlation`, and `enrichers-tenant` for the common case. Services add `logging-starter` and one or more appenders.

### 3.3 Hard rules

1. The `api` module MUST NOT depend on Quarkus, Jakarta CDI, or SLF4J. Its only allowed dependency is the JDK.
2. New capabilities MUST be added as new modules. The API module's surface is governed by semver.
3. The library MUST NOT register additional transport-level dependencies (Log4j2, Logback, etc.). All transport flows through JBoss LogManager.
4. Every interceptor MUST honour a `disabled-level` fast path so that disabled categories cost no allocation.
5. Every enricher MUST be safe to call from any thread that participates in Quarkus context propagation.

---

## 4. Public API — Tier 1 (configuration-driven)

Tier 1 has no Java surface visible to consuming code. It is configured exclusively through `application.properties` and observed through emitted log events.

### 4.1 Configuration root

All properties live under the namespace `app.logging.*` (configurable prefix; `app.logging` is the platform default).

### 4.2 Configuration classes (Quarkus `@ConfigMapping`)

```java
@ConfigMapping(prefix = "app.logging")
public interface GovernedLoggingConfig {

    EntryExitConfig entryExit();
    ExceptionsConfig exceptions();
    HttpConfig http();
    OutboundConfig outbound();
    DbConfig db();
    MessagingConfig messaging();
    RedactionConfig redaction();
    FormatterConfig formatter();
    AuditConfig audit();
    SecurityConfig security();
    BusinessConfig business();

    interface EntryExitConfig {
        @WithDefault("true")  boolean enabled();
        @WithDefault("com.lloyds")  List<String> packages();
        @WithDefault("")            List<String> excludePackages();
        @WithDefault("toString,equals,hashCode")
                                    List<String> excludeMethods();
        @WithDefault("TRACE")       Level entryLevel();
        @WithDefault("DEBUG")       Level exitLevel();
        @WithDefault("500ms")       Duration slowMethodThreshold();
        @WithDefault("strict")      RedactionStrictness argsRedaction();
    }

    interface ExceptionsConfig {
        @WithDefault("true")  boolean enabled();
        @WithDefault("true")  boolean logArguments();
        @WithDefault("30")    int stackDepth();
        Map<ExceptionCategory, Level> severity();
        Map<String, ExceptionCategory> mapping();
    }

    // ... (HttpConfig, OutboundConfig, DbConfig, MessagingConfig
    //      RedactionConfig, FormatterConfig, AuditConfig, SecurityConfig,
    //      BusinessConfig — see Appendix A of the Options Paper for full reference.)
}
```

Build-time validation in the deployment module:
- Every configured package is checked for at least one CDI bean.
- Every entry in `exceptions.mapping` is checked for class existence on the classpath.
- Every redaction `fields.mask` entry is checked against a curated list of known PII field names; unrecognised entries produce a build warning, not error.

---

## 5. Public API — Tier 2 (fluent)

### 5.1 Entry point

```java
package com.lloyds.platform.logging.api;

public interface GovernedLogger {
    AuditStage       audit();
    SecurityStage    security();
    BusinessStage    business();
    OperationalStage operational();
}
```

`GovernedLogger` is `@ApplicationScoped`. It is acquired via CDI injection. Static acquisition is not provided — request-scoped enrichment depends on container context.

```java
@Inject
GovernedLogger log;
```

### 5.2 Type-state staged builders

Each category has a sealed staged builder. `emit(...)` is only reachable on the final stage; preceding stages do not expose it.

#### 5.2.1 Audit

```java
public sealed interface AuditStage permits AuditStageImpl {
    /**
     * Selects the audit event from the closed AuditEvent hierarchy.
     * Required.
     * @return the next stage, on which fields can be set and emit() is reachable
     */
    AuditWithEvent event(AuditEvent event);
}

public sealed interface AuditWithEvent permits AuditWithEventImpl {
    AuditWithEvent withCustomer(Customer customer);
    AuditWithEvent withAmount(Money amount);
    AuditWithEvent withChannel(Channel channel);
    AuditWithEvent withActor(Principal actor);
    AuditWithEvent withRetention(Retention retention);
    /**
     * Adds a free-form attribute. The value type must be marked safe for logging
     * via @SafeLogField on its declaration, or the call is rejected at compile time
     * by the Error Prone rule and at runtime by a strict-mode guard.
     */
    AuditWithEvent attribute(String name, @SafeLogField Object value);

    /** Emits the audit event. The optional message is human-readable context. */
    void emit();
    void emit(String message);
}
```

#### 5.2.2 Security

```java
public sealed interface SecurityStage permits SecurityStageImpl {
    SecurityWithEvent event(SecurityEvent event);
}

public sealed interface SecurityWithEvent permits SecurityWithEventImpl {
    SecurityWithEvent withPrincipal(Principal principal);
    SecurityWithEvent withAttemptedPrincipal(String username);
    SecurityWithEvent withReason(Enum<?> reason);
    SecurityWithEvent withSourceIp(String ip);
    SecurityWithEvent withSeverity(Severity severity);
    SecurityWithEvent withTargetRole(String role);
    SecurityWithEvent attribute(String name, @SafeLogField Object value);
    void emit();
    void emit(String message);
}
```

#### 5.2.3 Business

```java
public sealed interface BusinessStage permits BusinessStageImpl {
    BusinessWithEvent event(BusinessEvent event);
}

public sealed interface BusinessWithEvent permits BusinessWithEventImpl {
    BusinessWithEvent withCustomer(Customer customer);
    BusinessWithEvent withRequestedAmount(Money amount);
    BusinessWithEvent withConfiguredLimit(Money limit);
    BusinessWithEvent withSeverity(Severity severity);
    BusinessWithEvent attribute(String name, @SafeLogField Object value);
    void emit();
    void emit(String message);
}
```

#### 5.2.4 Operational

The operational stage is more permissive than the audit/security/business stages because it covers situational logging that does not warrant a sealed event hierarchy. It still flows through redaction and the standard formatter.

```java
public sealed interface OperationalStage permits OperationalStageImpl {
    OperationalStage level(Level level);
    OperationalStage withException(Throwable t);
    OperationalStage withDuration(Duration d);
    OperationalStage withRetryHint(RetryHint hint);
    OperationalStage withContext(String name, @SafeLogField Object value);
    void emit(String message);
}
```

### 5.3 The `@SafeLogField` marker

A `@SafeLogField` annotation marks types or fields that are safe to log without redaction. Declared at the type level on domain types whose toString already excludes PII (e.g. `Money`, `Channel`, `OrderId`).

```java
@SafeLogField
public record Money(BigDecimal value, Currency currency) { ... }
```

When applied to a parameter of `attribute(...)` or `withContext(...)`, it instructs an Error Prone rule to verify the argument is a known safe type at compile time. At runtime, the redaction filter still inspects the value in `strict` mode for defensive depth.

---

## 6. The LogEvent model

The internal canonical representation that flows from the entry-point APIs through the pipeline to the formatter.

```java
public final class LogEvent {

    public enum Category { OPS, AUDIT, SECURITY, BUSINESS }

    private final Instant timestamp;
    private final Level level;
    private final Category category;
    private final String eventCode;        // null for OPS auto events
    private final String eventName;        // null for OPS auto events
    private final String eventType;        // "method.entry", "http.request", "operational.custom"
    private final String message;          // human-readable, may be null
    private final Map<String, Object> structuredFields;
    private final Throwable exception;     // nullable
    private final Context context;         // correlation, tenant, trace, principal
    private final Retention retention;     // YEARS_7 for audit, MONTHS_3 default for OPS
    private final String sourceClass;
    private final String sourceMethod;

    // ... immutable, thread-safe, builder via internal package
}
```

The `Context` carrier:

```java
public final class Context {
    public final String correlationId;     // never null after enrichment
    public final String tenant;             // nullable
    public final String traceId;            // nullable
    public final String spanId;             // nullable
    public final String principalId;        // nullable
    public final String hostName;           // populated by formatter
    public final String serviceName;        // populated by formatter
}
```

---

## 7. The audit event registry

### 7.1 Sealed hierarchy

```java
public sealed interface AuditEvent {
    /** Stable, hierarchical code: PAY.001, ONB.014, etc. */
    String code();
    /** Human-readable name, UPPER_SNAKE_CASE. */
    String eventName();
    /** Default retention for events of this kind. */
    Retention retention();
}

public enum PaymentEvent implements AuditEvent {
    PAYMENT_INITIATED   ("PAY.001", Retention.YEARS_7),
    PAYMENT_AUTHORISED  ("PAY.002", Retention.YEARS_7),
    PAYMENT_REJECTED    ("PAY.003", Retention.YEARS_7),
    PAYMENT_REVERSED    ("PAY.004", Retention.YEARS_7);
    // ...
}

public enum OnboardingEvent implements AuditEvent {
    ONB_KYC_SUBMITTED   ("ONB.001", Retention.YEARS_7),
    ONB_KYC_APPROVED    ("ONB.002", Retention.YEARS_7),
    // ...
}
```

`AuditEvent`, `SecurityEvent`, and `BusinessEvent` are each a sealed interface whose only permitted implementations are enums declared inside the `logging-events` module of the library.

### 7.2 Adding new events

1. PR against `logging-events` adds a new value to the relevant enum.
2. PR template requires the proposing team to fill: name, code, retention, owning service, compliance reviewer.
3. Compliance review SLA: 48 hours for fast-track, 2 weeks for batched quarterly review.
4. Merge triggers a minor version bump of the events module.

This is a deliberate friction point. Compliance must see every new audit event before it ships. The 48h fast-track exists for genuine urgency.

---

## 8. PII redaction policy

### 8.1 Declarative policy

Redaction is configured in `application.properties` and overlaid on a platform-default policy bundled with the library.

```properties
# Bundled default — strict mode
app.logging.redaction.policy=strict
app.logging.redaction.fields.mask=customerId,accountNumber,sortCode,email,phone,dob,nino,passport
app.logging.redaction.fields.last-chars-visible=4
app.logging.redaction.patterns.iban=^GB\\d{2}[A-Z]{4}\\d{14}$
```

### 8.2 Modes

| Mode | Behaviour |
|---|---|
| `strict` | All known PII field names are masked. Unknown fields are inspected against pattern rules (IBAN, NI number, email, card PAN). On match, value is masked. |
| `standard` | Known PII field names are masked; pattern matching disabled. |
| `off` | No redaction. Permitted only in test profile; fails build in `prod` profile. |

### 8.3 Redaction format

`C-****7421` — last four characters preserved for support reconciliation. Configurable; never exposes more than four characters by policy.

### 8.4 Redaction misses

A separate audit log stream records anonymised redaction misses (field name, declared type, no values) for ongoing policy tuning. This stream is reviewed by the DPO quarterly.

---

## 9. Context propagation

### 9.1 Correlation ID

- Extracted from the `x-correlation-id` header on inbound requests (header name configurable).
- If absent, generated as a UUIDv7 (time-ordered) and added to the response as the same header.
- Stored in `Context` for the duration of the request. Propagated across `ManagedExecutor` and `Mutiny` boundaries via Quarkus context propagation.
- Outbound HTTP and messaging interceptors automatically attach it.

### 9.2 Tenant

- Extracted from `x-tenant-id` header or JWT `tenant` claim; precedence configurable.
- Default precedence: JWT claim > header.

### 9.3 Trace and span IDs

- Pulled from the active OpenTelemetry context if the OTel extension is active.
- Field names follow OTel convention: `trace_id`, `span_id`.

### 9.4 Principal

- Extracted from the active `SecurityIdentity` if Quarkus Security is active.
- Only the principal **identifier** is logged by default (e.g. user UUID); name and email are subject to redaction.

---

## 10. Native image considerations

The library targets `quarkus-mandrel` native compilation cleanly. Specifically:

1. All reflection sites in interceptors are registered via `ReflectiveClassBuildItem` in the deployment module.
2. No dynamic proxy creation at runtime; CDI interceptor bindings are resolved at build time.
3. Hibernate event listener registration uses `HibernateOrmIntegrationStaticConfiguredBuildItem`.
4. JSON serialisation in the formatter uses Jackson (already on the Quarkus classpath); no Gson, no kotlinx.serialization.
5. Resource bundles (`META-INF/audit-events.properties` for human-readable event descriptions) are registered via `NativeImageResourceBuildItem`.
6. CI runs a Mandrel matrix per module on every PR.

---

## 11. Testing

### 11.1 Test kit (`logging-junit5`)

```java
@GovernedLoggingTest
class PaymentServiceTest {

    @Inject PaymentService service;
    @Inject LogEvents events;          // captured events for assertion

    @Test
    void emits_payment_initiated_audit_event() {
        service.process(samplePaymentRequest());

        assertThat(events.audit())
            .anyMatch(e -> e.eventName().equals("PAYMENT_INITIATED")
                       && e.field("customer.id").asText().startsWith("C-****"));

        assertThat(events.ops())
            .extracting(LogEvent::eventType)
            .contains("method.entry", "method.exit");
    }
}
```

The extension installs an in-memory appender, drains JBoss LogManager into `LogEvents`, and asserts after each test. PII redaction is validated automatically — any captured event whose `customer.id`, `accountNumber`, etc. is unredacted causes a test failure regardless of explicit assertions.

### 11.2 Property-based redaction tests

`logging-core` includes a jqwik-based property test suite that generates synthetic PII strings and asserts the redaction filter masks them per policy. This suite runs on every PR.

### 11.3 Compliance suite

A platform-level integration test that consumers can opt into via `@GovernedLoggingComplianceTest`. It exercises a representative set of operations against a service and asserts:

- Every method execution produces a paired entry/exit event with matching correlation.
- Every audit event has a code, name, retention, and tenant.
- No event exceeds the configured maximum field count.
- No event contains a string matching the pattern catalogue (IBAN, PAN, email).

---

## 12. Configuration reference

The complete property reference is in Appendix B of the Options Paper. This section lists only the properties that change behaviour materially across environments.

| Property | Default | Notes |
|---|---|---|
| `app.logging.entry-exit.enabled` | `true` | Set `false` only in services with extreme p99 sensitivity. |
| `app.logging.entry-exit.packages` | `com.lloyds` | Comma-separated package roots. |
| `app.logging.redaction.policy` | `strict` | `off` is forbidden in `prod` profile via build validation. |
| `app.logging.audit.sink` | `audit-stream` | Logical name; mapped to a concrete appender by service config. |
| `app.logging.formatter` | `ecs-json` | `pretty` available in dev profile. |

---

## 13. Versioning and compatibility

### 13.1 Semantic versioning

The `api` and `logging-events` modules follow strict semver. Breaking changes to a sealed event hierarchy require a major version bump of `logging-events`.

### 13.2 BOM

A `logging-bom` artefact pins compatible versions of all modules. Consuming services should import the BOM and not specify per-module versions.

### 13.3 Deprecation policy

Deprecated API surface is marked `@Deprecated(forRemoval = true, since = "x.y")` and retained for at least two minor versions before removal.

### 13.4 Quarkus version compatibility

| Library version | Quarkus version |
|---|---|
| 1.x | Quarkus 3.15 LTS |
| 2.x | Quarkus 3.20 LTS (planned) |

---

## 14. Build, release, distribution

1. The library is built and released by the Platform engineering team's CI pipeline.
2. Artefacts are published to the internal Nexus repository under `com.lloyds.platform.logging`.
3. Each release includes: built JARs, sources, javadoc, native-image reflection configs, and a signed checksums manifest.
4. Release notes follow a fixed template with sections: New, Changed, Deprecated, Removed, Fixed, Security, Compliance.
5. A standing change-advisory item is logged for every release that touches the redaction module or sealed event hierarchies.

---

## 15. Open questions

These items are deferred from the Options Paper and require resolution before Phase 1 begins.

1. **Owner.** Who in Platform engineering owns the library long-term? This must have a name before Phase 0 kicks off.
2. **Audit appender choice.** Pub/Sub vs direct BigQuery streaming — depends on the estate's existing audit pipeline contracts. Spike in Phase 0.
3. **Correlation ID format.** UUIDv7 (proposed) vs ULID vs the existing `x-request-id` GUID convention — needs a decision in Phase 0 to ensure consistency with non-Quarkus services.
4. **Tenant resolution precedence.** JWT claim vs header — confirm with the IAM team during Phase 0.
5. **Native-image perf cost.** Spike: measure Tier 1 interceptor overhead on a representative ADE service; agree p99 budget per interceptor (currently unset).
6. **Backwards-compatible migration path.** Services currently using `Logger logger = Logger.getLogger(...)` directly: do we provide a temporary bridge or insist on starter POM only?
7. **Event code namespace governance.** Who owns the `PAY.*`, `ONB.*`, `SEC.*` namespaces? Proposed: the originating product team owns the namespace, Compliance owns the schema. Confirm with Compliance.

---

## 16. Appendix — Pseudocode for the entry/exit interceptor

Illustrative, not normative.

```java
@Interceptor
@AutoLogged
@Priority(Interceptor.Priority.PLATFORM_BEFORE)
public class EntryExitInterceptor {

    @Inject GovernedLoggingConfig config;
    @Inject ContextEnricher enricher;
    @Inject RedactionFilter redactor;
    @Inject LogEventEmitter emitter;

    @AroundInvoke
    public Object intercept(InvocationContext ctx) throws Exception {
        if (!config.entryExit().enabled()) return ctx.proceed();
        if (excluded(ctx)) return ctx.proceed();

        Context context = enricher.current();
        long start = System.nanoTime();

        if (emitter.isEnabled(config.entryExit().entryLevel())) {
            emitter.emit(LogEvent.entry(
                ctx.getMethod(),
                redactor.redactArgs(ctx.getParameters()),
                context
            ));
        }

        try {
            Object result = ctx.proceed();
            emitExit(ctx, context, start, "success", null);
            return result;
        } catch (Throwable t) {
            emitExit(ctx, context, start, "exception", t);
            throw t;
        }
    }
}
```

---

*End of specification.*
