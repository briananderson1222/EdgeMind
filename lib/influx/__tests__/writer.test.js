/**
 * @file writer.test.js
 * @description Tests for InfluxDB writer utilities
 */

const {
  normalizeTag,
  ENTERPRISE_ALIASES,
  SITE_ALIASES,
  parseTopicToInflux,
  writeSparkplugMetric
} = require('../writer');
const { Point } = require('@influxdata/influxdb-client');

describe('normalizeTag', () => {
  test('exact alias match - AVEVA Enterprise A', () => {
    expect(normalizeTag('AVEVA Enterprise A', ENTERPRISE_ALIASES)).toBe('Enterprise A');
  });

  test('exact alias match - AVEVA Enterprise B', () => {
    expect(normalizeTag('AVEVA Enterprise B', ENTERPRISE_ALIASES)).toBe('Enterprise B');
  });

  test('exact alias match - AVEVA Enterprise C', () => {
    expect(normalizeTag('AVEVA Enterprise C', ENTERPRISE_ALIASES)).toBe('Enterprise C');
  });

  test('site alias - AVEVA - DALLAS', () => {
    expect(normalizeTag('AVEVA - DALLAS', SITE_ALIASES)).toBe('Dallas Line 1');
  });

  test('non-aliased value passes through', () => {
    expect(normalizeTag('Custom Enterprise', {})).toBe('Custom Enterprise');
  });

  test('null returns "unknown"', () => {
    expect(normalizeTag(null, {})).toBe('unknown');
  });

  test('undefined returns "unknown"', () => {
    expect(normalizeTag(undefined, {})).toBe('unknown');
  });

  test('non-string returns the value itself (123)', () => {
    // normalizeTag returns value || 'unknown', so non-string 123 returns 123
    expect(normalizeTag(123, {})).toBe(123);
  });

  test('empty string returns "unknown"', () => {
    // normalizeTag returns value || 'unknown', so empty string returns 'unknown'
    expect(normalizeTag('', {})).toBe('unknown');
  });
});

