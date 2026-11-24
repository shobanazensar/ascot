import { Locator, Page, test } from '@playwright/test';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const REPORT_FILE = resolve(process.cwd(), 'healing-report.json');

export interface HealEvent {
  key: string;
  primary: string;
  healedWith: string;
  fallbackIndex: number;
  test: string;
  time: string;
}

type Scope = Page | Locator;
type Role = Parameters<Page['getByRole']>[0];

/**
 * Declarative description of an element. The primary locator is built exactly as the page object used to
 * build it by hand; `candidatesFor` derives the ordered fallbacks automatically, so every element is
 * self-healing without writing a fallback list for each one.
 */
export type HealSpec =
  | { role: string; name: string | RegExp; exact?: boolean; level?: number }
  | { text: string | RegExp; exact?: boolean }
  | { css: string }
  | { label: string }
  | { clickable: string | RegExp };

function describe(locator: Locator): string {
  // Locator.toString() yields e.g. "getByRole('textbox', { name: 'Username' })"
  return String(locator);
}

function currentTestTitle(): string {
  try {
    return test.info().title;
  } catch {
    return 'unknown';
  }
}

function recordHeal(event: HealEvent): void {
  console.warn(
    `🩹 [HEALED] ${event.key}: primary ${event.primary} failed, used fallback #${event.fallbackIndex} ${event.healedWith}`,
  );
  try {
    const events: HealEvent[] = existsSync(REPORT_FILE) ? JSON.parse(readFileSync(REPORT_FILE, 'utf8')) : [];
    events.push(event);
    writeFileSync(REPORT_FILE, JSON.stringify(events, null, 2));
  } catch {
    // the report is best-effort and must never fail a test
    try { appendFileSync(REPORT_FILE + '.log', JSON.stringify(event) + '\n'); } catch { /* ignore */ }
  }
}

const CLICKABLE_ROLES = ['button', 'menuitem', 'link', 'tab'];
const siblingRoles = (role: string): string[] =>
  CLICKABLE_ROLES.includes(role) ? CLICKABLE_ROLES.filter((r) => r !== role)
    : role === 'combobox' ? ['listbox', 'textbox']
    : role === 'textbox' ? ['combobox', 'searchbox']
    : [];

