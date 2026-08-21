# Reliability Corpus / 可靠性样例集

These synthetic files exercise stable import and rendering behavior without using private article content.

- `markdown-baseline.md`: front matter, headings, lists, links and emphasis.
- `obsidian-complex.md`: Callout, task list, highlight, table and code fence.
- `pagination-stress.md`: repeated sections used to detect content loss during card pagination.
- `missing-assets.md`: unresolved standard and Obsidian image references.
- `unsafe-import.html`: sanitization of executable and embedded HTML.

ZIP coverage is generated from these sources in the test so the binary fixture remains reproducible.
