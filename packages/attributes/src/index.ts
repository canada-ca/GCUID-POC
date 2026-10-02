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
 * Attribute management and retrieval system
 * Handles local attribute storage and federated attribute delegation
 */

import { FederationManager } from '@gcuid/federation';

export interface Attribute {
  name: string;
  value: any;
  source: 'local' | 'federated';
  entityId?: string;
  updatedAt: Date;
}

export interface AttributeQuery {
  gcuid: string;
  attributes: string[];
  includeFederated?: boolean;
}

export class AttributeManager {
  private localAttributes: Map<string, Map<string, Attribute>> = new Map();
  private federationManager?: FederationManager;

  constructor(federationManager?: FederationManager) {
    this.federationManager = federationManager;
  }

  /**
   * Store attributes locally for a GCUID
   */
  setAttributes(gcuid: string, attributes: Record<string, any>): void {
    if (!this.localAttributes.has(gcuid)) {
      this.localAttributes.set(gcuid, new Map());
    }

    const userAttrs = this.localAttributes.get(gcuid)!;
    const now = new Date();

    for (const [name, value] of Object.entries(attributes)) {
      userAttrs.set(name, {
        name,
        value,
        source: 'local',
        updatedAt: now
      });
    }
  }

  /**
   * Retrieve attributes for a GCUID
   */
  async getAttributes(query: AttributeQuery): Promise<Record<string, Attribute>> {
    const result: Record<string, Attribute> = {};

    // Get local attributes
    const userAttrs = this.localAttributes.get(query.gcuid);
    if (userAttrs) {
      for (const attrName of query.attributes) {
        const attr = userAttrs.get(attrName);
        if (attr) {
          result[attrName] = attr;
        }
      }
    }

    // Query federated attributes if requested and available
    if (query.includeFederated && this.federationManager) {
      const missingAttrs = query.attributes.filter(name => !result[name]);
      if (missingAttrs.length > 0) {
        // TODO: Implement federated attribute retrieval logic
        // This would query registered federated entities for missing attributes
      }
    }

    return result;
  }

  /**
   * Delete attributes for a GCUID
   */
  deleteAttributes(gcuid: string, attributeNames?: string[]): void {
    if (!attributeNames) {
      this.localAttributes.delete(gcuid);
      return;
    }

    const userAttrs = this.localAttributes.get(gcuid);
    if (userAttrs) {
      for (const name of attributeNames) {
        userAttrs.delete(name);
      }
    }
  }

  /**
   * List all GCUIDs that have attributes stored
   */
  listGCUIDs(): string[] {
    return Array.from(this.localAttributes.keys());
  }

  /**
   * Get all attributes for a specific GCUID
   */
  getAllAttributesForGCUID(gcuid: string): Record<string, Attribute> | null {
    const userAttrs = this.localAttributes.get(gcuid);
    if (!userAttrs) {
      return null;
    }

    const result: Record<string, Attribute> = {};
    for (const [name, attr] of userAttrs.entries()) {
      result[name] = attr;
    }
    return result;
  }

  /**
   * List all attributes across all GCUIDs with optional filtering and pagination
   */
  listAttributes(options?: {
    limit?: number;
    offset?: number;
    gcuidFilter?: string;
    attributeNameFilter?: string;
    searchValue?: string;
  }): {
    results: Array<{ gcuid: string; attribute: Attribute }>;
    total: number;
    hasMore: boolean;
  } {
    const {
      limit = 100,
      offset = 0,
      gcuidFilter,
      attributeNameFilter,
      searchValue
    } = options || {};

    const allResults: Array<{ gcuid: string; attribute: Attribute }> = [];

    // Collect all attributes
    for (const [gcuid, userAttrs] of this.localAttributes.entries()) {
      // Apply GCUID filter
      if (gcuidFilter && !gcuid.includes(gcuidFilter)) {
        continue;
      }

      for (const [attrName, attr] of userAttrs.entries()) {
        // Apply attribute name filter
        if (attributeNameFilter && !attrName.toLowerCase().includes(attributeNameFilter.toLowerCase())) {
          continue;
        }

        // Apply value search filter
        if (searchValue) {
          const valueStr = String(attr.value).toLowerCase();
          if (!valueStr.includes(searchValue.toLowerCase())) {
            continue;
          }
        }

        allResults.push({ gcuid, attribute: attr });
      }
    }

    const total = allResults.length;
    const paginatedResults = allResults.slice(offset, offset + limit);
    const hasMore = offset + limit < total;

    return {
      results: paginatedResults,
      total,
      hasMore
    };
  }

  /**
   * Search for GCUIDs by attribute value
   */
  searchByAttributeValue(attributeName: string, searchValue: string, options?: {
    exactMatch?: boolean;
    limit?: number;
  }): Array<{ gcuid: string; attribute: Attribute }> {
    const { exactMatch = false, limit = 50 } = options || {};
    const results: Array<{ gcuid: string; attribute: Attribute }> = [];

    for (const [gcuid, userAttrs] of this.localAttributes.entries()) {
      const attr = userAttrs.get(attributeName);
      if (!attr) {
        continue;
      }

      const valueStr = String(attr.value);
      const matches = exactMatch
        ? valueStr === searchValue
        : valueStr.toLowerCase().includes(searchValue.toLowerCase());

      if (matches) {
        results.push({ gcuid, attribute: attr });
        if (results.length >= limit) {
          break;
        }
      }
    }

    return results;
  }

  /**
   * Get statistics about stored attributes
   */
  getStatistics(): {
    totalGCUIDs: number;
    totalAttributes: number;
    attributesByName: Record<string, number>;
    averageAttributesPerGCUID: number;
  } {
    let totalAttributes = 0;
    const attributesByName: Record<string, number> = {};

    for (const userAttrs of this.localAttributes.values()) {
      totalAttributes += userAttrs.size;
      for (const attrName of userAttrs.keys()) {
        attributesByName[attrName] = (attributesByName[attrName] || 0) + 1;
      }
    }

    const totalGCUIDs = this.localAttributes.size;
    const averageAttributesPerGCUID = totalGCUIDs > 0 ? totalAttributes / totalGCUIDs : 0;

    return {
      totalGCUIDs,
      totalAttributes,
      attributesByName,
      averageAttributesPerGCUID
    };
  }

  /**
   * Get all unique attribute names stored in the system
   */
  getAttributeNames(): string[] {
    const names = new Set<string>();
    for (const userAttrs of this.localAttributes.values()) {
      for (const name of userAttrs.keys()) {
        names.add(name);
      }
    }
    return Array.from(names).sort();
  }

  /**
   * Count attributes for a specific GCUID
   */
  countAttributes(gcuid: string): number {
    const userAttrs = this.localAttributes.get(gcuid);
    return userAttrs ? userAttrs.size : 0;
  }
}

export default AttributeManager;
