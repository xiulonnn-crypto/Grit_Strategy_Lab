# PIT L1 数据源限制复用备注

最后更新：2026-05-29

范围：本备注只记录本轮已经验证过的 PIT L1 日频价格修复数据源限制。L2 基本面、因子队列、全市场发现不在本备注范围内。

## 当前修复状态

- 最新已验证 PIT L1 调整价覆盖：`1219 / 1219`，`coverage_pct=100.0`。
- 最新剩余 PIT L1 价格缺口：`0` 个 symbol；`full_ready_repair_plan.queue_price_symbols=[]`。
- 最新缺口清单证据：`output/logs/grit-coder/l1-free-source-next-20260527/pit-data-after-batch22-recovered-20260529.json`、`output/logs/grit-coder/l1-free-source-next-20260527/baseline-after-batch22-cleanup-20260529.json`。
- 后续所有价格修复调用必须以 `/pit-data.full_ready_repair_plan.queue_price_symbols` 为准。
- `#/snapshots` 或 snapshot overview 可能使用更宽的分母，不能直接当作 L1 价格缺口调用清单。

## `#/snapshots` L1 行情卡片口径

- `#/snapshots` L1 行情卡片曾显示的 `股票 1314/1482`，以及后续 snapshot overview 当前读到的更宽口径数值，来自 `/data-snapshots/overview.dataset_snapshots[id=ds-price].metadata.covered_symbol_count / total_symbol_count`；前端 `getDatasetCoverage(price)` 当前直接读取这组 snapshot overview 元数据。
- `/pit-data` 的 L1 修复口径来自 `pit.coverage.covered_symbol_count / total_symbol_count`，实际补数清单来自 `full_ready_repair_plan.queue_price_symbols`；当前值见本文顶部“当前修复状态”。
- 两个接口共用同一批价格 bar 事实表证据（2026-05-26 口径排查时 `ds-price.row_count = pit.coverage.price_bar_rows = 6607159`），但目标集合不同：`/data-snapshots/overview` 是 snapshot 库存/全局覆盖读模型，`/pit-data` 是 PIT Full Ready 修复与准入口径。
- 进一步拆分：`/data-snapshots/overview` 会用当前 `dataset_symbol_coverage` 与 `universe_membership_snapshots`/策略额外标的重算进度；此前排查时为 `1479` 个历史 universe symbol 加 `SPY/QQQ/TLT` 共 `1482`，其中 `1314` 个在当时覆盖表中有记录，batch14 后 snapshot overview 当前读数为 `1367/1482`。`/pit-data` 的当前补数口径见本文顶部，不应从 snapshot overview 分子/分母反推。
- 2026-05-26 缺口集合不是简单包含关系：overview missing `168` 个，PIT price queue `70` 个；交集 `68` 个，overview-only missing `100` 个，PIT-only missing `2` 个（`LDW`、`SGPPRB`）。因此不要用二者的分子/分母互相推导补数队列。
- 后续免费源、Xfinlink、Quantiacs、GitHub 公开数据补 L1 时，只能使用 `/pit-data.full_ready_repair_plan.queue_price_symbols` 作为查询清单；当前 PIT 队列为空。不要按 `1314/1482`、`1379/1479` 等 snapshot 分母扩大发起价格查询。
- 产品/UI 已落地：`#/snapshots` L1 健康卡片的股票主指标优先显示 `PIT <covered>/<total> + ETF 3/3`，不再把 snapshot 库存读模型的 `1314/1482` 当作 PIT L1 补数进度；若 PIT 指标缺失，前端才回退到 `快照 <dataset coverage>`。
- 本次口径排查证据：`output/logs/grit-coder/snapshots-l1-card-coverage-reason-20260526/overview.json`、`output/logs/grit-coder/snapshots-l1-card-coverage-reason-20260526/pit.json`、`output/logs/grit-coder/snapshots-l1-card-coverage-reason-20260526/l1-metrics-final.json`、`output/logs/grit-coder/snapshots-l1-card-coverage-reason-20260526/runtime-preflight-final.json`、`output/logs/grit-coder/snapshots-l1-card-coverage-reason-20260526/snapshots-l1-card-chrome-ready.png`。

## 通用调用纪律

- 只查当前 PIT L1 价格缺口名单，不用免费或限额源做全市场扫描。
- 对 Xfinlink、Tiingo、Alpha Vantage 等限额源，调用前后都要记录剩余额度。
- 任何导入 market-data DB 前，必须先 dry-run、保存原始证据，并使用 `scripts/recovery/sqlite_backup_policy.py pit-price-preimage` 备份目标 symbol 的 `ds-price` preimage；不得为小批 L1/PIT 修复默认复制完整 market-data DB。
- 不得伪造缺失字段：没有 `open`、`volume`、`adj_close` 就按缺失字段入库并写 metadata，不要用 close 硬补成完整 OHLCV。
- 区分“价格覆盖”与“完整 OHLCV 覆盖”。公司 PDF 可以关闭 L1 price gate，但不等于已经具备完整行情质量。
- 外部价格和额度会变，本表是 2026-05-26 至 2026-05-28 的已验证状态；再次大规模调用前应重新核对 provider 说明。

## 已验证数据源限制表

