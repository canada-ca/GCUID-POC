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
// State transition diagrams rendered via Mermaid (MIT, runs entirely in-browser).
import { useEffect, useId, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { useTheme } from '../hooks/useTheme';

// ─── Theme configs ─────────────────────────────────────────────────────────────

const FONT = 'ui-sans-serif, system-ui, -apple-system, sans-serif';

const LIGHT_VARS = {
  primaryColor: '#f0f4ff',
  primaryBorderColor: '#94a3b8',
  primaryTextColor: '#1e293b',
  secondaryColor: '#f8fafc',
  tertiaryColor: '#f0f4ff',
  edgeLabelBackground: '#ffffff',
  lineColor: '#64748b',
  fontSize: '13px',
  fontFamily: FONT,
};

const DARK_VARS = {
  primaryColor: '#1e293b',
  primaryBorderColor: '#475569',
  primaryTextColor: '#e2e8f0',
  secondaryColor: '#0f172a',
  tertiaryColor: '#1e293b',
  edgeLabelBackground: '#0f172a',
  lineColor: '#64748b',
  fontSize: '13px',
  fontFamily: FONT,
};

const ACTIVE_COLORS = { fill: '#1d4ed8', stroke: '#93c5fd', text: '#ffffff' };

// ─── State label map ───────────────────────────────────────────────────────────

const STATE_LABELS: Record<string, string> = {
  provisional:  'Provisional',
  under_review: 'Under Review',
  active:       'Active',
  suspended:    'Suspended',
  retired:      'Retired',
  archived:     'Archived',
  reserved:     'Reserved',
  issued:       'Issued',
  superseded:   'Superseded',
  nullified:    'Nullified',
};

// ─── SVG post-processor ────────────────────────────────────────────────────────

function processSvg(svgStr: string, currentState: string, isDark: boolean): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgStr, 'image/svg+xml');
    const svg = doc.documentElement;

    // Let CSS control size; remove Mermaid's hardcoded pixel dimensions
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.setAttribute('style', 'max-width:100%;height:auto;display:block;');

    // Transparent diagram background
    const bg = svg.querySelector('rect:first-child');
    if (bg) {
      bg.setAttribute('fill', 'transparent');
      bg.setAttribute('stroke', 'none');
    }

    // ── Find and highlight the current-state node ──────────────────────────────
    // Mermaid stateDiagram-v2 wraps each state in a <g class="stateGroup ...">
    // (or <g class="node ...">) containing a <rect> and a <text> with the label.
    // We locate the node by matching the text content rather than relying on
    // classDef class application, which varies across Mermaid versions.
    const targetLabel = STATE_LABELS[currentState] ?? currentState;
    const { fill, stroke, text: textColor } = ACTIVE_COLORS;

    const applyHighlight = (container: Element) => {
      container.querySelectorAll('rect').forEach(r => {
        r.style.fill = fill;
        r.style.stroke = stroke;
        r.style.strokeWidth = '2.5px';
        r.style.filter = 'drop-shadow(0 0 6px #3b82f680)';
      });
      container.querySelectorAll('text, tspan').forEach(t => {
        (t as SVGElement).style.fill = textColor;
        (t as SVGElement).style.fontWeight = '700';
      });
    };

    // Primary: Mermaid classDef applied 'highlighted' class to the node <g>
    const byClass = doc.querySelectorAll('.highlighted');
    if (byClass.length > 0) {
      byClass.forEach(applyHighlight);
    } else {
      // Fallback: walk <text> elements and match label text
      doc.querySelectorAll('text').forEach(textEl => {
        if ((textEl.textContent ?? '').trim() !== targetLabel) return;
        let el: Element | null = textEl.parentElement;
        while (el && el !== svg) {
          const cls = el.getAttribute('class') ?? '';
          if (cls.includes('stateGroup') || cls.includes('node')) {
            applyHighlight(el); break;
          }
          el = el.parentElement;
        }
      });
    }

    // Style edge labels: transparent rect, themed text
    const edgeLabelColor = isDark ? '#7dd3fc' : '#6b7280';
    doc.querySelectorAll('.edgeLabel rect, .transition rect').forEach(r => {
      r.setAttribute('fill', 'transparent');
      r.setAttribute('stroke', 'none');
    });
    doc.querySelectorAll('.edgeLabel text, .edgeLabel tspan, .transition text').forEach(t => {
      (t as SVGElement).style.fill = edgeLabelColor;
      (t as SVGElement).style.fontSize = '11px';
    });

    return new XMLSerializer().serializeToString(svg);
  } catch {
    return svgStr;
  }
}