describe('parseTopicToInflux', () => {
  test('standard topic creates Point with correct tags and numeric payload', () => {
    const topic = 'Enterprise A/Dallas Line 1/packaging/machine1/quality/oee';
    const payload = '72.5';
    const point = parseTopicToInflux(topic, payload);

    // Point.toLineProtocol() needs a WritePrecision parameter
    // We'll use 'ns' (nanoseconds) which is what the writeApi uses
    const lineProtocol = point.toLineProtocol({ precision: 'ns' });

    // Line protocol format: measurement,tag1=value1,tag2=value2 field1=value1 timestamp
    expect(lineProtocol).toContain('quality_oee');
    expect(lineProtocol).toContain('enterprise=Enterprise\\ A');
    expect(lineProtocol).toContain('site=Dallas\\ Line\\ 1');
    expect(lineProtocol).toContain('area=packaging');
    expect(lineProtocol).toContain('machine=machine1');
    expect(lineProtocol).toContain('value=72.5');
  });

  test('numeric payload creates float field', () => {
    const topic = 'Enterprise A/Site1/area1/machine1/temp/sensor';
    const payload = '25.5';
    const point = parseTopicToInflux(topic, payload);

    const lineProtocol = point.toLineProtocol({ precision: 'ns' });
    expect(lineProtocol).toContain('value=25.5');
  });

  test('string payload creates string field', () => {
    const topic = 'Enterprise A/Site1/area1/machine1/status/state';
    const payload = 'running';
    const point = parseTopicToInflux(topic, payload);

    const lineProtocol = point.toLineProtocol({ precision: 'ns' });
    expect(lineProtocol).toContain('value="running"');
  });

  test('AVEVA enterprise alias normalization', () => {
    const topic = 'AVEVA Enterprise A/Site1/area1/machine1/temp/sensor';
    const payload = '25';
    const point = parseTopicToInflux(topic, payload);

    const lineProtocol = point.toLineProtocol({ precision: 'ns' });
    expect(lineProtocol).toContain('enterprise=Enterprise\\ A');
  });

  test('source option adds source tag', () => {
    const topic = 'Enterprise A/Site1/area1/machine1/temp/sensor';
    const payload = '25';
    const point = parseTopicToInflux(topic, payload, { source: 'demo-injected' });

    const lineProtocol = point.toLineProtocol({ precision: 'ns' });
    expect(lineProtocol).toContain('source=demo-injected');
  });

  test('short topic (fewer than 7 parts) handles gracefully', () => {
    const topic = 'Enterprise A/Site1';
    const payload = '42';
    const point = parseTopicToInflux(topic, payload);

    const lineProtocol = point.toLineProtocol({ precision: 'ns' });
    // Should still create a valid point with 'unknown' for missing parts
    expect(lineProtocol).toContain('enterprise=Enterprise\\ A');
    expect(lineProtocol).toContain('site=Site1');
    expect(lineProtocol).toContain('area=unknown');
    expect(lineProtocol).toContain('machine=unknown');
  });

  test('special characters in measurement name are replaced with underscore', () => {
    const topic = 'Enterprise A/Site1/area1/machine1/metric-name/value.raw';
    const payload = '10';
    const point = parseTopicToInflux(topic, payload);

    const lineProtocol = point.toLineProtocol({ precision: 'ns' });
    expect(lineProtocol).toContain('metric_name_value_raw');
  });

  test('full_topic tag is preserved', () => {
    const topic = 'Enterprise A/Dallas Line 1/packaging/machine1/quality/oee';
    const payload = '72.5';
    const point = parseTopicToInflux(topic, payload);

    const lineProtocol = point.toLineProtocol({ precision: 'ns' });
    // full_topic should be in the line protocol
    expect(lineProtocol).toContain('full_topic=');
  });

  test('long string payload is truncated to 200 chars', () => {
    const topic = 'Enterprise A/Site1/area1/machine1/log/message';
    const payload = 'x'.repeat(300);
    const point = parseTopicToInflux(topic, payload);

    const lineProtocol = point.toLineProtocol({ precision: 'ns' });
    // The value should be truncated
    const match = lineProtocol.match(/value="(x+)"/);
    expect(match).not.toBeNull();
    expect(match[1].length).toBe(200);
  });

  test('site alias normalization', () => {
    const topic = 'Enterprise A/AVEVA - DALLAS/area1/machine1/temp/sensor';
    const payload = '25';
    const point = parseTopicToInflux(topic, payload);

    const lineProtocol = point.toLineProtocol({ precision: 'ns' });
    expect(lineProtocol).toContain('site=Dallas\\ Line\\ 1');
  });

  test('empty string payload treated as string field', () => {
    const topic = 'Enterprise A/Site1/area/machine/metric/type';
    const payload = '';
    const point = parseTopicToInflux(topic, payload);

    const lineProtocol = point.toLineProtocol({ precision: 'ns' });
    expect(lineProtocol).toContain('value=""');
  });

  test('single-part topic returns point with unknown tags', () => {
    const topic = 'sensor';
    const payload = '42';
    const point = parseTopicToInflux(topic, payload);

    const lineProtocol = point.toLineProtocol({ precision: 'ns' });
    expect(lineProtocol).toBeDefined();
    // Single part means parts[0] = 'sensor', rest are undefined -> 'unknown'
    expect(lineProtocol).toContain('enterprise=sensor');
    expect(lineProtocol).toContain('site=unknown');
    expect(lineProtocol).toContain('area=unknown');
    expect(lineProtocol).toContain('machine=unknown');
  });
});

describe('ENTERPRISE_ALIASES constant', () => {
  test('contains AVEVA Enterprise A mapping', () => {
    expect(ENTERPRISE_ALIASES['AVEVA Enterprise A']).toBe('Enterprise A');
  });

  test('contains AVEVA Enterprise B mapping', () => {
    expect(ENTERPRISE_ALIASES['AVEVA Enterprise B']).toBe('Enterprise B');
  });

  test('contains AVEVA Enterprise C mapping', () => {
    expect(ENTERPRISE_ALIASES['AVEVA Enterprise C']).toBe('Enterprise C');
  });
});

describe('SITE_ALIASES constant', () => {
  test('contains AVEVA - DALLAS mapping', () => {
    expect(SITE_ALIASES['AVEVA - DALLAS']).toBe('Dallas Line 1');
  });
});