| 数据源 | 已验证额度 / 访问限制 | 已验证历史范围 / 结果 | 能否补退市 L1 | 后续使用备注 |
| --- | --- | --- | --- | --- |
| Quantiacs NDX100 | 免费账号，使用 `QUANTIACS_API_KEY`，不消耗 Xfinlink 额度。 | 已导入 9 个 NDX 匹配 symbol：`ARBA` 1999-06-23 至 2012-09-28，`CEPH` 1996-01-02 至 2011-10-13，`FWLT` 2005-06-03 至 2014-12-03，`HGSI` 1996-01-02 至 2012-08-02，`LNCR` 1996-01-02 至 2012-08-13，`NOVL` 1996-01-02 至 2011-04-27，`PPDI` 2000-02-02 至 2011-12-05，`SEPR` 1996-01-02 至 2009-10-20，`WCRX` 2006-09-21 至 2013-09-30。 | 可以，但只限 Quantiacs 历史资产 ID 能命中缺口 symbol 的情况。 | 本轮导入 `30107` 行。历史 NDX/SPX asset list 已不再命中当前剩余缺口，除非 PIT queue 变化，否则不要重复打。证据：`quantiacs-ndx100-import-report-20260526.json`。 |
| Pfizer / Wyeth 官方历史价格 PDF | 公开公司 PDF，无 API 额度。 | `WYE`：1980-07-28 至 2009-10-15，`7374` 行。 | 可以，适合单 symbol 官方修复。 | 源文件为未复权拆股价格；本地导入用 Wyeth/Pfizer 拆股因子写入 split-adjusted `adj_close`。5 行 `#N/A N/A` volume 以 `0` 入库并写 metadata。证据：`pfizer-wyeth-price-import-report-20260526.json`。 |
| BNSF / BNI 官方历史价格 PDF | 公开公司 PDF，无 API 额度。 | `BNI`：1980-01-02 至 2010-02-12，`7600` 行。 | 可以，适合单 symbol 官方价格修复。 | PDF 只有 Date/High/Low/Close；`open` 与 `volume` 为 `NULL`，没有推断补齐。`adj_close` 使用 BNSF 官方拆股历史与 Burlington Resources spin-off basis allocation，未做股息复权。证据：`bnsf-bni-hlc-pdf-import-report-20260526.json`。 |
| GitHub `willhjw/big_movers` | 公开 GitHub repo，MIT license；不消耗 provider API key。raw 下载仍应低频并缓存。 | 已导入 `NYX` 2004-08-12 至 2013-11-12，`SOV` 2000-01-04 至 2009-01-29，`ABK` 2000-01-03 至 2010-11-08，`WFR` 2000-01-03 至 2013-05-24，`XMSR` 2000-01-03 至 2008-07-28。 | 可以，条件是文件路径或 symbol 列直接命中当前缺口，且 dry-run 通过。 | CSV 有 OHLCV，但没有 adjusted-close 列；导入时 `adj_close=close`，公司行为复权状态未知。可作为免费修复进度，但机构级使用前要做 corporate-action QA。证据：`github-willhjw-big-movers-5-symbol-import-report-20260526.json`。 |
| BioWorld Quarterly / Biotechnology Stock Report | 公开网页，无 key；文章抓取必须低频、小批并缓存 HTML。 | 本轮精确命中当前缺口 `IMNX`、`QTRN`：`IMNX` 成员期内 1996-03-29 至 2000-12-31 共 `17` 个季度 close 点，`QTRN` 成员期内 1996-03-29 至 1999-12-31 共 `13` 个季度 close 点；合计导入 `30` 行。 | 可以，但只适合作为 `close_only_quarterly_stock_report` 低频 fallback。 | 仅导入 `close/adj_close`，`open/high/low/volume=NULL`；metadata 必须标注 `not_daily_ohlcv=true` 与文章 ID/URL。文章中同一行必须精确出现当前缺口 ticker；`Cytyc/CYTC` 等未精确命中，不得用相近公司名替代。证据：`bioworld-quarterly-current-l1-dry-run-20260527.json`、`bioworld-quarterly-current-l1-import-report-20260527.json`、`pit-data-after-bioworld-import-direct-builder-20260527.json`。 |
| CBS / MarketWatch merger news | 公开新闻网页，无 key；只适合单点事件价，必须缓存 HTML。 | 本轮精确命中 `HBOC`：CBS/MarketWatch 1998-10-18 合并报道写明 HBO & Co. 在 1998-10-16 收于 `29 9/16`，导入 `1` 条 close-only 行。 | 可以，但只限公开报道明确给出 date/ticker/close 的单点修复。 | `open/high/low/volume=NULL`，quality=`single_press_reported_close`；不能批量推断，也不能把新闻单点当日频行情。证据：`cbs-marketwatch-hboc-current-l1-dry-run-20260527.json`、`cbs-marketwatch-hboc-current-l1-import-report-20260527.json`、`pit-data-after-cbs-provider-patch-direct-builder-20260527.json`。 |
| Public market news single close | 公开新闻网页，无 key；适合按当前价格缺口逐个搜索，不适合批量抓取或推导。 | 本轮精确命中并导入 `TCOMA`、`NSCP`、`EXDS`、`MFNX` 各 `1` 条 close-only 单点。 | 可以，但只限报道明确给出 ticker、日期语义与 close/收盘价。 | `open/high/low/volume=NULL`，quality=`public_news_single_reported_close`；`closed yesterday` 必须用文章发布日期回推交易日，`moved up to` 仅在 after-close 市场综述中使用。证据：`public-news-single-close-current-l1-dry-run-20260527.json`、`public-news-single-close-current-l1-import-report-20260527.json`、`public-news-single-close-current-l1-post-apply-db-check-20260527.json`、`pit-data-after-public-news-single-import-direct-builder-20260527.json`。 |
| SEC merger proxy / official filing | SEC 官方公开 filing，无 key；本地 shell 可能被 SEC 403，需保留浏览器/网页行号证据与失败记录。 | 本轮精确命中 `RATL`：Rational Software merger proxy 写明 2002-12-05 收于 `$8.17`，导入 `1` 条 close-only 行。 | 可以，是 primary-source 单点修复。 | `open/high/low/volume=NULL`，quality=`primary_filing_single_reported_close`；只允许 filing 明确给出 date/ticker/close 时使用，不用季度 high/low range 伪造 close。证据：`sec-ratl-merger-proxy-current-l1-dry-run-20260527.json`、`sec-ratl-merger-proxy-current-l1-import-report-20260527.json`、`pit-data-after-sec-ratl-import-direct-builder-20260527.json`。 |
| GitHub `Acelogic/WayBackMachineStockScraper` + Internet Archive Wayback/Yahoo | 公开 GitHub 工具，README 标注 MIT；无需 key。Wayback 慢，必须缓存到 `.tmp/`，建议 `--delay 3.0` 至 `5.0`。 | 累计已导入 `15` 个 symbol。2026-05-26 已导入 `GLBC`、`GMST`、`NTLI`、`APCC`、`PIXR`、`SEBL`、`IVGN`、`MERQ`；2026-05-27 追加 `EDS` 2004-05-12 至 2008-05-15，`NXTL` 2004-03-16 至 2005-04-01，`ANDW` 2004-08-26 至 2006-07-17，`KSE` 2005-01-10 至 2006-08-23，`MLNM` 2004-01-07 至 2004-12-31，`CKFR` 2004-05-18 至 2007-04-05，`AEOS` 2006-12-19 至 2007-01-12；本次追加 `1405` 行。 | 可以，但多为部分历史。 | 后续按单 symbol 或小批次跑更稳；若首个 symbol 未命中，脚本可能在写 `manifest.json` 时要求 output dir 预先存在。只导入与 PIT 成员期相交的行；单点成员且成员日为非交易日时，允许使用 `±14` 个自然日近邻交易窗口，并必须写 metadata。`EDS` 的 2009 年 ticker 复用行已剔除；`ABGX/ADRX/CMGI/ICOS/CYTC/NWA` 本轮虽有 Wayback 行，但落在当前 PIT 成员期之后，未导入。2026-05-27 后续 sweep：batch4 全部 0 命中；batch5 仅 `NWA` 有行但成员期外；batch6 0 命中；剩余未尝试用 CDX 预筛后无可解析价格表，`SYBS` 单跑也未解析到表，`LDW/MTEL` 单跑未命中。证据：`wayback-yahoo-eds-nxtl-import-report-20260527.json`、`wayback-yahoo-batch2-import-report-20260527.json`、`wayback-yahoo-batch3-import-report-20260527.json`、`wayback-yahoo-batch5-dry-run-20260527.json`、`wayback-cdx-prefilter-unattempted-20260527.json`、`wayback-cdx-prefilter-error-retry-20260527.json`、`wayback-current-queue-sweep-summary-20260527.json`。 |
| Hugging Face `Zihan1004/FNSPID` `Stock_price/full_history.zip` | 公开 Hugging Face dataset，文件约 `590 MB`，无需 key；适合先用 HTTP Range 只读 ZIP central directory。 | 2026-05-27 对当前 PIT L1 缺口队列做 ZIP 尾部 central-directory 精确文件名扫描，命中 `0 / 68`。 | 对当前队列不能。 | 不要直接下载 590 MB 全量包；除非 queue 变化或需要非精确 alias 扫描。证据：`huggingface-fnspid-stock-price-tree-20260527.json`、`fnspid-full-history-zip-tail-scan-20260527.json`。 |
| QuantQuote Free Historical Stock Data 2013 / Academic Torrents | Academic Torrents 页面公开 `quantquote_daily_sp500_83986.zip`，`36.62 MB`，无需 API key；旧 HTTP 直链已 404，torrent 可用；本地用 `aria2c` 下载成功。 | ZIP 内 `502` 个文件；2026-05-27 对当前 `63` 个 PIT L1 缺口做 exact 文件名扫描，命中 `0`。 | 当前 exact symbol 队列不能。 | 除非后续建立可信 alias 映射或 PIT queue 变化，否则不要重复下载/扫描；当前包更像 2013 当时 S&P500 文件集，对旧退市缺口帮助有限。证据：`quantquote-free-sp500-2013.torrent`、`academictorrents-quantquote-entry-20260527.json`、`quantquote-academic-torrents-zip-scan-20260527.json`。 |
| grep.app public GitHub code search | 公开 GitHub code search 代理，无 key，但触发 `429 Too Many Requests` 很快。 | 精确查 `table_nxtl.csv`、`table_andw.csv`、`table_imnx.csv`、`table_hboc.csv`、`quantquote_daily_sp500_83986` 均 0 命中，随后 429。 | 当前不能。 | 只能小批、低频、精确查询；不要作为批量 GitHub 扫描器。证据：`grepapp-*-20260527.json`。 |
| BigCharts / MarketWatch historical page | 公开网页但有访问防护；无稳定 API。 | 2026-05-27 针对 `IMNX` 历史页探测返回 HTTP 401/JS challenge 类阻断，未取得价格表。 | 当前不能。 | 不作为自动修复源，除非后续有可合法访问的静态端点或人工导出文件。证据：`bigcharts-imnx-historical-probe-20260527.json`。 |
| ADVFN public historical page/API | 公开网页，无 key；直接 API 会 403，必须先访问 historical page 获取 session cookie，再调用 `/common/api/histo/GetHistoricalData`。未见稳定公开额度说明，调用必须低频、仅限当前缺口名单。 | 已导入 `26` 个 symbol、`53645` 行：首批 `ASN/AW/BDK/BGEN/BMET/BSC/CBSS/DJ/GTW/SBL/SLR/TRB/TXU/WWY/XTO`，第二批 `AKLM/ASCL/ATYT/BEAS/CDWC/EK/FHCC/LEH/MCIP/NWAC/PHSY`。 | 可以补部分退市 L1。 | API 不返回 adjusted close，本地 `adj_close=close` 并写入 `source_quality=public_web_ohlcv_adjustment_unknown`。必须过滤高重复日期序列；`ANDW/CKFR/MLNM` 已改由 Wayback/Yahoo 修复，`ABGX/ADRX/CMGI/ICOS` 等 ADVFN 高重复候选仍不能直接导入。证据：`advfn-sp500-known-l1-gap-import-report-20260526.json`、`advfn-remaining-l1-gap-import-report-20260526.json`。 |
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

