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
 * Alias generation and validation for GCUID
 * 
 * Alias Format: GC-{CONTEXT}-{HASH}-{CHECKSUM}
 * - GC: Fixed prefix
 * - CONTEXT: Context code (A=alias, extensible)
 * - HASH: 12-character Crockford Base32 hash in 3 groups of 4
 * - CHECKSUM: 1-character ISO 7064 MOD 37,36 checksum
 * 
 * Example: GC-A-ABCD-EFGH-IJKL-M
 * 
 * Regex: ^GC-[A-Z]+(-[0-9A-HJKMNP-TV-Z]{4}){3}-[0-9A-Z]$
 */

import * as crypto from 'crypto';
import { isValidCrockford, normalizeCrockford, CROCKFORD_ALPHABET } from './crockford-base32';

/**
 * Alias component structure
 */
export interface AliasComponents {
  prefix: 'GC';
  context: string;
  hash: string;      // 12 characters (without hyphens)
  checksum: string;  // 1 character
}

/**
 * Options for alias generation
 */
export interface AliasGenerationOptions {
  context?: string;
  hashAlgorithm?: 'sha256' | 'sha512';
}

/**
 * Alias validation regex
 */
export const ALIAS_REGEX = /^GC-[A-Z]+(-[0-9A-HJKMNP-TV-Z]{4}){3}-[0-9A-Z]$/;

/**
 * Context codes for aliases
 */
export enum AliasContext {
  ALIAS = 'A',        // General alias
  SHORT = 'S',        // Short form
  QR = 'Q',           // QR code optimized
  TEMPORARY = 'T',    // Temporary identifier
  PERMANENT = 'P',    // Permanent identifier
}

/**
 * Character set for ISO 7064 MOD 37,36 checksum
 */
const CHECKSUM_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Generate secure hash of core identifier
 * Takes first 60 bits of SHA-256 hash and encodes to 12 Crockford Base32 characters
 * 
 * @param core GCUID core identifier (26 characters)
 * @param algorithm Hash algorithm to use (default: sha256)
 * @returns 12-character Crockford Base32 hash
 */
function hashCore(core: string, algorithm: 'sha256' | 'sha512' = 'sha256'): string {
  // Validate core
  if (!core || typeof core !== 'string') {
    throw new Error('Core identifier cannot be empty');
  }

  // Normalize core (uppercase, remove hyphens)
  const normalizedCore = normalizeCrockford(core);

  // Generate hash
  const hash = crypto.createHash(algorithm).update(normalizedCore).digest();

  // Take first 8 bytes (64 bits), we'll use 60 bits for 12 base32 chars
  const hashBytes = hash.slice(0, 8);

  // Convert to bit string
  let bits = '';
  for (const byte of hashBytes) {
    bits += byte.toString(2).padStart(8, '0');
  }

  // Take first 60 bits and convert to Crockford Base32 (12 chars * 5 bits)
  let result = '';
  for (let i = 0; i < 60; i += 5) {
    const chunk = bits.slice(i, i + 5);
    const value = parseInt(chunk, 2);
    result += CROCKFORD_ALPHABET[value];
  }

  return result.slice(0, 12);
}

/**
 * Calculate ISO 7064 MOD 37,36 checksum
 * 
 * Algorithm:
 * 1. Start with checksum = 37
 * 2. For each character: checksum = ((checksum + char_value) * 2) % 37
 * 3. Final checksum = (37 - checksum + 1) % 37
 * 
 * @param data Data to calculate checksum for (without hyphens)
 * @returns Single character checksum
 */
function calculateChecksum(data: string): string {
  if (!data || typeof data !== 'string') {
    throw new Error('Data cannot be empty');
  }

  const normalized = data.toUpperCase().replace(/-/g, '');
  const MOD = 37;
  let checksum = MOD;

  for (const char of normalized) {
    const value = CHECKSUM_CHARSET.indexOf(char);
    if (value === -1) {
      throw new Error(`Invalid character for checksum: ${char}`);
    }

    checksum = ((checksum + value) * 2) % MOD;
  }

  checksum = (MOD - checksum + 1) % MOD;

  // Ensure checksum is within charset bounds (0-35)
  if (checksum >= CHECKSUM_CHARSET.length) {
    checksum = checksum % CHECKSUM_CHARSET.length;
  }

  // Return character from charset
  return CHECKSUM_CHARSET[checksum];
}

/**
 * Generate alias from GCUID core identifier
 * 
 * @param core GCUID core identifier (26 characters)
 * @param options Alias generation options
 * @returns Formatted alias (e.g., GC-A-ABCD-EFGH-IJKL-M)
 */
