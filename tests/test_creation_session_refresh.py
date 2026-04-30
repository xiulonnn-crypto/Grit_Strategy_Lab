from __future__ import annotations

import json
import sqlite3
from datetime import date, timedelta

from fastapi.testclient import TestClient

from grit_backtest_platform.api import create_app
from grit_backtest_platform.creation_templates import blank_confirmation_fields
from grit_backtest_platform.market_data_repository import CoverageSummary
from tests.api_test_support import create_grid_strategy, create_test_client

EMBEDDED_GRID_MESSAGE = (
    '\u672c\u91d110000\uff0c\u521d\u59cb\u4e70\u5165QQQ20%\u4ed3\u4f4d\uff0c'
    '\u6bcf\u4e0b\u8dcc5%\u4e70\u516510%\uff0c\u6bcf\u4e0a\u6da810%\u5356\u51fa10%'
)


def _client(tmp_path):
    db_path = tmp_path / 'grit_backtest.sqlite3'
    return TestClient(create_app(db_path)), db_path


def _client_with_service(tmp_path):
    db_path = tmp_path / 'grit_backtest.sqlite3'
    app = create_app(db_path)
    return TestClient(app), app.state.service


def _risk_parity_price_bars(symbol: str, *, daily_move: float) -> list[dict[str, object]]:
    bars: list[dict[str, object]] = []
    cursor = date.today() - timedelta(days=420)
    price = 100.0
    trade_day = 0
    while len(bars) < 280:
        if cursor.weekday() < 5:
            move = daily_move if trade_day % 2 == 0 else -daily_move * 0.45
            open_price = price
            price = round(price * (1.0 + move), 4)
            bars.append(
                {
                    'symbol': symbol,
                    'date': cursor.isoformat(),
                    'open': open_price,
                    'high': max(open_price, price) * 1.002,
                    'low': min(open_price, price) * 0.998,
                    'close': price,
                    'adj_close': price,
                    'volume': 1_000_000 + trade_day,
                    'source': 'test_price_history',
                    'fallback_source': None,
                }
            )
            trade_day += 1
        cursor += timedelta(days=1)
    return bars


def test_get_creation_session_rehydrates_stale_grid_draft(tmp_path):
    client, db_path = _client(tmp_path)

    created = client.post('/strategy-creation-sessions')
    assert created.status_code == 200
    session_id = created.json()['id']

    message = client.post(
        f'/strategy-creation-sessions/{session_id}/messages',
        json={'content': EMBEDDED_GRID_MESSAGE},
    )
    assert message.status_code == 200
    appended_payload = message.json()
    latest_message = appended_payload['messages'][-1]
    assert latest_message['id']
    assert latest_message['extracted_tags']
    assert {item['key'] for item in latest_message['extracted_tags']} >= {
        'strategy_name',
        'universe_name',
        'strategy_description',
        'initial_position',
        'grid_interval',
        'buy_size_pct',
        'sell_step_pct',
        'sell_size_pct',
    }

    with sqlite3.connect(db_path) as conn:
        conn.execute(
            '''
            UPDATE strategy_creation_sessions
            SET status = 'NEEDS_INPUT',
                strategy_type = 'GENERAL',
                universe_name = '',
                pending_inputs_json = ?,
                confirmation_fields_json = ?
            WHERE id = ?
            ''',
            (
                json.dumps([
                    {'key': 'universe_name', 'label': 'universe', 'message': 'fill universe'},
                    {'key': 'initial_position', 'label': 'initial_position', 'message': 'fill initial_position'},
                ]),
                json.dumps(blank_confirmation_fields('GENERAL')),
                session_id,
            ),
        )
        conn.execute(
            '''
            UPDATE strategy_creation_messages
            SET extracted_fields_json = '[]'
            WHERE session_id = ?
            ''',
            (session_id,),
        )
        conn.commit()

    fetched = client.get(f'/strategy-creation-sessions/{session_id}')
    assert fetched.status_code == 200
    payload = fetched.json()

    pending_keys = {item['key'] for item in payload['pending_inputs']}
    parameter_values = {
        item['key']: item.get('value')
        for item in payload['confirmation_fields']['parameters']
    }

    assert payload['strategy_type'] == 'GRID'
    assert payload['status'] == 'NEEDS_INPUT'
    assert payload['universe_name'] == 'QQQ'
    assert pending_keys == {'max_stop_loss_pct'}
    assert payload['top_level']['rebalance_frequency'] == 'never'
    assert payload['messages'][-1]['extracted_tags']
    assert {item['key'] for item in payload['messages'][-1]['extracted_tags']} >= {
        'strategy_name',
        'strategy_description',
        'universe_name',
        'initial_position',
    }
    assert parameter_values['strategy_name'] == 'QQQ 网格交易策略'
    assert parameter_values['strategy_description'] == '本金10000，围绕QQQ执行网格交易，初始仓位20%，每下跌5%买入10%，每上涨10%卖出10%。'
    assert parameter_values['benchmark_symbol'] == 'SPY'
    assert parameter_values['initial_position'] == 20
    assert parameter_values['grid_interval'] == 5
    assert parameter_values['buy_size_pct'] == 10
    assert parameter_values['sell_step_pct'] == 10
    assert parameter_values['sell_size_pct'] == 10


