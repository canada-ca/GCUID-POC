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
// Connector integration sequence diagrams rendered via Mermaid (MIT, runs entirely in-browser).
import { useEffect, useId, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { useTheme } from '../hooks/useTheme';

// ─── Theme configs (mirrors StateDiagram.tsx) ──────────────────────────────────

const FONT = 'ui-sans-serif, system-ui, -apple-system, sans-serif';

const LIGHT_VARS = {
  // Base vars — identical to StateDiagram.tsx light theme
  primaryColor:        '#f0f4ff',
  primaryBorderColor:  '#94a3b8',
  primaryTextColor:    '#1e293b',
  secondaryColor:      '#f8fafc',
  tertiaryColor:       '#f0f4ff',
  edgeLabelBackground: '#ffffff',
  lineColor:           '#64748b',
  fontSize:            '13px',
  fontFamily:          FONT,
  // Sequence-specific — kept consistent with the base palette above
  actorBorder:         '#94a3b8',
  actorBkg:            '#f0f4ff',
  actorTextColor:      '#1e293b',
  actorLineColor:      '#64748b',
  signalColor:         '#1e293b',
  signalTextColor:     '#1e293b',
  labelBoxBkgColor:    '#f8fafc',
  labelBoxBorderColor: '#94a3b8',
  labelTextColor:      '#1e293b',
  loopTextColor:       '#1e293b',
  noteBorderColor:     '#f59e0b',
  noteBkgColor:        '#fef3c7',
  noteTextColor:       '#78350f',
  activationBorderColor: '#7c3aed',
  activationBkgColor:  '#ede9fe',
  sequenceNumberColor: '#ffffff',
};

const DARK_VARS = {
  primaryColor:        '#1e293b',
  primaryBorderColor:  '#475569',
  primaryTextColor:    '#e2e8f0',
  secondaryColor:      '#0f172a',
  tertiaryColor:       '#1e293b',
  edgeLabelBackground: '#0f172a',
  lineColor:           '#64748b',
  fontSize:            '13px',
  fontFamily:          FONT,
  // sequence-specific
  actorBorder:         '#475569',
  actorBkg:            '#1e293b',
  actorTextColor:      '#e2e8f0',
  actorLineColor:      '#475569',
  signalColor:         '#e2e8f0',
  signalTextColor:     '#e2e8f0',
  labelBoxBkgColor:    '#0f172a',
  labelBoxBorderColor: '#475569',
  labelTextColor:      '#e2e8f0',
  loopTextColor:       '#e2e8f0',
  noteBorderColor:     '#d97706',
  noteBkgColor:        '#1c1917',
  noteTextColor:       '#fbbf24',
  activationBorderColor: '#a78bfa',
  activationBkgColor:  '#1e1b4b',
  sequenceNumberColor: '#ffffff',
};

// ─── Sequence diagram definitions ─────────────────────────────────────────────
// Box colours: solid hex values — avoids Mermaid tokenizer issues with rgba commas.
// Violet = GCUID Services; Amber/orange = Source Infrastructure.

function boxColors(isDark: boolean) {
  return isDark
    // Dark: deep violet / deep amber — visible against dark diagram bg
    ? { gcuid: '#2e1065', source: '#431407' }
    // Light: pale periwinkle (matches #f0f4ff actor bg) / pale amber
    : { gcuid: '#e8edff', source: '#fff7e6' };
}

function dynamicPullDef(isDark: boolean): string {
  const { gcuid, source } = boxColors(isDark);
  return `sequenceDiagram
  autonumber
  participant App as Client App
  box ${gcuid} GCUID Services
    participant Reg as GCUID Registry
  end
  box ${source} Source Infrastructure
    participant Con as Source Connector
    participant Src as Source System
  end

  App->>Reg: GET /lookup?gcuid=…
  activate Reg
  Reg->>Con: GET /record/{sourceId}
  activate Con
  Con->>Src: GET /records/{primaryKey}
  activate Src
  Src-->>Con: Entity record
  deactivate Src
  Con-->>Reg: { attributes }
  deactivate Con
  Reg-->>App: Resolved identity + attributes
  deactivate Reg`;
}

function scheduledPullDef(isDark: boolean): string {
  const { gcuid, source } = boxColors(isDark);
  return `sequenceDiagram
  autonumber
  box ${gcuid} GCUID Services
    participant Sch as Scheduler
    participant Reg as GCUID Registry
  end
  box ${source} Source Infrastructure
    participant Con as Source Connector
    participant Src as Source System
  end

  loop Every sync interval
    Sch->>Reg: Trigger scheduled sync
    activate Reg
    Reg->>Con: GET /records?since={lastSync}
    activate Con
    Con->>Src: GET /records?since={lastSync}
    activate Src
    Src-->>Con: Changed records
    deactivate Src
    Con-->>Reg: Batch attribute payload
    deactivate Con
    Reg->>Reg: Upsert attribute cache
    Reg-->>Sch: Sync complete
    deactivate Reg
  end`;
}

function pushCacheDef(isDark: boolean): string {
  const { gcuid, source } = boxColors(isDark);
  return `sequenceDiagram
  autonumber
  box ${source} Source Infrastructure
    participant Src as Source System
    participant Con as Source Connector
  end
  box ${gcuid} GCUID Services
    participant Reg as GCUID Registry
  end

  Src->>Con: Record created / updated
  activate Con
  Con->>Reg: POST /api/connectors/{id}/ingest
  activate Reg
  Reg->>Reg: Validate & upsert cache
  Reg-->>Con: 200 OK
  deactivate Reg
  Con-->>Src: Acknowledged
  deactivate Con`;
}

const DIAGRAM_DEFS: Record<string, (isDark: boolean) => string> = {
  'dynamic-pull':   dynamicPullDef,
  'scheduled-pull': scheduledPullDef,
  'push-cache':     pushCacheDef,
};

// ─── SVG post-processor ────────────────────────────────────────────────────────

function processSvg(svgStr: string, isDark: boolean): string {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgStr, 'image/svg+xml');
    const svg = doc.documentElement;

    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.setAttribute('style', 'max-width:100%;height:auto;display:block;');

    // Transparent diagram background
    const bg = svg.querySelector('rect:first-child');
    if (bg) {
      bg.setAttribute('fill', 'transparent');
      bg.setAttribute('stroke', 'none');
    }

    // Restyle autonumber circles.
    // Mermaid renders sequence number circles as an SVG <marker> in <defs>:
    //   <marker id="{id}-sequencenumber"><circle cx=15 cy=15 r=6>
    // The circle fill is unset (inherits from context) — black in light mode
    // (white text on black = jarring) and near-white in dark mode (invisible).
    // The number text is <text class="sequenceNumber"> in the SVG body.
    const circleFill   = isDark ? '#4c1d95' : '#7c3aed';  // violet-900 / violet-600
    const circleStroke = isDark ? '#7c3aed' : '#6d28d9';  // violet-600 / violet-700
    const numTextColor = '#ffffff';

    // Fix the marker circle inside <defs>
    doc.querySelectorAll('marker[id$="-sequencenumber"] circle').forEach(c => {
      c.setAttribute('fill',   circleFill);
      c.setAttribute('stroke', circleStroke);
      c.setAttribute('stroke-width', '1');
    });
    // Fix the number text elements
    doc.querySelectorAll('text.sequenceNumber').forEach(t => {
      (t as SVGElement).setAttribute('fill', numTextColor);
      (t as SVGElement).style.fill = numTextColor;
    });

    return new XMLSerializer().serializeToString(svg);
  } catch {
    return svgStr;
  }
}

