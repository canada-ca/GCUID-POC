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
 * Crockford Base32 encoding/decoding
 * 
 * Crockford Base32 is a base-32 notation using the following 32 characters:
 * 0123456789ABCDEFGHJKMNPQRSTVWXYZ
 * 
 * Excluded characters:
 * - I (can be confused with 1)
 * - L (can be confused with 1)
 * - O (can be confused with 0)
 * - U (accidental obscenity)
 * 
 * This matches the encoding used by ULID and is URL-safe.
 */

/**
 * Crockford Base32 alphabet (32 characters)
 */
export const CROCKFORD_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Regex pattern for validating Crockford Base32 strings
 */
export const CROCKFORD_REGEX = /^[0-9A-HJKMNP-TV-Z]+$/;

/**
 * Regex pattern for 26-character Crockford Base32 (GCUID core)
 */
export const CROCKFORD_26_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Create reverse lookup map for decoding
 */
const ALPHABET_MAP = new Map<string, number>();
for (let i = 0; i < CROCKFORD_ALPHABET.length; i++) {
  ALPHABET_MAP.set(CROCKFORD_ALPHABET[i], i);
}

/**
 * Validate if a string is valid Crockford Base32
 * 
 * @param str String to validate
 * @returns True if valid Crockford Base32
 */
export function isValidCrockford(str: string): boolean {
  if (!str || typeof str !== 'string') {
    return false;
  }
  const normalized = str.toUpperCase().replace(/-/g, '');
  return CROCKFORD_REGEX.test(normalized);
}

/**
 * Validate if a string is a valid 26-character GCUID core
 * 
 * @param str String to validate
 * @returns True if valid 26-character Crockford Base32
 */
export function isValidGCUIDCore(str: string): boolean {
  if (!str || typeof str !== 'string') {
    return false;
  }
  return CROCKFORD_26_REGEX.test(str);
}

/**
 * Encode bytes to Crockford Base32 string
 * 
 * @param buffer Buffer containing bytes to encode
 * @param length Desired output length in characters (default: 26)
 * @returns Crockford Base32 encoded string
 */
export function encodeCrockford(buffer: Buffer, length: number = 26): string {
  if (!buffer || buffer.length === 0) {
    throw new Error('Buffer cannot be empty');
  }

  if (length <= 0) {
    throw new Error('Length must be positive');
  }

  // Convert bytes to bit string
  let bits = '';
  for (const byte of buffer) {
    bits += byte.toString(2).padStart(8, '0');
  }

  // Convert to Base32 (5 bits per character)
  let result = '';
  const maxBits = Math.min(length * 5, bits.length);
  
  for (let i = 0; i < maxBits; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    const value = parseInt(chunk, 2);
    result += CROCKFORD_ALPHABET[value];
  }

  // Pad result to desired length if needed
  while (result.length < length) {
    result += CROCKFORD_ALPHABET[0];
  }

  return result.slice(0, length);
}

/**
 * Decode Crockford Base32 string to bytes
 * 
 * @param encoded Crockford Base32 encoded string
 * @returns Buffer containing decoded bytes
 */
export function decodeCrockford(encoded: string): Buffer {
  if (!encoded || typeof encoded !== 'string') {
    throw new Error('Encoded string cannot be empty');
  }

  // Normalize: uppercase and remove hyphens
  const normalized = encoded.toUpperCase().replace(/-/g, '');

  // Validate
  if (!isValidCrockford(normalized)) {
    throw new Error('Invalid Crockford Base32 string');
  }

  // Convert characters to bit string
  let bits = '';
  for (const char of normalized) {
    const value = ALPHABET_MAP.get(char);
    if (value === undefined) {
      throw new Error(`Invalid character in Crockford Base32: ${char}`);
    }
    bits += value.toString(2).padStart(5, '0');
  }

  // Convert bit string to bytes
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    const byte = bits.slice(i, i + 8);
    bytes.push(parseInt(byte, 2));
  }

  return Buffer.from(bytes);
}

/**
 * Convert UUID (with hyphens) to Crockford Base32 (26 characters)
 * 
 * @param uuid UUID string (e.g., "550e8400-e29b-41d4-a716-446655440000")
 * @returns 26-character Crockford Base32 string
 */
export function uuidToCrockford(uuid: string): string {
  if (!uuid || typeof uuid !== 'string') {
    throw new Error('UUID cannot be empty');
  }

  // Remove hyphens from UUID
  const hex = uuid.replace(/-/g, '');

  // Validate hex string
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new Error('Invalid UUID format');
  }

  // Convert hex to buffer
  const buffer = Buffer.from(hex, 'hex');

  // Encode to Crockford Base32 (26 characters)
  return encodeCrockford(buffer, 26);
}

/**
 * Convert ULID to Crockford Base32
 * Note: ULID is already in Crockford Base32 format, so this just validates
 * 
 * @param ulid ULID string (26 characters)
 * @returns The same ULID string (validated)
 */
export function ulidToCrockford(ulid: string): string {
  if (!ulid || typeof ulid !== 'string') {
    throw new Error('ULID cannot be empty');
  }

  // ULID is already Crockford Base32, just validate
  if (!isValidGCUIDCore(ulid)) {
    throw new Error('Invalid ULID format');
  }

  return ulid.toUpperCase();
}

/**
 * Normalize Crockford Base32 string (uppercase, remove hyphens)
 * 
 * @param str Crockford Base32 string
 * @returns Normalized string
 */
export function normalizeCrockford(str: string): string {
  if (!str || typeof str !== 'string') {
    throw new Error('String cannot be empty');
  }
  return str.toUpperCase().replace(/-/g, '');
}

/**
 * Format Crockford Base32 string with hyphens for readability
 * Formats as groups of 4: XXXX-XXXX-XXXX-XXXX-XXXX-XX
 * 
 * @param str Crockford Base32 string
 * @param groupSize Size of each group (default: 4)
 * @returns Formatted string with hyphens
 */
export function formatCrockford(str: string, groupSize: number = 4): string {
  const normalized = normalizeCrockford(str);
  const groups: string[] = [];

  for (let i = 0; i < normalized.length; i += groupSize) {
    groups.push(normalized.slice(i, i + groupSize));
  }

  return groups.join('-');
}