def test_update_confirmation_keeps_top_level_fields_out_of_parameters(tmp_path):
    client, _ = _client(tmp_path)

    created = client.post('/strategy-creation-sessions')
    assert created.status_code == 200
    session_id = created.json()['id']

    updated = client.patch(
        f'/strategy-creation-sessions/{session_id}/confirmation',
        json={
            'revision': 1,
            'core': {
                'strategy_type': 'GRID',
                'universe_name': 'QQQ',
                'rebalance_frequency': 'never',
            },
            'logic': {
                'initial_position': 20,
                'grid_interval': 5,
                'buy_size_pct': 10,
                'sell_step_pct': 10,
                'sell_size_pct': 10,
                'max_stop_loss_pct': -4,
            },
            'parameters': {
                'strategy_name': 'QQQ 网格交易策略',
                'strategy_description': '围绕 QQQ 的网格交易策略。',
                'benchmark_symbol': 'SPY',
            },
        },
    )
    assert updated.status_code == 200
    updated_payload = updated.json()
    assert updated_payload['top_level']['strategy_type'] == 'GRID'
    assert all(item['key'] != 'strategy_type' for item in updated_payload['confirmation_fields']['parameters'])

    fetched = client.get(f'/strategy-creation-sessions/{session_id}')
    assert fetched.status_code == 200
    fetched_payload = fetched.json()
    assert fetched_payload['top_level']['strategy_type'] == 'GRID'
    assert all(item['key'] != 'strategy_type' for item in fetched_payload['confirmation_fields']['parameters'])


def test_get_creation_session_preserves_buy_and_hold_template_type(tmp_path):
    client, _ = _client(tmp_path)

    created = client.post('/strategy-creation-sessions', json={'strategy_type': 'BUY_AND_HOLD'})
    assert created.status_code == 200
    payload = created.json()

    parameter_keys = {item['key'] for item in payload['confirmation_fields']['parameters']}

    assert payload['strategy_type'] == 'BUY_AND_HOLD'
    assert payload['top_level']['strategy_type'] == 'BUY_AND_HOLD'
    assert payload['top_level']['rebalance_frequency'] == 'never'
    assert {'strategy_name', 'strategy_description', 'benchmark_symbol', 'contribution_amount', 'investment_frequency'} <= parameter_keys


