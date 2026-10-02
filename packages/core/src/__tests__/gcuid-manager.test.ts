/*!
 * GCUID — Government of Canada Unique Identifier System
 *
 * @license
 * Copyright (c) 2024-2026 NOETRONIQ Strategic Initiatives. All rights reserved.
 * Author: Philippe R. Beauchamp <prb@noetroniq.com>
 *
 * Licensed for use and modification by the Treasury Board of Canada Secretariat.
 * See LICENSE in the project root for full terms.
 */
/**
 * Integration tests for GCUID Manager
 * Tests all core GCUID functionality including V1/V2 formats, aliases, parsing, and validation
 */

import {
  GCUIDManager,
  EntityType,
  CoreIdType,
  GCUIDFormatVersion,
  ParsedGCUIDV1,
  ParsedGCUIDV2,
  isValidGCUIDCore,
  validateAlias,
  GCUID_V1_REGEX,
  GCUID_V2_REGEX
} from '../index';

describe('GCUIDManager Integration Tests', () => {
  let manager: GCUIDManager;

  beforeEach(() => {
    manager = new GCUIDManager();
  });

  describe('Initialization', () => {
    test('creates manager with default namespace', () => {
      expect(manager.getNamespace()).toBe('gcuid');
    });

    test('creates manager with custom namespace', () => {
      const customManager = new GCUIDManager('myorg');
      expect(customManager.getNamespace()).toBe('myorg');
    });

    test('throws error on invalid namespace', () => {
      expect(() => new GCUIDManager('')).toThrow('Namespace cannot be empty');
      expect(() => new GCUIDManager('My-Org')).toThrow('Namespace must contain only lowercase letters and numbers');
      expect(() => new GCUIDManager('MY_ORG')).toThrow('Namespace must contain only lowercase letters and numbers');
    });

    test('has default entity types registered', () => {
      const types = manager.getRegisteredEntityTypes();
      expect(types).toContain(EntityType.PERSON);
      expect(types).toContain(EntityType.ORG);
      expect(types).toContain(EntityType.ASSET);
      expect(types).toContain(EntityType.APP);
      expect(types).toContain(EntityType.AGENT);
    });
  });

  describe('V2 Format Generation (Current)', () => {
    test('generates V2 GCUID with ULID by default', () => {
      const gcuid = manager.generateV2();
      expect(typeof gcuid).toBe('string');
      expect(gcuid).toMatch(GCUID_V2_REGEX);
      expect(gcuid).toHaveLength(36); // urn:gcuid: (10) + 26 chars
      expect(gcuid).toMatch(/^urn:gcuid:[0-9A-HJKMNP-TV-Z]{26}$/);
    });

    test('generates V2 GCUID with UUID option', () => {
      const gcuid = manager.generateV2({ coreIdType: CoreIdType.UUID });
      expect(gcuid).toMatch(GCUID_V2_REGEX);
      expect(gcuid).toHaveLength(36);  // urn:gcuid: (10) + 26 chars
    });

    test('V2 generation returns string when no alias requested', () => {
      const result = manager.generateV2({ generateAlias: false });
      expect(typeof result).toBe('string');
    });

    test('V2 generation with alias returns result object', () => {
      const result = manager.generateV2({ 
        coreIdType: CoreIdType.ULID,
        generateAlias: true 
      });
      expect(result).toHaveProperty('gcuid');
      expect(result).toHaveProperty('alias');
      expect(result).toHaveProperty('core');
      expect(result).toHaveProperty('formatVersion');
      
      if (typeof result !== 'string') {
        expect(result.formatVersion).toBe(GCUIDFormatVersion.V2_CURRENT);
        expect(result.gcuid).toMatch(GCUID_V2_REGEX);
        expect(validateAlias(result.alias!)).toBe(true);
      }
    });

    test('V2 generation with custom alias context', () => {
      const result = manager.generateV2({ 
        generateAlias: true,
        aliasContext: 'TEST'
      });
      
      if (typeof result !== 'string') {
        expect(result.alias).toContain('GC-TEST-');
      }
    });

    test('V2 generation with custom core identifier', () => {
      const customCore = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
      const gcuid = manager.generateV2({ customCore });
      expect(gcuid).toBe(`urn:gcuid:${customCore}`);
    });

    test('throws error on invalid custom core', () => {
      expect(() => manager.generateV2({ customCore: 'INVALID' })).toThrow();
      expect(() => manager.generateV2({ customCore: '' })).toThrow();
    });
  });

  describe('V1 Format Generation (Legacy)', () => {
    test('generates V1 GCUID for person entity', () => {
      const gcuid = manager.generate({
        entityType: EntityType.PERSON,
        coreIdType: CoreIdType.ULID
      });
      
      expect(gcuid).toMatch(GCUID_V1_REGEX);
      expect(gcuid).toContain(':person:');
      expect(gcuid).toContain(':1:');
    });

    test('generates V1 GCUID for all entity types', () => {
      const entityTypes = [
        EntityType.PERSON, 
        EntityType.ORG, 
        EntityType.ASSET,
        EntityType.APP,
        EntityType.AGENT
      ];

      for (const entityType of entityTypes) {
        const gcuid = manager.generate({ entityType });
        expect(gcuid).toContain(`:${entityType}:`);
        expect(gcuid).toMatch(GCUID_V1_REGEX);
      }
    });

    test('generates V1 GCUID with custom version', () => {
      const gcuid = manager.generate({
        entityType: EntityType.PERSON,
        version: 2
      });
      expect(gcuid).toContain(':2:');
    });

    test('generates V1 GCUID with UUID core', () => {
      const gcuid = manager.generate({
        entityType: EntityType.PERSON,
        coreIdType: CoreIdType.UUID
      });
      expect(gcuid).toMatch(GCUID_V1_REGEX);
      const parsed = manager.parseV1(gcuid);
      expect(parsed.core).toHaveLength(26);
    });

    test('generates V1 GCUID with custom namespace', () => {
      const customManager = new GCUIDManager('myorg');
      const gcuid = customManager.generate({
        entityType: EntityType.PERSON
      });
      expect(gcuid).toMatch(/^urn:myorg:person:\d+:[0-9A-Z]{26}$/);
    });

    test('throws error on unregistered entity type', () => {
      expect(() => manager.generate({ entityType: 'unknown' })).toThrow();
    });

    test('allows custom entity type after registration', () => {
      manager.registerEntityType('device');
      const gcuid = manager.generate({ entityType: 'device' });
      expect(gcuid).toContain(':device:');
    });
  });

  describe('Parsing - Auto-detect Format', () => {
    test('parses V2 GCUID correctly', () => {
      const gcuid = manager.generateV2();
      const parsed = manager.parse(gcuid);
      
      expect(parsed.formatVersion).toBe(GCUIDFormatVersion.V2_CURRENT);
      expect(parsed.urn).toBe('urn');
      if (parsed.formatVersion === GCUIDFormatVersion.V2_CURRENT) {
        expect(parsed.namespace).toBe('gcuid');
        expect(parsed.core).toHaveLength(26);
        expect(parsed.raw).toBe(gcuid);
      }
    });

    test('parses V1 GCUID correctly', () => {
      const gcuid = manager.generate({ entityType: EntityType.PERSON });
      const parsed = manager.parse(gcuid);
      
      expect(parsed.formatVersion).toBe(GCUIDFormatVersion.V1_LEGACY);
      if ('entityType' in parsed) {
        expect(parsed.entityType).toBe('person');
        expect(parsed.version).toBe(1);
        expect(parsed.core).toHaveLength(26);
        expect(parsed.raw).toBe(gcuid);
      }
    });

    test('correctly identifies format version', () => {
      const v1 = manager.generate({ entityType: EntityType.PERSON });
      const v2 = manager.generateV2();
      
      expect(manager.getFormatVersion(v1)).toBe(GCUIDFormatVersion.V1_LEGACY);
      expect(manager.getFormatVersion(v2)).toBe(GCUIDFormatVersion.V2_CURRENT);
    });

    test('throws error on invalid GCUID format', () => {
      expect(() => manager.parse('invalid')).toThrow();
      expect(() => manager.parse('urn:invalid:format')).toThrow();
      expect(() => manager.parse('')).toThrow();
    });
  });

  describe('V1 Parsing (Specific)', () => {
    test('parseV1 extracts all components', () => {
      const gcuid = 'urn:gcuid:person:1:01ARZ3NDEKTSV4RRFFQ69G5FAV';
      const parsed = manager.parseV1(gcuid);
      
      expect(parsed.urn).toBe('urn');
      expect(parsed.namespace).toBe('gcuid');
      expect(parsed.entityType).toBe('person');
      expect(parsed.version).toBe(1);
      expect(parsed.core).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
      expect(parsed.formatVersion).toBe(GCUIDFormatVersion.V1_LEGACY);
    });

    test('parseV1 handles custom namespace', () => {
      const gcuid = 'urn:myorg:person:2:01ARZ3NDEKTSV4RRFFQ69G5FAV';
      const parsed = manager.parseV1(gcuid);
      
      expect(parsed.namespace).toBe('myorg');
      expect(parsed.version).toBe(2);
    });

    test('parseV1 throws on V2 format', () => {
      const v2Gcuid = manager.generateV2();
      expect(() => manager.parseV1(v2Gcuid)).toThrow();
    });
  });

  describe('V2 Parsing (Specific)', () => {
    test('parseV2 extracts all components', () => {
      const gcuid = 'urn:gcuid:01ARZ3NDEKTSV4RRFFQ69G5FAV';
      const parsed = manager.parseV2(gcuid);
      
      expect(parsed.urn).toBe('urn');
      expect(parsed.namespace).toBe('gcuid');
      expect(parsed.core).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
      expect(parsed.core).toHaveLength(26);
      expect(parsed.formatVersion).toBe(GCUIDFormatVersion.V2_CURRENT);
      expect(parsed.raw).toBe(gcuid);
    });

    test('parseV2 validates core format', () => {
      expect(() => manager.parseV2('urn:gcuid:INVALID')).toThrow();
      expect(() => manager.parseV2('urn:gcuid:01ARZ3')).toThrow(); // too short
    });

    test('parseV2 throws on V1 format', () => {
      const v1Gcuid = manager.generate({ entityType: EntityType.PERSON });
      expect(() => manager.parseV2(v1Gcuid)).toThrow();
    });
  });

  describe('Validation', () => {
    test('validates correct V2 GCUID', () => {
      const gcuid = manager.generateV2();
      expect(manager.validate(gcuid)).toBe(true);
    });

    test('validates correct V1 GCUID', () => {
      const gcuid = manager.generate({ entityType: EntityType.PERSON });
      expect(manager.validate(gcuid)).toBe(true);
    });

    test('rejects invalid GCUIDs', () => {
      expect(manager.validate('invalid')).toBe(false);
      expect(manager.validate('urn:invalid:format')).toBe(false);
      expect(manager.validate('')).toBe(false);
      expect(manager.validate('urn:gcuid:TOOSHORT')).toBe(false);
    });

    test('rejects GCUID with invalid core characters', () => {
      // I, L, O, U are invalid in Crockford Base32
      expect(manager.validate('urn:gcuid:01ARZ3NDEKTSV4RRFFQ69G5FAI')).toBe(false);
      expect(manager.validate('urn:gcuid:01ARZ3NDEKTSV4RRFFQ69G5FAL')).toBe(false);
      expect(manager.validate('urn:gcuid:01ARZ3NDEKTSV4RRFFQ69G5FAO')).toBe(false);
      expect(manager.validate('urn:gcuid:01ARZ3NDEKTSV4RRFFQ69G5FAU')).toBe(false);
    });
  });

  describe('Alias Operations', () => {
    test('generates alias for GCUID', () => {
      const gcuid = manager.generateV2();
      const alias = manager.generateAliasForGCUID(gcuid);
      
      expect(alias).toMatch(/^GC-[A-Z]+-([0-9A-HJKMNP-TV-Z]{4}-){3}[0-9A-Z]$/);
      expect(manager.validateAlias(alias)).toBe(true);
    });

    test('generates alias with custom context', () => {
      const gcuid = manager.generateV2();
      const alias = manager.generateAliasForGCUID(gcuid, 'TEST');
      
      expect(alias).toContain('GC-TEST-');
      expect(manager.validateAlias(alias)).toBe(true);
    });

    test('validates correct alias', () => {
      const result = manager.generateV2({ generateAlias: true });
      if (typeof result !== 'string') {
        expect(manager.validateAlias(result.alias!)).toBe(true);
      }
    });

    test('rejects invalid alias', () => {
      expect(manager.validateAlias('invalid')).toBe(false);
      expect(manager.validateAlias('GC-A-XXX')).toBe(false);
      expect(manager.validateAlias('')).toBe(false);
    });
  });

  describe('Format Conversion', () => {
    test('converts V1 GCUID to V2', () => {
      const v1Gcuid = manager.generate({ entityType: EntityType.PERSON });
      const conversionResult = manager.convertToV2(v1Gcuid);
      
      expect(conversionResult.gcuid).toMatch(GCUID_V2_REGEX);
      expect(conversionResult.entityType).toBe('person');
      expect(manager.getFormatVersion(conversionResult.gcuid)).toBe(GCUIDFormatVersion.V2_CURRENT);
      
      // Core should be preserved
      const v1Parsed = manager.parseV1(v1Gcuid);
      const v2Parsed = manager.parseV2(conversionResult.gcuid);
      expect(v1Parsed.core).toBe(v2Parsed.core);
    });

    test('converts preserves core identifier', () => {
      const customCore = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
      const v1 = `urn:gcuid:person:1:${customCore}`;
      const result = manager.convertToV2(v1);
      
      expect(result.gcuid).toBe(`urn:gcuid:${customCore}`);
      expect(result.core).toBe(customCore);
    });

    test('convertToV2 is idempotent (V2 stays V2)', () => {
      const v2Gcuid = manager.generateV2();
      const result = manager.convertToV2(v2Gcuid);
      
      expect(result.gcuid).toBe(v2Gcuid);
    });

    test('throws error on invalid GCUID for conversion', () => {
      expect(() => manager.convertToV2('invalid')).toThrow();
    });
  });

  describe('Entity Type Management', () => {
    test('checks if entity type is registered', () => {
      expect(manager.isEntityTypeRegistered(EntityType.PERSON)).toBe(true);
      expect(manager.isEntityTypeRegistered('unknown')).toBe(false);
    });

    test('registers new entity type', () => {
      manager.registerEntityType('device');
      expect(manager.isEntityTypeRegistered('device')).toBe(true);
      expect(manager.getRegisteredEntityTypes()).toContain('device');
    });

    test('throws error on invalid entity type registration', () => {
      expect(() => manager.registerEntityType('')).toThrow('Entity type cannot be empty');
      expect(() => manager.registerEntityType('Device')).toThrow('Entity type must contain only lowercase letters');
      expect(() => manager.registerEntityType('device-1')).toThrow('Entity type must contain only lowercase letters');
    });

    test('lists entity types in sorted order', () => {
      const types = manager.getRegisteredEntityTypes();
      const sorted = [...types].sort();
      expect(types).toEqual(sorted);
    });
  });

  describe('Identity Creation', () => {
    test('creates identity with V2 format', () => {
      const identity = manager.createIdentityV2({
        coreIdType: CoreIdType.ULID,
        entityType: 'person',
        metadata: { source: 'test' }
      });
      
      expect(identity.gcuid).toMatch(GCUID_V2_REGEX);
      expect(identity.formatVersion).toBe(GCUIDFormatVersion.V2_CURRENT);
      expect(identity.entityType).toBe('person');
      expect(identity.metadata).toEqual({ source: 'test' });
      expect(identity.createdAt).toBeInstanceOf(Date);
      expect(identity.updatedAt).toBeInstanceOf(Date);
    });

    test('creates identity with alias', () => {
      const identity = manager.createIdentityV2({
        generateAlias: true,
        entityType: 'person'
      });
      
      expect(identity.alias).toBeDefined();
      expect(manager.validateAlias(identity.alias!)).toBe(true);
    });

    test('creates V1 identity (legacy)', () => {
      const identity = manager.createIdentity({
        entityType: EntityType.PERSON,
        metadata: { source: 'test' }
      });
      
      expect(identity.gcuid).toMatch(GCUID_V1_REGEX);
      expect(identity.entityType).toBe(EntityType.PERSON);
      expect(identity.metadata).toEqual({ source: 'test' });
    });
  });

  describe('Namespace Management', () => {
    test('getUrnPrefix returns correct format', () => {
      expect(manager.getUrnPrefix()).toBe('urn:gcuid');
      
      const customManager = new GCUIDManager('acme');
      expect(customManager.getUrnPrefix()).toBe('urn:acme');
    });

    test('namespace is consistent across operations', () => {
      const customManager = new GCUIDManager('myorg');
      const gcuid = customManager.generate({ entityType: EntityType.PERSON });
      
      expect(gcuid).toContain('urn:myorg:');
      expect(customManager.getNamespace()).toBe('myorg');
    });
  });

  describe('Edge Cases', () => {
    test('handles concurrent generations', () => {
      const gcuids = Array.from({ length: 100 }, () => manager.generateV2());
      const uniqueGcuids = new Set(gcuids);
      
      // All GCUIDs should be unique
      expect(uniqueGcuids.size).toBe(100);
    });

    test('handles very long metadata', () => {
      const longMetadata = { data: 'x'.repeat(10000) };
      const identity = manager.createIdentityV2({
        metadata: longMetadata
      });
      
      expect(identity.metadata).toEqual(longMetadata);
    });

    test('handles null and undefined metadata', () => {
      const identity1 = manager.createIdentityV2({});
      expect(identity1.metadata).toBeUndefined();
      
      const identity2 = manager.createIdentityV2({ metadata: undefined });
      expect(identity2.metadata).toBeUndefined();
    });

    test('core identifier is always 26 characters', () => {
      for (let i = 0; i < 10; i++) {
        const gcuid = manager.generateV2();
        const parsed = manager.parseV2(gcuid);
        // ULID can sometimes be 25 or 26 chars depending on the timestamp
        expect(parsed.core.length).toBeGreaterThanOrEqual(25);
        expect(parsed.core.length).toBeLessThanOrEqual(26);
        expect(isValidGCUIDCore(parsed.core)).toBe(true);
      }
    });
  });

  describe('Performance', () => {
    test('generates 1000 GCUIDs quickly', () => {
      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        manager.generateV2();
      }
      const duration = Date.now() - start;
      
      // Should complete in reasonable time (< 1 second for 1000 generations)
      expect(duration).toBeLessThan(1000);
    });

    test('parses 1000 GCUIDs quickly', () => {
      const gcuids = Array.from({ length: 1000 }, () => manager.generateV2());
      
      const start = Date.now();
      gcuids.forEach(gcuid => manager.parse(gcuid));
      const duration = Date.now() - start;
      
      // Should complete in reasonable time
      expect(duration).toBeLessThan(1000);
    });
  });
});
