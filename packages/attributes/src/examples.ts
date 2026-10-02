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
 * Examples demonstrating the attribute listing functions
 */

import AttributeManager from './index';

/**
 * Example 1: Basic attribute storage and listing
 */
export async function example1_BasicListing() {
  console.log('\n=== Example 1: Basic Attribute Listing ===\n');
  
  const attrManager = new AttributeManager();
  
  // Add attributes for multiple GCUIDs
  attrManager.setAttributes('urn:gcuid:person:1:01HQZX1Y2K3M4N5P6Q7R8S9T0V', {
    email: 'alice@example.com',
    firstName: 'Alice',
    lastName: 'Smith',
    department: 'Engineering',
    role: 'Senior Engineer'
  });
  
  attrManager.setAttributes('urn:gcuid:person:1:01HQZX2Z3K4M5N6P7Q8R9S0T1W', {
    email: 'bob@example.com',
    firstName: 'Bob',
    lastName: 'Jones',
    department: 'Sales',
    role: 'Account Manager'
  });
  
  attrManager.setAttributes('urn:gcuid:person:1:01HQZX3A4K5M6N7P8Q9R0S1T2X', {
    email: 'charlie@example.com',
    firstName: 'Charlie',
    lastName: 'Brown',
    department: 'Engineering',
    role: 'Staff Engineer'
  });
  
  // List all GCUIDs
  console.log('All GCUIDs with attributes:');
  const gcuids = attrManager.listGCUIDs();
  gcuids.forEach(gcuid => {
    console.log(`  - ${gcuid}`);
  });
  
  // Get statistics
  console.log('\nStatistics:');
  const stats = attrManager.getStatistics();
  console.log(`  Total GCUIDs: ${stats.totalGCUIDs}`);
  console.log(`  Total Attributes: ${stats.totalAttributes}`);
  console.log(`  Average Attributes per GCUID: ${stats.averageAttributesPerGCUID.toFixed(2)}`);
  console.log('  Attributes by name:');
  Object.entries(stats.attributesByName).forEach(([name, count]) => {
    console.log(`    ${name}: ${count}`);
  });
  
  // List all unique attribute names
  console.log('\nAll attribute names in the system:');
  const names = attrManager.getAttributeNames();
  console.log(`  ${names.join(', ')}`);
}

/**
 * Example 2: Paginated listing with filters
 */
export async function example2_PaginatedListing() {
  console.log('\n=== Example 2: Paginated Listing with Filters ===\n');
  
  const attrManager = new AttributeManager();
  
  // Add more records
  for (let i = 0; i < 20; i++) {
    attrManager.setAttributes(`urn:gcuid:person:1:USER${i.toString().padStart(5, '0')}`, {
      email: `user${i}@example.com`,
      firstName: `User${i}`,
      lastName: 'Test',
      department: i % 3 === 0 ? 'Engineering' : i % 3 === 1 ? 'Sales' : 'Marketing',
      status: i % 2 === 0 ? 'active' : 'inactive'
    });
  }
  
  // List all attributes (first page)
  console.log('First 10 attributes:');
  let results = attrManager.listAttributes({ limit: 10, offset: 0 });
  console.log(`  Found ${results.total} total, showing ${results.results.length}`);
  console.log(`  Has more: ${results.hasMore}`);
  results.results.slice(0, 3).forEach(item => {
    console.log(`  - ${item.gcuid}: ${item.attribute.name} = ${item.attribute.value}`);
  });
  console.log('  ...');
  
  // List attributes filtered by GCUID
  console.log('\nAttributes for GCUIDs containing "USER0000":');
  results = attrManager.listAttributes({ 
    gcuidFilter: 'USER0000',
    limit: 10 
  });
  console.log(`  Found ${results.total} attributes`);
  results.results.forEach(item => {
    console.log(`  - ${item.attribute.name}: ${item.attribute.value}`);
  });
  
  // List only email attributes
  console.log('\nAll email attributes:');
  results = attrManager.listAttributes({ 
    attributeNameFilter: 'email',
    limit: 5
  });
  console.log(`  Found ${results.total} email attributes`);
  results.results.forEach(item => {
    console.log(`  - ${item.gcuid}: ${item.attribute.value}`);
  });
  
  // Search by value
  console.log('\nAttributes containing "Engineering":');
  results = attrManager.listAttributes({ 
    searchValue: 'Engineering',
    limit: 10
  });
  console.log(`  Found ${results.total} matching attributes`);
  results.results.forEach(item => {
    console.log(`  - ${item.gcuid}: ${item.attribute.name} = ${item.attribute.value}`);
  });
}

