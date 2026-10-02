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
 * apply-transformation
 *
 * Runtime utility that executes ConnectorTransformation rules against raw
 * values fetched from source systems. Supports all 12 transformation types
 * defined in api/routes/connectors.ts.
 *
 * JEXL expression evaluation is performed lazily — the jexl module is only
 * imported when an 'expression' type rule is first encountered.
 */

import type { ConnectorTransformation } from '../routes/connectors.js';

// ─── JEXL lazy singleton ─────────────────────────────────────────────────────

let _jexlInstance: { eval: (expr: string, ctx: Record<string, unknown>) => Promise<unknown> } | null = null;

async function jexlEval(expr: string, context: Record<string, unknown>): Promise<unknown> {
  if (!_jexlInstance) {
    const mod = await import('jexl');
    // jexl v2 exports a ready-to-use default instance
    _jexlInstance = (mod.default ?? mod) as unknown as NonNullable<typeof _jexlInstance>;
  }
  return _jexlInstance!.eval(expr, context);
}

// ─── Date format helpers ──────────────────────────────────────────────────────

type DateParts = { year: string; month: string; day: string };

function parseDate(value: string, format: string): DateParts | null {
  switch (format) {
    case 'YYYY-MM-DD': {
      const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      return m ? { year: m[1], month: m[2], day: m[3] } : null;
    }
    case 'DD/MM/YYYY': {
      const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      return m ? { year: m[3], month: m[2], day: m[1] } : null;
    }
    case 'MM/DD/YYYY': {
      const m = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      return m ? { year: m[3], month: m[1], day: m[2] } : null;
    }
    case 'DD-MM-YYYY': {
      const m = value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
      return m ? { year: m[3], month: m[2], day: m[1] } : null;
    }
    case 'YYYYMMDD': {
      const m = value.match(/^(\d{4})(\d{2})(\d{2})$/);
      return m ? { year: m[1], month: m[2], day: m[3] } : null;
    }
    default:
      return null;
  }
}

function formatDate(parts: DateParts, format: string): string {
  const { year, month, day } = parts;
  switch (format) {
    case 'YYYY-MM-DD': return `${year}-${month}-${day}`;
    case 'DD/MM/YYYY': return `${day}/${month}/${year}`;
    case 'MM/DD/YYYY': return `${month}/${day}/${year}`;
    case 'DD-MM-YYYY': return `${day}-${month}-${year}`;
    case 'YYYYMMDD':   return `${year}${month}${day}`;
    default:           return `${year}-${month}-${day}`;
  }
}

// ─── Core apply ──────────────────────────────────────────────────────────────

/**
 * Apply a single transformation rule to a value.
 *
 * @param value     The raw input value from the source system
 * @param rule      The transformation rule to apply
 * @param direction 'read' (source → GCUID) or 'write' (GCUID → source)
 * @param fieldKey  Standard attribute key, passed into expression context
 */
export async function applyTransformation(
  value: unknown,
  rule: ConnectorTransformation,
  direction: 'read' | 'write' = 'read',
  fieldKey: string = '',
): Promise<unknown> {
  // Skip if this rule is scoped to the opposite direction
  const effectiveDir = rule.direction ?? 'both';
  if (effectiveDir !== 'both' && effectiveDir !== direction) return value;

  const str = String(value ?? '');

  switch (rule.type) {
    case 'lowercase':
      return str.toLowerCase();

    case 'uppercase':
      return str.toUpperCase();

    case 'trim':
      return str.trim();

    case 'value_map': {
      const map = rule.map ?? {};
      if (direction === 'write' && effectiveDir === 'both') {
        // Invert the map when writing (label → code)
        const inverted = Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]));
        return inverted[str] ?? str;
      }
      return map[str] ?? str;
    }

    case 'date_format': {
      // Swap from/to formats when writing back to the source
      const fromFmt = (direction === 'write' && effectiveDir === 'both')
        ? (rule.toFormat   ?? 'YYYY-MM-DD')
        : (rule.fromFormat ?? 'YYYY-MM-DD');
      const toFmt = (direction === 'write' && effectiveDir === 'both')
        ? (rule.fromFormat ?? 'YYYY-MM-DD')
        : (rule.toFormat   ?? 'YYYY-MM-DD');
      const parts = parseDate(str, fromFmt);
      return parts ? formatDate(parts, toFmt) : str;
    }

    case 'regex_replace': {
      if (!rule.pattern) return str;
      try {
        return str.replace(new RegExp(rule.pattern, 'g'), rule.replacement ?? '');
      } catch {
        return str;
      }
    }

    case 'prefix':
      if (direction === 'write') {
        const pfx = rule.affixValue ?? '';
        return str.startsWith(pfx) ? str.slice(pfx.length) : str;
      }
      return (rule.affixValue ?? '') + str;

    case 'suffix':
      if (direction === 'write') {
        const sfx = rule.affixValue ?? '';
        return str.endsWith(sfx) ? str.slice(0, str.length - sfx.length) : str;
      }
      return str + (rule.affixValue ?? '');

    case 'substring':
      return str.substring(rule.start ?? 0, rule.end);

    case 'conditional': {
      if (!rule.pattern) return str;
      try {
        return new RegExp(rule.pattern).test(str)
          ? (rule.thenValue ?? str)
          : (rule.elseValue ?? str);
      } catch {
        return str;
      }
    }

    case 'pipeline': {
      let current: unknown = value;
      for (const step of rule.steps ?? []) {
        current = await applyTransformation(current, step, direction, fieldKey);
      }
      return current;
    }

    case 'expression': {
      if (!rule.expr) return value;
      return jexlEval(rule.expr, { value, field: fieldKey });
    }

    default:
      return value;
  }
}

// ─── Batch lookup ─────────────────────────────────────────────────────────────

/**
 * Look up the rule for `fieldKey` in the connector's transformations map and
 * apply it.  Returns the value unchanged if no rule exists for this field.
 *
 * @param value                The raw value from the source system
 * @param connectorTransforms  The connector's `transformations` record (key = standard attribute)
 * @param fieldKey             Standard attribute being resolved (e.g. 'person.name.given')
 * @param direction            'read' or 'write'
 */
export async function applyConnectorTransformation(
  value: unknown,
  connectorTransforms: Record<string, ConnectorTransformation> | undefined,
  fieldKey: string,
  direction: 'read' | 'write' = 'read',
): Promise<unknown> {
  if (!connectorTransforms) return value;
  const rule = connectorTransforms[fieldKey];
  if (!rule) return value;
  return applyTransformation(value, rule, direction, fieldKey);
}
