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
 * Unit tests for `computeConnectorHttpMatchConfidence` in
 * `staging/api/lib/source-scan.ts`.
 *
 * SC-SR-7 in TEST_PLAN.md. Regression coverage for the Lucas O'Neill /
 * Lucas Pham auto-link bug (urn:gcuid:01KVTQ3VK5VVJZWTYK6AKGE8WN).
 *
 * The function is the security-critical counterpart to the connector
 * HTTP /search endpoint. It computes confidence based on which query
 * attributes actually agree with the candidate record, rather than
 * blindly returning 0.90 for every record the connector returns.
 */

import { computeConnectorHttpMatchConfidence } from '../../lib/source-scan';

describe('computeConnectorHttpMatchConfidence', () => {

  // ── Email-match paths ──────────────────────────────────────────────

  test('SC-SR-7: email + first_name + last_name all agree → 0.98', () => {
    const r = computeConnectorHttpMatchConfidence(
      { email: 'lucas.oneill@department.gc.ca', first_name: 'Lucas', last_name: "O'Neill" },
      { email: 'lucas.oneill@department.gc.ca', first_name: 'Lucas', last_name: "O'Neill" },
    );
    expect(r.confidence).toBe(0.98);
    expect(r.matched.sort()).toEqual(['person.email', 'person.name.family', 'person.name.given']);
  });

  test('email + first_name (no last_name match) → 0.98', () => {
    const r = computeConnectorHttpMatchConfidence(
      { email: 'a@b.com', first_name: 'Lucas', last_name: "O'Neill" },
      { email: 'a@b.com', first_name: 'Lucas', last_name: 'Pham' },  // last_name disagrees
    );
    // Note: this is a real-world identity mismatch — different last names with
    // the same email is essentially impossible (emails are functionally unique),
    // so we treat email + any name attribute as a 0.98 match. The user.ts
    // defense-in-depth check (isConsistentMatch) would still filter this out
    // at the source_mapping insertion step if BOTH email and last_name are
    // claimed by the user.
    expect(r.confidence).toBe(0.98);
  });

  test('email alone → 0.95', () => {
    const r = computeConnectorHttpMatchConfidence(
      { email: 'a@b.com' },
      { email: 'a@b.com' },
    );
    expect(r.confidence).toBe(0.95);
    expect(r.matched).toEqual(['person.email']);
  });

  // ── Name-only paths ────────────────────────────────────────────────

  test('SC-SR-7: first_name + last_name agree, no email → 0.55', () => {
    const r = computeConnectorHttpMatchConfidence(
      { first_name: 'Lucas', last_name: "O'Neill" },
      { first_name: 'Lucas', last_name: "O'Neill" },
    );
    expect(r.confidence).toBe(0.55);
  });

  test('SC-SR-7: only first_name matches (Lucas O\'Neill vs Lucas Pham) → 0.30', () => {
    // This is the bug case: the connector returns Lucas Pham because
    // first_name=Lucas matched, and the OLD code marked it 0.90.
    // The fix downgrades to 0.30 (well below strongMatchThreshold=0.9).
    const r = computeConnectorHttpMatchConfidence(
      { email: 'lucas.oneill@department.gc.ca', first_name: 'Lucas', last_name: "O'Neill" },
      { email: 'lucas.pham@department.gc.ca',    first_name: 'Lucas', last_name: 'Pham' },
    );
    expect(r.confidence).toBe(0.30);
    expect(r.matched).toEqual(['person.name.given']);
  });

  test('only last_name matches → 0.30', () => {
    const r = computeConnectorHttpMatchConfidence(
      { first_name: 'Lucas', last_name: "O'Neill" },
      { first_name: 'Sarah', last_name: "O'Neill" },
    );
    expect(r.confidence).toBe(0.30);
    expect(r.matched).toEqual(['person.name.family']);
  });

  // ── Rejection paths ────────────────────────────────────────────────

  test('SC-SR-7: no overlap at all → 0 (reject)', () => {
    const r = computeConnectorHttpMatchConfidence(
      { email: 'a@b.com', first_name: 'Lucas', last_name: "O'Neill" },
      { email: 'x@y.com', first_name: 'Sarah', last_name: 'Pham' },
    );
    expect(r.confidence).toBe(0);
    expect(r.matched).toEqual([]);
  });

  test('record missing the queried fields → 0', () => {
    const r = computeConnectorHttpMatchConfidence(
      { email: 'a@b.com', first_name: 'Lucas', last_name: "O'Neill" },
      { employee_id: 'E999' },  // no name or email
    );
    expect(r.confidence).toBe(0);
  });

  // ── Normalization ──────────────────────────────────────────────────

  test('email matching is case-insensitive and whitespace-tolerant', () => {
    const r = computeConnectorHttpMatchConfidence(
      { email: '  LUCAS.Oneill@Department.GC.CA  ' },
      { email: 'lucas.oneill@department.gc.ca' },
    );
    expect(r.confidence).toBe(0.95);
  });

  test('non-string record fields are tolerated (treated as non-match)', () => {
    const r = computeConnectorHttpMatchConfidence(
      { email: 'a@b.com' },
      { email: null as any },
    );
    expect(r.confidence).toBe(0);
  });
});