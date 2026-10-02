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
 * Centralized Fuzzy Matching Logic
 * 
 * Provides advanced matching algorithms and confidence scoring that goes beyond
 * simple string comparison. Applies sophisticated heuristics for identity matching.
 */

import { GlobalMatchingHeuristics, DEFAULT_GLOBAL_HEURISTICS } from './matching-config';

/**
 * Match result with detailed scoring
 */
export interface MatchResult {
  /** Overall confidence score (0-1) */
  confidence: number;
  
  /** Whether this is considered a match */
  isMatch: boolean;
  
  /** Individual attribute scores */
  attributeScores: Record<string, number>;
  
  /** Which attributes matched */
  matchedAttributes: string[];
  
  /** Applied heuristics */
  appliedHeuristics: string[];
  
  /** Explanation of the match decision */
  explanation?: string;
}

/**
 * String similarity algorithms
 */
export class StringSimilarity {
  /**
   * Levenshtein distance (edit distance)
   */
  static levenshtein(str1: string, str2: string): number {
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix: number[][] = [];

    for (let i = 0; i <= len1; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= len2; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= len1; i++) {
      for (let j = 1; j <= len2; j++) {
        const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,      // deletion
          matrix[i][j - 1] + 1,      // insertion
          matrix[i - 1][j - 1] + cost // substitution
        );
      }
    }