1. 先继续 Acelogic/Wayback 单 ticker，小批次、预建 output dir、`--delay 3.0` 至 `5.0`，只导入与 PIT 成员期相交的行。
2. 再找 issuer / merger survivor 官方历史价格页面或 PDF，尤其是已知并购退市 symbol。
3. 再找公开 GitHub CSV repo，只有路径、文件名或 symbol 列明确命中当前缺口且 license 可接受时才 dry-run。
4. QuantQuote Academic Torrents 已完成当前队列 exact 文件名扫描且 0 命中；只有出现可信 alias 映射或 PIT queue 变化时再用。
5. Xfinlink Free 只做缺口 symbol 的 identity/resolve 探测，不做旧价格历史补齐。
6. ADVFN 可继续作为 public web fallback，但必须先做重复日期/身份质量过滤；当前高重复候选优先用 Wayback 交叉验证。
7. Tiingo、FMP、Finnhub、Nasdaq WIKI、EODHD free、Yahoo chart、Stooq online、Stooq 本地 ZIP、已扫 Kaggle/本地大包、ADGSTUDIOS、direct ichart CDX、FNSPID exact-file scan、QuantQuote exact-file scan 对当前队列视为已耗尽，除非 key、文件、alias 规则或 queue 变化。

## 证据索引

主证据目录：

`output/logs/grit-coder/l1-stooq-free-coverage-100/`

本轮追加证据目录：

`output/logs/grit-coder/l1-free-source-continuation-20260526/`

本轮继续证据目录：

