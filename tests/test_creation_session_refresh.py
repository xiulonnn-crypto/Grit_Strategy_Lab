from __future__ import annotations

import json
import sqlite3

from fastapi.testclient import TestClient

from grit_backtest_platform.api import create_app
from grit_backtest_platform.creation_templates import blank_confirmation_fields

EMBEDDED_GRID_MESSAGE = (
    '\u672c\u91d110000\uff0c\u521d\u59cb\u4e70\u5165QQQ20%\u4ed3\u4f4d\uff0c'
    '\u6bcf\u4e0b\u8dcc5%\u4e70\u516510%\uff0c\u6bcf\u4e0a\u6da810%\u5356\u51fa10%'
)


def _client(tmp_path):
    db_path = tmp_path / 'grit_backtest.sqlite3'
    return TestClient(create_app(db_path)), db_path


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


def test_get_creation_session_preserves_mean_reversion_template_type(tmp_path):
    client, _ = _client(tmp_path)

    created = client.post('/strategy-creation-sessions', json={'strategy_type': 'MEAN_REVERSION'})
    assert created.status_code == 200
    payload = created.json()

    parameter_keys = {item['key'] for item in payload['confirmation_fields']['parameters']}

    assert payload['strategy_type'] == 'MEAN_REVERSION'
    assert payload['top_level']['strategy_type'] == 'MEAN_REVERSION'
    assert payload['top_level']['rebalance_frequency'] == 'weekly'
    assert {'strategy_name', 'strategy_description', 'benchmark_symbol', 'trading_logic', 'deviation_threshold', 'window_size'} <= parameter_keys


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
