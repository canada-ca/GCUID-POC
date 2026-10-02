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
 * GCUID Examples - V2 Format (Current) and V1 Format (Legacy)
 * 
 * This file demonstrates:
 * - V2 format (default, simplified)
 * - V1 format (backward compatibility)
 * - Alias generation (V2 feature)
 * - Format conversion
 * - Parsing and validation
 */

import { GCUIDManager, EntityType, CoreIdType } from './index';

// Create a GCUID manager instance
const manager = new GCUIDManager();

console.log('====================================');
console.log('GCUID Examples - V2 & V1 Formats');
console.log('====================================\n');

console.log('=== V2 Format Examples (Current) ===\n');

// Example 1: Generate V2 GCUID (default, simplified format)
console.log('1. Generate V2 GCUID (default, simplified):');
const personV2 = manager.generateV2() as string;
console.log(`   ${personV2}`);
console.log(`   Format: urn:gcuid:{core}`);
console.log(`   Length: ${personV2.length} chars (fixed)\n`);

// Example 2: Generate V2 with UUID
console.log('2. Generate V2 GCUID with UUID:');
const orgV2 = manager.generateV2({ coreIdType: CoreIdType.UUID }) as string;
console.log(`   ${orgV2}\n`);

// Example 3: Generate V2 with Alias
console.log('3. Generate V2 GCUID with human-readable alias:');
const resultWithAlias = manager.generateV2({ 
  coreIdType: CoreIdType.ULID,
  generateAlias: true,
  aliasContext: 'A'
});
if (typeof resultWithAlias === 'object') {
  console.log(`   GCUID: ${resultWithAlias.gcuid}`);
  console.log(`   Alias: ${resultWithAlias.alias}`);
  console.log(`   Format: GC-{CONTEXT}-{HASH}-{CHECKSUM}\n`);
}

// Example 4: Parse V2 GCUID
console.log('4. Parse V2 GCUID:');
const parsedV2 = manager.parseV2(personV2);
console.log(`   Namespace: ${parsedV2.namespace}`);
console.log(`   Core: ${parsedV2.core}`);
console.log(`   Format Version: ${parsedV2.formatVersion}\n`);

// Example 5: Generate Alias for existing V2 GCUID
console.log('5. Generate alias for existing V2 GCUID:');
const alias = manager.generateAliasForGCUID(personV2, 'A');
console.log(`   GCUID: ${personV2}`);
console.log(`   Alias: ${alias}`);
console.log(`   Valid: ${manager.validateAlias(alias)}\n`);

console.log('=== V1 Format Examples (Legacy - Backward Compatibility) ===\n');

// Example 6: Generate V1 GCUID for a person using ULID
console.log('6. Generate V1 GCUID for a person (ULID):');
const personV1 = manager.generate({
  entityType: EntityType.PERSON,
});
console.log(`   ${personV1}`);
console.log(`   Format: urn:gcuid:{entity-type}:{version}:{core}\n`);

// Example 7: Generate V1 GCUID for an organization using UUID
console.log('7. Generate V1 GCUID for an organization (UUID):');
const orgV1 = manager.generate({
  entityType: EntityType.ORG,
  coreIdType: CoreIdType.UUID,
});
console.log(`   ${orgV1}\n`);

// Example 8: Generate V1 GCUIDs for different entity types
console.log('8. Generate V1 GCUIDs for different entity types:');
const assetGCUID = manager.generate({ entityType: EntityType.ASSET });
const appGCUID = manager.generate({ entityType: EntityType.APP });
const agentGCUID = manager.generate({ entityType: EntityType.AGENT });
console.log(`   Asset:  ${assetGCUID}`);
console.log(`   App:    ${appGCUID}`);
console.log(`   Agent:  ${agentGCUID}\n`);

// Example 9: Parse V1 GCUID
console.log('9. Parse V1 GCUID:');
const parsedV1 = manager.parseV1(personV1);
console.log(`   Entity Type: ${parsedV1.entityType}`);
console.log(`   Version: ${parsedV1.version}`);
console.log(`   Core: ${parsedV1.core}`);
console.log(`   Format Version: ${parsedV1.formatVersion}\n`);

console.log('=== Format Conversion Examples ===\n');

// Example 10: Convert V1 to V2
console.log('10. Convert V1 GCUID to V2 format:');
const conversionResult = manager.convertToV2(personV1);
console.log(`   V1 (Legacy): ${personV1}`);
console.log(`   V2 (Current): ${conversionResult.gcuid}`);
console.log(`   Entity Type: ${conversionResult.entityType} (stored separately in V2)`);
console.log(`   Core Preserved: ${parsedV1.core === conversionResult.core}\n`);

// Example 11: Convert V1 to V2 with Alias
console.log('11. Convert V1 to V2 with alias generation:');
const conversionWithAlias = manager.convertToV2(orgV1, true);
console.log(`   V1: ${orgV1}`);
console.log(`   V2: ${conversionWithAlias.gcuid}`);
if (conversionWithAlias.alias) {
  console.log(`   Alias: ${conversionWithAlias.alias}\n`);
}

