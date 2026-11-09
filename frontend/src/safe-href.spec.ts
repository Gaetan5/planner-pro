import { describe, expect, it } from 'vitest';
import { safeHref } from './safe-href';

describe('safeHref (S20)', () => {
  it.each([
    'https://files.example.com/plan.png',
    'data:image/png;base64,iVBORw0KGgo=',
    'data:application/pdf;base64,JVBERi0xLjQ=',
  ])('conserve %s', (url) => {
    expect(safeHref(url)).toBe(url);
  });

  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    ' javascript:alert(1)',
    'vbscript:x',
    'http://files.example.com/a.png',
    'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'https://user:pass@files.example.com/',
    'pas une url',
    '',
    undefined,
    null,
    42,
  ])('supprime %s', (url) => {
    expect(safeHref(url)).toBeUndefined();
  });
});