    return matrix[len1][len2];
  }

  /**
   * Levenshtein similarity (normalized to 0-1)
   */
  static levenshteinSimilarity(str1: string, str2: string): number {
    const maxLen = Math.max(str1.length, str2.length);
    if (maxLen === 0) return 1.0;
    
    const distance = this.levenshtein(str1, str2);
    return 1 - distance / maxLen;
  }

  /**
   * Jaro-Winkler similarity (good for short strings like names)
   */
  static jaroWinkler(str1: string, str2: string): number {
    const jaro = this.jaro(str1, str2);
    
    // Jaro-Winkler gives more weight to common prefix
    let prefix = 0;
    const maxPrefix = 4;
    
    for (let i = 0; i < Math.min(str1.length, str2.length, maxPrefix); i++) {
      if (str1[i] === str2[i]) {
        prefix++;
      } else {
        break;
      }
    }
    
    const p = 0.1; // scaling factor
    return jaro + prefix * p * (1 - jaro);
  }

  /**
   * Jaro similarity
   */
  private static jaro(str1: string, str2: string): number {
    if (str1 === str2) return 1.0;
    if (str1.length === 0 || str2.length === 0) return 0.0;

    const matchWindow = Math.floor(Math.max(str1.length, str2.length) / 2) - 1;
    const str1Matches = new Array(str1.length).fill(false);
    const str2Matches = new Array(str2.length).fill(false);

    let matches = 0;
    let transpositions = 0;

    // Find matches
    for (let i = 0; i < str1.length; i++) {
      const start = Math.max(0, i - matchWindow);
      const end = Math.min(i + matchWindow + 1, str2.length);

      for (let j = start; j < end; j++) {
        if (str2Matches[j] || str1[i] !== str2[j]) continue;
        str1Matches[i] = true;
        str2Matches[j] = true;
        matches++;
        break;
      }
    }

    if (matches === 0) return 0.0;

    // Count transpositions
    let k = 0;
    for (let i = 0; i < str1.length; i++) {
      if (!str1Matches[i]) continue;
      while (!str2Matches[k]) k++;
      if (str1[i] !== str2[k]) transpositions++;
      k++;
    }

    return (
      (matches / str1.length +
        matches / str2.length +
        (matches - transpositions / 2) / matches) /
      3
    );
  }

  /**
   * Soundex algorithm for phonetic matching
   */
  static soundex(str: string): string {
    if (!str || str.length === 0) return '';
    
    const s = str.toUpperCase().replace(/[^A-Z]/g, '');
    if (s.length === 0) return '';
    
    const firstLetter = s[0];
    const codes: Record<string, string> = {
      'BFPV': '1',
      'CGJKQSXZ': '2',
      'DT': '3',
      'L': '4',
      'MN': '5',
      'R': '6'
    };
    
    let soundexCode = firstLetter;
    let prevCode = this.getSoundexCode(firstLetter, codes);
    
    for (let i = 1; i < s.length && soundexCode.length < 4; i++) {
      const code = this.getSoundexCode(s[i], codes);
      if (code !== '0' && code !== prevCode) {
        soundexCode += code;
      }
      prevCode = code;
    }
    
    // Pad with zeros
    while (soundexCode.length < 4) {
      soundexCode += '0';
    }
    
    return soundexCode;
  }

  private static getSoundexCode(char: string, codes: Record<string, string>): string {
    for (const [letters, code] of Object.entries(codes)) {
      if (letters.includes(char)) return code;
    }
    return '0';
  }

  /**
   * Metaphone algorithm for phonetic matching (simplified version)
   */
  static metaphone(str: string): string {
    if (!str || str.length === 0) return '';
    
    let s = str.toUpperCase().replace(/[^A-Z]/g, '');
    if (s.length === 0) return '';
    
    // Drop duplicate consecutive letters, except C
    s = s.replace(/([^C])\1+/g, '$1');
    
    // Handle special initial combinations
    if (s.startsWith('KN')) s = s.substring(1);
    if (s.startsWith('GN')) s = s.substring(1);
    if (s.startsWith('PN')) s = s.substring(1);
    if (s.startsWith('AE')) s = 'E' + s.substring(2);
    if (s.startsWith('WR')) s = s.substring(1);
    
    // Transform
    s = s.replace(/X/g, 'KS');
    s = s.replace(/PH/g, 'F');
    s = s.replace(/[AEIOU]/g, '');
    s = s.replace(/B$/g, '');
    
    return s.substring(0, 4);
  }

  /**
   * Combined fuzzy match using multiple algorithms
   */
  static fuzzyMatch(str1: string, str2: string, options?: {
    useLevenshtein?: boolean;
    useJaroWinkler?: boolean;
    useSoundex?: boolean;
    useMetaphone?: boolean;
  }): number {
    const opts = {
      useLevenshtein: true,
      useJaroWinkler: true,
      useSoundex: true,
      useMetaphone: false,
      ...options
    };
    
    const scores: number[] = [];
    
    if (opts.useLevenshtein) {
      scores.push(this.levenshteinSimilarity(str1.toLowerCase(), str2.toLowerCase()));
    }
    
    if (opts.useJaroWinkler) {
      scores.push(this.jaroWinkler(str1.toLowerCase(), str2.toLowerCase()));
    }
    
    if (opts.useSoundex) {
      const s1 = this.soundex(str1);
      const s2 = this.soundex(str2);
      scores.push(s1 === s2 ? 1.0 : 0.0);
    }
    
    if (opts.useMetaphone) {
      const m1 = this.metaphone(str1);
      const m2 = this.metaphone(str2);
      scores.push(m1 === m2 ? 1.0 : 0.0);
    }
    
    // Return average of all scores
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }
}

/**
 * Centralized matcher with heuristics
 */
export class CentralizedMatcher {
  private heuristics: GlobalMatchingHeuristics;
  
  constructor(heuristics?: GlobalMatchingHeuristics) {
    this.heuristics = heuristics || DEFAULT_GLOBAL_HEURISTICS;
  }
  
