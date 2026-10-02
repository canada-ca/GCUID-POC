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
 * Matching Configuration Profiles
 * 
 * Defines how to match and compare attributes from different authoritative sources.
 * Each source can have its own matching profile with specific rules, weights, and normalization.
 */

/**
 * Matching strategy for a specific attribute
 */
export interface AttributeMatchingStrategy {
  /** Attribute name in the source */
  attributeName: string;
  
  /** Weight in overall confidence calculation (0-1) */
  weight: number;
  
  /** Match type */
  matchType: 'exact' | 'fuzzy' | 'phonetic' | 'numeric' | 'date' | 'custom';
  
  /** Fuzzy matching threshold (0-1, only for fuzzy matches) */
  fuzzyThreshold?: number;
  
  /** Whether to normalize before comparing */
  normalize?: boolean;
  
  /** Custom normalization function name */
  normalizerName?: string;
  
  /** Custom matcher function name */
  matcherName?: string;
  
  /** Whether this is a required match (must match for record to be considered) */
  required?: boolean;
  
  /** Boost factor when this attribute matches exactly */
  exactMatchBoost?: number;
  
  /** Description of what this attribute represents */
  description?: string;
}

/**
 * Matching profile for an authoritative source
 */
export interface SourceMatchingProfile {
  /** Source identifier */
  sourceId: string;
  
  /** Source name */
  sourceName: string;
  
  /** Attribute matching strategies */
  attributeStrategies: AttributeMatchingStrategy[];
  
  /** Minimum number of attributes that must match */
  minAttributeMatches?: number;
  
  /** Minimum confidence score to return a match (0-1) */
  minConfidenceThreshold: number;
  
  /** Maximum confidence score boost for multiple matches */
  maxConfidenceBoost?: number;
  
  /** Whether to use source-level fuzzy logic */
  useSourceFuzzyLogic: boolean;
  
  /** Whether to apply centralized heuristics */
  applyCentralizedHeuristics: boolean;
  
  /** Source-specific configuration */
  sourceSpecificConfig?: Record<string, any>;
}

/**
 * Global matching heuristics configuration
 */
export interface GlobalMatchingHeuristics {
  /** Email matching rules */
  email: {
    /** Treat +aliases as same email (user+tag@domain.com = user@domain.com) */
    ignorePlusAliases: boolean;
    
    /** Treat dots in Gmail as insignificant (user.name@gmail.com = username@gmail.com) */
    ignoreGmailDots: boolean;
    
    /** Minimum confidence for email match */
    minConfidence: number;
    
    /** Confidence boost for exact email match */
    exactMatchBoost: number;
  };
  
  /** Name matching rules */
  name: {
    /** Use phonetic matching (Soundex, Metaphone, etc.) */
    usePhonetic: boolean;
    
    /** Phonetic algorithm */
    phoneticAlgorithm?: 'soundex' | 'metaphone' | 'double-metaphone';
    
    /** Allow nickname matching (Bob = Robert, etc.) */
    allowNicknames: boolean;
    
    /** Minimum confidence for name match */
    minConfidence: number;
    
    /** Weight for first name */
    firstNameWeight: number;
    
    /** Weight for last name */
    lastNameWeight: number;
    
    /** Weight for middle name/initial */
    middleNameWeight: number;
  };
  
  /** Date matching rules */
  date: {
    /** Allow fuzzy date matching (within N days) */
    allowFuzzyMatching: boolean;
    
    /** Days tolerance for fuzzy matching */
    fuzzyToleranceDays?: number;
    
    /** Minimum confidence for date match */
    minConfidence: number;
  };
  
  /** Identifier matching rules */
  identifier: {
    /** Consider identifiers definitive if they match */
    identifiersAreDefinitive: boolean;
    
    /** Confidence for identifier match */
    identifierMatchConfidence: number;
  };
  
  /** Composite scoring rules */
  composite: {
    /** Decay factor for additional weak matches */
    decayFactor: number;
    
    /** Bonus for matching multiple high-weight attributes */
    multiMatchBonus: number;
    
    /** Penalty for mismatched high-weight attributes */
    mismatchPenalty: number;
    
    /** Whether to use geometric mean vs arithmetic mean */
    useGeometricMean: boolean;
  };
}

/**
 * Predefined matching profiles for common source types
 */
