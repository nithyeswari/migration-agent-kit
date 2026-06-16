# OpenRewrite recipes — Spring Boot → Quarkus

This is the runnable reference the migration skill points at. It uses the
official `rewrite-spring-to-quarkus` module — you do **not** need to hand-write
recipes.

- Module:  `org.openrewrite.recipe:rewrite-spring-to-quarkus`  (latest `0.10.0`)
- Top recipe:  `org.openrewrite.quarkus.spring.SpringBootToQuarkus`
- Plugin:  `org.openrewrite.maven:rewrite-maven-plugin:6.41.0`

> Licence note: these recipes are under the **Moderne Source Available
> Licence**, not Apache-2.0. Fine to run locally/in CI; check the terms before
> running them at scale through the Moderne SaaS. Worth a quick legal/OSS-review
> sign-off in a regulated shop.

## Precondition — be on Spring Boot 3.x first

The composite recipe only fires when the module depends on
`org.springframework.boot:spring-*` at version **3.x**. If you're on Boot 2.x,
run the Spring upgrade recipe first, then this one:

    org.openrewrite.java.spring.boot3.UpgradeSpringBoot_3_3   # rewrite-spring
    org.openrewrite.quarkus.spring.SpringBootToQuarkus        # this module

## The two ways to run it

### A. Zero-config, command line (no pom changes) — matches the harness's dry-run

    # PREVIEW (this is what the harness's run_openrewrite does by default)
    mvn -U org.openrewrite.maven:rewrite-maven-plugin:dryRun \
        -Drewrite.recipeArtifactCoordinates=org.openrewrite.recipe:rewrite-spring-to-quarkus:RELEASE \
        -Drewrite.activeRecipes=org.openrewrite.quarkus.spring.SpringBootToQuarkus

    # APPLY
    mvn -U org.openrewrite.maven:rewrite-maven-plugin:run \
        -Drewrite.recipeArtifactCoordinates=org.openrewrite.recipe:rewrite-spring-to-quarkus:RELEASE \
        -Drewrite.activeRecipes=org.openrewrite.quarkus.spring.SpringBootToQuarkus

`dryRun` writes a patch to `target/rewrite/rewrite.patch` for review before you
ever touch the tree — that's the gate the agent loop relies on.

### B. Pinned in pom.xml (reproducible in CI)

```xml
<plugin>
  <groupId>org.openrewrite.maven</groupId>
  <artifactId>rewrite-maven-plugin</artifactId>
  <version>6.41.0</version>
  <configuration>
    <exportDatatables>true</exportDatatables>
    <activeRecipes>
      <recipe>org.openrewrite.quarkus.spring.SpringBootToQuarkus</recipe>
    </activeRecipes>
  </configuration>
  <dependencies>
    <dependency>
      <groupId>org.openrewrite.recipe</groupId>
      <artifactId>rewrite-spring-to-quarkus</artifactId>
      <version>0.10.0</version>
    </dependency>
  </dependencies>
</plugin>
```

Then `mvn rewrite:dryRun` / `mvn rewrite:run`.

Gradle: apply `id("org.openrewrite.rewrite")`, add
`rewrite("org.openrewrite.recipe:rewrite-spring-to-quarkus:0.10.0")`,
`activeRecipe("org.openrewrite.quarkus.spring.SpringBootToQuarkus")`,
then `gradle rewriteRun`.

Moderne CLI: `mod run . --recipe SpringBootToQuarkus`.

## What the composite actually does (the sub-recipes)

The single `SpringBootToQuarkus` recipe runs all of these in order. Pull any of
them out individually if you'd rather migrate in slices.

