# PIT L1 数据源限制复用备注

最后更新：2026-05-26

范围：本备注只记录本轮已经验证过的 PIT L1 日频价格修复数据源限制。L2 基本面、因子队列、全市场发现不在本备注范围内。

## 当前修复状态

- 最新已验证 L1 调整价覆盖：`1154 / 1224`。
- 最新剩余 PIT L1 价格缺口：`70` 个 symbol。
- 最新缺口清单证据：`output/logs/grit-coder/l1-free-source-continuation-20260526/pit-data-after-wayback-merq-import.json`。
- 后续所有价格修复调用必须以 `/pit-data.full_ready_repair_plan.queue_price_symbols` 为准。
- `#/snapshots` 或 snapshot overview 可能使用更宽的分母，不能直接当作 L1 价格缺口调用清单。

## `#/snapshots` L1 行情卡片口径

- `#/snapshots` L1 行情卡片里的 `股票 1314/1482` 来自 `/data-snapshots/overview.dataset_snapshots[id=ds-price].metadata.covered_symbol_count / total_symbol_count`；前端 `getDatasetCoverage(price)` 当前直接读取这组 snapshot overview 元数据。
- `/pit-data` 的 L1 修复口径仍是 `1154/1224`，来自 `pit.coverage.covered_symbol_count / total_symbol_count`，实际补数清单来自 `full_ready_repair_plan.queue_price_symbols`。
- 两个接口共用同一批价格 bar 事实表证据（本次排查时 `ds-price.row_count = pit.coverage.price_bar_rows = 6607159`），但目标集合不同：`/data-snapshots/overview` 是 snapshot 库存/全局覆盖读模型，`/pit-data` 是 PIT Full Ready 修复与准入口径。
- 进一步拆分：`/data-snapshots/overview` 会用当前 `dataset_symbol_coverage` 与 `universe_membership_snapshots`/策略额外标的重算进度；本次为 `1479` 个历史 universe symbol 加 `SPY/QQQ/TLT` 共 `1482`，其中 `1314` 个在当前覆盖表中有记录。`/pit-data` 当前仍读持久化 `dataset_snapshots.metadata_json` 里的 `covered_symbol_count=1154`、`total_symbol_count=1224`、`missing_symbols=70`。
- 当前缺口集合不是简单包含关系：overview missing `168` 个，PIT price queue `70` 个；交集 `68` 个，overview-only missing `100` 个，PIT-only missing `2` 个（`LDW`、`SGPPRB`）。因此不要用二者的分子/分母互相推导补数队列。
- 后续免费源、Xfinlink、Quantiacs、GitHub 公开数据补 L1 时，只能使用 `/pit-data.full_ready_repair_plan.queue_price_symbols` 作为查询清单；本次为 `70` 个 symbol。不要按 `1314/1482` 的 snapshot 分母扩大发起价格查询。
- 产品/UI 已落地：`#/snapshots` L1 健康卡片的股票主指标优先显示 `PIT 1154/1224 + ETF 3/3`，不再把 snapshot 库存读模型的 `1314/1482` 当作 PIT L1 补数进度；若 PIT 指标缺失，前端才回退到 `快照 <dataset coverage>`。
- 本次口径排查证据：`output/logs/grit-coder/snapshots-l1-card-coverage-reason-20260526/overview.json`、`output/logs/grit-coder/snapshots-l1-card-coverage-reason-20260526/pit.json`、`output/logs/grit-coder/snapshots-l1-card-coverage-reason-20260526/l1-metrics-final.json`、`output/logs/grit-coder/snapshots-l1-card-coverage-reason-20260526/runtime-preflight-final.json`、`output/logs/grit-coder/snapshots-l1-card-coverage-reason-20260526/snapshots-l1-card-chrome-ready.png`。

## 通用调用纪律