`output/logs/grit-coder/l1-free-source-next-20260527/`

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
- `wayback-yahoo-eds-nxtl-dry-run-20260527.json`
- `wayback-yahoo-eds-nxtl-import-report-20260527.json`
- `wayback-yahoo-batch2-dry-run-20260527.json`
- `wayback-yahoo-batch2-import-report-20260527.json`
- `wayback-yahoo-batch3-dry-run-20260527.json`
- `wayback-yahoo-batch3-import-report-20260527.json`
- `pit-data-after-wayback-batch3-import-20260527.json`
- `huggingface-fnspid-stock-price-tree-20260527.json`
- `fnspid-full-history-zip-tail-scan-20260527.json`
- `academictorrents-quantquote-entry-20260527.json`
- `quantquote-free-sp500-2013.torrent`
- `bigcharts-imnx-historical-probe-20260527.json`
- `wayback-yahoo-batch5-dry-run-20260527.json`
- `wayback-cdx-prefilter-unattempted-20260527.json`
- `wayback-cdx-prefilter-error-retry-20260527.json`
- `wayback-current-queue-sweep-summary-20260527.json`
- `quantquote-academic-torrents-zip-scan-20260527.json`
- `pit-data-after-quantquote-wayback-sweep-20260527.json`
- `advfn-cache-current-57-file-probe-20260527.json`
- `stooq-local-current-57-rescan-20260527.json`
- `nasdaq-wiki-cache-current-queue-file-probe-20260527.json`
- `nasdaq-wiki-cache-current-queue-data-probe-20260527.json`
- `public-github-teddykoker-spy-zip-current-55-scan-20260527.json`
- `public-github-csv-current-55-content-scan-20260527.json`
- `bioworld-quarterly-fetch-report-20260527.json`
- `bioworld-current-57-fulltext-match-probe-20260527.json`
- `bioworld-quarterly-current-l1-dry-run-20260527.json`
- `bioworld-quarterly-current-l1-import-report-20260527.json`
- `pit-data-after-bioworld-import-direct-builder-20260527.json`
- `cbs-marketwatch-hboc-fetch-20260527.json`
- `cbs-marketwatch-hboc-current-l1-dry-run-20260527.json`
- `cbs-marketwatch-hboc-current-l1-import-report-20260527.json`
- `pit-data-after-cbs-provider-patch-direct-builder-20260527.json`
- `sec-ratl-merger-proxy-fetch-20260527.json`
- `sec-ratl-merger-proxy-current-l1-dry-run-20260527.json`
- `sec-ratl-merger-proxy-current-l1-import-report-20260527.json`
- `pit-data-after-sec-ratl-import-direct-builder-20260527.json`
- `public-news-single-close-current-l1-dry-run-20260527.json`
- `public-news-single-close-current-l1-import-report-20260527.json`
- `public-news-single-close-current-l1-post-apply-db-check-20260527.json`
- `pit-data-after-public-news-single-import-direct-builder-20260527.json`
- `current-l1-price-queue-symbols-after-public-news-single-20260527.txt`

## 2026-05-27 续更：当前 57 个 L1 价格缺口后的免费源状态

本轮继续只查询 `full_ready_repair_plan.queue_price_symbols`，未查询 `#/snapshots` 的 1482 展示口径，也未消耗 Xfinlink 额度。

### 新增已验证源 / 规则

| 数据源 | 已验证额度 / 访问限制 | 已验证历史范围 / 结果 | 能否补退市 L1 | 后续使用备注 |
| --- | --- | --- | --- | --- |
| CompaniesMarketCap public delisted pages | 公开网页，无 key；站内 `search.do` 与历史页都应低频、小批、缓存 HTML。未见正式批量 API。 | 对当前 60 个缺口做 ticker 搜索后，仅严格命中 `WCOM.defunct.2002` 与 `LCOS.defunct.2000`；导入 `WCOM` 1996-01-31 至 2002-06-25 共 `78` 个 close 点，`LCOS` 1996-07-31 至 2000-06-30 共 `48` 个 close 点。 | 可以，但只适合作为 `close_only_monthly_chart_sample` 低质量 fallback。 | 只导入 `close/adj_close`，`open/high/low/volume=NULL`，metadata 必须标注 `not_daily_ohlcv=true`。站内公司名搜索和直接 slug 探测对当前队列未再找到可用美国退市页；`RAT.L`、`USW.defunct.2000`、`MACR.defunct.2005` 等是误命中，不能导入到当前 US ticker。证据：`companiesmarketcap-current-queue-search-probe-20260527.json`、`companiesmarketcap-current-queue-strict-page-probe-20260527.json`、`companiesmarketcap-current-l1-import-report-20260527.json`、`companiesmarketcap-current-queue-company-name-search-20260527.json`、`companiesmarketcap-current-queue-direct-slug-probe-20260527.json`。 |
| ADVFN duplicate split branch repair | 继续使用已缓存 ADVFN 原始 CSV；无新增外部调用。 | `ADRX` 原先因高重复日期被跳过。本轮验证重复主要来自同成交量拆股尺度分支与小数精度重复；选择低价 split-adjusted 分支、合并 rounding duplicates，并省略 `23` 个不可判定冲突日期后，导入 1996-07-01 至 2003-01-01 成员期内 `1673` 行。 | 可以，但仅限能解释为拆股尺度分支且 dry-run 冲突比例可控的 symbol。 | 不能把所有 ADVFN 重复行直接导入。后续遇到高重复候选时，必须输出 `resolution_reasons`、`conflict_share`、`conflict_sample`，并保留省略冲突日期。证据：`advfn-split-branch-adrx-dry-run-final-20260527.json`、`advfn-split-branch-adrx-import-report-20260527.json`。 |
| Quantiacs SPX500 / NASDAQ100 / generic stocks | 免费账号，使用 `QUANTIACS_API_KEY`；本轮只拉资产列表，不下载价格历史。 | 对当前 60 个价格缺口做资产列表匹配：SPX500 `847` 个资产、NASDAQ100 `296` 个资产、generic `640` 个资产，当前缺口精确命中 `0`。 | 对当前剩余队列暂不能。 | NDX100 已导入过 9 个 symbol；本轮验证 SPX/generic 也无命中。除非 PIT 队列变化，不要重复打 Quantiacs 列表或历史下载。证据：`quantiacs-spx-generic-list-match-20260527.json`。 |
| CompaniesMarketCap direct slug / company-name search | 公开网页，无 key；本轮仅对当前缺口的已知旧公司名做小批搜索。 | `immunex`、`rational-software`、`quintiles`、`shared-medical-systems`、`tele-communications`、`andrx`、`cytyc`、`exodus-communications`、`northwest-airlines`、`netscape`、`sybase` 等直接 slug 返回 404 或非目标公司。 | 当前不能。 | `at-home` 命中的是 `HOME` 退市页且无 chart data，不是 `ATHMA`；不得用相似公司名或外盘/不同 ticker 顶替 PIT 缺口。 |

### 本轮导入后状态

- L1 覆盖从 `1164 / 1224` 提升到 `1167 / 1224`，覆盖率约 `95.34%`。
- `queue_price_symbols` 从 `60` 降至 `57`。
- 本轮新增导入 symbol：`WCOM`、`LCOS`、`ADRX`。
- 备份位置：
  - `artifacts/recovery/l1-companiesmarketcap-close-only-20260527-163226/`
  - `artifacts/recovery/l1-advfn-adrx-split-branch-20260527-164414/`
- 验证证据：
  - `pit-data-after-companiesmarketcap-import-direct-service-20260527.json`
  - `pit-data-after-advfn-adrx-split-branch-import-direct-service-20260527.json`
  - `current-l1-price-queue-symbols-after-adrx-20260527.txt`

