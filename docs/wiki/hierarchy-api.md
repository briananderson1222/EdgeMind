# Schema Hierarchy API

Returns the full factory topic hierarchy as a tree structure, from enterprise down to individual measurements. The frontend dashboard uses this endpoint to understand the factory topology and render navigation.

**Endpoint:** `GET /api/schema/hierarchy`

| Environment | URL |
|---|---|
| Local | `http://localhost:3000/api/schema/hierarchy` |
| Production | `https://edge-mind.concept-reply-sandbox.com/api/schema/hierarchy` |

No query parameters. No authentication required.

---

## Response Structure

The response contains a nested tree: **Enterprise > Site > Area > Machine > Measurements**. Each level includes a `totalCount` representing data points received in the last hour.

```json
{
  "hierarchy": {
    "<enterprise_name>": {
      "totalCount": 12345,
      "sites": {
        "<site_name>": {
          "totalCount": 6789,
          "areas": {
            "<area_name>": {
              "totalCount": 3456,
              "machines": {
                "<machine_name>": {
                  "totalCount": 1234,
                  "measurements": ["metric_oee", "metric_temperature", "status_running"]
                }
              }
            }
          }
        }
      }
    }
  },
  "lastUpdated": "2026-02-02T12:00:00.000Z",
  "cached": true,
  "cacheAge": 120000
}
```

### Top-Level Fields

| Field | Type | Description |
|---|---|---|
| `hierarchy` | `object` | Object keyed by enterprise name. Each enterprise contains nested sites, areas, machines, and measurements. |
| `lastUpdated` | `string \| null` | ISO 8601 timestamp of when the cache was last refreshed. `null` if never refreshed. |
| `cached` | `boolean` | Always `true` for HTTP responses. Data is always served from cache. |
| `cacheAge` | `number` | Milliseconds since the cache was last refreshed. Use this to determine data freshness. |

### Tree Levels

| Level | Contains | Description |
|---|---|---|
| Enterprise | `totalCount` + `sites` object | Aggregated count from all sites within the enterprise. |
| Site | `totalCount` + `areas` object | Aggregated count from all areas within the site. |
| Area | `totalCount` + `machines` object | Aggregated count from all machines within the area. |
| Machine | `totalCount` + `measurements` array | Count for this machine, plus an array of measurement name strings. |

---

## Caching Behavior

The endpoint caches InfluxDB query results for **5 minutes**. Here is how caching works in practice:

- **Normal operation:** Requests within the 5-minute TTL return cached data instantly. When a request arrives after the TTL expires, a background refresh is triggered and the result is cached.
- **Refresh failure with existing cache:** The stale cached data is returned. No error is raised.
- **Refresh failure with no cache:** A `500` error is returned (see [Error Response](#error-response)).
- **Concurrent requests during refresh:** All requests share the same in-flight query. This prevents thundering herd problems when multiple clients hit the endpoint simultaneously.

---

## Data Source

Under the hood, the endpoint queries InfluxDB for the **last 1 hour** of data, grouped by enterprise, site, area, machine, and measurement. The `totalCount` at each level represents data points received in that 1-hour window.

MQTT topics from the virtual factory follow this naming pattern:

```
Enterprise {A|B|C}/Site{N}/area/machine/component/metric/type
```

For example:
- `Enterprise A/Dallas Line 1/packaging/.../metric/oee`
- `Enterprise B/Site3/palletizing/palletizermanual01/workstation/metric/oee`

---

## Error Response

Returned when the hierarchy cannot be built and no cached data is available.

**HTTP Status:** `500`

```json
{
  "error": "Failed to query schema hierarchy",
  "message": "<error details>"
}
```

---

## Examples

### curl

```bash
$ curl http://localhost:3000/api/schema/hierarchy
```

### JavaScript (fetch)

```javascript
const response = await fetch('/api/schema/hierarchy');
const { hierarchy, lastUpdated, cacheAge } = await response.json();

for (const [enterprise, data] of Object.entries(hierarchy)) {
  console.log(`${enterprise}: ${data.totalCount} data points`);

  for (const [site, siteData] of Object.entries(data.sites)) {
    console.log(`  ${site}: ${siteData.totalCount} data points`);

    for (const [area, areaData] of Object.entries(siteData.areas)) {
      console.log(`    ${area}: ${areaData.totalCount} data points`);

      for (const [machine, machineData] of Object.entries(areaData.machines)) {
        console.log(`      ${machine}: ${machineData.totalCount} points, measurements: ${machineData.measurements.join(', ')}`);
      }
    }
  }
}
```

### Python (requests)

```python
import requests

resp = requests.get("http://localhost:3000/api/schema/hierarchy")
data = resp.json()

for enterprise, edata in data["hierarchy"].items():
    print(f"{enterprise}: {edata['totalCount']} data points")
    for site, sdata in edata["sites"].items():
        print(f"  {site}: {sdata['totalCount']} data points")
```

---

## Related Endpoints

| Endpoint | Description |
|---|---|
| `GET /api/schema/measurements` | Flat list of all measurements with metadata (count, value type, sample values). |
| `GET /api/oee/discovery` | Discovered OEE schema showing available measurements per enterprise. |
| `GET /api/factory/status` | Hierarchical OEE status by enterprise and site. |
