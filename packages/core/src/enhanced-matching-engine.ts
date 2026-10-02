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
 * Enhanced Matching Engine
 * 
 * Integrates matching profiles, normalization, and fuzzy matching logic
 * to provide sophisticated duplicate detection across authoritative sources.
 */

import {
  SourceMatchingProfile,
  AttributeMatchingStrategy,
  getMatchingProfile,
  DEFAULT_GLOBAL_HEURISTICS
} from './matching-config';
import { RecordNormalizer, NormalizedRecord, normalizerRegistry } from './data-normalization';
import { CentralizedMatcher, MatchResult, StringSimilarity } from './fuzzy-matching';
import { SourceIdentityRecord } from './authoritative-source';
import { logDebug, logInfo } from './logger';

/**
 * Enhanced match result with detailed breakdown
 */
export interface EnhancedMatchResult {
  /** Overall confidence score (0-1) */
  confidence: number;
  
  /** Whether this is considered a match */
  isMatch: boolean;
  
  /** Source that provided the match */
  source: string;
  
  /** Source record identifier */
  identifier: string;
  
  /** Normalized records that were compared */
  normalizedRecords: {
    query: NormalizedRecord;
    candidate: NormalizedRecord;
  };
  
  /** Individual attribute match details */
  attributeMatches: Array<{
    attributeName: string;
    strategy: AttributeMatchingStrategy;
    score: number;
    matched: boolean;
    explanation: string;
  }>;
  
  /** Attributes that matched */
  matchedAttributes: string[];
  
  /** Applied heuristics and normalizations */
  appliedTechniques: {
    normalizations: string[];
    sourceHeuristics: string[];
    centralHeuristics: string[];
  };
  
  /** Detailed explanation */
  explanation: string;
  
  /** Original source record */
  sourceRecord: SourceIdentityRecord;
}

/**
 * Enhanced matching engine
 */
export class EnhancedMatchingEngine {
  private normalizer: RecordNormalizer;
  private centralMatcher: CentralizedMatcher;
  
  constructor() {
    this.normalizer = new RecordNormalizer(normalizerRegistry);
    this.centralMatcher = new CentralizedMatcher(DEFAULT_GLOBAL_HEURISTICS);
  }
  
  /**
   * Match a query against a candidate record using source-specific profile
   */
  matchRecords(
    queryAttributes: Record<string, any>,
    candidateRecord: SourceIdentityRecord,
    sourceId: string
  ): EnhancedMatchResult {
    const profile = getMatchingProfile(sourceId);
    
    logDebug('Matching records with profile', {
      sourceId,
      profileStrategies: profile.attributeStrategies.length
    });
    
    // Normalize both records
    const queryNormalized = this.normalizeQueryAttributes(queryAttributes, profile);
    const candidateNormalized = this.normalizeSourceRecord(candidateRecord, profile);
    
    // Match using strategies
    const attributeMatches = this.matchAttributes(
      queryNormalized,
      candidateNormalized,
      profile
    );
    
    // Calculate overall confidence
    const confidence = this.calculateConfidence(
      attributeMatches,
      profile,
      queryNormalized,
      candidateNormalized
    );
    
    // Determine if this is a match
    const isMatch = confidence >= profile.minConfidenceThreshold;
    
    // Collect matched attributes
    const matchedAttributes = attributeMatches
      .filter(m => m.matched)
      .map(m => m.attributeName);
    
    // Build explanation
    const explanation = this.buildExplanation(
      attributeMatches,
      confidence,
      profile,
      isMatch
    );
    
    return {
      confidence,
      isMatch,
      source: candidateRecord.sourceName,
      identifier: candidateRecord.primaryIdentifier,
      normalizedRecords: {
        query: queryNormalized,
        candidate: candidateNormalized
      },
      attributeMatches,
      matchedAttributes,
      appliedTechniques: {
        normalizations: queryNormalized.metadata.normalizersApplied,
        sourceHeuristics: profile.useSourceFuzzyLogic ? ['source-fuzzy-logic'] : [],
        centralHeuristics: profile.applyCentralizedHeuristics ? ['centralized-heuristics'] : []
      },
      explanation,
      sourceRecord: candidateRecord
    };
  }
  
