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
 * Data Normalization Modules
 * 
 * Provides standardization and normalization of data retrieved from authoritative sources
 * to enable better comparison and matching across different systems.
 */

/**
 * Normalized data record
 */
export interface NormalizedRecord {
  /** Original raw data */
  raw: Record<string, any>;
  
  /** Normalized data with standard field names */
  normalized: Record<string, any>;
  
  /** Normalization metadata */
  metadata: {
    /** Source of the data */
    source: string;
    
    /** Normalization timestamp */
    normalizedAt: Date;
    
    /** Which normalizers were applied */
    normalizersApplied: string[];
    
    /** Any warnings or issues during normalization */
    warnings?: string[];
  };
}

/**
 * Normalizer interface
 */
export interface Normalizer {
  /** Normalizer name */
  name: string;
  
  /** Normalize a value */
  normalize(value: any): any;
  
  /** Validate if a value can be normalized */
  canNormalize(value: any): boolean;
}

/**
 * Email normalizer
 * - Converts to lowercase
 * - Removes +aliases (user+tag@domain.com -> user@domain.com)
 * - Handles Gmail dot normalization (for matching purposes)
 */
export class EmailNormalizer implements Normalizer {
  name = 'email';
  
  normalize(value: any): string | null {
    if (!this.canNormalize(value)) {
      return null;
    }
    
    let email = String(value).trim().toLowerCase();
    
    // Remove +aliases
    email = email.replace(/\+[^@]+@/, '@');
    
    // Gmail specific: remove dots before @
    if (email.endsWith('@gmail.com') || email.endsWith('@googlemail.com')) {
      const [localPart, domain] = email.split('@');
      email = localPart.replace(/\./g, '') + '@' + domain;
    }
    
    return email;
  }
  
  canNormalize(value: any): boolean {
    if (!value) return false;
    const str = String(value);
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(str);
  }
}

/**
 * Name normalizer
 * - Converts to title case
 * - Removes extra whitespace
 * - Handles common prefixes/suffixes
 * - Removes special characters
 */
export class NameNormalizer implements Normalizer {
  name = 'name';
  