### 下一轮补齐纪律追加

- `CompaniesMarketCap` 只能作为 close-only / monthly chart fallback；如后续找到更多页，必须校验 `identifier`、退市 banner、美国国家字段、成员期交集，并缓存原始 HTML。
- `ADVFN` 高重复候选不能一律丢弃，也不能一律导入；可用条件是重复分支能解释为拆股尺度或 rounding，冲突日期可省略且比例可控。
- `Quantiacs` 对当前队列视为列表命中耗尽；除非 `queue_price_symbols` 变化，不再重复探测 SPX/NDX/generic 列表。

## 2026-05-27 再续更：BioWorld 与公开 GitHub 缓存验证后状态

本段基于 `ADRX` 导入后的 `57` 个 PIT L1 价格缺口继续，只查询 `full_ready_repair_plan.queue_price_symbols`，未查询 `#/snapshots` 的 1482 展示口径，也未消耗 Xfinlink 额度。

### 本轮新增导入

| 数据源 | 结果 | 质量口径 | 证据 |
| --- | --- | --- | --- |
| BioWorld Quarterly / Biotechnology Stock Report | 精确命中并导入 `IMNX`、`QTRN`，合计 `30` 行；`IMNX` 1996-03-29 至 2000-12-31 共 `17` 个 close 点，`QTRN` 1996-03-29 至 1999-12-31 共 `13` 个 close 点。 | `close_only_quarterly_stock_report`；`open/high/low/volume=NULL`，不等同完整日频 OHLCV。 | `bioworld-quarterly-current-l1-dry-run-20260527.json`、`bioworld-quarterly-current-l1-import-report-20260527.json`、`pit-data-after-bioworld-import-direct-builder-20260527.json`。 |

### 本轮新增排除 / 限制

| 数据源 | 当前 55/57 缺口验证结果 | 后续备注 |
| --- | --- | --- |
| Nasdaq Data Link / QUOTEMEDIA 本地 cache | 当前 57 个文件名 cache 都存在，但 `payload.datatable.data=[]`，0 行可导入。 | 除非账号 entitlement 或 cache 内容变化，不再重复扫当前队列。 |
| 本地 DuckDB / Quandl / RaymondSunartio / Tsaustin 缓存 | 对当前 57 个缺口 exact 与 normalized symbol 匹配均为 0。 | 作为当前队列已耗尽源。 |
| Stooq 本地 `d_us_txt.zip` | 当前 57 个 exact 命中 0；starts-with 命中 `BS/SMS/FORT/NWA` 均为 ETF、外盘或非目标 ticker。 | 不可用相似前缀替代当前 US 退市 ticker。 |
| ADVFN 本地缓存 | `advfn_historical_l1_gap_20260526` 与 `advfn_historical_l1_gap_remaining_20260526` 对当前 57 个缺口无 exact 文件名命中。 | 只在后续新增 raw CSV 或可信 alias 时再 dry-run。 |
| StockQuote.io | 样本 `IMNX/HBOC/SYBS/VISX/WMTT` 查询 1996-2003 日频均为 0 行；`SYBS` 被误识别为 Sterling bond ETF。 | 当前不能补旧退市 L1；如再用，只能小批验证内部 ID 映射。 |
| GitHub `teddykoker/survivorship-free-spy` 本地 `data.zip` | ZIP `642` 个价格文件，对当前 55 个缺口 exact/contains 文件名命中 0。 | 当前队列不能。 |
| GitHub `hanlinxiao-stat-arb` / Packt `ml4t-2e` 本地 CSV | `s_and_p_500.csv` 命中 `GIDL/HBOC/RATL/SMS/TCOMA/USHC/LDW` 等只是成员清单，不含价格；Packt `wiki_stocks.csv` 的 `FORT` 是公司名 substring，非目标价格。 | 可作成员/身份参考，不能作为 L1 价格导入源。 |

### 当前状态

- L1 覆盖从 `1167 / 1224` 提升到 `1169 / 1224`，覆盖率约 `95.51%`。
- `queue_price_symbols` 从 `57` 降至 `55`。
- 本轮新增导入 symbol：`IMNX`、`QTRN`。
- 备份位置：`artifacts/recovery/l1-bioworld-quarterly-close-only-20260527-apply/`。
- 当前剩余缺口清单：`current-l1-price-queue-symbols-after-bioworld-20260527.txt`。

### HBOC 单点续更

- CBS / MarketWatch 公开合并新闻补入 `HBOC` 1998-10-16 close=`29.5625` 单点。
- L1 覆盖进一步提升到 `1170 / 1224`，覆盖率约 `95.59%`。
- `queue_price_symbols` 从 `55` 降至 `54`。
- 备份位置：`artifacts/recovery/l1-cbs-marketwatch-hboc-close-only-20260527-apply/`。
- 当前剩余缺口清单：`current-l1-price-queue-symbols-after-cbs-provider-patch-20260527.txt`。

### RATL 与公开新闻单点续更

- SEC 官方 merger proxy 补入 `RATL` 2002-12-05 close=`8.17` 单点；shell 抓取 SEC 原文被 403/拦截页阻断，保留了失败记录与网页证据，不使用季度 high/low 区间伪造 close。
- SF Gate / WIRED / TheStreet 公开市场新闻补入 `TCOMA` 1996-04-08 close=`18.4375`、`NSCP` 1998-11-24 close=`39.62`、`EXDS` 2001-06-26 close=`2.11`、`MFNX` 1999-10-07 close=`32.875`。
- L1 覆盖进一步提升到 `1175 / 1224`，覆盖率约 `96.00%`。
- `queue_price_symbols` 从 `54` 降至 `49`。
- 备份位置：
  - `artifacts/recovery/l1-sec-ratl-close-only-20260527-apply/`
  - `artifacts/recovery/l1-public-news-single-close-20260527-apply/`
- 当前剩余缺口清单：`current-l1-price-queue-symbols-after-public-news-single-20260527.txt`。

### 下一轮优先级追加

- 继续找官方 issuer / survivor 历史价格 PDF、SEC proxy/8-K、以及 after-close 公开市场新闻；优先剩余 `SMS`、`USHC`、`CYTC`、`NWA`、`VISX`、`WMTT` 这类有明确并购/退市路径的高可识别 symbol。
- BioWorld 仅适合生物科技股票且必须精确出现当前 ticker；对 `CYTC` 未命中，不要用 `CYPH`、`Cytoclonal` 等相似行替代。
- SEC/年报季度高低价可以作为待评估候选，但没有 `close` 时不要直接用于关闭 L1 close gate；若未来采用，必须新增单独 `high_low_only_official_filing` 质量口径并避免伪造 close。
- TheStreet、SF Gate、WIRED 等公开新闻只能导入报道明确给出 `symbol + date semantic + close` 的单点；`offer price`、`premium over close`、`trading at around`、`recent trading`、`high/low range` 都不能直接关闭 L1 price gate。