  /**
   * Normalize query attributes
   */
  private normalizeQueryAttributes(
    attributes: Record<string, any>,
    profile: SourceMatchingProfile
  ): NormalizedRecord {
    const fieldMapping: Record<string, string> = {};
    
    // Build field mapping from strategies
    for (const strategy of profile.attributeStrategies) {
      if (strategy.normalize && strategy.normalizerName) {
        fieldMapping[strategy.attributeName] = strategy.normalizerName;
      }
    }
    
    return this.normalizer.normalizeRecord(
      attributes,
      fieldMapping,
      'query'
    );
  }
  
  /**
   * Normalize source record
   */
  private normalizeSourceRecord(
    record: SourceIdentityRecord,
    profile: SourceMatchingProfile
  ): NormalizedRecord {
    const fieldMapping: Record<string, string> = {};
    
    // Build field mapping from strategies
    for (const strategy of profile.attributeStrategies) {
      if (strategy.normalize && strategy.normalizerName) {
        fieldMapping[strategy.attributeName] = strategy.normalizerName;
      }
    }
    
    return this.normalizer.normalizeRecord(
      record.attributes,
      fieldMapping,
      record.sourceName
    );
  }
  
  /**
   * Match attributes using strategies
   */
  private matchAttributes(
    queryRecord: NormalizedRecord,
    candidateRecord: NormalizedRecord,
    profile: SourceMatchingProfile
  ): Array<{
    attributeName: string;
    strategy: AttributeMatchingStrategy;
    score: number;
    matched: boolean;
    explanation: string;
  }> {
    const results: Array<{
      attributeName: string;
      strategy: AttributeMatchingStrategy;
      score: number;
      matched: boolean;
      explanation: string;
    }> = [];
    
    for (const strategy of profile.attributeStrategies) {
      const queryValue = queryRecord.normalized[strategy.attributeName] ||
                        queryRecord.raw[strategy.attributeName];
      const candidateValue = candidateRecord.normalized[strategy.attributeName] ||
                            candidateRecord.raw[strategy.attributeName];
      
      // Skip if either value is missing
      if (queryValue === undefined || candidateValue === undefined) {
        if (strategy.required) {
          results.push({
            attributeName: strategy.attributeName,
            strategy,
            score: 0,
            matched: false,
            explanation: 'Required attribute missing'
          });
        }
        continue;
      }
      
      // Apply matching based on strategy
      const matchResult = this.applyMatchStrategy(
        queryValue,
        candidateValue,
        strategy,
        profile
      );
      
      results.push({
        attributeName: strategy.attributeName,
        strategy,
        score: matchResult.score,
        matched: matchResult.matched,
        explanation: matchResult.explanation
      });
    }
    
    return results;
  }
  