| Area              | Recipe (org.openrewrite.quarkus.spring.*)        | Effect |
|-------------------|--------------------------------------------------|--------|
| BOM               | (AddManagedDependency `quarkus-bom` 3.x)         | Adds Quarkus platform BOM |
| Build plugin      | `MigrateMavenPlugin`                             | Spring Boot plugin → quarkus-maven-plugin |
| Parent POM        | `RemoveSpringBootParent`                         | Drops the Boot 3.x parent |
| Starters          | `MigrateBootStarters`                            | `spring-boot-starter-*` → Quarkus extensions |
| DB drivers        | `MigrateDatabaseDrivers`                         | JDBC drivers → Quarkus JDBC extensions |
| Main class        | `ReplaceSpringBootApplication` + `SpringApplicationRunToQuarkusRun` | `@SpringBootApplication`/`SpringApplication.run` → Quarkus |
| Stereotypes       | `StereotypeAnnotationsToCdi`                     | `@Service`/`@Component`/`@Repository` → CDI |
| Web layer         | `WebToJaxRs`                                     | `@RestController`/`@RequestMapping` → JAX-RS |
| Response type     | `ResponseEntityToJaxRsResponse`                 | `ResponseEntity` → JAX-RS `Response` |
| Config injection  | `ValueToCdiConfigProperty`                      | `@Value` → `@ConfigProperty` |
| Config classes    | `MigrateConfigurationProperties`                | `@ConfigurationProperties` → `@ConfigMapping` |
| `@EnableXyz`      | `EnableAnnotationsToQuarkusDependencies`        | Maps enable-annotations to extensions |
| Spring compat     | `AddSpringCompatibilityExtensions`              | Adds `quarkus-spring-*` compat where 1:1 doesn't exist |
| Validation        | `MigrateSpringValidation`                        | Bean Validation → Quarkus Hibernate Validator |
| Transactions      | `MigrateSpringTransactional`                     | Spring `@Transactional` → Jakarta `@Transactional` |
| Events            | `MigrateSpringEvents`                            | Spring events → CDI events |
| Actuator          | `MigrateSpringActuator`                          | Actuator → SmallRye Health/Metrics |
| Testing           | `MigrateSpringTesting`                           | Boot tests → `@QuarkusTest` JUnit 5 |
| JPA → Panache     | `MigrateEntitiesToPanache`                       | JPA entities → Panache (Active Record) |
| Cloud config      | `MigrateSpringCloudConfig`                        | Spring Cloud Config → Quarkus Config |
| Service discovery | `MigrateSpringCloudServiceDiscovery`            | → Quarkus equivalents |
| DevTools          | `MigrateSpringBootDevTools`                       | Removes DevTools |

## Run a SUBSET — a custom composite (this is the "configurable" bit)

Drop a `rewrite.yml` at the repo root and activate your own recipe name. Here we
do the mechanical web + DI + config changes but deliberately SKIP the Panache
entity rewrite (often the riskiest, most review-heavy step):

```yaml
# rewrite.yml
type: specs.openrewrite.org/v1beta/recipe
name: com.lloyds.ade.QuarkusMigrationSafeSubset
displayName: SB→Quarkus (mechanical subset, no Panache)
recipeList:
  - org.openrewrite.quarkus.spring.MigrateBootStarters
  - org.openrewrite.quarkus.spring.WebToJaxRs
  - org.openrewrite.quarkus.spring.ValueToCdiConfigProperty
  - org.openrewrite.quarkus.spring.StereotypeAnnotationsToCdi
  - org.openrewrite.quarkus.spring.MigrateSpringTransactional
  - org.openrewrite.quarkus.spring.MigrateSpringValidation
```

Activate it via `-Drewrite.activeRecipes=com.lloyds.ade.QuarkusMigrationSafeSubset`
(still passing the `recipeArtifactCoordinates` so the sub-recipes resolve), or
list it under `agent.tools → run_openrewrite.recipes` in `migration.yaml`.

## After the framework swap — version + Java upgrades

`SpringBootToQuarkus` lands you on Quarkus 3.x. For subsequent Quarkus version
bumps and the Java 21 move, chain these (separate run):

    org.openrewrite.quarkus.migratetoquarkus_v3_37_0   # Quarkus Updates aggregate
    org.openrewrite.java.migrate.UpgradeToJava21       # rewrite-migrate-java

## What it will NOT do (still needs a human + the build-test loop)

- Reactive semantics: WebFlux/Reactor → Mutiny is partial; review threading.
- Security: Spring Security config rarely maps 1:1 — expect manual OIDC wiring.
- Anything behind reflection, SpEL, or custom Boot auto-configuration.
- Profiles and externalised property semantics differ; verify each environment.

That's exactly why the agent loop runs `build_module` + `run_tests` after the
recipe pass and self-heals from the first failure rather than trusting the
recipe blindly.