def test_asset_allocation_session_materializes_normal_strategy(tmp_path):
    client, _ = _client(tmp_path)

    created = client.post('/strategy-creation-sessions', json={'strategy_type': 'ASSET_ALLOCATION'})
    assert created.status_code == 200
    session = created.json()
    session_id = session['id']
    parameter_keys = {item['key'] for item in session['confirmation_fields']['parameters']}

    assert session['strategy_type'] == 'ASSET_ALLOCATION'
    assert session['top_level']['strategy_type'] == 'ASSET_ALLOCATION'
    assert session['top_level']['rebalance_frequency'] == 'quarterly'
    assert {
        'allocation_assets',
        'rebalance_enabled',
        'rebalance_frequency',
        'cost_model_enabled',
        'fee_bps',
        'slippage_bps',
        'expense_ratio_bps',
    } <= parameter_keys

    updated = client.patch(
        f'/strategy-creation-sessions/{session_id}/confirmation',
        json={
            'revision': session['revision'],
            'strategy_type': 'ASSET_ALLOCATION',
            'core': {
                'strategy_type': 'ASSET_ALLOCATION',
                'universe_name': 'Global Allocation',
                'rebalance_frequency': 'quarterly',
            },
            'parameters': {
                'strategy_name': 'Global Allocation Test',
                'strategy_description': 'Asset allocation test strategy.',
                'benchmark_symbol': 'SPY',
                'capital': 100000,
                'allocation_assets': [
                    {'symbol': 'SPY', 'display_name': 'S&P 500 ETF', 'asset_class': 'Equity'},
                    {'symbol': 'TLT', 'display_name': '20Y Treasury ETF', 'asset_class': 'Treasury'},
                ],
                'allocation_weight__SPY_pct': 60,
                'allocation_weight__TLT_pct': 40,
                'investment_mode': 'all_in',
                'rebalance_enabled': True,
                'rebalance_frequency': 'quarterly',
                'rebalance_threshold_pct': 5,
                'cost_model_enabled': True,
                'fee_bps': 1.5,
                'slippage_bps': 2.5,
                'expense_ratio_bps': 8,
            },
        },
    )
    assert updated.status_code == 200
    updated_session = updated.json()

    materialized = client.post(
        f'/strategy-creation-sessions/{session_id}/materialize',
        json={'idempotency_key': 'asset-allocation-test', 'confirmed_revision': updated_session['revision']},
    )
    assert materialized.status_code == 200
    strategy = materialized.json()

    assert strategy['strategy_type'] == 'ASSET_ALLOCATION'
    assert strategy['universe_name'] == 'Global Allocation'
    assert strategy['rebalance_frequency'] == 'quarterly'
    assert strategy['parameters']['allocation_assets'][0]['symbol'] == 'SPY'
    assert strategy['parameters']['allocation_weight__TLT_pct'] == 40


def test_asset_allocation_session_starts_with_empty_basket(tmp_path):
    client, _ = _client(tmp_path)

    created = client.post('/strategy-creation-sessions', json={'strategy_type': 'ASSET_ALLOCATION'})
    assert created.status_code == 200
    session = created.json()
    parameter_values = {item['key']: item['value'] for item in session['confirmation_fields']['parameters']}

    assert parameter_values['allocation_assets'] == []
    assert 'allocation_weight__SPY_pct' not in parameter_values
    assert 'allocation_weight__QQQ_pct' not in parameter_values


def test_asset_allocation_recommendation_rejects_missing_price_history(tmp_path):
    client, service = _client_with_service(tmp_path)
    service.market_data_repository.replace_dataset_snapshot(
        {
            'id': 'ds-price',
            'name': '股票价格数据',
            'status': 'READY',
            'as_of': date.today().isoformat(),
            'freshness_label': '已刷新',
            'start_date': (date.today() - timedelta(days=420)).isoformat(),
            'end_date': date.today().isoformat(),
            'row_count': 560,
            'source': 'test_price_history',
            'fallback_source': None,
            'blocker': None,
            'metadata': {},
        },
        price_bars=[
            *_risk_parity_price_bars('SPY', daily_move=0.002),
            *_risk_parity_price_bars('QQQ', daily_move=0.006),
        ],
        symbol_coverage=[
            CoverageSummary(symbol='SPY', start_date=(date.today() - timedelta(days=420)).isoformat(), end_date=date.today().isoformat(), trade_days=280),
            CoverageSummary(symbol='QQQ', start_date=(date.today() - timedelta(days=420)).isoformat(), end_date=date.today().isoformat(), trade_days=280),
        ],
    )
    session = client.post('/strategy-creation-sessions', json={'strategy_type': 'ASSET_ALLOCATION'}).json()

    response = client.post(
        f"/strategy-creation-sessions/{session['id']}/asset-allocation/recommendation",
        json={
            'assets': [{'symbol': 'SPY'}, {'symbol': 'QQQ'}, {'symbol': 'TLT'}],
            'lookback_days': 252,
        },
    )

    assert response.status_code == 400
    payload = response.json()
    assert payload['code'] == 'bad_request'
    assert 'TLT' in payload['message']


