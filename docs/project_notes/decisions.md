# Architectural Decisions

This file logs architectural decisions (ADRs) with context and trade-offs.

## Format

- **ADR Number and Title** (YYYY-MM-DD)
- **Context**: Why the decision was needed
- **Decision**: What was chosen
- **Alternatives Considered**: Other options and why rejected
- **Consequences**: Trade-offs (use checkmarks for clarity)

---

## Entries

### ADR-001: Modular Backend Architecture (2025-01)

**Context:**
- `server.js` was growing too large (1000+ lines)
- Hard to maintain, test, and understand
- Need clear separation of concerns

**Decision:**
- Extract into `lib/` modules with focused responsibilities
- Each module handles one concern (config, influx, schema, oee, ai, cmms)
- Clear dependency hierarchy documented in CLAUDE.md

**Alternatives Considered:**
- Single file approach -> Rejected: unmaintainable at scale
- Microservices -> Rejected: overkill for this project, deployment complexity
- Full MVC framework -> Rejected: too much boilerplate for real-time dashboard

**Consequences:**
- Easier to understand and maintain
- Clear module boundaries
- Better testability
- Deployment requires `docker cp` for lib/ folder (not bind-mounted)

---

### ADR-002: InfluxDB for Time-Series Data (2025-01)

**Context:**
- Need to store high-frequency MQTT sensor data
- Require efficient time-range queries for trend analysis
- Need aggregation functions (mean, max, min)

**Decision:**
- Use InfluxDB 2.7 with Flux query language
- Store in `factory` bucket with tags: enterprise, site, area, machine, full_topic

**Alternatives Considered:**
- PostgreSQL with TimescaleDB -> Rejected: more complex setup
- Plain PostgreSQL -> Rejected: inefficient for time-series queries
- Redis -> Rejected: limited query capabilities

**Consequences:**
- Excellent query performance for time ranges
- Built-in aggregation and downsampling
- Flux query language has learning curve
- Docker-based local development

---

### ADR-003: Tier-Based OEE Calculation (2025-01)

**Context:**
- Different factories report OEE data differently
- Some have direct OEE metrics, others have components (availability, performance, quality)
- Some have related metrics that can estimate OEE

**Decision:**
- Implement tier-based OEE system:
  - Tier 1: Direct OEE measurement (highest confidence)
  - Tier 2: Calculated from A/P/Q components
  - Tier 3: Estimated from related metrics
- Return calculation metadata (tier, method, confidence)

**Alternatives Considered:**
- Single calculation method -> Rejected: doesn't work across all enterprises
- Separate endpoints per enterprise -> Rejected: inconsistent API

**Consequences:**
- Works across all factory configurations
- Transparent about data quality (confidence scores)
- More complex implementation
- API returns rich metadata for debugging

---

### ADR-004: ChromaDB for Anomaly Persistence (2025-01)

**Context:**
- AI detects anomalies that should be remembered
- Need semantic search for similar past anomalies
- Want RAG capabilities for contextual analysis

**Decision:**
- Use ChromaDB as vector database for anomaly embeddings
- Store anomaly descriptions with metadata

**Alternatives Considered:**
- SQLite -> Rejected: no semantic search
- Pinecone -> Rejected: external service, cost, complexity
- Redis with RediSearch -> Rejected: limited embedding support

**Consequences:**
- Local-first, no external dependencies
- Semantic search for similar anomalies
- RAG pipeline for AI context enrichment
- Additional storage and memory requirements

---

### ADR-005: Sparkplug B Protocol Support (2025-01)

**Context:**
- Need to support industrial MQTT data from various sources
- Sparkplug B is an industry standard for MQTT in IIoT
- Universal ingestion for different factory configurations

**Decision:**
- Add Sparkplug B decoder for MQTT messages
- Detect protocol automatically based on topic pattern
- Parse Sparkplug B payloads into standard format

**Alternatives Considered:**
- Only plain MQTT -> Rejected: limits factory compatibility
- Custom protocol per factory -> Rejected: not scalable

**Consequences:**
- Wider factory compatibility
- More complex message parsing
- Additional dependency (sparkplug-payload)
- Need to install in container after recreation

<!-- Add new decisions above this line -->