export function generateAlias(
  core: string,
  options: AliasGenerationOptions = {}
): string {
  const { context = AliasContext.ALIAS, hashAlgorithm = 'sha256' } = options;

  // Validate inputs
  if (!isValidCrockford(core)) {
    throw new Error('Invalid core identifier: must be valid Crockford Base32');
  }

  if (!/^[A-Z]+$/.test(context)) {
    throw new Error('Context must be uppercase letters only');
  }

  if (context.length === 0 || context.length > 10) {
    throw new Error('Context must be between 1 and 10 characters');
  }

  // Normalize core
  const normalizedCore = normalizeCrockford(core);

  // Generate hash
  const hash = hashCore(normalizedCore, hashAlgorithm);

  // Format hash with hyphens (groups of 4)
  const hashFormatted = `${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}`;

  // Calculate checksum on the complete data (without hyphens in hash)
  const checksumData = `GC${context}${hash}`;
  const checksum = calculateChecksum(checksumData);

  // Build alias
  return `GC-${context}-${hashFormatted}-${checksum}`;
}

/**
 * Parse alias into components
 * 
 * @param alias Alias string to parse
 * @returns Parsed alias components
 */
export function parseAlias(alias: string): AliasComponents {
  if (!alias || typeof alias !== 'string') {
    throw new Error('Alias cannot be empty');
  }

  // Validate format
  const match = alias.match(/^GC-([A-Z]+)-([0-9A-HJKMNP-TV-Z]{4})-([0-9A-HJKMNP-TV-Z]{4})-([0-9A-HJKMNP-TV-Z]{4})-([0-9A-Z])$/);

  if (!match) {
    throw new Error('Invalid alias format');
  }

  const [, context, hash1, hash2, hash3, checksum] = match;

  return {
    prefix: 'GC',
    context,
    hash: `${hash1}${hash2}${hash3}`,
    checksum
  };
}

/**
 * Validate alias format and checksum
 * 
 * @param alias Alias string to validate
 * @returns True if alias is valid (correct format and checksum)
 */
export function validateAlias(alias: string): boolean {
  try {
    const parsed = parseAlias(alias);

    // Recalculate checksum
    const checksumData = `GC${parsed.context}${parsed.hash}`;
    const expectedChecksum = calculateChecksum(checksumData);

    // Compare checksums
    return parsed.checksum === expectedChecksum;
  } catch {
    return false;
  }
}

/**
 * Format alias with proper hyphenation
 * Also validates and normalizes the alias
 * 
 * @param alias Alias string (may be with or without hyphens)
 * @returns Properly formatted alias
 */
export function formatAlias(alias: string): string {
  const parsed = parseAlias(alias);
  const hashFormatted = `${parsed.hash.slice(0, 4)}-${parsed.hash.slice(4, 8)}-${parsed.hash.slice(8, 12)}`;
  return `GC-${parsed.context}-${hashFormatted}-${parsed.checksum}`;
}

/**
 * Get the hash portion of an alias (without hyphens)
 * 
 * @param alias Alias string
 * @returns 12-character hash
 */
export function getAliasHash(alias: string): string {
  const parsed = parseAlias(alias);
  return parsed.hash;
}

/**
 * Get the context code from an alias
 * 
 * @param alias Alias string
 * @returns Context code (e.g., 'A')
 */
export function getAliasContext(alias: string): string {
  const parsed = parseAlias(alias);
  return parsed.context;
}

/**
 * Check if a string looks like an alias (basic format check)
 * Does not validate checksum
 * 
 * @param str String to check
 * @returns True if string matches alias format
 */
export function isAliasFormat(str: string): boolean {
  if (!str || typeof str !== 'string') {
    return false;
  }
  return ALIAS_REGEX.test(str);
}

/**
 * Verify that an alias was generated from a specific GCUID core
 * 
 * @param alias Alias to verify
 * @param core GCUID core identifier
 * @param options Generation options (must match original generation)
 * @returns True if alias matches the core
 */
export function verifyAliasForCore(
  alias: string,
  core: string,
  options: AliasGenerationOptions = {}
): boolean {
  try {
    const expectedAlias = generateAlias(core, options);
    return alias === expectedAlias;
  } catch {
    return false;
  }
}

/**
 * Compare two aliases for equality
 * Normalizes format before comparison
 * 
 * @param alias1 First alias
 * @param alias2 Second alias
 * @returns True if aliases are equal
 */
export function compareAliases(alias1: string, alias2: string): boolean {
  try {
    const formatted1 = formatAlias(alias1);
    const formatted2 = formatAlias(alias2);
    return formatted1 === formatted2;
  } catch {
    return false;
  }
}

/**
 * Generate multiple aliases with different contexts for the same core
 * 
 * @param core GCUID core identifier
 * @param contexts Array of context codes
 * @param options Additional generation options
 * @returns Map of context to alias
 */
export function generateMultipleAliases(
  core: string,
  contexts: string[],
  options: Omit<AliasGenerationOptions, 'context'> = {}
): Map<string, string> {
  const aliases = new Map<string, string>();

  for (const context of contexts) {
    const alias = generateAlias(core, { ...options, context });
    aliases.set(context, alias);
  }

  return aliases;
}
