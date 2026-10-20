/**
 * AcuDx: citation links. A guideline citation is shown as a link only when it resolves:
 * an http(s) URL, or a DOI (bare, or prefixed `doi:`) linked through doi.org. Pure.
 */
export function citationHref(citation: string): string | null {
  const c = citation.trim();
  if (/^https?:\/\//i.test(c)) return c;
  const doi = /^(?:doi:\s*)?(10\.\d{4,9}\/\S+)$/i.exec(c);
  return doi ? `https://doi.org/${doi[1]}` : null;
}