导入 manifest：

- `artifacts/recovery/l1-wayback-acelogic-import-20260526-161000/manifest.json`
- `artifacts/recovery/l1-wayback-pixr-import-20260526-161500/manifest.json`
- `artifacts/recovery/l1-wayback-sebl-import-20260526-162000/manifest.json`
- `artifacts/recovery/l1-wayback-ivgn-import-20260526-162500/manifest.json`

## 2026-05-28 备份机制瘦身规则

- L1/PIT 小批补数默认使用 `scripts/recovery/sqlite_backup_policy.py pit-price-preimage`，只保存目标 symbol 的 `ds-price` 快照元数据、价格行、coverage 行和 `backup-manifest.json`。
- 默认禁止每个小批次复制完整 `.grit_backtest_platform_market_data.sqlite3`。该库当前约 14GB，连续批次整库备份会直接打满磁盘。
- `full-pair` 只用于结构性迁移、批量未知影响或用户明确要求全量恢复点，并且必须满足 `--min-free-after-gb 25` 或更高空间门禁。
- 清理旧备份时必须保留当前活动根目录 DB、最新一组全量备份 pair、最新 targeted preimage、manifest、source notes 和 `output/logs/grit-coder/` 证据日志。
- `artifacts/recovery` 是恢复/审计区，不是系统运行热路径；运行路径仍以根目录主库和 companion market-data 库为准。

## 2026-05-29 备份清理前置检查

- 清理前必须确认 `GRIT_BACKTEST_DB` 没有指向 `artifacts/recovery`；如果活动 DB 或 companion market-data DB 落在 recovery 区，`scripts/codex-clean-stale-local-artifacts.ps1` 必须阻断并输出 `activeDbGuardStatus=blocked-active-db-under-recovery`。
- 清理报告必须记录活动主库路径、活动 market-data companion 路径、两者大小，以及本次 planned/removed/skipped 列表。需要 recovery 专项报告时使用 `-ReportPath output/logs/grit-coder/<task-slug>/recovery-cleanup-summary.json`。
- 当前活动 market-data baseline 可用 `scripts/recovery/sqlite_backup_policy.py baseline --json` 固化；重点字段是 `snapshot_row_count`、`missing_symbols_count`、`snapshot_updated_at`。
- 后续 L1 导入仍然只允许按 `/pit-data.full_ready_repair_plan.queue_price_symbols` 缺口名单做 targeted preimage，不因清理释放空间而恢复“小批整库复制”。

## 2026-05-29 备份清理执行验收

- 执行 recovery-only dry-run：`output/logs/grit-coder/backup-policy-slimming-20260529/recovery-cleanup-dry-run-20260529.json`。
- 执行 recovery-only apply：`output/logs/grit-coder/backup-policy-slimming-20260529/recovery-cleanup-summary.json`。
- 清理脚本确认 `activeDbGuardStatus=ok`，活动主库为根目录 `.grit_backtest_platform.sqlite3`，活动 market-data companion 为根目录 `.grit_backtest_platform_market_data.sqlite3`；两者均不在 `artifacts/recovery`。
- 本次 apply 结果为 `plannedCount=0`、`removedCount=0`、`removedGB=0`。含义是：当前没有符合新规则的旧 L1 全量 DB payload 可删；最新全量 pair `artifacts/recovery/l1-public-news-single-close-batch12-20260528-apply/`、最新 targeted preimage `artifacts/recovery/l1-public-news-filings-batch21-20260529-apply/` 与所有 manifest/evidence 被保护。
- 清理前后活动 market-data baseline 保持一致：`snapshot_row_count=6619322`、`missing_symbols_count=4`、`snapshot_updated_at=2026-05-29T06:41:56Z`。
- 清理后 runtime preflight：`output/logs/grit-coder/backup-policy-slimming-20260529/runtime-preflight-after-cleanup-20260529.json`，结果为 `quickstartOverall=ready`、`decision=reuse`。

## 2026-05-28 batch14 公开单点 close 续更

- 本批只使用当前 `/pit-data.full_ready_repair_plan.queue_price_symbols` 缺口名单，未调用 Xfinlink、Tiingo、Alpha Vantage 等限额源。
- 新增导入 `GNCI`、`USHC` 各 1 条 close-only PIT 价格行；`open/high/low/volume=NULL`，metadata 标记 `not_daily_ohlcv=true` 与 `membership_window_rule=min_max_membership_window`。
- `GNCI` 来源为 Asensio 1996-01-19 公开研究报告，报告标注 `GNCI` 与 `Price: $20.625`；导入日期 `1996-01-19`、close `20.625`。
- `USHC` 来源为 Bloomberg 1996-07-11 market movers 公开新闻，正文说明价格为收盘价，`US Healthcare Inc. (USHC)` 收于 `50 5/8`；导入日期 `1996-07-11`、close `50.625`。
- 覆盖结果：`/pit-data.coverage.covered_symbol_count` 从 `1205` 提升到 `1207`，`queue_price_symbols` 从 `19` 降到 `17`，活动 market DB `ds-price.row_count=6614572`。
- targeted preimage：`artifacts/recovery/l1-public-news-single-close-batch14-20260528-apply/backup-manifest.json`；本批 preimage 的目标 symbols 是 `GNCI`、`USHC`，没有复制完整 DB。
- 证据：`public-news-single-close-batch14-current-l1-dry-run-20260528.json`、`public-news-single-close-batch14-preimage-20260528.json`、`public-news-single-close-batch14-current-l1-import-report-20260528.json`、`public-news-single-close-batch14-post-apply-db-check-20260528.json`、`pit-data-after-public-news-single-batch14-api-20260528.json`、`runtime-preflight-after-batch14-final-ready-20260528.json`。

## 2026-05-28 batch15 公开单点 close 续更

