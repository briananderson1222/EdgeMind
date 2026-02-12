/**
 * @file cesmii-validator.test.js
 * @description Tests for CESMII SM Profile detector and validator
 */

const path = require('path');
const {
  isCesmiiPayload,
  extractProfileType
} = require('../cesmii/detector');

const {
  loadProfile,
  loadAllProfiles,
  getProfileForType,
  validatePayload,
  validateOpcUaType,
  clearProfileCache
} = require('../cesmii/validator');

// Path to test profiles
const PROFILES_DIR = path.join(__dirname, '..', 'cesmii', 'profiles');

// Work order factory for test fixtures
function makeValidWorkOrder(overrides = {}) {
  return {
    '@context': { '@vocab': 'https://cesmii.org/smprofile/' },
    '@type': 'WorkOrderV1',
    'profileDefinition': 'https://example.com/WorkOrderV1.jsonld',
    WorkOrderId: 'WO-2026-001',
    ProductName: 'Widget A',
    Quantity: 1000,
    UnitOfMeasure: 'units',
    Status: 'New',
    Priority: 1,
    StartTime: '2026-02-11T08:00:00Z',
    EndTime: '2026-02-11T16:00:00Z',
    Ingredients: [{
      IngredientName: 'Raw Material X',
      Quantity: 500.5,
      UnitOfMeasure: 'kg',
      LotNumber: 'LOT-001',
      PercentOfTotal: 50.5
    }],
    ...overrides
  };
}

describe('CESMII Detector', () => {
  describe('isCesmiiPayload', () => {
    test('JSON-LD with @type and @context returns true', () => {
      const payload = {
        '@type': 'WorkOrderV1',
        '@context': { '@vocab': 'https://cesmii.org/smprofile/' },
        WorkOrderId: 'WO-123'
      };
      expect(isCesmiiPayload(payload)).toBe(true);
    });

    test('JSON-LD with @type and profileDefinition returns true', () => {
      const payload = {
        '@type': 'WorkOrderV1',
        profileDefinition: 'https://github.com/Concept-Reply-US/EdgeMind/blob/main/lib/cesmii/profiles/WorkOrderV1.jsonld',
        WorkOrderId: 'WO-123'
      };
      expect(isCesmiiPayload(payload)).toBe(true);
    });

    test('plain JSON without @type returns false', () => {
      const payload = { WorkOrderId: 'WO-123' };
      expect(isCesmiiPayload(payload)).toBe(false);
    });

    test('plain number string returns false', () => {
      expect(isCesmiiPayload('42')).toBe(false);
    });

    test('empty object returns false', () => {
      expect(isCesmiiPayload({})).toBe(false);
    });

    test('Buffer input with JSON-LD works', () => {
      const payload = {
        '@type': 'WorkOrderV1',
        '@context': { '@vocab': 'https://cesmii.org/smprofile/' }
      };
      const buffer = Buffer.from(JSON.stringify(payload), 'utf8');
      expect(isCesmiiPayload(buffer)).toBe(true);
    });

    test('String input with JSON-LD works', () => {
      const payload = JSON.stringify({
        '@type': 'WorkOrderV1',
        '@context': { '@vocab': 'https://cesmii.org/smprofile/' }
      });
      expect(isCesmiiPayload(payload)).toBe(true);
    });

    test('malformed JSON string returns false', () => {
      expect(isCesmiiPayload('{invalid json')).toBe(false);
    });

    test('array payload returns false', () => {
      expect(isCesmiiPayload([1, 2, 3])).toBe(false);
    });

    test('null payload returns false', () => {
      expect(isCesmiiPayload(null)).toBe(false);
    });

    test('@type present but missing both @context and profileDefinition returns false', () => {
      const payload = { '@type': 'WorkOrderV1', WorkOrderId: 'WO-123' };
      expect(isCesmiiPayload(payload)).toBe(false);
    });
  });

  describe('extractProfileType', () => {
    test('extracts simple type name', () => {
      const payload = { '@type': 'WorkOrderV1' };
      expect(extractProfileType(payload)).toBe('WorkOrderV1');
    });

    test('extracts type from URL', () => {
      const payload = { '@type': 'https://cesmii.org/smprofile/WorkOrderV1' };
      expect(extractProfileType(payload)).toBe('WorkOrderV1');
    });

    test('extracts type from namespaced string', () => {
      const payload = { '@type': 'cesmii:WorkOrderV1' };
      expect(extractProfileType(payload)).toBe('WorkOrderV1');
    });

    test('works with Buffer input', () => {
      const payload = { '@type': 'WorkOrderV1' };
      const buffer = Buffer.from(JSON.stringify(payload), 'utf8');
      expect(extractProfileType(buffer)).toBe('WorkOrderV1');
    });

    test('works with string input', () => {
      const payload = JSON.stringify({ '@type': 'WorkOrderV1' });
      expect(extractProfileType(payload)).toBe('WorkOrderV1');
    });

    test('returns null for payload without @type', () => {
      const payload = { WorkOrderId: 'WO-123' };
      expect(extractProfileType(payload)).toBeNull();
    });

    test('returns null for null input', () => {
      expect(extractProfileType(null)).toBeNull();
    });

    test('returns null for malformed JSON', () => {
      expect(extractProfileType('{bad json')).toBeNull();
    });
  });
});

