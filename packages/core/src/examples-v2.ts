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
/*!
 * GCUID V2 Format Examples
 * 
 * This file demonstrates the new V2 format features including:
 * - Simplified format: urn:gcuid:{core}
 * - Human-readable aliases: GC-A-XXXX-YYYY-ZZZZ-C
 * - Format conversion (V1 to V2)
 * - Backward compatibility
 */

import { GCUIDManager, CoreIdType, GCUIDFormatVersion, IdentityRegistry } from './index';

const manager = new GCUIDManager();

console.log('====================================');
console.log('GCUID V2 Format Examples');
console.log('====================================\n');

// ==================== Example 1: Generate V2 GCUID ====================
console.log('Example 1: Generate V2 GCUID (Simplified Format)');
console.log('------------------------------------------------');

const v2Gcuid = manager.generateV2() as string;
console.log('Generated V2 GCUID:');
console.log(`  ${v2Gcuid}`);
console.log(`  Length: ${v2Gcuid.length} characters (fixed)`);
console.log(`  Format: urn:gcuid:{core}`);
console.log('');

// Parse the V2 GCUID
const parsedV2 = manager.parseV2(v2Gcuid);
console.log('Parsed Components:');
console.log(`  URN: ${parsedV2.urn}`);
console.log(`  Namespace: ${parsedV2.namespace}`);
console.log(`  Core: ${parsedV2.core}`);
console.log(`  Format Version: ${parsedV2.formatVersion} (V2)`);
console.log('');

// ==================== Example 2: Generate V2 with Alias ====================
console.log('Example 2: Generate V2 GCUID with Human-Readable Alias');
console.log('-------------------------------------------------------');

const result = manager.generateV2({ 
  coreIdType: CoreIdType.ULID,
  generateAlias: true,
  aliasContext: 'A'  // A = Alias context
});

if (typeof result === 'object') {
  console.log('Generated V2 GCUID with Alias:');
  console.log(`  GCUID: ${result.gcuid}`);
  console.log(`  Alias: ${result.alias}`);
  console.log(`  Core:  ${result.core}`);
  console.log('');
  console.log('Alias Format: GC-{CONTEXT}-{HASH}-{CHECKSUM}');
  console.log(`  Prefix: GC (Global Citizen)`);
  console.log(`  Context: A (Default alias context)`);
  console.log(`  Hash: 12-character hash of core (3 groups of 4)`);
  console.log(`  Checksum: ISO 7064 MOD 37,36 validation digit`);
  console.log('');
}

// ==================== Example 3: Generate Alias for Existing GCUID ====================
console.log('Example 3: Generate Alias for Existing GCUID');
console.log('---------------------------------------------');

const existingGcuid = manager.generateV2() as string;
const alias = manager.generateAliasForGCUID(existingGcuid, 'S');  // S = System context

console.log(`GCUID: ${existingGcuid}`);
console.log(`Alias: ${alias}`);
console.log(`Context: S (System-generated)`);
console.log('');

// Validate the alias
const isValidAlias = manager.validateAlias(alias);
console.log(`Alias Valid: ${isValidAlias ? '✓ Yes' : '✗ No'}`);
console.log('');

// ==================== Example 4: Multiple Contexts ====================
console.log('Example 4: Generate Multiple Aliases for Same GCUID');
console.log('----------------------------------------------------');

const baseGcuid = manager.generateV2() as string;
const aliasA = manager.generateAliasForGCUID(baseGcuid, 'A');  // Default alias
const aliasS = manager.generateAliasForGCUID(baseGcuid, 'S');  // System
const aliasQ = manager.generateAliasForGCUID(baseGcuid, 'Q');  // Query result
const aliasT = manager.generateAliasForGCUID(baseGcuid, 'T');  // Temporary
const aliasP = manager.generateAliasForGCUID(baseGcuid, 'P');  // Persistent

console.log(`Base GCUID: ${baseGcuid}`);
console.log('\nAliases for Different Contexts:');
console.log(`  A (Default):    ${aliasA}`);
console.log(`  S (System):     ${aliasS}`);
console.log(`  Q (Query):      ${aliasQ}`);
console.log(`  T (Temporary):  ${aliasT}`);
console.log(`  P (Persistent): ${aliasP}`);
console.log('');
console.log('Note: Each context generates a unique alias with the same core hash.');
console.log('');

// ==================== Example 5: Format Conversion (V1 to V2) ====================
console.log('Example 5: Convert V1 GCUID to V2 Format');
console.log('-----------------------------------------');

const v1Gcuid = manager.generate({
  entityType: 'person',
  version: 1,
  coreIdType: CoreIdType.ULID
});

console.log('Original V1 GCUID:');
console.log(`  ${v1Gcuid}`);
console.log(`  Length: ${v1Gcuid.length} characters (variable)`);

// Convert to V2
const convertedV2 = manager.convertToV2(v1Gcuid, true);  // With alias