const q = (s: string): string => s.replace(/"/g, '\\"');

/** Alternative CSS selectors for an id / name / aria-label based selector (prefix, tag and attribute changes). */
function cssVariants(css: string): string[] {
  // "<parent> <descendant>": split on the first space that is not inside [...] or quotes, vary the parent only
  let depth = 0;
  let quote = '';
  for (let i = 0; i < css.length; i++) {
    const c = css[i];
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '[') depth++;
    else if (c === ']') depth--;
    else if (c === ' ' && depth === 0) {
      const parent = css.slice(0, i);
      const rest = css.slice(i + 1);
      return cssVariants(parent).map((v) => `${v} ${rest}`);
    }
  }
  const out: string[] = [];
  const id = css.match(/^[a-z]*#([\w:.-]+)$/i)?.[1];
  const name = css.match(/\[name="([^"]+)"\]/)?.[1];
  const aria = css.match(/\[aria-label="([^"]+)"\]/)?.[1];
  const key = id ?? name;
  if (key) {
    const tail2 = key.split('-').slice(-2).join('-');
    const last = key.split('-').pop() as string;
    out.push(`[id="${key}"]`, `[name="${key}"]`, `[id$="${tail2}"]`, `[name$="${tail2}"]`, `[id*="${last}" i]`);
  }
  if (aria) out.push(`[aria-label="${aria}"]`, `[aria-label*="${aria}" i]`);
  return out.filter((v) => v !== css);
}

/** The primary locator for a spec (what the page object used to build by hand). */
export function primaryFor(scope: Scope, spec: HealSpec): Locator {
  return candidatesFor(scope, spec)[0];
}

/** Ordered candidates for a spec: [0] is the primary, the rest are strategy fallbacks. */
export function candidatesFor(scope: Scope, spec: HealSpec): Locator[] {
  const out: Locator[] = [];

  if ('role' in spec) {
    const { role, name, exact, level } = spec;
    const withLevel = level ? { level } : {};
    out.push(scope.getByRole(role as Role, { name, ...(exact !== undefined && { exact }), ...withLevel }));
    if (typeof name === 'string' && exact) out.push(scope.getByRole(role as Role, { name, ...withLevel }));
    for (const r of siblingRoles(role)) out.push(scope.getByRole(r as Role, { name, ...(exact !== undefined && { exact }) }));
    out.push(scope.getByText(name, { exact: typeof name === 'string' ? !!exact : undefined }));
    out.push(scope.getByLabel(name));
    if (typeof name === 'string') {
      out.push(scope.locator(`[aria-label*="${q(name)}" i]`));
      out.push(scope.getByTitle(name));
    }
  } else if ('text' in spec) {
    const { text, exact } = spec;
    out.push(scope.getByText(text, { exact }));
    if (typeof text === 'string' && exact) out.push(scope.getByText(text));
    for (const r of CLICKABLE_ROLES) out.push(scope.getByRole(r as Role, { name: text, ...(exact !== undefined && { exact }) }));
    out.push(scope.getByLabel(text));
    if (typeof text === 'string') {
      out.push(scope.locator(`[aria-label*="${q(text)}" i]`));
      out.push(scope.getByTitle(text));
    }
  } else if ('css' in spec) {
    out.push(scope.locator(spec.css));
    for (const v of cssVariants(spec.css)) out.push(scope.locator(v));
    const aria = spec.css.match(/\[aria-label="([^"]+)"\]/)?.[1];
    if (aria) {
      out.push(scope.getByLabel(aria));
      out.push(scope.getByText(aria, { exact: true }));
    }
  } else if ('label' in spec) {
    const { label } = spec;
    out.push(scope.getByLabel(label, { exact: false }).or(scope.getByPlaceholder(label, { exact: false })));
    out.push(scope.getByPlaceholder(label));
    out.push(scope.getByRole('textbox', { name: label }));
    out.push(scope.getByRole('combobox', { name: label }));
    out.push(scope.locator(`[aria-label*="${q(label)}" i]`));
  } else {
    const { clickable } = spec;
    out.push(scope.locator('button, a, [role="button"]', { hasText: clickable }));
    out.push(scope.getByRole('button', { name: clickable }));
    out.push(scope.getByRole('link', { name: clickable }));
    out.push(scope.getByText(clickable));
  }
  return out;
}

/**
 * Self-healing locator resolution.
 *
 * `candidates[0]` is the primary locator; the rest are fallbacks that use different strategies.
 * For the first `primaryGraceMs` only the primary is consulted, so a slow page load is never mistaken for a
 * broken locator (and a loose fallback can't grab the wrong element while the right one is still loading).
 * After that all candidates are polled together until `timeout`; the first visible one, in priority order,
 * wins, provided it matches exactly one element (ambiguous fallbacks are skipped). When that is not the
 * primary, the heal is logged and written to healing-report.json so the primary
 * locator can be fixed.
 *
 * Throws, listing every locator tried, when none becomes visible.
 */
export async function healLocator(
  key: string,
  candidates: Locator[],
  timeout = 30_000,
  primaryGraceMs = 10_000,
): Promise<Locator> {
  if (!candidates.length) throw new Error(`healLocator(${key}): no candidates supplied`);
  const start = Date.now();
  const deadline = start + timeout;
  for (;;) {
    const usable = Date.now() - start < Math.min(primaryGraceMs, timeout) ? 1 : candidates.length;
    for (let i = 0; i < usable; i++) {
      const candidate = candidates[i].first();
      if (await candidate.isVisible().catch(() => false)) {
        // Ambiguity guard: a fallback must identify exactly one element. A loose fallback that matches several
        // (e.g. text "Search" appears in the nav bar and on the button) could silently click the wrong one.
        if (i > 0 && (await candidates[i].count().catch(() => 0)) !== 1) continue;
        if (i > 0) {
          recordHeal({
            key,
            primary: describe(candidates[0]),
            healedWith: describe(candidates[i]),
            fallbackIndex: i,
            test: currentTestTitle(),
            time: new Date().toISOString(),
          });
        }
        return candidate;
      }
    }
    if (Date.now() >= deadline) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `Self-healing failed for "${key}": none of ${candidates.length} locator(s) became visible within ${timeout}ms:\n` +
      candidates.map((c, i) => `  ${i === 0 ? 'primary ' : `fallback${i}`}: ${describe(c)}`).join('\n'),
  );
}

/** Resolve a spec (primary + derived fallbacks) to a visible, healed locator. */
export function heal(key: string, scope: Scope, spec: HealSpec, extra: Locator[] = []): Promise<Locator> {
  return healLocator(key, [...candidatesFor(scope, spec), ...extra]);
}