- 本批继续只使用当前 L1 价格缺口名单，未调用 Xfinlink；导入前使用 `pit-price-preimage` 生成 targeted preimage，没有复制完整 DB。
- 新增导入 `IFMX`、`OSSI`、`NLI` 各 1 条 close-only PIT 价格行；`open/high/low/volume=NULL`，metadata 标记 `not_daily_ohlcv=true`。
- `IFMX` 来源为 SFGate 1997-09-26 公开新闻，报道 Informix stock closed yesterday at `$6.53`；导入日期 `1997-09-25`、close `6.53`，成员窗口依据项目本地 Nasdaq-100 historical seed 的 1997 anchor。
- `OSSI` 来源为 TheStreet 1997-03-21 after-close market report，报道 Outback Steakhouse `(OSSI)` 收于 `19 1/8`；导入日期 `1997-03-21`、close `19.125`，成员窗口依据项目本地 Nasdaq-100 historical seed 的 1997 anchor。
- `NLI` 来源为 Motley Fool 1999-01-25 market close report，报道 NTL Inc. `(Nasdaq: NTLI)` 收于 `$79 3/4`；活动 PIT universe 以 `NLI` 保存该 NTL 成分，metadata 保留 `reported_symbol=NTLI` 与映射说明。
- 覆盖结果：`/pit-data.coverage.covered_symbol_count` 从 `1207` 提升到 `1210`，`queue_price_symbols` 从 `17` 降到 `14`，活动 market DB `ds-price.row_count=6614575`。
- targeted preimage：`artifacts/recovery/l1-public-news-single-close-batch15-20260528-apply/backup-manifest.json`；本批 preimage 的目标 symbols 是 `IFMX`、`OSSI`、`NLI`。
- 剩余价格缺口：`AGREA`、`DZB`、`FDLNB`、`GMSTE`、`INFOQUOTE`、`LDW`、`MTEL`、`MUEI`、`NLTI`、`RPOW`、`SGPPRB`、`SYBS`、`VCELA`、`WMTT`。其中 `INFOQUOTE` 已确认是历史 Nasdaq activity 页面工具链接解析伪码；解析器已修复为不再新增该伪码，但现有 DB 元数据清理需另走 targeted metadata preimage。
- 证据：`public-news-single-close-batch15-current-l1-dry-run-20260528.json`、`public-news-single-close-batch15-import-report-20260528.json`、`public-news-single-close-batch15-post-apply-db-check-20260528.json`、`pit-data-after-public-news-single-batch15-api-20260528.json`、`data-snapshots-overview-after-batch15-20260528.json`、`pit-data-during-quickstart-batch15-api-20260528.json`、`data-snapshots-overview-during-quickstart-batch15-20260528.json`、`current-l1-price-queue-symbols-after-public-news-batch15-20260528.txt`、`runtime-preflight-during-quickstart-batch15-20260528.json`。

## 2026-05-29 batch18 RCR Wireless 公开单点 close 续更

- 本批继续只使用当前 L1 价格缺口名单，未调用 Xfinlink；导入前使用 `pit-price-preimage` 生成 `MTEL` targeted preimage，没有复制完整 DB。
- 新增导入 `MTEL` 1 条 close-only PIT 价格行：`1996-01-22` close=`14.12`，`open/high/low/volume=NULL`，metadata 标记 `not_daily_ohlcv=true`。
- 来源为 RCR Wireless News 1997-03-03 公开报道，文中说明 `Mtel` 股票在 1996-01-22 跌至 `$14.12`；成员窗口依据项目本地 Nasdaq-100 historical seed 的 1996 anchor。
- 覆盖结果：活动 market DB `ds-price.row_count` 从 `6615096` 提升到 `6615097`，`missing_symbols_count` 从 `12` 降到 `11`；`dataset_snapshots.ds-price.metadata.covered_symbol_count=1213`，`total_symbol_count=1224`。
- targeted preimage：`artifacts/recovery/l1-rcrwireless-mtel-close-batch18-20260529-apply/backup-manifest.json`；本批 preimage 的目标 symbol 是 `MTEL`。
- 剩余价格缺口：`AGREA`、`DZB`、`FDLNB`、`GMSTE`、`INFOQUOTE`、`LDW`、`NLTI`、`RPOW`、`SGPPRB`、`VCELA`、`WMTT`。
- 证据：`mtel-rcrwireless-fetch-20260529.json`、`rcrwireless-mtel-batch18-preimage-20260529.json`、`rcrwireless-mtel-batch18-dry-run-20260529.json`、`rcrwireless-mtel-batch18-import-report-20260529.json`、`mtel-db-row-after-batch18-20260529.json`、`pit-data-after-rcrwireless-mtel-batch18-20260529.json`、`current-l1-price-queue-after-rcrwireless-mtel-batch18-20260529.json`。

## 2026-05-29 batch19 无效 L1 缺口元数据清理

- 本批只处理当前 PIT L1 queue 中已经证明不应继续查询价格源的无效 symbol，未调用 Xfinlink，也未复制完整 DB。
- 从 L1 价格目标集合移除 `INFOQUOTE`、`LDW`、`SGPPRB`：`INFOQUOTE` 是历史 Nasdaq activity 页面工具链接解析残留，已有回归测试确保解析器跳过该工具链接；`LDW`、`SGPPRB` 没有 membership、price、coverage、corporate-action 事实，只剩空白 identity cache 行。
- 清理动作只删除 `INFOQUOTE` 的 2 行错误 membership row、3 个无效 identity cache row，并同步 `ds-price.metadata_json.missing_symbols`、`existing_missing_symbol_count`、`total_symbol_count` 等读模型字段；未改动任何已有价格 bar。
- 覆盖结果：`/pit-data.coverage.covered_symbol_count=1213` 保持不变，`total_symbol_count` 从 `1224` 降为 `1221`，`queue_price_symbols` 从 `11` 降为 `8`。
- targeted metadata preimage：`artifacts/recovery/l1-invalid-gap-metadata-cleanup-batch19-20260529-apply/backup-manifest.json`；preimage 文件为 `metadata-preimage.json`。
- 剩余价格缺口：`AGREA`、`DZB`、`FDLNB`、`GMSTE`、`NLTI`、`RPOW`、`VCELA`、`WMTT`。
- 证据：`current-11-symbol-fact-table-20260529.json`、`invalid-l1-gap-candidate-rows-20260529.json`、`invalid-gap-metadata-cleanup-batch19-dry-run-20260529.json`、`invalid-gap-metadata-cleanup-batch19-apply-20260529.json`、`pit-data-api-after-invalid-gap-cleanup-batch19-20260529.json`、`baseline-after-invalid-gap-cleanup-batch19-20260529.json`、`invalid-gap-cleanup-db-check-batch19-20260529.json`。

## 2026-05-29 batch20 CompaniesMarketCap / RPM RPOW close-only 月度图表补点