  /**
   * Apply specific matching strategy
   */
  private applyMatchStrategy(
    queryValue: any,
    candidateValue: any,
    strategy: AttributeMatchingStrategy,
    profile: SourceMatchingProfile
  ): { score: number; matched: boolean; explanation: string } {
    let score = 0;
    let explanation = '';
    
    switch (strategy.matchType) {
      case 'exact':
        if (queryValue === candidateValue) {
          score = 1.0;
          if (strategy.exactMatchBoost) {
            score *= strategy.exactMatchBoost;
          }
          explanation = 'Exact match';
        } else {
          score = 0;
          explanation = 'No match';
        }
        break;
      
      case 'fuzzy':
        if (profile.useSourceFuzzyLogic) {
          // Use source-level fuzzy logic (simple similarity)
          const similarity = StringSimilarity.levenshteinSimilarity(
            String(queryValue).toLowerCase(),
            String(candidateValue).toLowerCase()
          );
          score = similarity;
          explanation = `Fuzzy match: ${(similarity * 100).toFixed(0)}%`;
        }
        
        if (profile.applyCentralizedHeuristics) {
          // Enhance with centralized heuristics
          if (strategy.attributeName.includes('email')) {
            const emailMatch = this.centralMatcher.matchEmail(queryValue, candidateValue);
            score = Math.max(score, emailMatch.score);
            explanation = emailMatch.explanation;
          }
        }
        break;
      
      case 'phonetic':
        if (profile.useSourceFuzzyLogic) {
          const soundex1 = StringSimilarity.soundex(String(queryValue));
          const soundex2 = StringSimilarity.soundex(String(candidateValue));
          
          if (soundex1 === soundex2) {
            score = 0.9;
            explanation = 'Phonetic match (Soundex)';
          } else {
            // Fall back to Jaro-Winkler
            score = StringSimilarity.jaroWinkler(
              String(queryValue).toLowerCase(),
              String(candidateValue).toLowerCase()
            );
            explanation = `Jaro-Winkler: ${(score * 100).toFixed(0)}%`;
          }
        }
        
        if (profile.applyCentralizedHeuristics && strategy.attributeName.includes('name')) {
          // Use centralized name matching
          const parts1 = String(queryValue).split(' ');
          const parts2 = String(candidateValue).split(' ');
          
          if (parts1.length >= 2 && parts2.length >= 2) {
            const nameMatch = this.centralMatcher.matchName(
              parts1[0], parts1[parts1.length - 1],
              parts2[0], parts2[parts2.length - 1]
            );
            score = Math.max(score, nameMatch.score);
            explanation = nameMatch.explanation;
          }
        }
        break;
      
      case 'date':
        if (profile.applyCentralizedHeuristics) {
          const dateMatch = this.centralMatcher.matchDate(queryValue, candidateValue);
          score = dateMatch.score;
          explanation = dateMatch.explanation;
        } else {
          // Simple date equality
          const d1 = new Date(queryValue).getTime();
          const d2 = new Date(candidateValue).getTime();
          score = d1 === d2 ? 1.0 : 0.0;
          explanation = score === 1.0 ? 'Exact date match' : 'Date mismatch';
        }
        break;
      
      case 'numeric':
        const n1 = Number(queryValue);
        const n2 = Number(candidateValue);
        if (isNaN(n1) || isNaN(n2)) {
          score = 0;
          explanation = 'Invalid numeric value';
        } else if (n1 === n2) {
          score = 1.0;
          explanation = 'Exact numeric match';
        } else {
          // Allow small variance
          const variance = Math.abs(n1 - n2) / Math.max(Math.abs(n1), Math.abs(n2));
          score = Math.max(0, 1 - variance);
          explanation = `Numeric variance: ${(variance * 100).toFixed(0)}%`;
        }
        break;
      
      case 'custom':
        // Custom matchers would be registered and called here
        score = 0.5;
        explanation = 'Custom matcher not implemented';
        break;
    }
    
    // Apply fuzzy threshold
    const threshold = strategy.fuzzyThreshold || 0.7;
    const matched = score >= threshold;
    
    return { score, matched, explanation };
  }
  
