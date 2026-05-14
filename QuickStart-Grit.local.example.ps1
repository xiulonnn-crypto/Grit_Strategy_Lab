# Local provider environment for QuickStart-Grit.ps1
# Copy this file to QuickStart-Grit.local.ps1 and replace the placeholders.
# The real QuickStart-Grit.local.ps1 is gitignored and should stay local only.

$env:TIINGO_API_TOKEN = 'replace-with-tiingo-token'
$env:ALPHAVANTAGE_API_KEY = 'replace-with-alpha-vantage-key'
$env:FMP_API_KEY = 'replace-with-fmp-key'
$env:KAGGLE_API_TOKEN = 'replace-with-kaggle-api-token'
# Massive.com is the rebranded Polygon.io API. Set one of these two keys.
# $env:MASSIVE_API_KEY = 'replace-with-massive-api-key'
$env:NASDAQ_DATA_LINK_API_KEY = 'replace-with-nasdaq-data-link-api-key'
$env:FINNHUB_API_KEY = 'replace-with-finnhub-api-key'

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