  /**
   * Match email addresses with normalization and heuristics
   */
  matchEmail(email1: string, email2: string): { score: number; explanation: string } {
    if (!email1 || !email2) {
      return { score: 0, explanation: 'Missing email' };
    }
    
    let e1 = email1.toLowerCase().trim();
    let e2 = email2.toLowerCase().trim();
    
    // Apply heuristics
    if (this.heuristics.email.ignorePlusAliases) {
      e1 = e1.replace(/\+[^@]+@/, '@');
      e2 = e2.replace(/\+[^@]+@/, '@');
    }
    
    if (this.heuristics.email.ignoreGmailDots) {
      if (e1.endsWith('@gmail.com')) {
        e1 = e1.split('@')[0].replace(/\./g, '') + '@gmail.com';
      }
      if (e2.endsWith('@gmail.com')) {
        e2 = e2.split('@')[0].replace(/\./g, '') + '@gmail.com';
      }
    }
    
    // Exact match after normalization
    if (e1 === e2) {
      return {
        score: this.heuristics.email.minConfidence * this.heuristics.email.exactMatchBoost,
        explanation: 'Exact email match after normalization'
      };
    }
    
    // Fuzzy match
    const similarity = StringSimilarity.levenshteinSimilarity(e1, e2);
    return {
      score: similarity * this.heuristics.email.minConfidence,
      explanation: `Email similarity: ${(similarity * 100).toFixed(0)}%`
    };
  }
  
  /**
   * Match names with phonetic algorithms and nickname support
   */
  matchName(
    firstName1: string, lastName1: string,
    firstName2: string, lastName2: string
  ): { score: number; explanation: string } {
    const scores: number[] = [];
    const explanations: string[] = [];
    
    // First name matching
    if (firstName1 && firstName2) {
      const fn1 = firstName1.toLowerCase().trim();
      const fn2 = firstName2.toLowerCase().trim();
      
      if (fn1 === fn2) {
        scores.push(this.heuristics.name.firstNameWeight * 1.0);
        explanations.push('Exact first name match');
      } else if (this.heuristics.name.usePhonetic) {
        const soundex1 = StringSimilarity.soundex(fn1);
        const soundex2 = StringSimilarity.soundex(fn2);
        
        if (soundex1 === soundex2) {
          scores.push(this.heuristics.name.firstNameWeight * 0.9);
          explanations.push('Phonetic first name match');
        } else {
          const similarity = StringSimilarity.jaroWinkler(fn1, fn2);
          scores.push(this.heuristics.name.firstNameWeight * similarity);
          explanations.push(`First name similarity: ${(similarity * 100).toFixed(0)}%`);
        }
      }
    }
    
    // Last name matching (weighted higher)
    if (lastName1 && lastName2) {
      const ln1 = lastName1.toLowerCase().trim();
      const ln2 = lastName2.toLowerCase().trim();
      
      if (ln1 === ln2) {
        scores.push(this.heuristics.name.lastNameWeight * 1.0);
        explanations.push('Exact last name match');
      } else if (this.heuristics.name.usePhonetic) {
        const soundex1 = StringSimilarity.soundex(ln1);
        const soundex2 = StringSimilarity.soundex(ln2);
        
        if (soundex1 === soundex2) {
          scores.push(this.heuristics.name.lastNameWeight * 0.9);
          explanations.push('Phonetic last name match');
        } else {
          const similarity = StringSimilarity.jaroWinkler(ln1, ln2);
          scores.push(this.heuristics.name.lastNameWeight * similarity);
          explanations.push(`Last name similarity: ${(similarity * 100).toFixed(0)}%`);
        }
      }
    }
    
    const totalScore = scores.reduce((a, b) => a + b, 0);
    return {
      score: Math.min(totalScore, 1.0),
      explanation: explanations.join('; ')
    };
  }
  
  /**
   * Match dates with fuzzy tolerance
   */
  matchDate(date1: string | Date, date2: string | Date): { score: number; explanation: string } {
    const d1 = date1 instanceof Date ? date1 : new Date(date1);
    const d2 = date2 instanceof Date ? date2 : new Date(date2);
    
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) {
      return { score: 0, explanation: 'Invalid date' };
    }
    
    // Exact match
    if (d1.getTime() === d2.getTime()) {
      return {
        score: this.heuristics.date.minConfidence,
        explanation: 'Exact date match'
      };
    }
    
    // Fuzzy match within tolerance
    if (this.heuristics.date.allowFuzzyMatching) {
      const diffDays = Math.abs(d1.getTime() - d2.getTime()) / (1000 * 60 * 60 * 24);
      
      if (diffDays <= this.heuristics.date.fuzzyToleranceDays!) {
        const score = this.heuristics.date.minConfidence * (1 - diffDays / this.heuristics.date.fuzzyToleranceDays!);
        return {
          score,
          explanation: `Dates within ${diffDays.toFixed(0)} days`
        };
      }
    }
    
