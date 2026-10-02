// Try to load the noetroniq design-system preset (co-located sibling repo).
// If it is not available the inline colour overrides in theme.extend below act
// as the standalone fallback — identical values, no behaviour difference.
import { createRequire } from 'module';
const _require = createRequire(import.meta.url);
let _noetroniqPreset = null;
try { _noetroniqPreset = _require('../../../noetroniq-design-system/02_tokens/tailwind-preset.cjs'); } catch { /* not available */ }

/** @type {import('tailwindcss').Config} */
export default {
  presets: _noetroniqPreset ? [_noetroniqPreset] : [],
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ── NOETRONIQ brand primitives ───────────────────────────────────────────
        navy: {
          DEFAULT: '#001f3f',
          dark:    '#0a1d3a',
          light:   '#173d75',
        },
        burgundy: {
          DEFAULT: '#721817',
          tint:    '#a34347',
        },
        gold: {
          DEFAULT: '#d4af37',
          dark:    '#b9972c',
        },
        offwhite: {
          digital: '#f2f5f9',
          print:   '#fdfdf0',
        },
        // Semantic alias: "primary" maps to navy so existing classes keep working
        primary: {
          50:  '#e8eef5',
          100: '#c5d3e6',
          200: '#9eb5d4',
          300: '#6e93bf',
          400: '#3f72a9',
          500: '#173d75',
          600: '#001f3f',
          700: '#001833',
          800: '#001026',
          900: '#00081a',
          950: '#00040d',
        },

        // ── NOETRONIQ extended-palette colour family overrides ───────────────────
        // These replace Tailwind's default colour families so that standard utility
        // classes (bg-blue-100, border-green-200, dark:border-amber-700, etc.) all
        // resolve to on-palette values without any changes to component source files.
        //
        // Aliased families (no dedicated noetroniq equivalent):
        //   yellow → noetroniq-amber  (no noetroniq-yellow)
        //   violet → noetroniq-purple (no noetroniq-violet)
        //
        // Families left at Tailwind defaults (already identical to noetroniq):
        //   orange, indigo

        // noetroniq-blue: muted slate-blue harmonized with navy
        blue: {
           50: '#f4f7fa',
          100: '#e7eef4',
          200: '#d0dde9',
          300: '#b2c5d7',
          400: '#8ea7c1',
          500: '#6f8fb0',
          600: '#4d7aa7',
          700: '#3f6489',
          800: '#334f6c',
          900: '#273c51',
          950: '#0f161f',
        },

        // noetroniq-green: muted sage-green for success states
        green: {
           50: '#f5f7f4',
          100: '#e8ede6',
          200: '#d1dccf',
          300: '#b3c3ae',
          400: '#8fa588',
          500: '#6e8667',
          600: '#4a6741',
          700: '#3d5636',
          800: '#30442b',
          900: '#243321',
          950: '#0e130d',
        },

        // noetroniq-teal: muted sage-teal for connector/accent states
        teal: {
           50: '#f4f8f7',
          100: '#e6eeec',
          200: '#ceddd9',
          300: '#aec5c1',
          400: '#87a6a1',
          500: '#668b86',
          600: '#4d7470',
          700: '#3f5f5c',
          800: '#324b48',
          900: '#263735',
          950: '#0f1513',
        },

        // noetroniq-amber: muted golden-amber harmonized with gold
        amber: {
           50: '#faf8f2',
          100: '#f4f0e4',
          200: '#e9e1c9',
          300: '#daccaa',
          400: '#c7b285',
          500: '#b59b66',
          600: '#c99a4a',
          700: '#a67f3d',
          800: '#836531',
          900: '#614b25',
          950: '#231c0d',
        },

        // yellow → noetroniq-amber (no noetroniq-yellow; amber is semantically closest)
        yellow: {
           50: '#faf8f2',
          100: '#f4f0e4',
          200: '#e9e1c9',
          300: '#daccaa',
          400: '#c7b285',
          500: '#b59b66',
          600: '#c99a4a',
          700: '#a67f3d',
          800: '#836531',
          900: '#614b25',
          950: '#231c0d',
        },

        // noetroniq-purple: muted elegant violet harmonious with navy/burgundy
        purple: {
           50: '#f7f5f9',
          100: '#eeeaf3',
          200: '#ddd5e7',
          300: '#c7bad7',
          400: '#ac98c2',
          500: '#947bb0',
          600: '#7d5ba6',
          700: '#674b8a',
          800: '#523c6d',
          900: '#3e2d52',
          950: '#2a1f38',
        },

        // violet → noetroniq-purple (no noetroniq-violet; purple is semantically closest)
        violet: {
           50: '#f7f5f9',
          100: '#eeeaf3',
          200: '#ddd5e7',
          300: '#c7bad7',
          400: '#ac98c2',
          500: '#947bb0',
          600: '#7d5ba6',
          700: '#674b8a',
          800: '#523c6d',
          900: '#3e2d52',
          950: '#2a1f38',
        },

        // noetroniq-rose: muted burgundy-red scale anchored to brand primitives
        //   rose-600 = burgundy tint (#a34347)  rose-800 = burgundy (#721817)
        rose: {
           50: '#fdf4f4',
          100: '#f8e5e5',
          200: '#f1cccc',
          300: '#e5a5a5',
          400: '#d27878',
          500: '#b85050',
          600: '#a34347',   // burgundy tint
          700: '#8c3537',
          800: '#721817',   // burgundy DEFAULT
          900: '#5a1313',
          950: '#3a0d0d',
        },

        // red → noetroniq-rose (standard Tailwind red replaced with muted burgundy family)
        red: {
           50: '#fdf4f4',
          100: '#f8e5e5',
          200: '#f1cccc',
          300: '#e5a5a5',
          400: '#d27878',
          500: '#b85050',
          600: '#a34347',   // burgundy tint
          700: '#8c3537',
          800: '#721817',   // burgundy DEFAULT
          900: '#5a1313',
          950: '#3a0d0d',
        },

        // ── UX theme tokens ───────────────────────────────────────────────────
        // These map every --ux-* CSS variable to a Tailwind colour key so that
        // pages can use classes like bg-ux-page, text-ux-text, border-ux-border
        // without any dark: prefix — UXThemeContext re-injects the variables on
        // every mode change so the values are always correct for the current mode.
        //
        // Tailwind class → CSS variable:
        //   bg-ux-page          → var(--ux-bg-page)
        //   bg-ux-surface       → var(--ux-bg-surface)
        //   bg-ux-surface-alt   → var(--ux-bg-surface-alt)
        //   bg-ux-hover         → var(--ux-bg-hover)
        //   bg-ux-highlight     → var(--ux-bg-highlight)
        //   border-ux-border    → var(--ux-border-default)
        //   border-ux-border-strong → var(--ux-border-strong)
        //   text-ux-text        → var(--ux-text-primary)
        //   text-ux-text-sub    → var(--ux-text-secondary)
        //   text-ux-text-muted  → var(--ux-text-muted)
        //   text-ux-link        → var(--ux-text-link)
        //   bg-ux-accent        → var(--ux-accent-primary)
        //   text-ux-accent      → var(--ux-accent-primary)
        //   text-ux-accent-on   → var(--ux-accent-on-primary)
        //   bg-ux-accent2       → var(--ux-accent-secondary)
        //   bg-ux-btn           → var(--ux-btn-primary-bg)
        //   text-ux-btn-on      → var(--ux-btn-primary-text)
        //   bg-ux-btn2          → var(--ux-btn-secondary-bg)
        //   text-ux-btn2-on     → var(--ux-btn-secondary-text)
        //   text-ux-success     → var(--ux-status-success)
        //   text-ux-warning     → var(--ux-status-warning)
        //   text-ux-error       → var(--ux-status-error)
        //   text-ux-info        → var(--ux-status-info)
        //   bg-ux-nav-dot       → var(--ux-nav-dot-color)
        //   text-ux-nav-label   → var(--ux-nav-label-color)
        ux: {
          // Backgrounds
          'page':        'var(--ux-bg-page)',
          'surface':     'var(--ux-bg-surface)',
          'surface-alt': 'var(--ux-bg-surface-alt)',
          'hover':       'var(--ux-bg-hover)',
          'highlight':   'var(--ux-bg-highlight)',
          // Borders
          'border':        'var(--ux-border-default)',
          'border-strong': 'var(--ux-border-strong)',
          // Text
          'text':        'var(--ux-text-primary)',
          'text-sub':    'var(--ux-text-secondary)',
          'text-muted':  'var(--ux-text-muted)',
          'link':        'var(--ux-text-link)',
          // Accent
          'accent':      'var(--ux-accent-primary)',
          'accent-on':   'var(--ux-accent-on-primary)',
          'accent2':     'var(--ux-accent-secondary)',
          // Buttons
          'btn':         'var(--ux-btn-primary-bg)',
          'btn-on':      'var(--ux-btn-primary-text)',
          'btn2':        'var(--ux-btn-secondary-bg)',
          'btn2-on':     'var(--ux-btn-secondary-text)',
          // Status
          'success':     'var(--ux-status-success)',
          'warning':     'var(--ux-status-warning)',
          'error':       'var(--ux-status-error)',
          'info':        'var(--ux-status-info)',
          // Nav
          'nav-dot':        'var(--ux-nav-dot-color)',
          'nav-label':      'var(--ux-nav-label-color)',
          // New element tokens (Phase 7)
          'table-header':   'var(--ux-table-header-bg)',
          'input-bg':       'var(--ux-input-bg)',
          'code-bg':        'var(--ux-code-bg)',
          'badge-neutral':  'var(--ux-badge-neutral-bg)',
          'badge-neutral-text': 'var(--ux-badge-neutral-text)',
          'toggle-thumb':   'var(--ux-toggle-thumb)',
          // Accent tints (portal-specific — pagination active, stat pills, row hover)
          'accent-subtle':        'var(--ux-accent-subtle-bg)',
          'accent-subtle-border': 'var(--ux-accent-subtle-border)',
          'accent-muted':         'var(--ux-accent-muted-bg)',
          // Status panel backgrounds and borders (semantic)
          'success-bg':     'var(--ux-status-success-bg)',
          'success-border': 'var(--ux-status-success-border)',
          'warning-bg':     'var(--ux-status-warning-bg)',
          'warning-border': 'var(--ux-status-warning-border)',
          'error-bg':       'var(--ux-status-error-bg)',
          'error-border':   'var(--ux-status-error-border)',
          'info-bg':        'var(--ux-status-info-bg)',
          'info-border':    'var(--ux-status-info-border)',
          // Elevation overlays
          'elevation1':     'var(--ux-elevation1)',
          'elevation2':     'var(--ux-elevation2)',
        },
      },
      fontFamily: {
        heading: ['Montserrat', 'system-ui', 'sans-serif'],
        body:    ['Inter', 'IBM Plex Sans', 'system-ui', 'sans-serif'],
        mono:    ['Fira Code', 'IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
