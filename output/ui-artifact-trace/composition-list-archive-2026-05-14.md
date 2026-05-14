# UI Trace Matrix - Composition List Archive

## Scope

- Request route: `http://127.0.0.1:4173/?v=route-reload-1778753345593#/compositions/list`
- Verified route: `http://127.0.0.1:4173/?v=archive-1778754379361#/compositions/list`
- Shared shell scope: observed in screenshot, not modified.
- Design sources: `DESIGN.md` Compose First rules for composition cards/archive confirmation, and `ARCHITECTURE.md` Phase 1.1 logical deletion/status write contract.

## Requirements To Selectors

| Requirement | Implementation | Verification |
| --- | --- | --- |
| Operation column adds archive | `CompositionListTable` action cell renders `查看详情` and `归档` in `.composition-global-index__row-actions`. | Desktop live DOM found 4 archive buttons for 4 rows. |
| Archive requires second confirmation | `CompositionArchiveDialog` opens from `onArchiveRequest` and no API write happens before `确认归档`. | Vitest asserts `updateComposition` is not called after first click and before dialog confirmation. |
| Confirmation names object and stable ID | Dialog shows `组合名称` and `稳定 ID`. | Vitest checks `cmp-001`; desktop screenshot captured dialog. |
| Logical delete, not physical purge | Dialog copy states the composition is hidden and historical backtests/frozen evidence/audit evidence are not physically cleared. | Desktop and mobile live checks found `不会被物理清除`. |
| Leg reference count decrements through runtime truth | Confirm action calls `updateComposition(id, { status: 'ARCHIVED' })` and reloads `/compositions`; backend leg inventory already counts only non-archived compositions. | Vitest checks PATCH payload and second `listCompositions`; existing backend tests cover archived compositions ignored by leg reference counts. |
| Responsive confirmation surface | Dialog uses existing fixed backdrop and width constraint `min(540px, 100%)`; table remains horizontally contained. | Mobile geometry: viewport 390px, dialog left 24/right 366, body scroll width 390. |

## Evidence

- Focused test: `npm.cmd test -- composition.global-index.test.tsx` -> 13 passed.
- Build: `npm.cmd run build` -> passed.
- Supervisor status: quickstart running; backend-api and frontend-preview healthy in `.tmp/runtime-supervisor/state/quickstart.json`.
- Backend health: `http://127.0.0.1:8000/healthz` -> 200.
- Desktop live proof: ready in 952ms, 4 rows, 4 archive buttons, dialog copy verified.
- Desktop screenshot: `C:\Fin\Grit_Strategy_Lab\output\ui-artifact-trace\composition-list-archive-dialog-1778754379361.png`
- Mobile screenshot: `C:\Fin\Grit_Strategy_Lab\output\ui-artifact-trace\composition-list-archive-dialog-mobile-1778754425732.png`
