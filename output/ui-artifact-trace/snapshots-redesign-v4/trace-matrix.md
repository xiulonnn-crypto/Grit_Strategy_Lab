# #/snapshots 数据快照页 UI Trace Matrix

## Scope

- Design source: `designs/2026-05-20-snapshots-equity-redesign/spec.html`
- Route: `http://127.0.0.1:4173/?v=<timestamp>#/snapshots`
- Compatibility route: `http://127.0.0.1:4173/?v=<timestamp>#/snapshots?tab=bond`
- Implementation files:
  - `web/src/pages/snapshots-page.tsx`
  - `web/src/page-sections/snapshots-operations-console.tsx`
  - `web/src/pages/snapshots-page.css`
  - `web/src/snapshots.page.test.tsx`

## Acceptance Matrix

| Requirement | Selector / File | Verification | Status |
| --- | --- | --- | --- |
| Header removes four metric cards and keeps title, description, refresh action | `.snapshots-header-card`, `snapshots-page.tsx` | Desktop screenshot `desktop-1960.png`; `role=tab` count is 0 | PASS |
| Single main page replaces independent bond tab while keeping `?tab=bond` compatible | `SnapshotsPage`, `.snapshots-page--bond-compat` | Mobile `?tab=bond` route renders same console, `tabs=0`, bond text present | PASS |
| L1 includes bond fixed-income as base market data | `buildLayerCards()`, `buildLedgerRows()` | L1 refresh log shows price, corporate actions, bond `7/7`; bond ledger row present | PASS |
| Pending queue is above drilldown and visible in first viewport | `[data-testid="snapshots-pending-queue"]`, `[data-testid="snapshots-drilldown-row"]` | Desktop `queueTop=488.23 < drillTop=819.5`; mobile `queueTop=704.98 < 900` | PASS |
| Drilldown renders L1-L4 horizontally on desktop and degrades responsively | `.snapshots-ops-drill-grid` | Desktop screenshot 1960; mobile screenshot 390; no body horizontal overflow | PASS |
| Raw ledger is dense and every row has evidence | `.snapshots-ops-ledger-table` | Browser check `evidenceButtons=11`; Vitest checks evidence and anomaly drilldown actions | PASS |
| Anomaly rows expose repair and drilldown actions | `.snapshots-ops-action-cluster` | Vitest verifies `修复` and `下钻` buttons on anomalous rows | PASS |
| Evidence modal includes snapshot id, status, coverage, source, this-run ingest, quality/audit and next action | `SnapshotEvidenceModal` | Screenshot `bond-evidence-modal-1960.png`; modal text includes `bond_fixed_income`, curve, eligible instruments, audit | PASS |
| Bond evidence reuses live bond overview fields | `overview.bond_fixed_income` mapper | Modal text includes curve `3M/2Y/10Y/30Y`, eligible instruments, quality/risk/accrual sections | PASS |
| Refresh log modal explains L1-L4 current coverage, this-run ingest, source, reason and action | `RefreshLogModal` | Screenshot `refresh-log-modal-1960.png`; modal text includes L1-L4 rows and `snap_57ae046824c9` | PASS |
| Credential module uses provider registry and maps states to actions | `buildCredentialRows()` | Vitest verifies `更换 key`, `配置路径`, `查看窗口`, `查看来源`; command panel includes forced QuickStart restart | PASS |
| Registry failures do not block the main page | `captureOptional()` and `providerRegistryError` prop | Non-blocking loader path in `SnapshotsPage`; unavailable row supported in view model | PASS |
| Responsive text does not create page-level horizontal overflow | `.snapshots-ops-*` CSS | Desktop `bodyOverflow=0`, mobile `bodyOverflow=0` | PASS |

## Evidence

- Desktop screenshot: `output/ui-artifact-trace/snapshots-redesign-v4/desktop-1960.png`
- Mobile compatibility screenshot: `output/ui-artifact-trace/snapshots-redesign-v4/mobile-bond-compat-390.png`
- Refresh log modal screenshot: `output/ui-artifact-trace/snapshots-redesign-v4/refresh-log-modal-1960.png`
- Bond evidence modal screenshot: `output/ui-artifact-trace/snapshots-redesign-v4/bond-evidence-modal-1960.png`

## Runtime Checks

- Desktop geometry: `queueTop=488.234375`, `drillTop=819.5`, `queueBeforeDrill=true`, `queueInFirstViewport=true`, `contentWidth=1660`, `bodyOverflow=0`
- Mobile geometry: `queueTop=704.984375`, `drillTop=1465.328125`, `queueBeforeDrill=true`, `queueInFirstViewport=true`, `bodyOverflow=0`, `bondTextPresent=true`
- Interactions: refresh log open/close passed; bond evidence open passed; ledger evidence action count is 11.