describe('writeSparkplugMetric', () => {
  test('integer value type creates int field', () => {
    const metric = {
      name: 'temperature',
      value: 72,
      valueType: 'int',
      timestamp: null,
      tags: {
        enterprise: 'Enterprise A',
        site: 'Site1',
        edgeNodeId: 'Edge1',
        deviceId: 'Dev1',
        messageType: 'NDATA'
      }
    };
    const point = writeSparkplugMetric(metric);
    const line = point.toLineProtocol({ precision: 'ns' });

    expect(line).toContain('temperature');
    expect(line).toContain('value=72i'); // 'i' suffix indicates integer in line protocol
    expect(line).toContain('enterprise=Enterprise\\ A');
    expect(line).toContain('site=Site1');
    expect(line).toContain('edge_node_id=Edge1');
    expect(line).toContain('device_id=Dev1');
    expect(line).toContain('message_type=NDATA');
    expect(line).toContain('protocol=sparkplug_b');
  });

  test('float value type creates float field', () => {
    const metric = {
      name: 'temperature',
      value: 72.5,
      valueType: 'float',
      timestamp: null,
      tags: {
        enterprise: 'Enterprise A',
        site: 'Site1',
        edgeNodeId: 'Edge1',
        deviceId: null,
        messageType: 'NDATA'
      }
    };
    const point = writeSparkplugMetric(metric);
    const line = point.toLineProtocol({ precision: 'ns' });

    expect(line).toContain('value=72.5');
    expect(line).not.toContain('value=72.5i'); // No 'i' suffix for float
  });

  test('double value type creates float field', () => {
    const metric = {
      name: 'precision_value',
      value: 3.14159,
      valueType: 'double',
      timestamp: null,
      tags: {
        enterprise: 'Enterprise B',
        site: 'Site3',
        edgeNodeId: 'Edge2',
        deviceId: null,
        messageType: 'DDATA'
      }
    };
    const point = writeSparkplugMetric(metric);
    const line = point.toLineProtocol({ precision: 'ns' });

    expect(line).toContain('value=3.14159');
  });

  test('long value type creates int field', () => {
    const metric = {
      name: 'counter',
      value: 1000000,
      valueType: 'long',
      timestamp: null,
      tags: {
        enterprise: 'Enterprise A',
        site: 'Site1',
        edgeNodeId: 'Edge1',
        deviceId: 'Dev1',
        messageType: 'NDATA'
      }
    };
    const point = writeSparkplugMetric(metric);
    const line = point.toLineProtocol({ precision: 'ns' });

    expect(line).toContain('value=1000000i');
  });

  test('boolean value type creates boolean field', () => {
    const metric = {
      name: 'motor_running',
      value: true,
      valueType: 'boolean',
      timestamp: null,
      tags: {
        enterprise: 'Enterprise A',
        site: 'Site1',
        edgeNodeId: 'Edge1',
        deviceId: 'Dev1',
        messageType: 'NDATA'
      }
    };
    const point = writeSparkplugMetric(metric);
    const line = point.toLineProtocol({ precision: 'ns' });

    expect(line).toContain('value=T'); // InfluxDB uses T/F for boolean in line protocol
  });

  test('string value type creates string field', () => {
    const metric = {
      name: 'status',
      value: 'running',
      valueType: 'string',
      timestamp: null,
      tags: {
        enterprise: 'Enterprise A',
        site: 'Site1',
        edgeNodeId: 'Edge1',
        deviceId: null,
        messageType: 'NDATA'
      }
    };
    const point = writeSparkplugMetric(metric);
    const line = point.toLineProtocol({ precision: 'ns' });

    expect(line).toContain('value="running"');
  });

  test('string truncation to 200 chars', () => {
    const metric = {
      name: 'long_message',
      value: 'x'.repeat(250),
      valueType: 'string',
      timestamp: null,
      tags: {
        enterprise: 'Enterprise A',
        site: 'Site1',
        edgeNodeId: 'Edge1',
        deviceId: null,
        messageType: 'NDATA'
      }
    };
    const point = writeSparkplugMetric(metric);
    const line = point.toLineProtocol({ precision: 'ns' });

    const match = line.match(/value="(x+)"/);
    expect(match).not.toBeNull();
    expect(match[1].length).toBe(200);
  });

  test('unknown valueType with number infers float', () => {
    const metric = {
      name: 'custom_metric',
      value: 42,
      valueType: 'custom',
      timestamp: null,
      tags: {
        enterprise: 'Enterprise A',
        site: 'Site1',
        edgeNodeId: 'Edge1',
        deviceId: null,
        messageType: 'NDATA'
      }
    };
    const point = writeSparkplugMetric(metric);
    const line = point.toLineProtocol({ precision: 'ns' });

    expect(line).toContain('value=42');
  });

  test('unknown valueType with string infers string field', () => {
    const metric = {
      name: 'custom_metric',
      value: 'text',
      valueType: 'unknown',
      timestamp: null,
      tags: {
        enterprise: 'Enterprise A',
        site: 'Site1',
        edgeNodeId: 'Edge1',
        deviceId: null,
        messageType: 'NDATA'
      }
    };
    const point = writeSparkplugMetric(metric);
    const line = point.toLineProtocol({ precision: 'ns' });

    expect(line).toContain('value="text"');
  });

  test('enterprise tag normalized via ENTERPRISE_ALIASES', () => {
    const metric = {
      name: 'temperature',
      value: 72,
      valueType: 'int',
      timestamp: null,
      tags: {
        enterprise: 'AVEVA Enterprise A',
        site: 'Site1',
        edgeNodeId: 'Edge1',
        deviceId: null,
        messageType: 'NDATA'
      }
    };
    const point = writeSparkplugMetric(metric);
    const line = point.toLineProtocol({ precision: 'ns' });

    expect(line).toContain('enterprise=Enterprise\\ A');
  });

  test('site tag normalized via SITE_ALIASES', () => {
    const metric = {
      name: 'temperature',
      value: 72,
      valueType: 'int',
      timestamp: null,
      tags: {
        enterprise: 'Enterprise A',
        site: 'AVEVA - DALLAS',
        edgeNodeId: 'Edge1',
        deviceId: null,
        messageType: 'NDATA'
      }
    };
    const point = writeSparkplugMetric(metric);
    const line = point.toLineProtocol({ precision: 'ns' });

    expect(line).toContain('site=Dallas\\ Line\\ 1');
  });

  test('protocol tag always sparkplug_b', () => {
    const metric = {
      name: 'temperature',
      value: 72,
      valueType: 'int',
      timestamp: null,
      tags: {
        enterprise: 'Enterprise A',
        site: 'Site1',
        edgeNodeId: 'Edge1',
        deviceId: null,
        messageType: 'NDATA'
      }
    };
    const point = writeSparkplugMetric(metric);
    const line = point.toLineProtocol({ precision: 'ns' });

    expect(line).toContain('protocol=sparkplug_b');
  });

  test('deviceId tag only added when truthy', () => {
    const metricWithDevice = {
      name: 'temperature',
      value: 72,
      valueType: 'int',
      timestamp: null,
      tags: {
        enterprise: 'Enterprise A',
        site: 'Site1',
        edgeNodeId: 'Edge1',
        deviceId: 'Dev1',
        messageType: 'NDATA'
      }
    };
    const pointWithDevice = writeSparkplugMetric(metricWithDevice);
    const lineWithDevice = pointWithDevice.toLineProtocol({ precision: 'ns' });
    expect(lineWithDevice).toContain('device_id=Dev1');

    const metricWithoutDevice = {
      name: 'temperature',
      value: 72,
      valueType: 'int',
      timestamp: null,
      tags: {
        enterprise: 'Enterprise A',
        site: 'Site1',
        edgeNodeId: 'Edge1',
        deviceId: null,
        messageType: 'NDATA'
      }
    };
    const pointWithoutDevice = writeSparkplugMetric(metricWithoutDevice);
    const lineWithoutDevice = pointWithoutDevice.toLineProtocol({ precision: 'ns' });
    expect(lineWithoutDevice).not.toContain('device_id');
  });

  test('timestamp set when provided', () => {
    const timestamp = new Date('2026-01-15T10:30:00Z');
    const metric = {
      name: 'temperature',
      value: 72,
      valueType: 'int',
      timestamp: timestamp,
      tags: {
        enterprise: 'Enterprise A',
        site: 'Site1',
        edgeNodeId: 'Edge1',
        deviceId: null,
        messageType: 'NDATA'
      }
    };
    const point = writeSparkplugMetric(metric);
    const line = point.toLineProtocol({ precision: 'ns' });

    // Line protocol should include a timestamp at the end
    // Format: measurement,tags fields timestamp
    expect(line).toMatch(/\s\d+$/); // Ends with space + timestamp
  });

  test('no explicit timestamp when timestamp is null (InfluxDB adds default)', () => {
    const metric = {
      name: 'temperature',
      value: 72,
      valueType: 'int',
      timestamp: null,
      tags: {
        enterprise: 'Enterprise A',
        site: 'Site1',
        edgeNodeId: 'Edge1',
        deviceId: null,
        messageType: 'NDATA'
      }
    };
    const point = writeSparkplugMetric(metric);
    const line = point.toLineProtocol({ precision: 'ns' });

    // InfluxDB Point always adds a timestamp (current time) even when not explicitly set
    // So the line protocol will always end with a timestamp
    expect(line).toMatch(/\s\d+$/);
    // The test just verifies the point is created successfully without explicit timestamp
    expect(line).toContain('temperature');
  });

  test('measurement name sanitized - spaces replaced with underscore', () => {
    const metric = {
      name: 'motor speed',
      value: 1500,
      valueType: 'int',
      timestamp: null,
      tags: {
        enterprise: 'Enterprise A',
        site: 'Site1',
        edgeNodeId: 'Edge1',
        deviceId: null,
        messageType: 'NDATA'
      }
    };
    const point = writeSparkplugMetric(metric);
    const line = point.toLineProtocol({ precision: 'ns' });

    expect(line).toContain('motor_speed');
  });
});