/**
 * Example 3: Search by attribute value
 */
export async function example3_SearchByValue() {
  console.log('\n=== Example 3: Search by Attribute Value ===\n');
  
  const attrManager = new AttributeManager();
  
  // Add test data
  attrManager.setAttributes('urn:gcuid:person:1:ALICE001', {
    email: 'alice.smith@example.com',
    firstName: 'Alice',
    lastName: 'Smith',
    department: 'Engineering'
  });
  
  attrManager.setAttributes('urn:gcuid:person:1:ALICE002', {
    email: 'alice.jones@example.com',
    firstName: 'Alice',
    lastName: 'Jones',
    department: 'Sales'
  });
  
  attrManager.setAttributes('urn:gcuid:person:1:BOB001', {
    email: 'bob.smith@example.com',
    firstName: 'Bob',
    lastName: 'Smith',
    department: 'Engineering'
  });
  
  // Search for all people named Alice (fuzzy search)
  console.log('Search for firstName containing "alice":');
  let results = attrManager.searchByAttributeValue('firstName', 'alice', { 
    exactMatch: false 
  });
  console.log(`  Found ${results.length} matches`);
  results.forEach(item => {
    console.log(`  - ${item.gcuid}: ${item.attribute.value}`);
  });
  
  // Search for exact match
  console.log('\nSearch for exact firstName "Alice":');
  results = attrManager.searchByAttributeValue('firstName', 'Alice', { 
    exactMatch: true 
  });
  console.log(`  Found ${results.length} matches`);
  results.forEach(item => {
    console.log(`  - ${item.gcuid}: ${item.attribute.value}`);
  });
  
  // Search by department
  console.log('\nSearch for department "Engineering":');
  results = attrManager.searchByAttributeValue('department', 'Engineering', {
    exactMatch: true
  });
  console.log(`  Found ${results.length} matches`);
  results.forEach(item => {
    const attrs = attrManager.getAllAttributesForGCUID(item.gcuid);
    if (attrs) {
      console.log(`  - ${attrs.firstName.value} ${attrs.lastName.value} (${item.attribute.value})`);
    }
  });
}

/**
 * Example 4: Get all attributes for specific GCUIDs
 */
export async function example4_GetAllAttributes() {
  console.log('\n=== Example 4: Get All Attributes for GCUIDs ===\n');
  
  const attrManager = new AttributeManager();
  
  // Add test data
  const gcuid1 = 'urn:gcuid:person:1:TEST001';
  const gcuid2 = 'urn:gcuid:person:1:TEST002';
  const gcuid3 = 'urn:gcuid:person:1:TEST003';
  
  attrManager.setAttributes(gcuid1, {
    email: 'test1@example.com',
    firstName: 'Test',
    lastName: 'User1',
    role: 'Admin'
  });
  
  attrManager.setAttributes(gcuid2, {
    email: 'test2@example.com',
    firstName: 'Test',
    lastName: 'User2',
    role: 'User',
    status: 'active'
  });
  
  // Get all attributes for each GCUID
  console.log(`All attributes for ${gcuid1}:`);
  let attrs = attrManager.getAllAttributesForGCUID(gcuid1);
  if (attrs) {
    Object.entries(attrs).forEach(([name, attr]) => {
      console.log(`  ${name}: ${attr.value} (source: ${attr.source}, updated: ${attr.updatedAt.toISOString()})`);
    });
  }
  
  console.log(`\nAll attributes for ${gcuid2}:`);
  attrs = attrManager.getAllAttributesForGCUID(gcuid2);
  if (attrs) {
    Object.entries(attrs).forEach(([name, attr]) => {
      console.log(`  ${name}: ${attr.value}`);
    });
  }
  
  console.log(`\nAll attributes for ${gcuid3} (non-existent):`);
  attrs = attrManager.getAllAttributesForGCUID(gcuid3);
  console.log(`  ${attrs === null ? 'No attributes found' : 'Found attributes'}`);
  
  // Count attributes per GCUID
  console.log('\nAttribute counts:');
  console.log(`  ${gcuid1}: ${attrManager.countAttributes(gcuid1)} attributes`);
  console.log(`  ${gcuid2}: ${attrManager.countAttributes(gcuid2)} attributes`);
  console.log(`  ${gcuid3}: ${attrManager.countAttributes(gcuid3)} attributes`);
}