// ─── Mermaid renderer ─────────────────────────────────────────────────────────

interface MermaidSequenceProps {
  definition: string;
  isDark: boolean;
}

function MermaidSequence({ definition, isDark }: MermaidSequenceProps) {
  const uid = useId().replace(/:/g, '');
  const renderCount = useRef(0);
  const [svg, setSvg]     = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Each invocation gets a unique ID so Mermaid never returns a cached SVG
    // from a previous theme or definition render.
    const renderId = `mermaid-seq-${uid}-${++renderCount.current}`;

    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      themeVariables: isDark ? DARK_VARS : LIGHT_VARS,
    });

    mermaid.render(renderId, definition)
      .then(({ svg: rendered }) => {
        if (!cancelled) setSvg(processSvg(rendered, isDark));
      })
      .catch(err => { if (!cancelled) setError(String(err)); });

    return () => { cancelled = true; };
  }, [uid, definition, isDark]);

  const wrapperCls = isDark
    ? 'overflow-x-auto rounded-lg bg-ux-surface border border-ux-border px-3 py-2'
    : 'overflow-x-auto rounded-lg bg-ux-surface border border-ux-border px-3 py-2';

  if (error) return <p className="text-xs text-red-500">Diagram error: {error}</p>;

  if (!svg) return (
    <div className="h-24 flex items-center justify-center text-xs text-ux-muted">
      Rendering…
    </div>
  );

  return (
    <div
      className={wrapperCls}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

// ─── Access-mode labels & descriptions ────────────────────────────────────────

const MODE_LABELS: Record<string, string> = {
  'dynamic-pull':   'Dynamic Pull',
  'scheduled-pull': 'Scheduled Pull',
  'push-cache':     'Push to Cache',
};

const MODE_DESCRIPTIONS: Record<string, string> = {
  'dynamic-pull':   'The registry queries the connector in real-time for each attribute lookup. No data is cached centrally — every request triggers a live fetch from the source system.',
  'scheduled-pull': 'The registry scheduler periodically fetches delta records from the connector and stores them in the attribute cache. Subsequent lookups are served from the cache.',
  'push-cache':     'The department system (via the connector) proactively pushes record changes to the registry cache. The registry acts as a passive receiver and serves lookups from the cache.',
};

// ─── Public export ─────────────────────────────────────────────────────────────

interface ConnectorSequenceDiagramProps {
  /** The access modes actually present in the loaded connectors. */
  availableModes: Array<'dynamic-pull' | 'scheduled-pull' | 'push-cache'>;
}

export default function ConnectorSequenceDiagram({ availableModes }: ConnectorSequenceDiagramProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [selected, setSelected] = useState<string>(() => availableModes[0] ?? 'dynamic-pull');

  // If availableModes changes and selected is no longer in it, reset.
  const effectiveMode = availableModes.includes(selected as 'dynamic-pull' | 'scheduled-pull' | 'push-cache')
    ? selected
    : (availableModes[0] ?? 'dynamic-pull');

  const defFn = DIAGRAM_DEFS[effectiveMode];
  const definition = defFn ? defFn(isDark) : '';

  return (
    <div className="space-y-4">
      {/* Mode selector */}
      <div className="flex flex-wrap gap-2">
        {availableModes.map(mode => (
          <button
            key={mode}
            onClick={() => setSelected(mode)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
              effectiveMode === mode
                ? 'bg-violet-600 border-violet-600 text-white'
                : 'bg-ux-surface border-ux-border text-ux-text-sub hover:border-violet-400 hover:text-violet-600 dark:hover:border-violet-500 dark:hover:text-violet-300'
            }`}
          >
            {MODE_LABELS[mode] ?? mode}
          </button>
        ))}
      </div>

      {/* Description */}
      <p className="text-xs text-ux-text-sub">
        {MODE_DESCRIPTIONS[effectiveMode]}
      </p>

      {/* Diagram */}
      <MermaidSequence key={effectiveMode + String(isDark)} definition={definition} isDark={isDark} />
    </div>
  );
}
