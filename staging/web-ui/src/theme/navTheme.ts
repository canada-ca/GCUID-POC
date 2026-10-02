/**
 * Derive nav-dropdown colors from a page's UX-theme palette.
 *
 * The Layout header lives OUTSIDE any per-scope wrapper, so it can't inherit
 * the page's CSS variables directly.  Instead, each dropdown reads its
 * corresponding scope's theme tokens from the global UX config and derives:
 *
 *   title  — color for the group label bullet + uppercase title text +
 *            trigger button border/text.  Rendered on the page header bgPage
 *            (light blue/grey surface in light mode, dark navy in dark mode).
 *            Tuned to satisfy WCAG-AA (>= 4.5:1) against bgPage.
 *
 *   panel  — color for the dropdown menu background.  Rendered in a small
 *            floating panel that sits over the page header, so it should be
 *            a tinted-but-dark surface that complements the page accent in
 *            both modes — never pure white, never pure black.
 *
 *   accent — color for item text/hover/active highlight inside the panel.
 *            On the panel bg, this needs strong contrast as well.
 *
 * The values are derived from the scope's own bgPage / bgSurface /
 * accentPrimary tokens so the dropdown always reads as belonging to its
 * corresponding page — no hard-coded palettes.
 *
 * @param scopeTheme  The `theme` object for a scope (has `light` and `dark`
 *                    sub-objects each containing ~47 UX tokens).  Pass
 *                    `undefined` for a safe fallback palette.
 * @param mode        'light' | 'dark' — which variant to derive.
 */
export interface NavDropdownColors {
  /** Title bullet / uppercase label / trigger button on bgPage. */
  title: string;
  /** Dropdown panel background. */
  panel: string;
  /** Item text / hover / active highlight inside the panel. */
  accent: string;
}

export function deriveNavTheme(
  scopeTheme: { light?: Record<string, string>; dark?: Record<string, string> } | undefined,
  mode: 'light' | 'dark',
): NavDropdownColors {
  // ─── Safe fallback (Titanium palette) ──────────────────────────────────
  if (!scopeTheme) {
    const isDark = mode === 'dark';
    return {
      title:  isDark ? '#2dd4bf' : '#0f766e',
      panel:  isDark ? '#0d2a2a'  : '#e6f5f3',
      accent: isDark ? '#2dd4bf' : '#0d9488',
    };
  }

  const tokens = scopeTheme[mode] || {};
  const accentPrimary: string = tokens.accentPrimary || (mode === 'dark' ? '#c7d2fe' : '#4338ca');
  const bgPage:        string = tokens.bgPage        || (mode === 'dark' ? '#000f20' : '#eff6ff');
  const bgSurface:     string = tokens.bgSurface     || (mode === 'dark' ? '#001730' : '#ffffff');

  const isDark = mode === 'dark';

  // ─── Title color ──────────────────────────────────────────────────────
  // The title sits on the page header bgPage, so it must contrast against
  // THAT background, not against the dropdown panel.  We compute the page
  // accent's contrast against bgPage, and if it's not AA-grade we step
  // toward black/white until it is.
  let title = accentPrimary;
  if (contrastRatio(title, bgPage) < 4.5) {
    title = stepColor(title, isDark ? '#ffffff' : '#000000', 4.5, bgPage);
  }

  // ─── Panel background ─────────────────────────────────────────────────
  // The panel sits over the page header.  In dark mode we want it
  // noticeably DARKER than bgPage (so it reads as a recessed / shadowed
  // surface), but still tinted with the page accent so it visually
  // belongs to the corresponding page.  In light mode we lift the
  // bgSurface just enough with the accent to give the panel a hint of
  // color without making it feel heavy.
  const panel = isDark
    ? mixColors(mixColors(bgPage, '#000000', 0.30), accentPrimary, 0.08)
    : mixColors(bgSurface, accentPrimary, 0.06);

  // ─── Accent (item text inside panel) ──────────────────────────────────
  // On the dark-ish panel, item text uses the page accent.  If the accent
  // doesn't have enough contrast against the panel (often in dark mode
  // where accents are intentionally muted), we step toward white in dark
  // mode or black in light mode until AA is met.
  let accent = accentPrimary;
  if (contrastRatio(accent, panel) < 4.5) {
    accent = stepColor(accent, isDark ? '#ffffff' : '#000000', 4.5, panel);
  }

  return { title, panel, accent };
}

// ─── Color math helpers ─────────────────────────────────────────────────────

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function mixColors(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  return toHex(
    ar + (br - ar) * t,
    ag + (bg - ag) * t,
    ab + (bb - ab) * t,
  );
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(c1: string, c2: string): number {
  const L1 = relativeLuminance(c1);
  const L2 = relativeLuminance(c2);
  const lighter = Math.max(L1, L2);
  const darker  = Math.min(L1, L2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Linearly interpolate a color toward a target color until the resulting
 * color achieves the desired contrast ratio against a background.  Used to
 * guarantee WCAG-AA readability when the raw accent is too pale on its
 * intended surface.
 */
function stepColor(
  from: string,
  toward: string,
  minRatio: number,
  against: string,
): string {
  let lo = 0;
  let hi = 1;
  let best = from;
  for (let i = 0; i < 12; i++) {
    const mid = (lo + hi) / 2;
    const candidate = mixColors(from, toward, mid);
    if (contrastRatio(candidate, against) >= minRatio) {
      hi = mid;
      best = candidate;
    } else {
      lo = mid;
    }
  }
  return best;
}