import { instrument } from '@prismbox/core';
import path from 'node:path';

/** Check whether a file is a React Client Component ('use client' directive). */
export function isClientComponent(code: string): boolean {
  return /^\s*(['"])use client\1/m.test(code);
}

/**
 * Transform a Next.js component for Prismbox dev mode.
 * Crucially: Server Components (files without 'use client') are left completely untouched (returns null).
 * Only Client Components containing R3F Canvas / host nodes are instrumented.
 */
export function transformNextClientComponent(
  code: string,
  id: string,
  root: string,
): { code: string; map: unknown } | null {
  if (!isClientComponent(code)) return null;
  const clean = id.split('?')[0] as string;
  if (!/\.(tsx|jsx)$/.test(clean) || clean.includes('/node_modules/') || clean.includes('\\node_modules\\')) {
    return null;
  }
  const rel = path.relative(root, clean).split(path.sep).join('/');
  if (rel.startsWith('..')) return null;
  try {
    const r = instrument(code, rel);
    return r ? { code: r.code, map: r.map } : null;
  } catch {
    return null; // parse error: leave to Next.js compiler to report
  }
}