// ─── Diagram definitions ───────────────────────────────────────────────────────

function identityDef(current: string): string {
  return `stateDiagram-v2
  direction TB
  classDef highlighted fill:#1d4ed8,stroke:#93c5fd,stroke-width:2px,color:#ffffff,font-weight:bold

  [*] --> provisional
  provisional : Provisional
  under_review : Under Review
  active : Active
  suspended : Suspended
  retired : Retired
  archived : Archived

  provisional --> active : approve
  provisional --> under_review : flag
  active --> under_review : flag
  active --> suspended : suspend
  active --> retired : retire
  under_review --> active : approve
  under_review --> suspended : suspend
  suspended --> active : clear
  suspended --> retired : retire
  retired --> under_review : rehire
  retired --> archived : archive
  archived --> [*]
  ${current ? `class ${current} highlighted` : ''}`;
}

function identifierDef(current: string): string {
  return `stateDiagram-v2
  direction LR
  classDef highlighted fill:#1d4ed8,stroke:#93c5fd,stroke-width:2px,color:#ffffff,font-weight:bold

  [*] --> reserved
  reserved : Reserved
  issued : Issued
  superseded : Superseded
  nullified : Nullified

  reserved --> issued : bind
  reserved --> nullified : nullify
  issued --> superseded : supersede
  issued --> nullified : nullify
  superseded --> [*]
  nullified --> [*]
  ${current ? `class ${current} highlighted` : ''}`;
}

// ─── Mermaid renderer ─────────────────────────────────────────────────────────

interface MermaidDiagramProps {
  title: string;
  definition: string;
  currentState: string;
  isDark: boolean;
  /** CSS max-width to scale the diagram down, e.g. '520px' */
  maxWidth?: string;
}

function MermaidDiagram({ title, definition, currentState, isDark, maxWidth }: MermaidDiagramProps) {
  const uid = useId().replace(/:/g, '');
  const renderCount = useRef(0);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const renderId = `mermaid-${uid}-${++renderCount.current}`;

    // Re-initialize with the correct theme before every render
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      themeVariables: isDark ? DARK_VARS : LIGHT_VARS,
    });

    mermaid.render(renderId, definition)
      .then(({ svg: rendered }) => {
        if (!cancelled) setSvg(processSvg(rendered, currentState, isDark));
      })
      .catch(err => { if (!cancelled) setError(String(err)); });

    return () => { cancelled = true; };
  }, [uid, definition, currentState, isDark]);

  const wrapperCls = isDark
    ? 'overflow-x-auto rounded-lg bg-slate-900/50 border border-slate-700/50 px-3 py-2'
    : 'overflow-x-auto rounded-lg bg-slate-50 border border-slate-200 px-3 py-2';

  return (
    <div>
      <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-2">
        {title}
      </p>
      {error ? (
        <p className="text-xs text-red-500">Diagram error: {error}</p>
      ) : svg ? (
        <div
          className={wrapperCls}
          style={maxWidth ? { maxWidth, margin: '0 auto' } : undefined}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="h-20 flex items-center justify-center text-xs text-gray-400">
          Rendering…
        </div>
      )}
    </div>
  );
}

// ─── Public export ─────────────────────────────────────────────────────────────

interface StateDiagramProps {
  identityState: string;
  identifierState: string;
}

export default function StateDiagram({ identityState, identifierState }: StateDiagramProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <div className="space-y-5">
      <MermaidDiagram
        title="Identity State Machine"
        definition={identityDef(identityState)}
        currentState={identityState}
        isDark={isDark}
        maxWidth="286px"
      />
      <MermaidDiagram
        title="Identifier State Machine"
        definition={identifierDef(identifierState)}
        currentState={identifierState}
        isDark={isDark}
      />
    </div>
  );
}