if (convertedV2.alias) {
  console.log('\nConverted to V2:');
  console.log(`  GCUID: ${convertedV2.gcuid}`);
  console.log(`  Alias: ${convertedV2.alias}`);
  console.log(`  Length: ${convertedV2.gcuid.length} characters (fixed)`);
  console.log('');
  
  // Extract entity type from V1
  const parsedV1 = manager.parseV1(v1Gcuid);
  console.log('V1 Metadata (now stored separately in V2):');
  console.log(`  Entity Type: ${parsedV1.entityType}`);
  console.log(`  Version: ${parsedV1.version}`);
  console.log('');
  console.log('Note: In V2, entity type and version are metadata, not part of the URN.');
  console.log('');
}

// ==================== Example 6: Dual-Format Support ====================
console.log('Example 6: Dual-Format Support (Backward Compatibility)');
console.log('--------------------------------------------------------');

const v1Sample = manager.generate({ entityType: 'org', version: 1 });
const v2Sample = manager.generateV2() as string;

console.log('Parsing both formats with auto-detection:');
console.log('');

// Parse V1 (auto-detects)
const parsedV1Auto = manager.parse(v1Sample);
console.log(`V1 Input: ${v1Sample}`);
console.log(`  Detected: V${parsedV1Auto.formatVersion} (Legacy)`);
if ('entityType' in parsedV1Auto) {
  console.log(`  Entity Type: ${parsedV1Auto.entityType}`);
  console.log(`  Version: ${parsedV1Auto.version}`);
}
console.log('');

// Parse V2 (auto-detects)
const parsedV2Auto = manager.parse(v2Sample);
console.log(`V2 Input: ${v2Sample}`);
console.log(`  Detected: V${parsedV2Auto.formatVersion} (Current)`);
console.log(`  Core: ${parsedV2Auto.core}`);
console.log('');

console.log('Validation works for both formats:');
console.log(`  V1 Valid: ${manager.validate(v1Sample) ? '✓' : '✗'}`);
console.log(`  V2 Valid: ${manager.validate(v2Sample) ? '✓' : '✗'}`);
console.log('');

// ==================== Example 7: Create Identity with V2 ====================
console.log('Example 7: Create Identity Record with V2 Format');
console.log('-------------------------------------------------');

const identityV2 = manager.createIdentityV2({
  coreIdType: CoreIdType.ULID,
  entityType: 'person',
  generateAlias: true,
  aliasContext: 'P',
  metadata: {
    source: 'example-v2.ts',
    purpose: 'demonstration',
    features: ['v2-format', 'alias', 'crockford-base32']
  }
});

console.log('Created Identity V2:');
console.log(`  GCUID: ${identityV2.gcuid}`);
console.log(`  Alias: ${identityV2.alias}`);
console.log(`  Entity Type: ${identityV2.entityType}`);
console.log(`  Format Version: ${identityV2.formatVersion}`);
console.log(`  Created: ${identityV2.createdAt.toISOString()}`);
console.log('');
console.log('Metadata:');
console.log(JSON.stringify(identityV2.metadata, null, 2));
console.log('');

// ==================== Example 8: Registry with Alias Lookup ====================
console.log('Example 8: Registry Operations with Alias');
console.log('------------------------------------------');

const registry = new IdentityRegistry(':memory:', manager);

// Create and register a V2 identity with alias
const identityWithAlias = manager.createIdentityV2({
  coreIdType: CoreIdType.ULID,
  entityType: 'asset',
  generateAlias: true,
  aliasContext: 'A'
});

console.log('Registering V2 Identity:');
console.log(`  GCUID: ${identityWithAlias.gcuid}`);
console.log(`  Alias: ${identityWithAlias.alias}`);
console.log('');

// Register in database
const entry = registry.register(identityWithAlias as any, 'V2 example registration');

console.log('Registered Successfully:');
console.log(`  State: ${entry.state}`);
console.log(`  Format Version: ${entry.formatVersion}`);
console.log('');

// Lookup by GCUID
const foundByGcuid = registry.get(identityWithAlias.gcuid);
console.log('Lookup by GCUID:');
console.log(`  Found: ${foundByGcuid ? '✓ Yes' : '✗ No'}`);
if (foundByGcuid) {
  console.log(`  Alias: ${foundByGcuid.alias}`);
}
console.log('');

// Lookup by Alias
if (identityWithAlias.alias) {
  const foundByAlias = registry.findByAlias(identityWithAlias.alias);
  console.log('Lookup by Alias:');
  console.log(`  Found: ${foundByAlias ? '✓ Yes' : '✗ No'}`);
  if (foundByAlias) {
    console.log(`  GCUID: ${foundByAlias.gcuid}`);
    console.log(`  Entity Type: ${foundByAlias.entityType}`);
  }
  console.log('');
}

registry.close();

// ==================== Example 9: Format Comparison ====================
console.log('Example 9: V1 vs V2 Format Comparison');
console.log('--------------------------------------');

const comparisonV1 = manager.generate({ 
  entityType: 'app', 
  version: 1, 
  coreIdType: CoreIdType.ULID 
});