- 只查当前 PIT L1 价格缺口名单，不用免费或限额源做全市场扫描。
- 对 Xfinlink、Tiingo、Alpha Vantage 等限额源，调用前后都要记录剩余额度。
- 任何导入 market-data DB 前，必须先 dry-run、保存原始证据，并备份 `.grit_backtest_platform.sqlite3` 与 `.grit_backtest_platform_market_data.sqlite3`。
- 不得伪造缺失字段：没有 `open`、`volume`、`adj_close` 就按缺失字段入库并写 metadata，不要用 close 硬补成完整 OHLCV。
- 区分“价格覆盖”与“完整 OHLCV 覆盖”。公司 PDF 可以关闭 L1 price gate，但不等于已经具备完整行情质量。
- 外部价格和额度会变，本表是 2026-05-26 的已验证状态；再次大规模调用前应重新核对 provider 说明。

## 已验证数据源限制表

| 数据源 | 已验证额度 / 访问限制 | 已验证历史范围 / 结果 | 能否补退市 L1 | 后续使用备注 |
| --- | --- | --- | --- | --- |
| Quantiacs NDX100 | 免费账号，使用 `QUANTIACS_API_KEY`，不消耗 Xfinlink 额度。 | 已导入 9 个 NDX 匹配 symbol：`ARBA` 1999-06-23 至 2012-09-28，`CEPH` 1996-01-02 至 2011-10-13，`FWLT` 2005-06-03 至 2014-12-03，`HGSI` 1996-01-02 至 2012-08-02，`LNCR` 1996-01-02 至 2012-08-13，`NOVL` 1996-01-02 至 2011-04-27，`PPDI` 2000-02-02 至 2011-12-05，`SEPR` 1996-01-02 至 2009-10-20，`WCRX` 2006-09-21 至 2013-09-30。 | 可以，但只限 Quantiacs 历史资产 ID 能命中缺口 symbol 的情况。 | 本轮导入 `30107` 行。历史 NDX/SPX asset list 已不再命中当前剩余缺口，除非 PIT queue 变化，否则不要重复打。证据：`quantiacs-ndx100-import-report-20260526.json`。 |
| Pfizer / Wyeth 官方历史价格 PDF | 公开公司 PDF，无 API 额度。 | `WYE`：1980-07-28 至 2009-10-15，`7374` 行。 | 可以，适合单 symbol 官方修复。 | 源文件为未复权拆股价格；本地导入用 Wyeth/Pfizer 拆股因子写入 split-adjusted `adj_close`。5 行 `#N/A N/A` volume 以 `0` 入库并写 metadata。证据：`pfizer-wyeth-price-import-report-20260526.json`。 |
| BNSF / BNI 官方历史价格 PDF | 公开公司 PDF，无 API 额度。 | `BNI`：1980-01-02 至 2010-02-12，`7600` 行。 | 可以，适合单 symbol 官方价格修复。 | PDF 只有 Date/High/Low/Close；`open` 与 `volume` 为 `NULL`，没有推断补齐。`adj_close` 使用 BNSF 官方拆股历史与 Burlington Resources spin-off basis allocation，未做股息复权。证据：`bnsf-bni-hlc-pdf-import-report-20260526.json`。 |
| GitHub `willhjw/big_movers` | 公开 GitHub repo，MIT license；不消耗 provider API key。raw 下载仍应低频并缓存。 | 已导入 `NYX` 2004-08-12 至 2013-11-12，`SOV` 2000-01-04 至 2009-01-29，`ABK` 2000-01-03 至 2010-11-08，`WFR` 2000-01-03 至 2013-05-24，`XMSR` 2000-01-03 至 2008-07-28。 | 可以，条件是文件路径或 symbol 列直接命中当前缺口，且 dry-run 通过。 | CSV 有 OHLCV，但没有 adjusted-close 列；导入时 `adj_close=close`，公司行为复权状态未知。可作为免费修复进度，但机构级使用前要做 corporate-action QA。证据：`github-willhjw-big-movers-5-symbol-import-report-20260526.json`。 |
| GitHub `Acelogic/WayBackMachineStockScraper` + Internet Archive Wayback/Yahoo | 公开 GitHub 工具，README 标注 MIT；无需 key。Wayback 慢，必须缓存到 `.tmp/`。 | 已导入 `GLBC` 2004-10-26 至 2007-05-25，`GMST` 2004-01-29 至 2007-04-03，`NTLI` 2004-05-13 至 2006-06-23，`APCC` 2004-08-24 至 2005-01-14，`PIXR` 2003-07-22 至 2005-11-21，`SEBL` 2004-03-17 至 2005-08-29，`IVGN` 2003-11-10 至 2007-01-12，`MERQ` 2004-01-07 至 2005-04-05。 | 可以，但多为部分历史。 | 后续按单 symbol 跑更稳。12-symbol 批量 run 超过 15 分钟后停止；`PIXR`、`SEBL`、`IVGN` 单 symbol 后续成功。`WCOM`、`CEFT`、`SDLI`、`VSTR` 未取到可用数据。证据：`github-acelogic-wayback-*-20260526.json`、`wayback-acelogic-merq-import-report-20260526.json`。 |
| ADVFN public historical page/API | 公开网页，无 key；直接 API 会 403，必须先访问 historical page 获取 session cookie，再调用 `/common/api/histo/GetHistoricalData`。未见稳定公开额度说明，调用必须低频、仅限当前缺口名单。 | 已导入 `26` 个 symbol、`53645` 行：首批 `ASN/AW/BDK/BGEN/BMET/BSC/CBSS/DJ/GTW/SBL/SLR/TRB/TXU/WWY/XTO`，第二批 `AKLM/ASCL/ATYT/BEAS/CDWC/EK/FHCC/LEH/MCIP/NWAC/PHSY`。 | 可以补部分退市 L1。 | API 不返回 adjusted close，本地 `adj_close=close` 并写入 `source_quality=public_web_ohlcv_adjustment_unknown`。必须过滤高重复日期序列；`ANDW/ABGX/ADRX/CKFR/CMGI/ICOS/MLNM` 因 duplicate ratio 约 0.35-0.44 暂不导入。证据：`advfn-sp500-known-l1-gap-import-report-20260526.json`、`advfn-remaining-l1-gap-import-report-20260526.json`。 |
| Xfinlink Free | 官方免费层：`100` 次/日，`40` 次/小时，`1` ticker/call，价格历史仅 `1` 年。认证 header 为 `X-API-Key`。 | 本轮只消耗 2 次 price call：`LEH` HTTP 200 但 0 行；`WYE` HTTP 200，entity 388，0 行。探测后剩余额度：`98/day`、`38/hour`。 | 不能补旧退市 L1。 | 只用于当前缺口 symbol 的 identity/resolve 小探测。resolve/search 在后续导入前覆盖过 `96 / 111` 个剩余 symbol，但 free price history 无法修复旧缺口。1996+ 日频历史需要 Pro。证据：`xfinlink-price-gap-probe-one-call-20260526.json`、`xfinlink-price-gap-probe-wye-second-call-20260526.json`。 |
| Xfinlink Pro | 付费层；本轮未消耗。 | 文档口径为 1996+ 日频价格。 | 可能可以，但需要升级。 | 只能作为付费 fallback，不能把 free key 当 Pro 用。 |
| Tiingo 免费账号 | 免费账号 token 已存在，quota-limited。 | 对 1990-01-01 至 2026-05-26 的剩余旧退市样本未返回可用 daily bars。 | 当前缺口不能。 | 保留额度，不要继续批量打旧退市价格。证据：`free-account-provider-sample-dry-run-20260526.json`。 |
| FMP 当前权限 | 当前 key/account 返回 HTTP 402 Payment Required。 | 未验证到可用旧退市历史范围。 | 当前权限不能。 | 除非 entitlement 变化，否则不再用于此队列。证据：`free-account-provider-sample-dry-run-20260526.json`。 |
| Finnhub 免费账号 | 免费账号返回 entitlement error / HTTP 403。 | 未验证到可用旧退市历史范围。 | 当前免费账号不能。 | 不用于当前旧价格修复。证据：`free-account-provider-sample-dry-run-20260526.json`。 |
| Nasdaq Data Link WIKI | 当前免费账号返回 entitlement error；本地镜像也已扫描。 | 本地 WIKI mirror 与 GitHub `kmfranz/WIKI_PRICES` 均 0 命中当前缺口。 | 当前队列不能。 | 对当前 L1 缺口已耗尽。证据：`github-kmfranz-wiki-prices-l1-remaining-dry-run-20260526.json`。 |
| Alpha Vantage 免费账号 | 样本触发免费层 pacing/rate limit。 | 未验证到可用旧退市历史范围。 | 未证明；价格修复按不能处理。 | 只保留为极小规模 listing/action 探测候选，不做批量价格修复。证据：`free-account-provider-sample-dry-run-20260526.json`。 |
| EODHD 当前账号 | 当前订阅返回 `subscription_history_limit`。 | 免费订阅在样本中仅限近期历史。 | 当前订阅不能。 | 旧 L1 缺口需要升级 entitlement。证据：`paid-optional-provider-sample-dry-run-20260526.json`。 |
| Polygon / Massive 当前 key | 当前 key 返回 invalid credentials。 | 认证失败，未验证历史范围。 | 未知，需换 key 后再验证。 | key 修复前不要继续调用。证据：`paid-optional-provider-sample-dry-run-20260526.json`。 |
| Yahoo chart public endpoint | 公共 endpoint，无 key。 | 旧退市样本返回 0 行。 | 当前队列不能。 | 对剩余旧退市 L1 无修复价值。证据：`yahoo-chart-l1-remaining-sample-20260526.json`。 |
| Stooq online CSV | 公共 endpoint 在样本请求中变为 key-gated。 | 样本返回 “Get your apikey” 提示，不是价格数据。 | 无可用 key 时不能。 | 不要把 6 行 key prompt 当成 CSV 价格入库。证据：`stooq-single-endpoint-l1-remaining-sample-20260526.json`。 |
| Stooq 本地 ZIP `d_us_txt.zip` | 本地文件 `C:\Users\TradeAdmin\Downloads\d_us_txt.zip`，无 API 额度。 | Quantiacs 前 exact/common alias match 为 `0 / 120`。 | 当前队列不能。 | 二级 substring candidate 没有通过身份验证，不能导入。证据：`stooq-zip-secondary-candidate-scan-20260526.json`。 |
| Kaggle / 本地免费大包 | 公开 Kaggle datasets 或已缓存 ZIP/CSV，无 API 额度；下载新 Kaggle dataset 通常仍需要 Kaggle API 凭证。 | Arandkei delisted archive、Tsaustin、JacksonCrow、Liewyousheng、Raymondsunartio、`secfilingapi/sec-form-4-filings` 对当前缺口均 0 可用命中。本地 `stockmarketdatafrom1996to2020.zip` 仅命中 `EDS` 404 占位文件，以及 `KSE/SMS/IMNX/MTEL/NXTL/RATL` 等外盘 suffix 或非 US 文件，不能入库。 | 当前队列不能。 | 只保留为未来 queue 变化后的搜索面；不能把外盘同名 ticker 当 US 退市 L1。证据：`local-free-archive-scan-after-advfn-remaining-20260526.json`、`local-free-archive-normalized-scan-after-advfn-remaining-20260526.json`。 |
| ADGSTUDIOS CSV endpoint | 公共 endpoint；页面宣称 `/csv/<ticker>` 与 `/json/<ticker>` 免费、无付费墙。 | 当前环境 AAPL 探测无浏览器头返回 403，加浏览器头返回 500；缺口队列 dry-run 未产出有效文件。 | 当前不能。 | 不作为修复源，除非服务可用性变化。证据：`adgstudios-yahoo-proxy-access-probe-20260526.json`。 |
| Wayback Yahoo ichart direct CDX | Internet Archive 公共 CDX API。 | `XTO`、`BNI`、`BSC`、`BDK` 等代表性缺失 symbol 返回 0 captures。 | 直接 ichart CDX 不能。 | Acelogic 的 HTML/Wayback 拼接能修复部分 symbol，但 direct ichart CDX 本身不够。证据：`wayback-yahoo-ichart-cdx-sample-20260526.json`。 |