  private prefixes = ['mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'rev'];
  private suffixes = ['jr', 'sr', 'ii', 'iii', 'iv', 'esq', 'phd', 'md'];
  
  normalize(value: any): string | null {
    if (!this.canNormalize(value)) {
      return null;
    }
    
    let name = String(value).trim();
    
    // Remove special characters except spaces, hyphens, apostrophes
    name = name.replace(/[^a-zA-Z\s\-']/g, '');
    
    // Normalize whitespace
    name = name.replace(/\s+/g, ' ');
    
    // Convert to lowercase for processing
    const parts = name.toLowerCase().split(' ');
    
    // Remove prefixes and suffixes
    const filtered = parts.filter(part => 
      !this.prefixes.includes(part.replace('.', '')) &&
      !this.suffixes.includes(part.replace('.', ''))
    );
    
    // Title case
    const titleCased = filtered.map(part => 
      part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
    );
    
    return titleCased.join(' ');
  }
  
  canNormalize(value: any): boolean {
    if (!value) return false;
    const str = String(value).trim();
    return str.length > 0 && /[a-zA-Z]/.test(str);
  }
}

/**
 * Phone normalizer
 * - Removes all non-numeric characters
 * - Standardizes to E.164 format when possible
 * - Handles North American and international formats
 */
export class PhoneNormalizer implements Normalizer {
  name = 'phone';
  
  normalize(value: any): string | null {
    if (!this.canNormalize(value)) {
      return null;
    }
    
    // Remove all non-numeric characters
    let phone = String(value).replace(/\D/g, '');
    
    // Handle North American numbers (10 or 11 digits)
    if (phone.length === 10) {
      // Add +1 country code
      phone = '1' + phone;
    } else if (phone.length === 11 && phone.startsWith('1')) {
      // Already has country code
    } else if (phone.length > 11) {
      // International number - keep as is
    } else {
      // Invalid length
      return null;
    }
    
    return '+' + phone;
  }
  
  canNormalize(value: any): boolean {
    if (!value) return false;
    const digits = String(value).replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15;
  }
}

/**
 * Date normalizer
 * - Converts various date formats to ISO 8601
 * - Handles common date parsing issues
 */
export class DateNormalizer implements Normalizer {
  name = 'date';
  
  normalize(value: any): string | null {
    if (!this.canNormalize(value)) {
      return null;
    }
    
    let date: Date;
    
    if (value instanceof Date) {
      date = value;
    } else if (typeof value === 'number') {
      // Unix timestamp
      date = new Date(value);
    } else {
      // Try to parse string
      date = new Date(value);
    }
    
    if (isNaN(date.getTime())) {
      return null;
    }
    
    // Return ISO 8601 date (YYYY-MM-DD)
    return date.toISOString().split('T')[0];
  }
  
  canNormalize(value: any): boolean {
    if (!value) return false;
    
    if (value instanceof Date) {
      return !isNaN(value.getTime());
    }
    
    if (typeof value === 'number') {
      return value > 0;
    }
    
    if (typeof value === 'string') {
      const parsed = new Date(value);
      return !isNaN(parsed.getTime());
    }
    
    return false;
  }
}

/**
 * Address normalizer
 * - Standardizes street abbreviations
 * - Normalizes case and spacing
 * - Removes apartment/suite numbers for matching
 */
export class AddressNormalizer implements Normalizer {
  name = 'address';
  
  private abbreviations: Record<string, string> = {
    'street': 'st',
    'avenue': 'ave',
    'road': 'rd',
    'boulevard': 'blvd',
    'drive': 'dr',
    'lane': 'ln',
    'court': 'ct',
    'place': 'pl',
    'north': 'n',
    'south': 's',
    'east': 'e',
    'west': 'w'
  };
  
  normalize(value: any): string | null {
    if (!this.canNormalize(value)) {
      return null;
    }
    
    let address = String(value).toLowerCase().trim();
    
    // Remove apartment/suite/unit numbers
    address = address.replace(/\s+(apt|suite|unit|#)\s*[a-z0-9\-]+/gi, '');
    
    // Normalize whitespace
    address = address.replace(/\s+/g, ' ');
    
    // Apply abbreviations
    for (const [full, abbr] of Object.entries(this.abbreviations)) {
      const regex = new RegExp('\\b' + full + '\\b', 'gi');
      address = address.replace(regex, abbr);
    }
    
    return address;
  }
  
  canNormalize(value: any): boolean {
    if (!value) return false;
    const str = String(value).trim();
    return str.length > 0;
  }
}

/**
 * SSN/Identifier normalizer
 * - Removes formatting characters
 * - Standardizes format
 */
export class IdentifierNormalizer implements Normalizer {
  name = 'identifier';
  
  normalize(value: any): string | null {
    if (!this.canNormalize(value)) {
      return null;
    }
    
    // Remove all non-alphanumeric characters
    return String(value).replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  }
  
  canNormalize(value: any): boolean {
    if (!value) return false;
    return String(value).trim().length > 0;
  }
}

/**
 * Normalizer registry
 */
export class NormalizerRegistry {
  private normalizers: Map<string, Normalizer> = new Map();
  
  constructor() {
    // Register default normalizers
    this.register(new EmailNormalizer());
    this.register(new NameNormalizer());
    this.register(new PhoneNormalizer());
    this.register(new DateNormalizer());
    this.register(new AddressNormalizer());
    this.register(new IdentifierNormalizer());
  }
  
  register(normalizer: Normalizer): void {
    this.normalizers.set(normalizer.name, normalizer);
  }
  
  get(name: string): Normalizer | undefined {
    return this.normalizers.get(name);
  }
  
  has(name: string): boolean {
    return this.normalizers.has(name);
  }
  
  normalize(normalizerName: string, value: any): any {
    const normalizer = this.get(normalizerName);
    if (!normalizer) {
      throw new Error(`Normalizer not found: ${normalizerName}`);
    }
    return normalizer.normalize(value);
  }
}

/**
 * Record normalizer that applies multiple normalizers
 */
export class RecordNormalizer {
  private registry: NormalizerRegistry;
  
  constructor(registry?: NormalizerRegistry) {
    this.registry = registry || new NormalizerRegistry();
  }
  
  /**
   * Normalize a complete record based on field mapping
   */
  normalizeRecord(
    record: Record<string, any>,
    fieldMapping: Record<string, string>,
    source: string
  ): NormalizedRecord {
    const normalized: Record<string, any> = {};
    const normalizersApplied: string[] = [];
    const warnings: string[] = [];
    
    for (const [sourceField, normalizerName] of Object.entries(fieldMapping)) {
      const value = record[sourceField];
      
      if (value === undefined || value === null) {
        continue;
      }
      
      try {
        const normalizedValue = this.registry.normalize(normalizerName, value);
        
        if (normalizedValue !== null) {
          normalized[sourceField] = normalizedValue;
          
          // Also add under normalized field name if different
          const standardFieldName = this.getStandardFieldName(sourceField);
          if (standardFieldName !== sourceField) {
            normalized[standardFieldName] = normalizedValue;
          }
          
          if (!normalizersApplied.includes(normalizerName)) {
            normalizersApplied.push(normalizerName);
          }
        } else {
          warnings.push(`Failed to normalize ${sourceField} with ${normalizerName}`);
        }
      } catch (error) {
        warnings.push(`Error normalizing ${sourceField}: ${(error as Error).message}`);
      }
    }
    
    return {
      raw: { ...record },
      normalized,
      metadata: {
        source,
        normalizedAt: new Date(),
        normalizersApplied,
        warnings: warnings.length > 0 ? warnings : undefined
      }
    };
  }
  
  /**
   * Get standard field name (maps source-specific names to standard names)
   */
  private getStandardFieldName(sourceField: string): string {
    const mapping: Record<string, string> = {
      // Name fields
      'first_name': 'firstName',
      'given_name': 'firstName',
      'givenName': 'firstName',
      'last_name': 'lastName',
      'surname': 'lastName',
      'family_name': 'lastName',
      'sn': 'lastName',
      
      // Email fields
      'email': 'email',
      'mail': 'email',
      'emailAddress': 'email',
      
      // Phone fields
      'phone': 'phone',
      'telephone': 'phone',
      'phone_number': 'phone',
      'telephoneNumber': 'phone',
      
      // Identifier fields
      'employee_id': 'employeeId',
      'customer_id': 'customerId',
      'distinguished_name': 'distinguishedName',
      'username': 'username',
      'sAMAccountName': 'username'
    };
    
    return mapping[sourceField] || sourceField;
  }
}

// Export singleton instance
export const normalizerRegistry = new NormalizerRegistry();
export const recordNormalizer = new RecordNormalizer(normalizerRegistry);