const comparisonV2Result = manager.generateV2({ 
  coreIdType: CoreIdType.ULID,
  generateAlias: true,
  aliasContext: 'A'
});

const comparisonV2 = typeof comparisonV2Result === 'string' 
  ? comparisonV2Result 
  : comparisonV2Result.gcuid;

const comparisonAlias = typeof comparisonV2Result === 'object' 
  ? comparisonV2Result.alias 
  : undefined;

console.log('Format Comparison Table:');
console.log('');
console.log('┌─────────────────────────┬──────────────────────┬──────────────────────┐');
console.log('│ Attribute               │ V1 (Legacy)          │ V2 (Current)         │');
console.log('├─────────────────────────┼──────────────────────┼──────────────────────┤');
console.log(`│ Format                  │ ${padRight('urn:gcuid:{...}', 20)} │ ${padRight('urn:gcuid:{core}', 20)} │`);
console.log(`│ Length                  │ ${padRight(comparisonV1.length + ' chars (variable)', 20)} │ ${padRight(comparisonV2.length + ' chars (fixed)', 20)} │`);
console.log(`│ Entity in URN           │ ${padRight('✓ Yes', 20)} │ ${padRight('✗ No (metadata)', 20)} │`);
console.log(`│ Version in URN          │ ${padRight('✓ Yes', 20)} │ ${padRight('✗ No (metadata)', 20)} │`);
console.log(`│ Human-readable Alias    │ ${padRight('✗ No', 20)} │ ${padRight('✓ Yes', 20)} │`);
console.log(`│ Core Encoding           │ ${padRight('Base32 (RFC 4648)', 20)} │ ${padRight('Crockford Base32', 20)} │`);
console.log(`│ Core Length             │ ${padRight('26 characters', 20)} │ ${padRight('26 characters', 20)} │`);
console.log('└─────────────────────────┴──────────────────────┴──────────────────────┘');
console.log('');

if (comparisonAlias) {
  console.log('V2 Human-Readable Alias:');
  console.log(`  ${comparisonAlias}`);
  console.log(`  Length: ${comparisonAlias.length} characters`);
  console.log(`  Format: GC-{CONTEXT}-{HASH groups}-{CHECKSUM}`);
  console.log('');
}

console.log('Examples:');
console.log(`  V1: ${comparisonV1}`);
console.log(`  V2: ${comparisonV2}`);
if (comparisonAlias) {
  console.log(`  V2 Alias: ${comparisonAlias}`);
}
console.log('');

// ==================== Example 10: Crockford Base32 Benefits ====================
console.log('Example 10: Crockford Base32 Benefits');
console.log('-------------------------------------');

console.log('Crockford Base32 Alphabet:');
console.log('  0123456789ABCDEFGHJKMNPQRSTVWXYZ');
console.log('');
console.log('Excluded Characters (for human readability):');
console.log('  I, L, O, U');
console.log('');
console.log('Benefits:');
console.log('  ✓ No confusion between I (letter) and 1 (number)');
console.log('  ✓ No confusion between O (letter) and 0 (number)');
console.log('  ✓ No confusion between L (letter) and 1 (number)');
console.log('  ✓ No offensive words (U excluded)');
console.log('  ✓ Case-insensitive (normalized to uppercase)');
console.log('  ✓ Checksum validation in aliases');
console.log('');

console.log('Sample Core (Crockford Base32):');
const sampleResult = manager.generateV2() as string;
const sampleCore = manager.parseV2(sampleResult).core;
console.log(`  ${sampleCore}`);
console.log(`  Length: ${sampleCore.length} characters`);
console.log(`  Valid Characters: ${/^[0-9A-HJKMNP-TV-Z]{26}$/.test(sampleCore) ? '✓' : '✗'}`);
console.log('');

// ==================== Summary ====================
console.log('====================================');
console.log('Summary: Why Use V2?');
console.log('====================================');
console.log('');
console.log('1. Simplified Format');
console.log('   - Fixed length (37 characters)');
console.log('   - Cleaner URN structure');
console.log('   - Entity type as metadata (flexible)');
console.log('');
console.log('2. Human-Readable Aliases');
console.log('   - Easier to share and communicate');
console.log('   - Multiple contexts per GCUID');
console.log('   - Checksum validation built-in');
console.log('');
console.log('3. Improved Encoding');
console.log('   - Crockford Base32 (human-friendly)');
console.log('   - No ambiguous characters');
console.log('   - Case-insensitive');
console.log('');
console.log('4. Backward Compatible');
console.log('   - All V1 operations still supported');
console.log('   - Auto-detection of format');
console.log('   - Migration tools available');
console.log('');
console.log('5. Enhanced Features');
console.log('   - Format version tracking in database');
console.log('   - Alias-based lookups');
console.log('   - Flexible metadata storage');
console.log('');
console.log('====================================');
console.log('');

// Helper function for padding
function padRight(str: string, length: number): string {
  return str + ' '.repeat(Math.max(0, length - str.length));
}