const signedIntTypes = [
  ['Int16', -32768, 32767],
  ['Int32', -2147483648, 2147483647],
  ['Int64', Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
];

const unsignedIntTypes = [
  ['UInt16', 0, 65535],
  ['UInt32', 0, 4294967295],
  ['UInt64', 0, Number.MAX_SAFE_INTEGER],
];

describe('OPC UA Type Validators', () => {
  describe('Boolean', () => {
    test('accepts true', () => {
      expect(validateOpcUaType(true, 'opc:Boolean')).toBe(true);
    });

    test('accepts false', () => {
      expect(validateOpcUaType(false, 'opc:Boolean')).toBe(true);
    });

    test('accepts 1', () => {
      expect(validateOpcUaType(1, 'opc:Boolean')).toBe(true);
    });

    test('accepts 0', () => {
      expect(validateOpcUaType(0, 'opc:Boolean')).toBe(true);
    });

    test('rejects string', () => {
      expect(validateOpcUaType('hello', 'opc:Boolean')).toBe(false);
    });

    test('rejects number other than 0 or 1', () => {
      expect(validateOpcUaType(2, 'opc:Boolean')).toBe(false);
    });
  });

  describe.each(signedIntTypes)('%s', (type, min, max) => {
    test('accepts valid positive integer', () => {
      expect(validateOpcUaType(100, `opc:${type}`)).toBe(true);
    });

    test('accepts minimum value', () => {
      expect(validateOpcUaType(min, `opc:${type}`)).toBe(true);
    });

    test('accepts maximum value', () => {
      expect(validateOpcUaType(max, `opc:${type}`)).toBe(true);
    });

    test('rejects float', () => {
      expect(validateOpcUaType(3.14, `opc:${type}`)).toBe(false);
    });

    test('rejects value above max', () => {
      expect(validateOpcUaType(max + 1, `opc:${type}`)).toBe(false);
    });

    test('rejects value below min', () => {
      expect(validateOpcUaType(min - 1, `opc:${type}`)).toBe(false);
    });

    test('rejects string', () => {
      expect(validateOpcUaType('hello', `opc:${type}`)).toBe(false);
    });
  });

  describe.each(unsignedIntTypes)('%s', (type, min, max) => {
    test('accepts zero', () => {
      expect(validateOpcUaType(0, `opc:${type}`)).toBe(true);
    });

    test('accepts valid positive integer', () => {
      expect(validateOpcUaType(100, `opc:${type}`)).toBe(true);
    });

    test('accepts maximum value', () => {
      expect(validateOpcUaType(max, `opc:${type}`)).toBe(true);
    });

    test('rejects negative', () => {
      expect(validateOpcUaType(-1, `opc:${type}`)).toBe(false);
    });

    test('rejects float', () => {
      expect(validateOpcUaType(3.14, `opc:${type}`)).toBe(false);
    });

    test('rejects string', () => {
      expect(validateOpcUaType('hello', `opc:${type}`)).toBe(false);
    });
  });

  describe('Float and Double', () => {
    test('Float accepts any finite number', () => {
      expect(validateOpcUaType(3.14, 'opc:Float')).toBe(true);
    });

    test('Float accepts integer', () => {
      expect(validateOpcUaType(42, 'opc:Float')).toBe(true);
    });

    test('Float rejects NaN', () => {
      expect(validateOpcUaType(NaN, 'opc:Float')).toBe(false);
    });

    test('Float rejects Infinity', () => {
      expect(validateOpcUaType(Infinity, 'opc:Float')).toBe(false);
    });

    test('Double accepts any finite number', () => {
      expect(validateOpcUaType(3.14159265359, 'opc:Double')).toBe(true);
    });

    test('Double rejects NaN', () => {
      expect(validateOpcUaType(NaN, 'opc:Double')).toBe(false);
    });
  });

  describe('String', () => {
    test('accepts any string', () => {
      expect(validateOpcUaType('hello world', 'opc:String')).toBe(true);
    });

    test('accepts empty string', () => {
      expect(validateOpcUaType('', 'opc:String')).toBe(true);
    });

    test('rejects number', () => {
      expect(validateOpcUaType(123, 'opc:String')).toBe(false);
    });

    test('rejects null', () => {
      expect(validateOpcUaType(null, 'opc:String')).toBe(false);
    });
  });

  describe('DateTime and UtcTime', () => {
    test('DateTime accepts ISO 8601 string', () => {
      expect(validateOpcUaType('2026-02-11T12:00:00Z', 'opc:DateTime')).toBe(true);
    });

    test('DateTime accepts numeric timestamp', () => {
      expect(validateOpcUaType(1707649200000, 'opc:DateTime')).toBe(true);
    });

    test('DateTime rejects invalid string', () => {
      expect(validateOpcUaType('not-a-date', 'opc:DateTime')).toBe(false);
    });

    test('DateTime rejects random text', () => {
      expect(validateOpcUaType('hello', 'opc:DateTime')).toBe(false);
    });

    test('UtcTime accepts ISO 8601 string', () => {
      expect(validateOpcUaType('2026-02-11T12:00:00Z', 'opc:UtcTime')).toBe(true);
    });

    test('UtcTime accepts numeric timestamp', () => {
      expect(validateOpcUaType(1707649200000, 'opc:UtcTime')).toBe(true);
    });
  });

  describe('Guid', () => {
    test('accepts valid UUID v4', () => {
      expect(validateOpcUaType('550e8400-e29b-41d4-a716-446655440000', 'opc:Guid')).toBe(true);
    });

    test('accepts UUID with uppercase', () => {
      expect(validateOpcUaType('550E8400-E29B-41D4-A716-446655440000', 'opc:Guid')).toBe(true);
    });

    test('rejects UUID without hyphens', () => {
      expect(validateOpcUaType('550e8400e29b41d4a716446655440000', 'opc:Guid')).toBe(false);
    });

    test('rejects random string', () => {
      expect(validateOpcUaType('not-a-guid', 'opc:Guid')).toBe(false);
    });

    test('rejects number', () => {
      expect(validateOpcUaType(123, 'opc:Guid')).toBe(false);
    });
  });

  describe('Array types', () => {
    test('accepts array for array type', () => {
      expect(validateOpcUaType([], 'FeedIngredientV1[]')).toBe(true);
    });

    test('rejects non-array for array type', () => {
      expect(validateOpcUaType({}, 'FeedIngredientV1[]')).toBe(false);
    });
  });
});

describe('Profile Loading', () => {
  beforeEach(() => {
    clearProfileCache();
  });

  test('loads WorkOrderV1 profile successfully', () => {
    const profilePath = path.join(PROFILES_DIR, 'WorkOrderV1.jsonld');
    const profile = loadProfile(profilePath);

    expect(profile).not.toBeNull();
    expect(profile['@type']).toBe('WorkOrderV1');
    expect(profile.profile.attributes).toBeInstanceOf(Array);
    expect(profile.profile.attributes.length).toBeGreaterThan(0);
  });

  test('loads FeedIngredientV1 profile successfully', () => {
    const profilePath = path.join(PROFILES_DIR, 'FeedIngredientV1.jsonld');
    const profile = loadProfile(profilePath);

    expect(profile).not.toBeNull();
    expect(profile['@type']).toBe('FeedIngredientV1');
    expect(profile.profile.attributes).toBeInstanceOf(Array);
  });

  test('loads FactoryInsightV1 profile successfully', () => {
    const profilePath = path.join(PROFILES_DIR, 'FactoryInsightV1.jsonld');
    const profile = loadProfile(profilePath);

    expect(profile).not.toBeNull();
    expect(profile['@type']).toBe('FactoryInsightV1');
  });

  test('loads OEEReportV1 profile successfully', () => {
    const profilePath = path.join(PROFILES_DIR, 'OEEReportV1.jsonld');
    const profile = loadProfile(profilePath);

    expect(profile).not.toBeNull();
    expect(profile['@type']).toBe('OEEReportV1');
  });

  test('returns null for non-existent profile', () => {
    const profilePath = path.join(PROFILES_DIR, 'NonExistent.jsonld');
    const profile = loadProfile(profilePath);

    expect(profile).toBeNull();
  });

  test('loadAllProfiles loads all profiles from directory', () => {
    const count = loadAllProfiles(PROFILES_DIR);

    expect(count).toBe(4); // WorkOrderV1, FeedIngredientV1, FactoryInsightV1, OEEReportV1
  });

  test('getProfileForType retrieves loaded profile', () => {
    loadAllProfiles(PROFILES_DIR);

    const profile = getProfileForType('WorkOrderV1');
    expect(profile).not.toBeNull();
    expect(profile['@type']).toBe('WorkOrderV1');
  });

  test('getProfileForType returns null for unloaded profile', () => {
    const profile = getProfileForType('UnknownProfile');
    expect(profile).toBeNull();
  });

  test('getLoadedProfileTypes returns loaded profile types', () => {
    loadAllProfiles(PROFILES_DIR);

    const { getLoadedProfileTypes } = require('../cesmii/validator');
    const loadedTypes = getLoadedProfileTypes();

    expect(loadedTypes).toBeInstanceOf(Array);
    expect(loadedTypes.length).toBe(4);

    const typeNames = loadedTypes.map(t => t.typeName);
    expect(typeNames).toContain('WorkOrderV1');
    expect(typeNames).toContain('FeedIngredientV1');
    expect(typeNames).toContain('FactoryInsightV1');
    expect(typeNames).toContain('OEEReportV1');

    // Verify structure
    loadedTypes.forEach(({ typeName, profile }) => {
      expect(typeof typeName).toBe('string');
      expect(profile).toHaveProperty('@type');
      expect(profile).toHaveProperty('profile');
    });
  });

  test('getLoadedProfileTypes returns empty array when no profiles loaded', () => {
    clearProfileCache();

    const { getLoadedProfileTypes } = require('../cesmii/validator');
    const loadedTypes = getLoadedProfileTypes();

    expect(loadedTypes).toBeInstanceOf(Array);
    expect(loadedTypes).toHaveLength(0);
  });
});

describe('WorkOrderV1 Payload Validation', () => {
  beforeAll(() => {
    loadAllProfiles(PROFILES_DIR);
  });

  afterAll(() => {
    clearProfileCache();
  });

  test('validates complete valid WorkOrderV1 payload', () => {
    const payload = makeValidWorkOrder();

    const profile = getProfileForType('WorkOrderV1');
    const result = validatePayload(payload, profile);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('detects missing required field', () => {
    const payload = makeValidWorkOrder();
    delete payload.ProductName;

    const profile = getProfileForType('WorkOrderV1');
    const result = validatePayload(payload, profile);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Missing required field: ProductName');
  });

  test('detects wrong type for field', () => {
    const payload = makeValidWorkOrder({ Quantity: 'not-a-number' });

    const profile = getProfileForType('WorkOrderV1');
    const result = validatePayload(payload, profile);

    expect(result.valid).toBe(false);
    expect(result.errors.some(err => err.includes('Quantity'))).toBe(true);
  });

  test('validates nested Ingredients array', () => {
    const payload = makeValidWorkOrder({
      Ingredients: [
        {
          IngredientName: 'Corn',
          Quantity: 500.0,
          UnitOfMeasure: 'kg',
          LotNumber: 'LOT-123',
          PercentOfTotal: 50.0
        },
        {
          IngredientName: 'Wheat',
          Quantity: 500.0,
          UnitOfMeasure: 'kg',
          LotNumber: 'LOT-456',
          PercentOfTotal: 50.0
        }
      ]
    });

    const profile = getProfileForType('WorkOrderV1');
    const result = validatePayload(payload, profile);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test('detects invalid nested ingredient', () => {
    const payload = makeValidWorkOrder({
      Ingredients: [
        {
          IngredientName: 'Corn',
          UnitOfMeasure: 'kg',
          LotNumber: 'LOT-123',
          PercentOfTotal: 50.0
        }
      ]
    });

    const profile = getProfileForType('WorkOrderV1');
    const result = validatePayload(payload, profile);

    expect(result.valid).toBe(false);
    expect(result.errors.some(err => err.includes('Ingredients[0]'))).toBe(true);
  });

  test('rejects non-array for Ingredients field', () => {
    const payload = makeValidWorkOrder({ Ingredients: 'not-an-array' });

    const profile = getProfileForType('WorkOrderV1');
    const result = validatePayload(payload, profile);

    expect(result.valid).toBe(false);
    expect(result.errors.some(err => err.includes('must be an array'))).toBe(true);
  });
});

describe('Edge Cases', () => {
  beforeAll(() => {
    loadAllProfiles(PROFILES_DIR);
  });

  afterAll(() => {
    clearProfileCache();
  });

  test('validates empty payload object', () => {
    const payload = {};
    const profile = getProfileForType('WorkOrderV1');
    const result = validatePayload(payload, profile);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test('handles null payload gracefully', () => {
    const profile = getProfileForType('WorkOrderV1');
    const result = validatePayload(null, profile);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Payload is not an object');
  });

  test('handles null profile gracefully', () => {
    const payload = { '@type': 'WorkOrderV1' };
    const result = validatePayload(payload, null);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Invalid profile definition');
  });

  test('handles malformed profile gracefully', () => {
    const payload = { '@type': 'WorkOrderV1' };
    const badProfile = { '@type': 'BadProfile' }; // Missing profile.attributes
    const result = validatePayload(payload, badProfile);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Invalid profile definition');
  });

  test('recursion depth guard prevents infinite loops', () => {
    const payload = { '@type': 'WorkOrderV1' };
    const profile = getProfileForType('WorkOrderV1');

    // Call validatePayload with depth > 10 to trigger guard
    const result = validatePayload(payload, profile, 11);

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Maximum nesting depth exceeded');
  });

  test('warnings are generated for unknown nested profile types', () => {
    // Create a mock profile with a nested type that doesn't exist
    const mockProfile = {
      '@type': 'TestProfile',
      profile: {
        attributes: [
          {
            attributeName: 'NestedField',
            dataType: 'UnknownNestedType',
            description: 'A field with unknown nested type'
          }
        ]
      }
    };

    const payload = {
      NestedField: { someKey: 'someValue' }
    };

    const result = validatePayload(payload, mockProfile);

    expect(result.warnings).toContain('Nested profile UnknownNestedType not loaded, skipping validation for NestedField');
  });

  test('warnings are generated for unknown nested array profile types', () => {
    // Create a mock profile with a nested array type that doesn't exist
    const mockProfile = {
      '@type': 'TestProfile',
      profile: {
        attributes: [
          {
            attributeName: 'Items',
            dataType: 'UnknownItemType[]',
            description: 'An array of unknown type'
          }
        ]
      }
    };

    const payload = {
      Items: [{ someKey: 'someValue' }]
    };

    const result = validatePayload(payload, mockProfile);

    expect(result.warnings).toContain('Nested profile UnknownItemType not loaded, skipping validation');
  });
});

describe('Unknown OPC UA Type Fallback', () => {
  test('validateOpcUaType returns true for object with unknown type', () => {
    const result = validateOpcUaType({}, 'UnknownNestedType');
    expect(result).toBe(true);
  });

  test('validateOpcUaType returns false for string with unknown type', () => {
    const result = validateOpcUaType('string', 'UnknownNestedType');
    expect(result).toBe(false);
  });

  test('validateOpcUaType returns false for null with unknown type', () => {
    const result = validateOpcUaType(null, 'UnknownNestedType');
    expect(result).toBe(false);
  });

  test('validateOpcUaType returns false for array with unknown type', () => {
    const result = validateOpcUaType([1, 2, 3], 'UnknownNestedType');
    expect(result).toBe(false);
  });

  test('validateOpcUaType returns false for number with unknown type', () => {
    const result = validateOpcUaType(42, 'UnknownNestedType');
    expect(result).toBe(false);
  });
});