export const DEFAULT_MATCHING_PROFILES: Record<string, SourceMatchingProfile> = {
  'hr-system': {
    sourceId: 'hr-system',
    sourceName: 'HR System',
    minConfidenceThreshold: 0.4,
    useSourceFuzzyLogic: true,
    applyCentralizedHeuristics: true,
    attributeStrategies: [
      {
        attributeName: 'employee_id',
        weight: 1.0,
        matchType: 'exact',
        required: false,
        exactMatchBoost: 1.5,
        description: 'Employee identifier - definitive match'
      },
      {
        attributeName: 'email',
        weight: 0.95,
        matchType: 'fuzzy',
        fuzzyThreshold: 0.9,
        normalize: true,
        normalizerName: 'email',
        description: 'Work email address'
      },
      {
        attributeName: 'first_name',
        weight: 0.4,
        matchType: 'phonetic',
        fuzzyThreshold: 0.8,
        normalize: true,
        normalizerName: 'name',
        description: 'First name with phonetic matching'
      },
      {
        attributeName: 'last_name',
        weight: 0.5,
        matchType: 'phonetic',
        fuzzyThreshold: 0.8,
        normalize: true,
        normalizerName: 'name',
        description: 'Last name with phonetic matching'
      },
      {
        attributeName: 'phone',
        weight: 0.7,
        matchType: 'fuzzy',
        fuzzyThreshold: 0.85,
        normalize: true,
        normalizerName: 'phone',
        description: 'Phone number'
      },
      {
        attributeName: 'hire_date',
        weight: 0.3,
        matchType: 'date',
        normalize: true,
        description: 'Hire date (low weight, supplementary)'
      }
    ],
    minAttributeMatches: 2
  },
  
  'ldap-ad': {
    sourceId: 'ldap-ad',
    sourceName: 'LDAP/Active Directory',
    minConfidenceThreshold: 0.4,
    useSourceFuzzyLogic: true,
    applyCentralizedHeuristics: true,
    attributeStrategies: [
      {
        attributeName: 'distinguished_name',
        weight: 1.0,
        matchType: 'exact',
        required: false,
        exactMatchBoost: 1.5,
        description: 'Distinguished Name - definitive match'
      },
      {
        attributeName: 'username',
        weight: 0.9,
        matchType: 'exact',
        exactMatchBoost: 1.3,
        description: 'Username/sAMAccountName'
      },
      {
        attributeName: 'email',
        weight: 0.95,
        matchType: 'fuzzy',
        fuzzyThreshold: 0.9,
        normalize: true,
        normalizerName: 'email',
        description: 'Email address'
      },
      {
        attributeName: 'given_name',
        weight: 0.4,
        matchType: 'phonetic',
        fuzzyThreshold: 0.8,
        normalize: true,
        normalizerName: 'name',
        description: 'Given name (first name)'
      },
      {
        attributeName: 'surname',
        weight: 0.5,
        matchType: 'phonetic',
        fuzzyThreshold: 0.8,
        normalize: true,
        normalizerName: 'name',
        description: 'Surname (last name)'
      },
      {
        attributeName: 'employee_number',
        weight: 0.95,
        matchType: 'exact',
        description: 'Employee number'
      }
    ],
    minAttributeMatches: 2
  },
  
  'customer-db': {
    sourceId: 'customer-db',
    sourceName: 'Customer Database',
    minConfidenceThreshold: 0.35,
    useSourceFuzzyLogic: true,
    applyCentralizedHeuristics: true,
    attributeStrategies: [
      {
        attributeName: 'customer_id',
        weight: 1.0,
        matchType: 'exact',
        required: false,
        exactMatchBoost: 1.5,
        description: 'Customer identifier - definitive match'
      },
      {
        attributeName: 'email',
        weight: 0.95,
        matchType: 'fuzzy',
        fuzzyThreshold: 0.9,
        normalize: true,
        normalizerName: 'email',
        description: 'Customer email address'
      },
      {
        attributeName: 'first_name',
        weight: 0.35,
        matchType: 'phonetic',
        fuzzyThreshold: 0.75,
        normalize: true,
        normalizerName: 'name',
        description: 'First name'
      },
      {
        attributeName: 'last_name',
        weight: 0.45,
        matchType: 'phonetic',
        fuzzyThreshold: 0.75,
        normalize: true,
        normalizerName: 'name',
        description: 'Last name'
      },
      {
        attributeName: 'phone',
        weight: 0.65,
        matchType: 'fuzzy',
        fuzzyThreshold: 0.8,
        normalize: true,
        normalizerName: 'phone',
        description: 'Phone number'
      },
      {
        attributeName: 'account_created',
        weight: 0.2,
        matchType: 'date',
        normalize: true,
        description: 'Account creation date'
      }
    ],
    minAttributeMatches: 2,
    sourceSpecificConfig: {
      // Customer DB may have lower quality data
      relaxedMatching: true,
      allowPartialMatches: true
    }
  }
};

/**
 * Default global heuristics
 */
export const DEFAULT_GLOBAL_HEURISTICS: GlobalMatchingHeuristics = {
  email: {
    ignorePlusAliases: true,
    ignoreGmailDots: true,
    minConfidence: 0.9,
    exactMatchBoost: 1.2
  },
  name: {
    usePhonetic: true,
    phoneticAlgorithm: 'metaphone',
    allowNicknames: true,
    minConfidence: 0.7,
    firstNameWeight: 0.4,
    lastNameWeight: 0.6,
    middleNameWeight: 0.2
  },
  date: {
    allowFuzzyMatching: true,
    fuzzyToleranceDays: 7,
    minConfidence: 0.8
  },
  identifier: {
    identifiersAreDefinitive: true,
    identifierMatchConfidence: 1.0
  },
  composite: {
    decayFactor: 0.9,
    multiMatchBonus: 0.15,
    mismatchPenalty: 0.1,
    useGeometricMean: false
  }
};

/**
 * Load matching profile for a source
 */
export function getMatchingProfile(sourceId: string): SourceMatchingProfile {
  return DEFAULT_MATCHING_PROFILES[sourceId] || createDefaultProfile(sourceId);
}

/**
 * Create a default profile for unknown sources
 */
function createDefaultProfile(sourceId: string): SourceMatchingProfile {
  return {
    sourceId,
    sourceName: sourceId,
    minConfidenceThreshold: 0.5,
    useSourceFuzzyLogic: true,
    applyCentralizedHeuristics: true,
    attributeStrategies: [
      {
        attributeName: 'email',
        weight: 0.9,
        matchType: 'fuzzy',
        fuzzyThreshold: 0.85,
        normalize: true,
        normalizerName: 'email'
      },
      {
        attributeName: 'name',
        weight: 0.7,
        matchType: 'fuzzy',
        fuzzyThreshold: 0.75,
        normalize: true,
        normalizerName: 'name'
      }
    ],
    minAttributeMatches: 1
  };
}
