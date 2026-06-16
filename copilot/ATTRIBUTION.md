# Attribution — bundled third-party skills

This kit bundles agent skills from Quarkus projects. All are Apache-2.0.

## 1. Official migration skill
- Skill:    migrate-spring-to-quarkus
- Source:   https://github.com/quarkusio/skills  (skills/migrate-spring-to-quarkus/)
- Licence:  Apache-2.0
- Author:   Quarkus Community — https://github.com/quarkusio/quarkus
- Reproduced unmodified, including its modules/ and references/ files.

## 2. Quarkus framework-development skills
- Source:   https://github.com/quarkusio/quarkus  (.agents/skills/)
- Commit:   65f3e2bfde9e61be8f17700fc159a45f5c4ed272
- Licence:  Apache-2.0
- Copyright: Red Hat, Inc. and the Quarkus contributors
- Skills (reproduced unmodified):
    building-and-testing          classloading-and-runtime-dev
    building-docs                 coding-style
    creating-extensions           pull-requests
    working-with-config           writing-build-steps
    writing-extension-devui       writing-tests
- These target CONTRIBUTING TO the Quarkus framework, distinct from migrating an
  app to Quarkus.

## Original to this kit (not third-party)
- OPENREWRITE-RECIPES.md (verified OpenRewrite Spring->Quarkus commands)
- react-modernization plugin (modernize-react skill, agent)
- sdlc-toolkit plugin (peer-review, sdlc-workflow skills, reviewer agent, MCP config)
- the standalone Python/Node harness

Apache-2.0 permits redistribution provided this notice and the licence are
retained. Keep this file with the bundle if you republish it.
