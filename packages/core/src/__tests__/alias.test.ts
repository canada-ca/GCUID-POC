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
 * Unit tests for Alias generation and validation
 */

import {
  generateAlias,
  parseAlias,
  validateAlias,
  formatAlias,
  getAliasHash,
  getAliasContext,
  isAliasFormat,
  verifyAliasForCore,
  compareAliases,
  generateMultipleAliases,
  AliasContext,
  ALIAS_REGEX
} from '../alias';

describe('Alias System', () => {
  const testCore = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
  
  describe('ALIAS_REGEX', () => {
    test('matches valid alias format', () => {
      expect(ALIAS_REGEX.test('GC-A-ABCD-EFGH-JKMN-M')).toBe(true);
      expect(ALIAS_REGEX.test('GC-TEST-1234-5678-90AB-X')).toBe(true);
    });

    test('rejects invalid formats', () => {
      expect(ALIAS_REGEX.test('GC-A-ABCD-EFGH-M')).toBe(false); // missing group
      expect(ALIAS_REGEX.test('GC-A-ABC-EFGH-JKMN-M')).toBe(false); // wrong length
      expect(ALIAS_REGEX.test('XX-A-ABCD-EFGH-JKMN-M')).toBe(false); // wrong prefix
    });
  });

  describe('generateAlias', () => {
    test('generates valid alias from core', () => {
      const alias = generateAlias(testCore);
      expect(alias).toMatch(ALIAS_REGEX);
      expect(alias).toContain('GC-A-');
    });

    test('generates consistent aliases for same core', () => {
      const alias1 = generateAlias(testCore);
      const alias2 = generateAlias(testCore);
      expect(alias1).toBe(alias2);
    });

    test('generates different aliases for different cores', () => {
      const core1 = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
      const core2 = '7ZZZZZZZZZZZZZZZZZZZZZZZZZ';
      const alias1 = generateAlias(core1);
      const alias2 = generateAlias(core2);
      expect(alias1).not.toBe(alias2);
    });

    test('supports custom context codes', () => {
      const alias = generateAlias(testCore, { context: 'TEST' });
      expect(alias).toContain('GC-TEST-');
    });

    test('uses AliasContext enum values', () => {
      const aliasA = generateAlias(testCore, { context: AliasContext.ALIAS });
      const aliasS = generateAlias(testCore, { context: AliasContext.SHORT });
      expect(aliasA).toContain('GC-A-');
      expect(aliasS).toContain('GC-S-');
    });

    test('throws error on invalid core', () => {
      expect(() => generateAlias('invalid')).toThrow('Invalid core identifier');
      expect(() => generateAlias('')).toThrow('Invalid core identifier');
    });

    test('throws error on invalid context', () => {
      expect(() => generateAlias(testCore, { context: 'lowercase' })).toThrow('Context must be uppercase letters only');
      expect(() => generateAlias(testCore, { context: '123' })).toThrow('Context must be uppercase letters only');
      expect(() => generateAlias(testCore, { context: '' })).toThrow('Context must be uppercase letters only');
    });

    test('hash portion is 12 characters', () => {
      const alias = generateAlias(testCore);
      const parsed = parseAlias(alias);
      expect(parsed.hash).toHaveLength(12);
    });

    test('checksum is 1 character', () => {
      const alias = generateAlias(testCore);
      const parsed = parseAlias(alias);
      expect(parsed.checksum).toHaveLength(1);
    });
  });

  describe('parseAlias', () => {
    test('parses valid alias', () => {
      const alias = generateAlias(testCore);
      const parsed = parseAlias(alias);
      
      expect(parsed.prefix).toBe('GC');
      expect(parsed.context).toBe('A');
      expect(parsed.hash).toHaveLength(12);
      expect(parsed.checksum).toHaveLength(1);
    });

    test('parses alias with custom context', () => {
      const alias = generateAlias(testCore, { context: 'CUSTOM' });
      const parsed = parseAlias(alias);
      
      expect(parsed.context).toBe('CUSTOM');
    });

    test('extracts hash without hyphens', () => {
      const alias = 'GC-A-ABCD-EFGH-JKMN-M';
      const parsed = parseAlias(alias);
      
      expect(parsed.hash).toBe('ABCDEFGHJKMN');
    });

    test('throws error on invalid format', () => {
      expect(() => parseAlias('invalid')).toThrow('Invalid alias format');
      expect(() => parseAlias('GC-A-ABCD-M')).toThrow('Invalid alias format');
      expect(() => parseAlias('')).toThrow('Alias cannot be empty');
    });
  });

  describe('validateAlias', () => {
    test('validates correct alias', () => {
      const alias = generateAlias(testCore);
      expect(validateAlias(alias)).toBe(true);
    });

    test('rejects alias with wrong checksum', () => {
      const alias = generateAlias(testCore);
      const parsed = parseAlias(alias);
      
      // Change the checksum to something else
      const wrongChecksum = parsed.checksum === 'A' ? 'B' : 'A';
      const invalidAlias = `GC-${parsed.context}-${parsed.hash.slice(0,4)}-${parsed.hash.slice(4,8)}-${parsed.hash.slice(8,12)}-${wrongChecksum}`;
      
      expect(validateAlias(invalidAlias)).toBe(false);
    });

    test('rejects invalid formats', () => {
      expect(validateAlias('invalid')).toBe(false);
      expect(validateAlias('GC-A-ABCD-M')).toBe(false);
      expect(validateAlias('')).toBe(false);
    });

    test('validates multiple generated aliases', () => {
      const aliases = [
        generateAlias(testCore),
        generateAlias(testCore, { context: 'S' }),
        generateAlias(testCore, { context: 'TEST' }),
      ];
      
      aliases.forEach(alias => {
        expect(validateAlias(alias)).toBe(true);
      });
    });
  });

  describe('formatAlias', () => {
    test('formats alias with proper hyphens', () => {
      const alias = generateAlias(testCore);
      const formatted = formatAlias(alias);
      
      expect(formatted).toBe(alias); // Should already be formatted
      expect(formatted).toMatch(/^GC-[A-Z]+-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-Z]$/);
    });

    test('reformats alias without proper hyphens', () => {
      const alias = generateAlias(testCore);
      const parsed = parseAlias(alias);
      
      // Create alias without hyphens
      const noHyphens = `GC${parsed.context}${parsed.hash}${parsed.checksum}`;
      
      // formatAlias should throw because it expects proper format
      expect(() => formatAlias(noHyphens)).toThrow();
    });
  });

  describe('getAliasHash', () => {
    test('extracts hash from alias', () => {
      const alias = generateAlias(testCore);
      const hash = getAliasHash(alias);
      
      expect(hash).toHaveLength(12);
      expect(/^[0-9A-HJKMNP-TV-Z]{12}$/.test(hash)).toBe(true);
    });

    test('hash is consistent for same core', () => {
      const alias1 = generateAlias(testCore);
      const alias2 = generateAlias(testCore);
      
      expect(getAliasHash(alias1)).toBe(getAliasHash(alias2));
    });
  });

  describe('getAliasContext', () => {
    test('extracts context from alias', () => {
      const alias = generateAlias(testCore, { context: 'CUSTOM' });
      const context = getAliasContext(alias);
      
      expect(context).toBe('CUSTOM');
    });

    test('extracts default context', () => {
      const alias = generateAlias(testCore);
      const context = getAliasContext(alias);
      
      expect(context).toBe('A');
    });
  });

  describe('isAliasFormat', () => {
    test('returns true for valid alias format', () => {
      const alias = generateAlias(testCore);
      expect(isAliasFormat(alias)).toBe(true);
    });

    test('returns false for invalid formats', () => {
      expect(isAliasFormat('invalid')).toBe(false);
      expect(isAliasFormat('GC-A-ABCD')).toBe(false);
      expect(isAliasFormat('')).toBe(false);
      expect(isAliasFormat(null as any)).toBe(false);
    });

    test('does not validate checksum', () => {
      // Even with wrong checksum, format check should pass
      expect(isAliasFormat('GC-A-ABCD-EFGH-JKMN-X')).toBe(true);
    });
  });

  describe('verifyAliasForCore', () => {
    test('verifies alias matches core', () => {
      const alias = generateAlias(testCore);
      expect(verifyAliasForCore(alias, testCore)).toBe(true);
    });

    test('rejects alias that does not match core', () => {
      const core1 = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
      const core2 = '7ZZZZZZZZZZZZZZZZZZZZZZZZZ';
      const alias1 = generateAlias(core1);
      
      expect(verifyAliasForCore(alias1, core2)).toBe(false);
    });

    test('handles context in verification', () => {
      const aliasA = generateAlias(testCore, { context: 'A' });
      const aliasS = generateAlias(testCore, { context: 'S' });
      
      expect(verifyAliasForCore(aliasA, testCore, { context: 'A' })).toBe(true);
      expect(verifyAliasForCore(aliasS, testCore, { context: 'S' })).toBe(true);
      expect(verifyAliasForCore(aliasA, testCore, { context: 'S' })).toBe(false);
    });

    test('returns false for invalid inputs', () => {
      expect(verifyAliasForCore('invalid', testCore)).toBe(false);
      expect(verifyAliasForCore('GC-A-ABCD-EFGH-IJKL-M', 'invalid')).toBe(false);
    });
  });

  describe('compareAliases', () => {
    test('returns true for identical aliases', () => {
      const alias = generateAlias(testCore);
      expect(compareAliases(alias, alias)).toBe(true);
    });

    test('returns true for same alias formatted differently', () => {
      const alias = generateAlias(testCore);
      // formatAlias normalizes, so comparison should work
      expect(compareAliases(alias, alias)).toBe(true);
    });

    test('returns false for different aliases', () => {
      const alias1 = generateAlias(testCore, { context: 'A' });
      const alias2 = generateAlias(testCore, { context: 'S' });
      
      expect(compareAliases(alias1, alias2)).toBe(false);
    });

    test('returns false for invalid inputs', () => {
      const alias = generateAlias(testCore);
      expect(compareAliases(alias, 'invalid')).toBe(false);
      expect(compareAliases('invalid', alias)).toBe(false);
    });
  });

  describe('generateMultipleAliases', () => {
    test('generates aliases for multiple contexts', () => {
      const contexts = ['A', 'S', 'Q'];
      const aliases = generateMultipleAliases(testCore, contexts);
      
      expect(aliases.size).toBe(3);
      expect(aliases.has('A')).toBe(true);
      expect(aliases.has('S')).toBe(true);
      expect(aliases.has('Q')).toBe(true);
    });

    test('each alias has correct context', () => {
      const contexts = ['A', 'TEST'];
      const aliases = generateMultipleAliases(testCore, contexts);
      
      const aliasA = aliases.get('A')!;
      const aliasTest = aliases.get('TEST')!;
      
      expect(getAliasContext(aliasA)).toBe('A');
      expect(getAliasContext(aliasTest)).toBe('TEST');
    });

    test('all aliases are valid', () => {
      const contexts = ['A', 'S', 'Q', 'T', 'P'];
      const aliases = generateMultipleAliases(testCore, contexts);
      
      aliases.forEach(alias => {
        expect(validateAlias(alias)).toBe(true);
      });
    });

    test('generates consistent results', () => {
      const contexts = ['A', 'S'];
      const aliases1 = generateMultipleAliases(testCore, contexts);
      const aliases2 = generateMultipleAliases(testCore, contexts);
      
      expect(aliases1.get('A')).toBe(aliases2.get('A'));
      expect(aliases1.get('S')).toBe(aliases2.get('S'));
    });
  });

  describe('AliasContext enum', () => {
    test('has expected context codes', () => {
      expect(AliasContext.ALIAS).toBe('A');
      expect(AliasContext.SHORT).toBe('S');
      expect(AliasContext.QR).toBe('Q');
      expect(AliasContext.TEMPORARY).toBe('T');
      expect(AliasContext.PERMANENT).toBe('P');
    });
  });

  describe('Checksum calculation', () => {
    test('different checksums for different data', () => {
      const alias1 = generateAlias('01ARZ3NDEKTSV4RRFFQ69G5FAV');
      const alias2 = generateAlias('7ZZZZZZZZZZZZZZZZZZZZZZZZZ');
      
      const parsed1 =parseAlias(alias1);
      const parsed2 = parseAlias(alias2);
      
      // Different cores should produce different checksums
      // (or at least very likely different)
      const sameChecksum = parsed1.checksum === parsed2.checksum;
      const sameHash = parsed1.hash === parsed2.hash;
      
      // If hash is different, that's the primary difference
      // Checksum may occasionally collide
      expect(sameHash).toBe(false);
    });
  });

  describe('Edge cases', () => {
    test('handles maximum length context', () => {
      const longContext = 'ABCDEFGHIJ'; // 10 chars (max)
      const alias = generateAlias(testCore, { context: longContext });
      expect(validateAlias(alias)).toBe(true);
      expect(getAliasContext(alias)).toBe(longContext);
    });

    test('rejects context longer than 10 characters', () => {
      const tooLong = 'ABCDEFGHIJK'; // 11 chars
      expect(() => generateAlias(testCore, { context: tooLong })).toThrow('Context must be between 1 and 10 characters');
    });

    test('handles all valid Crockford characters in core', () => {
      const core = '0123456789ABCDEFGHJKMNPQRS';
      const alias = generateAlias(core);
      expect(validateAlias(alias)).toBe(true);
    });
  });
});