def test_asset_allocation_recommendation_uses_inverse_volatility_when_history_exists(tmp_path):
    client, service = _client_with_service(tmp_path)
    service.market_data_repository.replace_dataset_snapshot(
        {
            'id': 'ds-price',
            'name': '股票价格数据',
            'status': 'READY',
            'as_of': date.today().isoformat(),
            'freshness_label': '已刷新',
            'start_date': (date.today() - timedelta(days=420)).isoformat(),
            'end_date': date.today().isoformat(),
            'row_count': 560,
            'source': 'test_price_history',
            'fallback_source': None,
            'blocker': None,
            'metadata': {},
        },
        price_bars=[
            *_risk_parity_price_bars('SPY', daily_move=0.002),
            *_risk_parity_price_bars('QQQ', daily_move=0.006),
        ],
        symbol_coverage=[
            CoverageSummary(symbol='SPY', start_date=(date.today() - timedelta(days=420)).isoformat(), end_date=date.today().isoformat(), trade_days=280),
            CoverageSummary(symbol='QQQ', start_date=(date.today() - timedelta(days=420)).isoformat(), end_date=date.today().isoformat(), trade_days=280),
        ],
    )
    session = client.post('/strategy-creation-sessions', json={'strategy_type': 'ASSET_ALLOCATION'}).json()

    response = client.post(
        f"/strategy-creation-sessions/{session['id']}/asset-allocation/recommendation",
        json={
            'assets': [{'symbol': 'SPY'}, {'symbol': 'QQQ'}],
            'lookback_days': 252,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    weights = {item['symbol']: item['target_weight_pct'] for item in payload['weights']}
    assert payload['method'] == 'risk_parity_inverse_volatility'
    assert weights['SPY'] > weights['QQQ']
    assert weights['SPY'] != 50


def test_get_creation_session_preserves_mean_reversion_template_type(tmp_path):
    client, _ = _client(tmp_path)

    created = client.post('/strategy-creation-sessions', json={'strategy_type': 'MEAN_REVERSION'})
    assert created.status_code == 200
    payload = created.json()

    parameter_keys = {item['key'] for item in payload['confirmation_fields']['parameters']}

    assert payload['strategy_type'] == 'MEAN_REVERSION'
    assert payload['top_level']['strategy_type'] == 'MEAN_REVERSION'
    assert payload['top_level']['rebalance_frequency'] == 'never'
    assert {
        'strategy_name',
        'strategy_description',
        'benchmark_symbol',
        'observation_timeframe',
        'trading_logic',
        'bollinger_period',
        'rsi_period',
        'rsi_buy_threshold',
        'rsi_sell_threshold',
        'atr_period',
        'take_profit_atr',
        'stop_loss_atr',
        'long_entry_size_pct',
        'short_entry_size_pct',
        'capital',
    } <= parameter_keys
    assert 'deviation_threshold' not in parameter_keys
    assert 'window_size' not in parameter_keys


def test_get_creation_session_clears_stale_mean_reversion_rebalance_conflict(tmp_path):
    client, db_path = _client(tmp_path)

    created = client.post('/strategy-creation-sessions', json={'strategy_type': 'MEAN_REVERSION'})
    assert created.status_code == 200
    session_id = created.json()['id']

    message = (
        'QQQ均值回归策略 观察QQQ日线，通过 20 日布林带 + 6 周期 RSI 识别超买超卖，'
        '结合 14 周期 ATR 动态止损止盈，开仓后盈利达到 1.5 倍 ATR时止盈，亏损达到 1 倍 ATR止损'
    )
    appended = client.post(
        f'/strategy-creation-sessions/{session_id}/messages',
        json={'content': message},
    )
    assert appended.status_code == 200

    with sqlite3.connect(db_path) as conn:
        confirmation_fields = json.loads(
            conn.execute(
                'SELECT confirmation_fields_json FROM strategy_creation_sessions WHERE id = ?',
                (session_id,),
            ).fetchone()[0]
        )
        for entry in confirmation_fields['top_level']:
            if entry['key'] == 'rebalance_frequency':
                entry['value'] = 'never'
                entry['source'] = 'manual_override'
        conn.execute(
            '''
            UPDATE strategy_creation_sessions
            SET confirmation_fields_json = ?,
                manual_conflicts_json = ?
            WHERE id = ?
            ''',
            (
                json.dumps(confirmation_fields),
                json.dumps([
                    {
                        'key': 'rebalance_frequency',
                        'label': '再平衡频次',
                        'message': '再平衡频次 已保留人工修正值',
                        'suggested_value': 'weekly',
                        'manual_value': 'never',
                        'ai_value': 'weekly',
                        'reason': 'manual_override_preserved',
                    }
                ]),
                session_id,
            ),
        )
        conn.commit()

    fetched = client.get(f'/strategy-creation-sessions/{session_id}')
    assert fetched.status_code == 200
    payload = fetched.json()

    assert payload['top_level']['rebalance_frequency'] == 'never'
    assert payload['manual_conflicts'] == []
    assert 'prepare_confirmation' in payload['allowed_actions'] or 'materialize' in payload['allowed_actions']


def test_get_creation_session_refreshes_stale_partial_buy_and_hold_message_tags(tmp_path):
    client, db_path = _client(tmp_path)

    created = client.post('/strategy-creation-sessions', json={'strategy_type': 'BUY_AND_HOLD'})
    assert created.status_code == 200
    session_id = created.json()['id']

    message = client.post(
        f'/strategy-creation-sessions/{session_id}/messages',
        json={'content': 'QQQ月度定投策略 每月第一个交易日买入QQQ1000USD'},
    )
    assert message.status_code == 200

    with sqlite3.connect(db_path) as conn:
        conn.execute(
            '''
            UPDATE strategy_creation_messages
            SET extracted_fields_json = ?
            WHERE session_id = ?
            ''',
            (
                json.dumps([
                    {'key': 'universe_name', 'label': '股票池', 'value': 'QQQ', 'status': 'synced'},
                ]),
                session_id,
            ),
        )
        conn.commit()

    fetched = client.get(f'/strategy-creation-sessions/{session_id}')
    assert fetched.status_code == 200
    payload = fetched.json()
    latest_tags = payload['messages'][-1]['extracted_tags']

    assert {item['key'] for item in latest_tags} >= {
        'strategy_name',
        'strategy_description',
        'benchmark_symbol',
        'contribution_amount',
        'investment_frequency',
    }


def test_get_creation_session_refreshes_dynamic_buy_and_hold_message_tags(tmp_path):
    client, db_path = _client(tmp_path)

    created = client.post('/strategy-creation-sessions', json={'strategy_type': 'BUY_AND_HOLD'})
    assert created.status_code == 200
    session_id = created.json()['id']

    message = client.post(
        f'/strategy-creation-sessions/{session_id}/messages',
        json={
            'content': (
                'QQQ动态定投策略 每月固定第一个交易日买入QQQ1000USD*倍率 '
                '读取QQQ 的滚动10年PE (TTM) '
                '极度高估 ( > 90% )： 倍率 0.5x '
                '温和高估 ( 70% - 90% )： 倍率 0.8x '
                '合理区间 ( 30% - 70% )： 倍率 1.0x (基准) '
                '低估区间 ( 10% - 30% )： 倍率 1.5x '
                '极度低估 ( < 10% )： 倍率 2.0x'
            )
        },
    )
    assert message.status_code == 200

    with sqlite3.connect(db_path) as conn:
        conn.execute(
            '''
            UPDATE strategy_creation_messages
            SET extracted_fields_json = ?
            WHERE session_id = ?
            ''',
            (
                json.dumps([
                    {'key': 'universe_name', 'label': '股票池', 'value': 'QQQ', 'status': 'synced'},
                ]),
                session_id,
            ),
        )
        conn.commit()

    fetched = client.get(f'/strategy-creation-sessions/{session_id}')
    assert fetched.status_code == 200
    payload = fetched.json()
    latest_tags = payload['messages'][-1]['extracted_tags']

    assert {item['key'] for item in latest_tags} >= {
        'strategy_name',
        'strategy_description',
        'benchmark_symbol',
        'contribution_amount',
        'investment_frequency',
        'contribution_anchor',
        'dynamic_investment_logic',
    }


def test_revision_session_prefills_full_strategy_snapshot_and_summarizes_description(tmp_path):
    client, db_path = create_test_client(tmp_path)
    original_description = (
        '观察 QQQ 日线，在固定网格条件下管理仓位，结合用户先前约束和交易逻辑做较长说明，'
        '这段描述会在修改策略入口被压缩成一句更易读的摘要。'
    )

    base = create_grid_strategy(
        client,
        universe_name='QQQ',
        strategy_name='QQQ 网格交易策略',
        strategy_description=original_description,
        benchmark_symbol='QQQ',
        rebalance_frequency='never',
        initial_position=20,
        grid_interval=5,
        buy_size_pct=10,
        sell_step_pct=10,
        sell_size_pct=10,
        max_stop_loss_pct=-4,
        capital=100000,
        idempotency_key='revision-prefill-grid-base',
    )
    strategy = base['strategy']

    created = client.post(
        '/strategy-creation-sessions',
        json={
            'strategy_type': strategy['strategy_type'],
            'mode': 'REVISION',
            'base_strategy_id': strategy['id'],
            'base_parameter_version_id': strategy['current_parameter_version_id'],
        },
    )
    assert created.status_code == 200
    session_id = created.json()['id']

    with sqlite3.connect(db_path) as conn:
        conn.execute(
            '''
            UPDATE strategy_creation_sessions
            SET strategy_type = 'GENERAL',
                universe_name = '',
                rebalance_frequency = NULL,
                confirmation_fields_json = ?
            WHERE id = ?
            ''',
            (json.dumps(blank_confirmation_fields('GENERAL')), session_id),
        )
        conn.commit()

    fetched = client.get(f'/strategy-creation-sessions/{session_id}')
    assert fetched.status_code == 200
    payload = fetched.json()

    parameter_values = {
        item['key']: item.get('value')
        for item in payload['confirmation_fields']['parameters']
    }

    assert payload['strategy_type'] == 'GRID'
    assert payload['top_level']['strategy_type'] == 'GRID'
    assert payload['top_level']['universe_name'] == 'QQQ'
    assert payload['top_level']['rebalance_frequency'] == 'never'
    assert parameter_values['strategy_name'] == 'QQQ 网格交易策略'
    assert parameter_values['benchmark_symbol'] == 'QQQ'
    assert parameter_values['initial_position'] == 20
    assert parameter_values['grid_interval'] == 5
    assert parameter_values['buy_size_pct'] == 10
    assert parameter_values['sell_step_pct'] == 10
    assert parameter_values['sell_size_pct'] == 10
    assert parameter_values['max_stop_loss_pct'] == -4
    assert parameter_values['capital'] == 100000
    assert parameter_values['strategy_description'] != original_description
    assert 'QQQ' in parameter_values['strategy_description']
    assert '20%' in str(parameter_values['strategy_description'])
    assert len(str(parameter_values['strategy_description'])) < len(original_description)


def test_revision_session_patch_message_updates_only_targeted_mean_reversion_fields(tmp_path):
    client, _ = create_test_client(tmp_path)
    base_message = (
        'QQQ均值回归策略 观察QQQ日线，通过 20 日布林带 + 6 周期 RSI 识别超买超卖，'
        '结合 14 周期 ATR 动态止损止盈 1、开仓：当前空仓且收盘价 跌破布林带下轨且RSI(6) ＜ 30时买入5%，'
        '当前空仓且收盘价 突破布林带上轨且RSI(6) > 80时卖出5% '
        '2、盈利达到 1.5 倍 ATR时止盈，亏损达到 1 倍 ATR止损 初始100000刀'
    )

    created = client.post('/strategy-creation-sessions', json={'strategy_type': 'MEAN_REVERSION'})
    assert created.status_code == 200
    base_session_id = created.json()['id']

    appended = client.post(
        f'/strategy-creation-sessions/{base_session_id}/messages',
        json={'content': base_message},
    )
    assert appended.status_code == 200

    materialized = client.post(
        f'/strategy-creation-sessions/{base_session_id}/materialize',
        json={'idempotency_key': 'mean-reversion-base-for-revision'},
    )
    assert materialized.status_code == 200
    strategy = materialized.json()

    revision_created = client.post(
        '/strategy-creation-sessions',
        json={
            'strategy_type': 'MEAN_REVERSION',
            'mode': 'REVISION',
            'base_strategy_id': strategy['id'],
            'base_parameter_version_id': strategy['current_parameter_version_id'],
        },
    )
    assert revision_created.status_code == 200
    revision_session_id = revision_created.json()['id']

    updated = client.post(
        f'/strategy-creation-sessions/{revision_session_id}/messages',
        json={'content': '把买入仓位和卖出仓位都改成10%吧'},
    )
    assert updated.status_code == 200
    payload = updated.json()

    parameter_values = {
        item['key']: item.get('value')
        for item in payload['confirmation_fields']['parameters']
    }
    latest_tags = payload['messages'][-1]['extracted_tags']

    assert payload['strategy_type'] == 'MEAN_REVERSION'
    assert payload['top_level']['universe_name'] == 'QQQ'
    assert payload['top_level']['rebalance_frequency'] == 'never'
    assert payload['pending_inputs'] == []
    assert parameter_values['benchmark_symbol'] == 'QQQ'
    assert parameter_values['long_entry_size_pct'] == 10
    assert parameter_values['short_entry_size_pct'] == 10
    assert '观察QQQ日线' in parameter_values['trading_logic']
    assert '买入10%' in parameter_values['trading_logic']
    assert '卖出10%' in parameter_values['trading_logic']
    assert '目标标的' not in parameter_values['strategy_description']
    assert 'QQQ' in parameter_values['strategy_description']
    assert {item['key'] for item in latest_tags} >= {
        'long_entry_size_pct',
        'short_entry_size_pct',
    }
