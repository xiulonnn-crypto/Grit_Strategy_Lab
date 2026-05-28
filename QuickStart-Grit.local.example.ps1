# Local provider environment for QuickStart-Grit.ps1
# Copy this file to QuickStart-Grit.local.ps1 and replace the placeholders.
# The real QuickStart-Grit.local.ps1 is gitignored and should stay local only.

$env:TIINGO_API_TOKEN = 'replace-with-tiingo-token'
$env:ALPHAVANTAGE_API_KEY = 'replace-with-alpha-vantage-key'
$env:FMP_API_KEY = 'replace-with-fmp-key'
$env:KAGGLE_API_TOKEN = 'replace-with-kaggle-api-token'
$env:EODHD_API_TOKEN = 'replace-with-eodhd-token'
# Massive.com is the rebranded Polygon.io API. Set one of these two keys.
# $env:MASSIVE_API_KEY = 'replace-with-massive-api-key'
$env:NASDAQ_DATA_LINK_API_KEY = 'replace-with-nasdaq-data-link-api-key'
$env:FINNHUB_API_KEY = 'replace-with-finnhub-api-key'
$env:CRSP_DATA_PATH = 'replace-with-crsp-export-path'
$env:NORGATE_DATA_PATH = 'replace-with-norgate-export-path'
$env:GRIT_DERIVATIVES_DATA_PATH = 'replace-with-structured-note-shadow-data-path'
$env:GRIT_SEC_424B2_CACHE_DIR = '.tmp/sec-424b2-cache'
$env:GRIT_SEC_424B2_RATE_LIMIT_RPS = '5'
$env:GRIT_SEC_424B2_PILOT_MANIFEST = '.tmp/sec-424b2-pilot/jpm_manifest.json'
$env:GRIT_SEC_424B2_PILOT_LIMIT = '10'
$env:GRIT_STRUCTURED_NOTE_REPLAY_MODE = 'sandbox'
$env:GRIT_STRUCTURED_NOTE_F1_CACHE_MAX_NOTES = '2000'
$env:GRIT_STRUCTURED_NOTE_F1_CACHE_POLICY = 'read_through_lru'
$env:GRIT_STRUCTURED_NOTE_F1_CACHE_WARN_MB = '256'
$env:GRIT_SEC_424B2_AUTO_REPAIR = 'off'
$env:GRIT_SEC_424B2_AUTO_REPAIR_MODE = 'dry_run'
$env:GRIT_SEC_424B2_AUTO_REPAIR_REASON_ALLOWLIST = 'PARSER_CHANGED,RULEPACK_CHANGED'
$env:GRIT_SEC_424B2_AUTO_REPAIR_MAX_FILINGS = '10'

$env:SEC_CONTACT_EMAIL = 'replace-with-contact-email@example.com'
$env:SEC_EDGAR_CONTACT_EMAIL = $env:SEC_CONTACT_EMAIL
$env:SEC_USER_AGENT = "TradeAdmin Grit_Strategy_Lab/1.0 ($($env:SEC_CONTACT_EMAIL))"

$env:LONGPORT_APP_KEY = 'replace-with-longport-app-key'
$env:LONGPORT_APP_SECRET = 'replace-with-longport-app-secret'
$env:LONGPORT_ACCESS_TOKEN = 'replace-with-longport-access-token'

# Optional aliases for code paths that still read the legacy names.
$env:LONGBRIDGE_APP_KEY = $env:LONGPORT_APP_KEY
$env:LONGBRIDGE_APP_SECRET = $env:LONGPORT_APP_SECRET
$env:LONGBRIDGE_ACCESS_TOKEN = $env:LONGPORT_ACCESS_TOKEN
