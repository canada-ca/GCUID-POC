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
 * Mock implementation of uuid for Jest tests
 * This avoids ESM compatibility issues with uuid v13+
 */

let counter = 0;

export function v4(): string {
  // Generate a deterministic UUID-like string for testing
  counter++;
  const hex = counter.toString(16).padStart(32, '0');
  // Format as UUID: 8-4-4-4-12
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(16, 19)}-${hex.slice(19, 31)}`;
}

export function validate(uuid: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

export const NIL = '00000000-0000-0000-0000-000000000000';
