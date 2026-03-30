from __future__ import annotations

import json
import sqlite3

from fastapi.testclient import TestClient

from grit_backtest_platform.api import create_app
from grit_backtest_platform.creation_templates import blank_confirmation_fields

EMBEDDED_GRID_MESSAGE = '\u7eb3\u6307\u7f51\u683c\u7b56\u7565 \u76ee\u6807QQQ\uff0c\u672c\u91d1100000\uff0c\u521d\u59cb\u4e70\u516510%\uff0c\u540e\u7eed\u6bcf\u8dcc2%\u4e70\u51655%\uff0c\u6bcf\u6da85%\u5356\u51fa5%'


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
    assert payload['status'] == 'READY_FOR_CONFIRMATION'
    assert payload['universe_name'] == 'QQQ'
    assert pending_keys == set()
    assert parameter_values['initial_position'] == 10
    assert parameter_values['grid_interval'] == 2
    assert parameter_values['buy_size_pct'] == 5
    assert parameter_values['sell_step_pct'] == 5
    assert parameter_values['sell_size_pct'] == 5