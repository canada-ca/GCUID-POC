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

declare const __BUILD_VERSION__: string;
import { UXScopeWrapper } from '../context/UXThemeContext';

export default function AboutPortal() {
  return (
    <UXScopeWrapper scopeId="portal-system">
    <div className="p-6 max-w-3xl mx-auto space-y-8">

      {/* Page header */}
      <div>
        <h1 className="text-2xl font-bold text-ux-text">About GCUID</h1>
        <p className="text-sm text-ux-text-muted mt-1">
          Government of Canada Unique Identifier System
        </p>
      </div>

      {/* Attribution */}
      <section className="bg-ux-surface border border-ux-border rounded-lg p-5 space-y-5">
        <h2 className="text-xs font-semibold text-ux-text-muted uppercase tracking-widest">
          Attribution
        </h2>

        {/* NOETRONIQ brand logo + name — light / dark mode variants */}
        <a
          href="https://www.noetroniq.com"
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-col items-center gap-3 py-2 rounded-lg hover:bg-ux-hover transition-colors"
          aria-label="NOETRONIQ Strategic Initiatives — visit noetroniq.com"
        >
          {/* Icon mark */}
          <div className="h-20 flex items-center">
            <img src="/noetroniq-logo.svg" alt="" aria-hidden="true" className="h-20 w-auto dark:hidden" draggable={false} />
            <img src="/noetroniq-logo-dark.svg" alt="" aria-hidden="true" className="h-20 w-auto hidden dark:block" draggable={false} />
          </div>
          {/* Wordmark */}
          <div className="h-7 flex items-center">
            <img src="/noetroniq-name.svg" alt="NOETRONIQ Strategic Initiatives" className="h-7 w-auto dark:hidden" draggable={false} />
            <img src="/noetroniq-name-dark.svg" alt="NOETRONIQ Strategic Initiatives" className="h-7 w-auto hidden dark:block" draggable={false} />
          </div>
        </a>

        <dl className="grid grid-cols-[max-content_1fr] gap-x-8 gap-y-2 text-sm">
          <dt className="text-ux-text-muted font-medium">Authoring company</dt>
          <dd className="text-ux-text">
            <a href="https://www.noetroniq.com" target="_blank" rel="noopener noreferrer"
               className="text-ux-accent hover:underline">
              NOETRONIQ Strategic Initiatives
            </a>
          </dd>

          <dt className="text-ux-text-muted font-medium">Contributor</dt>
          <dd className="text-ux-text">
            Philippe R. Beauchamp{' '}
            <a href="mailto:prb@noetroniq.com"
               className="text-ux-accent hover:underline font-mono text-xs">
              prb@noetroniq.com
            </a>
          </dd>

          <dt className="text-ux-text-muted font-medium">Licensed to</dt>
          <dd className="space-y-2">
            <a href="https://www.canada.ca/en/treasury-board-secretariat.html"
               target="_blank" rel="noopener noreferrer"
               className="text-ux-accent hover:underline">
              Treasury Board of Canada Secretariat
            </a>
            {/* GC wordmark — credential accent below the name, intentionally subdued */}
            <div>
              <a href="https://www.canada.ca/en/treasury-board-secretariat.html"
                 target="_blank" rel="noopener noreferrer"
                 aria-label="Government of Canada">
                <img src="/gc-wordmark-blk.svg" alt="Government of Canada" className="h-4 w-auto dark:hidden opacity-40 hover:opacity-70 transition-opacity" draggable={false} />
                <img src="/gc-wordmark-wht.svg" alt="Government of Canada" className="h-4 w-auto hidden dark:block opacity-40 hover:opacity-70 transition-opacity" draggable={false} />
              </a>
            </div>
          </dd>

          <dt className="text-ux-text-muted font-medium">Version</dt>
          <dd className="text-ux-text font-mono">{__BUILD_VERSION__}</dd>
        </dl>
      </section>

      {/* Description and purpose */}
      <section className="bg-ux-surface border border-ux-border rounded-lg p-5 space-y-4">
        <h2 className="text-xs font-semibold text-ux-text-muted uppercase tracking-widest">
          Description &amp; Purpose
        </h2>
        <p className="text-sm text-ux-text leading-relaxed">
          GCUID provides a <strong className="font-semibold text-ux-text">centralized identity
          registry</strong> for the Government of Canada, issuing persistent, globally-unique
          identifiers to persons, organizations, assets, applications, and autonomous agents.
          Each identifier is encoded as a structured URN in one of two formats:
        </p>
        <div className="space-y-2">
          <div className="flex items-start gap-3">
            <span className="text-xs font-semibold text-ux-accent shrink-0 mt-0.5 w-20 text-right">V2 — Current</span>
            <code className="text-xs font-mono bg-ux-accent-subtle text-ux-accent rounded px-3 py-1.5 block flex-1">
              urn:gcuid:&lt;core&gt;
            </code>
          </div>
          <div className="flex items-start gap-3">
            <span className="text-xs font-semibold text-ux-text-muted shrink-0 mt-0.5 w-20 text-right">V1 — Legacy</span>
            <code className="text-xs font-mono bg-ux-hover text-ux-text-sub rounded px-3 py-1.5 block flex-1">
              urn:gc:uid:&lt;entity-type&gt;:&lt;version&gt;:&lt;core&gt;
            </code>
          </div>
        </div>
        <p className="text-sm text-ux-text leading-relaxed">
          The system enables <strong className="font-semibold text-ux-text">federated attribute
          retrieval</strong>: a single GCUID links to authoritative attributes held across multiple
          source systems (HR, LDAP, Finance, Engineering) without copying or centralizing that
          data. Applications query the registry to obtain only the attributes they are authorized
          to access under the policy model.
        </p>
        <p className="text-sm text-ux-text leading-relaxed">
          This demonstration environment showcases the full GCUID lifecycle using synthetic departmental data including registration, alias
          resolution, cross-system lookups, credential-based and identity-based access gates, and
          policy-driven attribute authorization.
        </p>
      </section>

      {/* Technology stack */}
      <section className="bg-ux-surface border border-ux-border rounded-lg p-5 space-y-5">
        <h2 className="text-xs font-semibold text-ux-text-muted uppercase tracking-widest">
          Technology Stack
        </h2>

        {/* Shared row component rendered inline */}
        {/* Frontend */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wide">
            Frontend
          </h3>
          <div className="space-y-2">
            {([
              { name: 'React',               version: '^18.2.0',  desc: 'UI component framework; drives all portal views, forms, and interactive state' },
              { name: 'React Router DOM',     version: '^6.21.3',  desc: 'Client-side routing; maps URL paths to portal pages and sub-views without full reloads' },
              { name: 'TanStack React Query', version: '^5.17.19', desc: 'Server-state caching layer; manages API fetches, stale-while-revalidate, and background refreshes' },
              { name: 'Mermaid',              version: '^11.14.0', desc: 'Diagram renderer; generates entity-relationship and lifecycle flow diagrams inline in the portal' },
              { name: 'TypeScript',           version: '^5.3.3',   desc: 'Typed superset of JavaScript; enforces correctness and documents contracts across the codebase' },
              { name: 'Vite',                 version: '^5.0.12',  desc: 'Build tool and dev server; provides fast HMR, tree-shaking, and optimized production bundles' },
              { name: 'Tailwind CSS',         version: '^3.4.1',   desc: 'Utility-first CSS framework; powers the theming system, responsive layout, and dark-mode switching' },
            ] as { name: string; version: string; desc: string }[]).map(({ name, version, desc }) => (
              <div key={name} className="grid grid-cols-[160px_80px_1fr] gap-x-4 items-baseline text-sm">
                <span className="text-ux-text-muted font-medium truncate">{name}</span>
                <span className="text-ux-text-sub font-mono text-xs">{version}</span>
                <span className="text-xs text-ux-text-sub leading-snug">{desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* API / Runtime */}
        <div className="border-t border-ux-border pt-4 space-y-2">
          <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wide">
            API / Runtime
          </h3>
          <div className="space-y-2">
            {([
              { name: 'Node.js / tsx', version: '^4.7.0',  desc: 'Runtime that executes TypeScript directly via tsx; hosts the Express API server process' },
              { name: 'Express',       version: '^4.18.2', desc: 'HTTP server framework; defines REST routes for identity registration, lookup, and attribute queries' },
              { name: 'CORS',          version: '^2.8.5',  desc: 'Middleware that gates cross-origin access; permits the Vite dev server to call the local API' },
              { name: 'Commander',     version: '^14.0.3', desc: 'CLI argument parser; powers the gcuid mint, parse, validate, and register command-line tools' },
              { name: 'jexl',          version: '^2.3.0',  desc: 'JavaScript expression evaluator; drives the policy-rule engine that authorizes attribute access per request' },
            ] as { name: string; version: string; desc: string }[]).map(({ name, version, desc }) => (
              <div key={name} className="grid grid-cols-[160px_80px_1fr] gap-x-4 items-baseline text-sm">
                <span className="text-ux-text-muted font-medium truncate">{name}</span>
                <span className="text-ux-text-sub font-mono text-xs">{version}</span>
                <span className="text-xs text-ux-text-sub leading-snug">{desc}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Database */}
        <div className="border-t border-ux-border pt-4 space-y-2">
          <h3 className="text-xs font-semibold text-ux-text-sub uppercase tracking-wide">
            Database
          </h3>
          <div className="space-y-2">
            {([
              { name: 'SQLite',         version: 'embedded',  desc: 'Embedded relational database; stores the identity registry, attribute records, and audit log on-disk with no external service' },
              { name: 'better-sqlite3', version: '^12.10.0', desc: 'Synchronous Node.js bindings for SQLite; provides low-latency, zero-async-overhead queries for the API layer' },
            ] as { name: string; version: string; desc: string }[]).map(({ name, version, desc }) => (
              <div key={name} className="grid grid-cols-[160px_80px_1fr] gap-x-4 items-baseline text-sm">
                <span className="text-ux-text-muted font-medium truncate">{name}</span>
                <span className="text-ux-text-sub font-mono text-xs">{version}</span>
                <span className="text-xs text-ux-text-sub leading-snug">{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

    </div>
    </UXScopeWrapper>
  );
}