  /**
   * Calculate overall confidence from attribute matches
   */
  private calculateConfidence(
    attributeMatches: Array<{
      attributeName: string;
      strategy: AttributeMatchingStrategy;
      score: number;
      matched: boolean;
    }>,
    profile: SourceMatchingProfile,
    queryRecord: NormalizedRecord,
    candidateRecord: NormalizedRecord
  ): number {
    // Weighted average of attribute scores
    let weightedSum = 0;
    let totalWeight = 0;
    let matchedCount = 0;
    
    for (const match of attributeMatches) {
      const weight = match.strategy.weight;
      weightedSum += match.score * weight;
      totalWeight += weight;
      
      if (match.matched) {
        matchedCount++;
      }
    }
    
    if (totalWeight === 0) {
      return 0;
    }
    
    let confidence = weightedSum / totalWeight;
    
    // Check minimum attribute matches requirement
    if (profile.minAttributeMatches && matchedCount < profile.minAttributeMatches) {
      // Penalize if not enough attributes matched
      confidence *= (matchedCount / profile.minAttributeMatches);
    }
    
    // Apply multi-match bonus
    if (matchedCount >= 3 && profile.maxConfidenceBoost) {
      const bonus = Math.min(
        profile.maxConfidenceBoost,
        DEFAULT_GLOBAL_HEURISTICS.composite.multiMatchBonus
      );
      confidence += bonus;
    }
    
    // Apply centralized composite scoring if enabled
    if (profile.applyCentralizedHeuristics) {
      const attributeWeights: Record<string, number> = {};
      for (const match of attributeMatches) {
        attributeWeights[match.attributeName] = match.strategy.weight;
      }
      
      const compositeResult = this.centralMatcher.matchComposite(
        queryRecord.normalized,
        candidateRecord.normalized,
        attributeWeights
      );
      
      // Blend with composite result (70% profile-based, 30% composite)
      confidence = confidence * 0.7 + compositeResult.confidence * 0.3;
    }
    
    // Ensure confidence is in [0, 1]
    return Math.max(0, Math.min(1, confidence));
  }
  
  /**
   * Build explanation text
   */
  private buildExplanation(
    attributeMatches: Array<{
      attributeName: string;
      strategy: AttributeMatchingStrategy;
      score: number;
      matched: boolean;
      explanation: string;
    }>,
    confidence: number,
    profile: SourceMatchingProfile,
    isMatch: boolean
  ): string {
    const lines: string[] = [];
    
    lines.push(`Source: ${profile.sourceName}`);
    lines.push(`Overall Confidence: ${(confidence * 100).toFixed(1)}%`);
    lines.push(`Match: ${isMatch ? 'YES' : 'NO'} (threshold: ${(profile.minConfidenceThreshold * 100).toFixed(0)}%)`);
    lines.push('');
    lines.push('Attribute Breakdown:');
    
    for (const match of attributeMatches) {
      const icon = match.matched ? '✓' : '✗';
      const scoreStr = (match.score * 100).toFixed(0);
      lines.push(`  ${icon} ${match.attributeName}: ${scoreStr}% - ${match.explanation}`);
    }
    
    const matchedCount = attributeMatches.filter(m => m.matched).length;
    lines.push('');
    lines.push(`Matched Attributes: ${matchedCount}/${attributeMatches.length}`);
    
    if (profile.minAttributeMatches) {
      lines.push(`Minimum Required: ${profile.minAttributeMatches}`);
    }
    
    return lines.join('\n');
  }
  
  /**
   * Batch match query against multiple candidates
   */
  matchBatch(
    queryAttributes: Record<string, any>,
    candidates: SourceIdentityRecord[],
    sourceId: string,
    options?: {
      minConfidence?: number;
      maxResults?: number;
      sortByConfidence?: boolean;
    }
  ): EnhancedMatchResult[] {
    const opts = {
      minConfidence: 0.3,
      maxResults: 10,
      sortByConfidence: true,
      ...options
    };
    
    logInfo('Batch matching records', {
      sourceId,
      candidatesCount: candidates.length,
      minConfidence: opts.minConfidence
    });
    
    // Match all candidates
    let results = candidates.map(candidate => 
      this.matchRecords(queryAttributes, candidate, sourceId)
    );
    
    // Filter by minimum confidence
    results = results.filter(r => r.confidence >= opts.minConfidence);
    
    // Sort by confidence
    if (opts.sortByConfidence) {
      results.sort((a, b) => b.confidence - a.confidence);
    }
    
    // Limit results
    if (opts.maxResults) {
      results = results.slice(0, opts.maxResults);
    }
    
    logInfo('Batch matching complete', {
      matchesFound: results.length,
      topConfidence: results.length > 0 ? results[0].confidence : 0
    });
    
    return results;
  }
}

// Export singleton instance
export const enhancedMatchingEngine = new EnhancedMatchingEngine();