- 本批继续只使用当前 PIT L1 价格缺口名单，未调用 Xfinlink；导入前使用 `pit-price-preimage` 生成 `RPOW` targeted preimage，没有复制完整 DB。
- 新增导入 `RPOW` 1 条 close-only PIT 价格行：`1996-01-31` close=`4.751464366912842`，`open/high/low/volume=NULL`，metadata 标记 `not_daily_ohlcv=true`。
- 来源为 CompaniesMarketCap `RPM International` stock price history 页面内嵌月度图表数据；RPM 官方历史页面确认公司在 Nasdaq 的历史交易符号为 `RPOW`，本地 Nasdaq-100 historical seed 在 1996 与 1997 anchor 中包含 `RPOW`。
- 覆盖结果：活动 market DB `ds-price.row_count` 从 `6615097` 提升到 `6615098`，`missing_symbols_count` 从 `8` 降到 `7`；`/pit-data.coverage.covered_symbol_count=1214`，`total_symbol_count=1221`。
- targeted preimage：`artifacts/recovery/l1-companiesmarketcap-rpow-close-batch20-20260529-apply/backup-manifest.json`；本批 preimage 的目标 symbol 是 `RPOW`。
- 剩余价格缺口：`AGREA`、`DZB`、`FDLNB`、`GMSTE`、`NLTI`、`VCELA`、`WMTT`。
- 证据：`companiesmarketcap-rpm-page-fetch-20260529.html`、`companiesmarketcap-rpow-rpm-extraction-20260529.json`、`companiesmarketcap-rpow-batch20-dry-run-20260529.json`、`companiesmarketcap-rpow-batch20-preimage-20260529.json`、`companiesmarketcap-rpow-batch20-import-report-20260529.json`、`rpow-db-row-after-batch20-20260529.json`、`baseline-after-companiesmarketcap-rpow-batch20-20260529.json`、`pit-data-after-companiesmarketcap-rpow-batch20-20260529.json`、`data-snapshots-overview-after-rpow-batch20-20260529.json`。

## 2026-05-29 batch21 Public news / SEC filings close-only 补点

- 本批继续只使用当前 PIT L1 价格缺口名单，未调用 Xfinlink；导入前使用 `pit-price-preimage` 生成 `FDLNB`、`GMSTE`、`WMTT` targeted preimage，没有复制完整 DB。
- `FDLNB`：Washington Post 公开新闻给出 Food Lion Class B after-announcement close=`8.8125`，并说明 Delhaize America `DZA/DZB` 上市后 Food Lion shares 会从 Nasdaq 退市；本地 seed 提供 1996 membership anchor。
- `GMSTE`：TheStreet 公开报道给出 `GMSTE` 2002-08-26 close=`4.48`；Mondo Visione / Nasdaq-100 替换公告确认 Patterson Dental 于 2002-12-16 替换 Gemstar-TV Guide International (`GMSTE`)。
- `WMTT`：Willamette Industries 1996 SEC 年报列示 1996 year-end stock price=`69.625`，本地 seed 提供 1996 membership anchor。
- 覆盖结果：活动 market DB `ds-price.row_count` 从 `6615098` 提升到 `6615101`；`missing_symbols_count` 从 `7` 降到 `4`；`/pit-data.coverage.covered_symbol_count=1217`，`total_symbol_count=1221`，`coverage_pct=99.67`。
- targeted preimage：`artifacts/recovery/l1-public-news-filings-batch21-20260529-apply/backup-manifest.json`；本批 preimage 的目标 symbols 是 `FDLNB`、`GMSTE`、`WMTT`。
- 剩余价格缺口：`AGREA`、`DZB`、`NLTI`、`VCELA`。
- 证据：`public-news-single-close-batch21-dry-run-20260529.json`、`public-news-filings-batch21-preimage-20260529.json`、`public-news-filings-batch21-import-report-20260529.json`、`baseline-after-public-news-filings-batch21-20260529.json`、`pit-data-after-public-news-filings-batch21-20260529.json`、`db-rows-after-public-news-filings-batch21-20260529.json`、`data-snapshots-overview-after-public-news-filings-batch21-20260529.json`。

## 2026-05-29 batch22 SEC filings + metadata cleanup 收尾

- 本批继续只使用当前 PIT L1 价格缺口名单，未调用 Xfinlink；导入前使用 `scripts/recovery/sqlite_backup_policy.py pit-price-preimage --symbol AGREA --symbol VCELA` 生成 targeted preimage，没有复制完整 DB。
- `AGREA`：American Greetings 1996 Form 10-K 选定财务数据列示 fiscal year-end market price per share=`27.38`，Item 5 确认 Class A common shares 在 Nasdaq 以 `AGREA` 交易；导入 `1996-02-29` close=`27.38`。
- `VCELA`：Vanguard Cellular 1995 Form 10-K 披露 1996-03-15 非董事/高管持股 aggregate market value=`$693,065,000`，且该值基于 Nasdaq closing sale price；1996 DEF 14A 披露 outstanding shares=`41,313,443` 与 all directors/officers group=`6,875,409`，推导 close=`20.125`；导入 `1996-03-15` close=`20.125`。
- 导入后剩余 `DZB`、`NLTI` 两个 metadata gap：`DZB` 是 FMP 把 1999-09 以后 Delhaize America 的 `DZA/DZB` 回填到 1996-1999H1 anchor；已有 `FDLNB` 补点覆盖 Food Lion 1996 anchor。`NLTI` 是 Wikipedia current changes table 拼写残留，DB 已有覆盖链路 `NLI`/`NTLI`/`VMED`。
- metadata cleanup 只删除 `DZB`、`NLTI` 的 membership/identity 行并同步 `ds-price.metadata_json`；未删除任何已有 price bar 或 coverage row。cleanup preimage：`artifacts/recovery/l1-invalid-gap-metadata-cleanup-batch22-20260529-apply/metadata-preimage.json`。
- 覆盖结果：活动 market DB `ds-price.row_count=6619324`；`dataset_snapshots.ds-price.status=READY`；`/pit-data.coverage.covered_symbol_count=1219`、`total_symbol_count=1219`、`coverage_pct=100.0`、`queue_price_symbols=[]`。
- 注意：`/data-snapshots/overview.dataset_snapshots[id=ds-price]` 仍是更宽的 snapshot/global 价格库存口径，当前可显示 `1379/1479` 且 `missing_symbols=100`；该数字不是 PIT L1 修复队列，不能用于后续价格源调用。
- 证据：`public-news-filings-batch22-dry-run-20260529.json`、`sec-filings-batch22-preimage-20260529.json`、`sec-filings-batch22-import-report-20260529.json`、`db-rows-after-sec-filings-batch22-20260529.json`、`invalid-gap-metadata-cleanup-batch22-dry-run-20260529.json`、`invalid-gap-metadata-cleanup-batch22-apply-20260529.json`、`db-check-after-batch22-cleanup-20260529.json`、`baseline-after-batch22-cleanup-20260529.json`、`pit-data-after-batch22-recovered-20260529.json`、`runtime-preflight-after-batch22-recovered-20260529.json`。