## 下一轮 L1 免费源优先级

1. 先找 issuer / merger survivor 官方历史价格页面或 PDF，尤其是已知并购退市 symbol。
2. 再找公开 GitHub CSV repo，只有路径、文件名或 symbol 列明确命中当前缺口且 license 可接受时才 dry-run。
3. 对 Yahoo 旧时代退市 symbol，用 Acelogic/Wayback 单 ticker、带 timeout、带缓存跑。
4. Xfinlink Free 只做缺口 symbol 的 identity/resolve 探测，不做旧价格历史补齐。
5. ADVFN 可继续作为 public web fallback，但必须先做重复日期/身份质量过滤。
6. Tiingo、FMP、Finnhub、Nasdaq WIKI、EODHD free、Yahoo chart、Stooq online、Stooq 本地 ZIP、已扫 Kaggle/本地大包、ADGSTUDIOS、direct ichart CDX 对当前队列视为已耗尽，除非 key、文件或 queue 变化。

## 证据索引

主证据目录：

`output/logs/grit-coder/l1-stooq-free-coverage-100/`

本轮追加证据目录：

`output/logs/grit-coder/l1-free-source-continuation-20260526/`

核心报告：

- `data-source-limit-notes-20260526.md`
- `pit-data-current-l1-price-queue-20260526.json`
- `remaining-l1-price-queue-after-wayback-ivgn-20260526.txt`
- `quantiacs-ndx100-import-report-20260526.json`
- `pfizer-wyeth-price-import-report-20260526.json`
- `bnsf-bni-hlc-pdf-import-report-20260526.json`
- `github-willhjw-big-movers-5-symbol-import-report-20260526.json`
- `github-acelogic-wayback-4-symbol-import-report-20260526.json`
- `github-acelogic-wayback-pixr-import-report-20260526.json`
- `github-acelogic-wayback-sebl-import-report-20260526.json`
- `github-acelogic-wayback-ivgn-import-report-20260526.json`
- `advfn-sp500-known-l1-gap-import-report-20260526.json`
- `advfn-remaining-l1-gap-import-report-20260526.json`
- `wayback-acelogic-merq-import-report-20260526.json`
- `pit-data-after-wayback-merq-import.json`
- `local-free-archive-scan-after-advfn-remaining-20260526.json`
- `local-free-archive-normalized-scan-after-advfn-remaining-20260526.json`
- `adgstudios-yahoo-proxy-access-probe-20260526.json`
- `xfinlink-price-gap-probe-one-call-20260526.json`
- `xfinlink-price-gap-probe-wye-second-call-20260526.json`
- `free-account-provider-sample-dry-run-20260526.json`
- `paid-optional-provider-sample-dry-run-20260526.json`
- `stooq-single-endpoint-l1-remaining-sample-20260526.json`
- `stooq-zip-secondary-candidate-scan-20260526.json`
- `kaggle-search-expanded-l1-free-sources-20260526.json`
- `github-kmfranz-wiki-prices-l1-remaining-dry-run-20260526.json`
- `adgstudios-csv-l1-remaining-dry-run-20260526.json`
- `wayback-yahoo-ichart-cdx-sample-20260526.json`

导入 manifest：

- `artifacts/recovery/l1-wayback-acelogic-import-20260526-161000/manifest.json`
- `artifacts/recovery/l1-wayback-pixr-import-20260526-161500/manifest.json`
- `artifacts/recovery/l1-wayback-sebl-import-20260526-162000/manifest.json`
- `artifacts/recovery/l1-wayback-ivgn-import-20260526-162500/manifest.json`