console.log('=== Validation Examples ===\n');

// Example 12: Validate GCUIDs (both formats)
console.log('12. Validate GCUIDs:');
console.log(`   Valid V2: ${manager.validate(personV2)}`);
console.log(`   Valid V1: ${manager.validate(personV1)}`);
console.log(`   Invalid: ${manager.validate('urn:gcuid:invalid')}\n`);

// Example 13: Validate Alias
console.log('13. Validate alias:');
console.log(`   Alias: ${alias}`);
console.log(`   Valid: ${manager.validateAlias(alias)}\n`);

console.log('=== Custom Entity Types ===\n');

// Example 14: Register and use custom entity type
console.log('14. Register custom entity type and generate V1 GCUID:');
manager.registerEntityType('device');
const deviceGCUID = manager.generate({ entityType: 'device' });
console.log(`   ${deviceGCUID}`);
console.log(`   Strict validation: ${manager.validate(deviceGCUID, { strictEntityType: true })}\n`);

// Example 15: List registered entity types
console.log('15. Registered entity types:');
console.log(`    ${manager.getRegisteredEntityTypes().join(', ')}\n`);

console.log('=== Identity Creation Examples ===\n');

// Example 16: Create V2 identity
console.log('16. Create V2 identity:');
const identityV2 = manager.createIdentityV2({
  metadata: {
    name: 'Jane Smith',
    email: 'jane.smith@example.com',
  },
});
console.log(`   GCUID: ${identityV2.gcuid}`);
console.log(`   Format: ${identityV2.formatVersion === 2 ? 'V2' : 'V1'}`);
console.log(`   Created: ${identityV2.createdAt.toISOString()}`);
console.log(`   Metadata:`, identityV2.metadata);
console.log();

// Example 17: Create V2 identity with alias
console.log('17. Create V2 identity with alias:');
const identityWithAlias = manager.createIdentityV2({
  generateAlias: true,
  aliasContext: 'P',  // P = Permanent
  metadata: {
    name: 'John Doe',
    email: 'john.doe@example.com',
    role: 'admin'
  },
});
console.log(`   GCUID: ${identityWithAlias.gcuid}`);
console.log(`   Alias: ${identityWithAlias.alias}`);
console.log(`   Format: V2`);
console.log(`   Metadata:`, identityWithAlias.metadata);
console.log();

// Example 18: Create V1 identity (legacy)
console.log('18. Create V1 identity (legacy):');
const identityV1 = manager.createIdentity({
  entityType: EntityType.PERSON,
  metadata: {
    name: 'Bob Johnson',
    department: 'Engineering',
  },
});
console.log(`   GCUID: ${identityV1.gcuid}`);
console.log(`   Entity Type: ${identityV1.entityType}`);
console.log(`   Format: V1 (Legacy)`);
console.log(`   Metadata:`, identityV1.metadata);
console.log();

console.log('=== Auto-Detection Examples ===\n');

// Example 19: Auto-detect format version
console.log('19. Auto-detect GCUID format:');
const detectV2 = manager.getFormatVersion(personV2);
const detectV1 = manager.getFormatVersion(personV1);
console.log(`   ${personV2}`);
console.log(`   Detected: V${detectV2}`);
console.log(`   ${personV1}`);
console.log(`   Detected: V${detectV1}\n`);

// Example 20: Parse with auto-detection
console.log('20. Parse with automatic format detection:');
const autoParsedV2 = manager.parse(personV2);
const autoParsedV1 = manager.parse(personV1);
console.log(`   V2 Core: ${autoParsedV2.core}`);
if ('entityType' in autoParsedV1) {
  console.log(`   V1 Core: ${autoParsedV1.core}, Entity: ${autoParsedV1.entityType}\n`);
}

console.log('=== Feature Comparison ===\n');
console.log('V2 Format (Current):');
console.log('  ✓ Shorter format (36 chars fixed)');
console.log('  ✓ Human-readable aliases');
console.log('  ✓ Better for APIs and URLs');
console.log('  ✓ Entity type stored separately');
console.log('');
console.log('V1 Format (Legacy):');
console.log('  ✓ Entity type embedded in URN');
console.log('  ✓ Fully backward compatible');
console.log('  ✓ Can be converted to V2');
console.log('');

console.log('====================================');
console.log('All Examples Complete!');
console.log('====================================');

// Example 12: Error handling
console.log('12. Error handling:');
try {
  manager.generate({ entityType: 'unknown' as EntityType });
} catch (error) {
  console.log(`   ✓ Caught error for unregistered type: ${(error as Error).message}`);
}

try {
  manager.parse('invalid-gcuid');
} catch (error) {
  console.log(`   ✓ Caught error for invalid format: ${(error as Error).message}`);
}

try {
  manager.generate({ entityType: EntityType.PERSON, version: 0 });
} catch (error) {
  console.log(`   ✓ Caught error for invalid version: ${(error as Error).message}`);
}
