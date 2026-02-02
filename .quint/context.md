# Bounded Context

## Vocabulary

- **Bug**: A defect in code causing incorrect behavior. UI/UX
- **Bug**: Frontend issue affecting user experience (XSS, memory leak, rendering, accessibility). Backend
- **Bug**: Server-side issue (race condition, unhandled promise, data loss, resource leak). Bug-Finding
- **System**: A comprehensive approach to systematically discover, track, and fix bugs across the full stack.
- **Regression**: A bug introduced by fixing another bug. Test
- **Coverage**: Percentage of code paths exercised by automated tests.

## Invariants

1. Bug fixes must not introduce regressions.
2. Security vulnerabilities (XSS, injection) take highest priority.
3. Memory leaks degrade production over time and must be addressed.
4. The system has zero test coverage currently.
5. No linting or static analysis exists.
6. Production is deployed via GitHub Actions to ECS Fargate (backend) and S3/CloudFront (frontend).
7. The project is JavaScript/Node.js (no TypeScript).
8. Conference demo deadline exists (ProveIt! 2026).
