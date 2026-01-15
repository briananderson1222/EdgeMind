---
id: 2026-01-14-external-sqlite-local-database.md
type: external
target: sqlite-local-database
verdict: pass
assurance_level: L2
carrier_ref: test-runner
valid_until: 2026-04-14
date: 2026-01-14
content_hash: aa76f61fe3754a06d568aa75fdfaa014
---

Research reveals Docker compatibility issues: (1) better-sqlite3 has known MUSL vs GLIBC incompatibility on Alpine Linux. (2) Current EdgeMind Docker uses node:18-slim (Debian-based) which should work. (3) Requires multi-stage build or build-from-source in container. (4) Native module compilation adds ~30s to Docker build. (5) File-based storage works in single container but complicates horizontal scaling. Conclusion: Viable for current single-instance deployment but creates migration friction for AgentCore distributed runtime.