/**
 * Example 5: Comprehensive workflow
 */
export async function example5_ComprehensiveWorkflow() {
  console.log('\n=== Example 5: Comprehensive Workflow ===\n');
  
  const attrManager = new AttributeManager();
  
  // Simulate a real-world scenario
  console.log('1. Adding users from an employee directory...');
  const employees = [
    { id: 'EMP001', email: 'john.doe@company.com', name: 'John Doe', dept: 'Engineering', level: 'Senior' },
    { id: 'EMP002', email: 'jane.smith@company.com', name: 'Jane Smith', dept: 'Engineering', level: 'Staff' },
    { id: 'EMP003', email: 'bob.wilson@company.com', name: 'Bob Wilson', dept: 'Sales', level: 'Manager' },
    { id: 'EMP004', email: 'alice.brown@company.com', name: 'Alice Brown', dept: 'Engineering', level: 'Senior' },
    { id: 'EMP005', email: 'charlie.davis@company.com', name: 'Charlie Davis', dept: 'Marketing', level: 'Junior' }
  ];
  
  employees.forEach(emp => {
    const gcuid = `urn:gcuid:person:1:${emp.id}`;
    attrManager.setAttributes(gcuid, {
      email: emp.email,
      fullName: emp.name,
      department: emp.dept,
      level: emp.level
    });
  });
  console.log(`  Added ${employees.length} employees`);
  
  // Show summary
  console.log('\n2. System statistics:');
  const stats = attrManager.getStatistics();
  console.log(`  Total identities: ${stats.totalGCUIDs}`);
  console.log(`  Total attributes: ${stats.totalAttributes}`);
  console.log(`  Avg attributes per identity: ${stats.averageAttributesPerGCUID.toFixed(1)}`);
  
  // Find all engineers
  console.log('\n3. Finding all Engineering department employees:');
  const engineers = attrManager.searchByAttributeValue('department', 'Engineering', {
    exactMatch: true
  });
  console.log(`  Found ${engineers.length} engineers:`);
  engineers.forEach(item => {
    const attrs = attrManager.getAllAttributesForGCUID(item.gcuid);
    if (attrs) {
      console.log(`    - ${attrs.fullName.value} (${attrs.level.value})`);
    }
  });
  
  // Find senior level employees
  console.log('\n4. Finding all Senior level employees:');
  const seniors = attrManager.searchByAttributeValue('level', 'Senior', {
    exactMatch: true
  });
  console.log(`  Found ${seniors.length} senior employees:`);
  seniors.forEach(item => {
    const attrs = attrManager.getAllAttributesForGCUID(item.gcuid);
    if (attrs) {
      console.log(`    - ${attrs.fullName.value} (${attrs.department.value})`);
    }
  });
  
  // List all emails
  console.log('\n5. All email addresses in the system:');
  const emails = attrManager.listAttributes({
    attributeNameFilter: 'email',
    limit: 100
  });
  emails.results.forEach(item => {
    console.log(`    - ${item.attribute.value}`);
  });
  
  // Show attribute distribution
  console.log('\n6. Attribute usage:');
  Object.entries(stats.attributesByName)
    .sort((a, b) => b[1] - a[1])
    .forEach(([name, count]) => {
      console.log(`    ${name}: ${count} records`);
    });
}

/**
 * Run all examples
 */
export async function runAllExamples() {
  console.log('='.repeat(60));
  console.log('ATTRIBUTE MANAGER LISTING FUNCTIONS - EXAMPLES');
  console.log('='.repeat(60));
  
  await example1_BasicListing();
  await example2_PaginatedListing();
  await example3_SearchByValue();
  await example4_GetAllAttributes();
  await example5_ComprehensiveWorkflow();
  
  console.log('\n' + '='.repeat(60));
  console.log('All examples completed successfully!');
  console.log('='.repeat(60));
}

// Run all examples if this file is executed directly
if (require.main === module) {
  runAllExamples().catch(console.error);
}
