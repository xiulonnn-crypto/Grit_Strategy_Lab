# Vibe Alpha Zoo Raw_F2 UI Trace Matrix

route: http://127.0.0.1:4173/?v=<timestamp>#/factors/imports
design_source: designs/2026-05-21-public-factor-import-center/spec.md plus approved public factor import page structure
implementation_target: web/src/pages/public-factor-import-center-page.tsx, web/src/app-runtime-cn.tsx, web/src/types.ts

| Requirement | Selector / Surface | Acceptance Gate | Status |
| --- | --- | --- | --- |
| Vibe source is visible as an external catalog source without becoming a primary nav route | source list / active source button | DOM copy includes `Vibe Alpha Zoo`; no raw enum, NaN, or direct publish wording | PASS_VITEST |
| Vibe manifest exposes catalog and bench evidence | manifest rail | Shows formula count, AST scan counts, alive/reversed/dead counts, and Raw_F2 batch status when present | PASS_VITEST |
| Vibe flow preserves governed chain | flow/manifest copy | Copy includes `Catalog -> AST Scan -> IC Bench -> Raw_F2 -> WNZT -> Refined_F2 -> D2 Quarantine -> Publish` or localized equivalent | PASS_VITEST |
| Dataset row action does not imply direct publish | dataset table | Primary action creates/reviews catalog; status remains review-gated or Raw_F2 staged before D2 | PASS_VITEST |
| Mobile layout remains within approved import page constraints | 390px viewport | No horizontal overflow; manifest rail collapses within page width | BLOCKED_STALE_RUNTIME |

## Evidence To Fill
- Desktop screenshot: BLOCKED; runtime preflight stayed `needs-action` after supervisor restart intent.
- Mobile screenshot: BLOCKED; runtime preflight stayed `needs-action` after supervisor restart intent.
- DOM text scan: covered by focused Vitest; live browser blocked by stale runtime.
- Focused Vitest: `node scripts/run-vitest-fixed.cjs public-factor-import-center.test.tsx` PASS, 20 tests.
- Runtime preflight evidence:
  - output/logs/grit-coder/vibe-alpha-zoo-raw-f2/runtime-preflight.json
  - output/logs/grit-coder/vibe-alpha-zoo-raw-f2/runtime-preflight-after-backend-restart.json
  - output/logs/grit-coder/vibe-alpha-zoo-raw-f2/runtime-preflight-after-cooldown.json