    return { score: 0, explanation: 'Dates too far apart' };
  }
  
  /**
   * Match identifiers (definitive if they match)
   */
  matchIdentifier(id1: string, id2: string): { score: number; explanation: string } {
    if (!id1 || !id2) {
      return { score: 0, explanation: 'Missing identifier' };
    }
    
    // Normalize: remove non-alphanumeric, uppercase
    const norm1 = id1.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    const norm2 = id2.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    
    if (norm1 === norm2) {
      return {
        score: this.heuristics.identifier.identifierMatchConfidence,
        explanation: 'Exact identifier match (definitive)'
      };
    }
    
    return { score: 0, explanation: 'Identifier mismatch' };
  }
  
  /**
   * Composite matching with multiple attributes
   */
  matchComposite(
    record1: Record<string, any>,
    record2: Record<string, any>,
    attributeWeights: Record<string, number>
  ): MatchResult {
    const attributeScores: Record<string, number> = {};
    const matchedAttributes: string[] = [];
    const appliedHeuristics: string[] = [];
    const explanations: string[] = [];
    
    let totalWeight = 0;
    let weightedScore = 0;
    
    for (const [attr, weight] of Object.entries(attributeWeights)) {
      const val1 = record1[attr];
      const val2 = record2[attr];
      
      if (val1 === undefined || val2 === undefined) {
        continue;
      }
      
      let matchResult: { score: number; explanation: string };
      
      // Determine attribute type and apply appropriate matcher
      if (attr.includes('email') || attr === 'mail') {
        matchResult = this.matchEmail(val1, val2);
        appliedHeuristics.push('email-heuristics');
      } else if (attr.includes('name')) {
        // For composite names, try to split
        const parts1 = String(val1).split(' ');
        const parts2 = String(val2).split(' ');
        matchResult = this.matchName(parts1[0], parts1[parts1.length - 1], parts2[0], parts2[parts2.length - 1]);
        appliedHeuristics.push('name-heuristics');
      } else if (attr.includes('date') || val1 instanceof Date || val2 instanceof Date) {
        matchResult = this.matchDate(val1, val2);
        appliedHeuristics.push('date-heuristics');
      } else if (attr.includes('id') || attr.includes('identifier')) {
        matchResult = this.matchIdentifier(val1, val2);
        appliedHeuristics.push('identifier-heuristics');
      } else {
        // Generic fuzzy match
        matchResult = {
          score: StringSimilarity.fuzzyMatch(String(val1), String(val2)),
          explanation: 'Generic fuzzy match'
        };
      }
      
      attributeScores[attr] = matchResult.score;
      
      if (matchResult.score > 0.7) {
        matchedAttributes.push(attr);
      }
      
      explanations.push(`${attr}: ${matchResult.explanation} (${(matchResult.score * 100).toFixed(0)}%)`);
      
      weightedScore += matchResult.score * weight;
      totalWeight += weight;
    }
    
    // Calculate final confidence
    let confidence = totalWeight > 0 ? weightedScore / totalWeight : 0;
    
    // Apply composite heuristics
    const uniqueHeuristics = [...new Set(appliedHeuristics)];
    
    // Multi-match bonus
    if (matchedAttributes.length >= 3) {
      confidence += this.heuristics.composite.multiMatchBonus;
      explanations.push(`Multi-match bonus: ${matchedAttributes.length} attributes matched`);
    }
    
    // Ensure confidence is in [0, 1]
    confidence = Math.max(0, Math.min(1, confidence));
    
    return {
      confidence,
      isMatch: confidence >= 0.5,
      attributeScores,
      matchedAttributes,
      appliedHeuristics: uniqueHeuristics,
      explanation: explanations.join('\n')
    };
  }
}

// Export singleton instance
export const centralizedMatcher = new CentralizedMatcher();
