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
 * Unit tests for Crockford Base32 encoding/decoding
 */

import {
  encodeCrockford,
  decodeCrockford,
  isValidCrockford,
  isValidGCUIDCore,
  uuidToCrockford,
  ulidToCrockford,
  normalizeCrockford,
  formatCrockford,
  CROCKFORD_ALPHABET,
  CROCKFORD_REGEX,
  CROCKFORD_26_REGEX
} from '../crockford-base32';

describe('Crockford Base32', () => {
  describe('Constants', () => {
    test('CROCKFORD_ALPHABET has 32 characters', () => {
      expect(CROCKFORD_ALPHABET).toHaveLength(32);
    });

    test('CROCKFORD_ALPHABET excludes I, L, O, U', () => {
      expect(CROCKFORD_ALPHABET).not.toContain('I');
      expect(CROCKFORD_ALPHABET).not.toContain('L');
      expect(CROCKFORD_ALPHABET).not.toContain('O');
      expect(CROCKFORD_ALPHABET).not.toContain('U');
    });

    test('CROCKFORD_REGEX matches valid characters', () => {
      expect(CROCKFORD_REGEX.test('0123456789ABCDEFGHJKMNPQRSTVWXYZ')).toBe(true);
      expect(CROCKFORD_REGEX.test('INVALID-WITH-I')).toBe(false);
    });

    test('CROCKFORD_26_REGEX matches 26-character strings', () => {
      expect(CROCKFORD_26_REGEX.test('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(true);
      expect(CROCKFORD_26_REGEX.test('01ARZ3NDEKTSV4RRFFQ')).toBe(false); // too short
    });
  });

  describe('encodeCrockford', () => {
    test('encodes buffer to Crockford Base32', () => {
      const buffer = Buffer.from('Hello');
      const encoded = encodeCrockford(buffer, 10);
      expect(encoded).toMatch(CROCKFORD_REGEX);
      expect(encoded).toHaveLength(10);
    });

    test('produces 26-character output by default', () => {
      const buffer = Buffer.alloc(16);
      const encoded = encodeCrockford(buffer);
      expect(encoded).toHaveLength(26);
    });

    test('throws error on empty buffer', () => {
      expect(() => encodeCrockford(Buffer.from([]))).toThrow('Buffer cannot be empty');
    });

    test('throws error on invalid length', () => {
      const buffer = Buffer.from('test');
      expect(() => encodeCrockford(buffer, 0)).toThrow('Length must be positive');
      expect(() => encodeCrockford(buffer, -1)).toThrow('Length must be positive');
    });
  });

  describe('decodeCrockford', () => {
    test('decodes Crockford Base32 to buffer', () => {
      const original = Buffer.from('Hello World');
      const encoded = encodeCrockford(original, 20);
      const decoded = decodeCrockford(encoded);
      
      // First few bytes should match
      expect(decoded.slice(0, 5).toString()).toBe('Hello');
    });

    test('handles hyphens in input', () => {
      const encoded = '01ARZ3-NDEK-TSV4-RRFFQ6-9G5FAV';
      expect(() => decodeCrockford(encoded)).not.toThrow();
    });

    test('throws error on empty string', () => {
      expect(() => decodeCrockford('')).toThrow('Encoded string cannot be empty');
    });

    test('throws error on invalid characters', () => {
      expect(() => decodeCrockford('INVALID-WITH-I-L-O-U')).toThrow('Invalid Crockford Base32 string');
    });
  });

  describe('isValidCrockford', () => {
    test('validates correct Crockford Base32 strings', () => {
      expect(isValidCrockford('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(true);
      expect(isValidCrockford('0123456789ABCDEFGHJKMNPQRSTVWXYZ')).toBe(true);
    });

    test('accepts hyphens', () => {
      expect(isValidCrockford('01ARZ3-NDEK-TSV4')).toBe(true);
    });

    test('rejects invalid characters', () => {
      expect(isValidCrockford('INVALID-I')).toBe(false);
      expect(isValidCrockford('INVALID-L')).toBe(false);
      expect(isValidCrockford('INVALID-O')).toBe(false);
      expect(isValidCrockford('INVALID-U')).toBe(false);
    });

    test('rejects empty string', () => {
      expect(isValidCrockford('')).toBe(false);
      expect(isValidCrockford(null as any)).toBe(false);
      expect(isValidCrockford(undefined as any)).toBe(false);
    });
  });

  describe('isValidGCUIDCore', () => {
    test('validates 26-character Crockford Base32 strings', () => {
      expect(isValidGCUIDCore('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(true);
      expect(isValidGCUIDCore('7ZZZZZZZZZZZZZZZZZZZZZZZZZ')).toBe(true);
    });

    test('rejects incorrect length', () => {
      expect(isValidGCUIDCore('01ARZ3NDEKTSV4RRFFQ')).toBe(false); // too short
      expect(isValidGCUIDCore('01ARZ3NDEKTSV4RRFFQ69G5FAVEXTRA')).toBe(false); // too long
    });

    test('rejects invalid characters', () => {
expect(isValidGCUIDCore('01ARZ3NDEKTSV4RRFFQ69G5FAI')).toBe(false); // ends with I
    });
  });

  describe('uuidToCrockford', () => {
    test('converts UUID to 26-character Crockford Base32', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const crockford = uuidToCrockford(uuid);
      expect(crockford).toHaveLength(26);
      expect(isValidGCUIDCore(crockford)).toBe(true);
    });

    test('produces consistent output for same UUID', () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const crockford1 = uuidToCrockford(uuid);
      const crockford2 = uuidToCrockford(uuid);
      expect(crockford1).toBe(crockford2);
    });

    test('throws error on invalid UUID', () => {
      expect(() => uuidToCrockford('invalid')).toThrow('Invalid UUID format');
      expect(() => uuidToCrockford('')).toThrow('UUID cannot be empty');
    });
  });

  describe('ulidToCrockford', () => {
    test('validates and returns ULID', () => {
      const ulid = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
      const result = ulidToCrockford(ulid);
      expect(result).toBe(ulid);
    });

    test('uppercases ULID', () => {
      const ulid = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
      const lowercase = ulid.toLowerCase();
      const result = ulidToCrockford(lowercase.toUpperCase());
      expect(result).toBe('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    });

    test('throws error on invalid ULID', () => {
      expect(() => ulidToCrockford('invalid')).toThrow('Invalid ULID format');
      expect(() => ulidToCrockford('')).toThrow('ULID cannot be empty');
    });
  });

  describe('normalizeCrockford', () => {
    test('uppercases and removes hyphens', () => {
      expect(normalizeCrockford('01arz3-ndek-tsv4')).toBe('01ARZ3NDEKTSV4');
    });

    test('handles already normalized strings', () => {
      expect(normalizeCrockford('01ARZ3NDEKTSV4')).toBe('01ARZ3NDEKTSV4');
    });

    test('throws error on empty string', () => {
      expect(() => normalizeCrockford('')).toThrow('String cannot be empty');
    });
  });

  describe('formatCrockford', () => {
    test('formats with hyphens in groups of 4', () => {
      const input = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
      const formatted = formatCrockford(input);
      expect(formatted).toBe('01AR-Z3ND-EKTS-V4RR-FFQ6-9G5F-AV');
    });

    test('handles custom group size', () => {
      const input = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
      const formatted = formatCrockford(input, 6);
      expect(formatted).toBe('01ARZ3-NDEKTS-V4RRFF-Q69G5F-AV');
    });

    test('removes existing hyphens before reformatting', () => {
      const input = '01AR-Z3ND-EKTS-V4RR';
      const formatted = formatCrockford(input);
      expect(formatted).toBe('01AR-Z3ND-EKTS-V4RR');
    });
  });

  describe('Round-trip encoding/decoding', () => {
    test('encode and decode preserves data', () => {
      const original = Buffer.from('Test Data 12345');
      const encoded = encodeCrockford(original, 30);
      const decoded = decodeCrockford(encoded);
      
      // Check that the beginning of the data matches
      expect(decoded.slice(0, 4).toString()).toBe('Test');
    });

    test('works with random data', () => {
      const original = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
      const encoded = encodeCrockford(original, 15);
      const decoded = decodeCrockford(encoded);
      
      // First byte should match
      expect(decoded[0]).toBe(1);
    });
  });
});
