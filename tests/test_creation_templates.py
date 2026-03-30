from grit_backtest_platform.creation_templates import (
    blank_confirmation_fields,
    build_confirmation,
    detect_universe,
)


def _messages(content: str) -> list[dict[str, str]]:
    return [{'role': 'user', 'content': content}]


def test_detect_universe_recognizes_target_prefix_without_separator():
    universe, source, conflicts = detect_universe(
        _messages('纳指网格策略 目标QQQ，本金100000，初始买入10%，后续每跌2%买入5%，每涨5%卖出5%')
    )

    assert universe == 'QQQ'
    assert source == 'user_input'
    assert conflicts == []


def test_build_confirmation_extracts_universe_and_initial_position_from_embedded_text():
    payload = build_confirmation(
        _messages('纳指网格策略 目标QQQ，本金100000，初始买入10%，后续每跌2%买入5%，每涨5%卖出5%')
    )

    pending_keys = {item['key'] for item in payload['pending_inputs']}
    parameter_values = {
        item['key']: item.get('value')
        for item in payload['confirmation_fields']['parameters']
    }

    assert payload['top_level']['universe_name'] == 'QQQ'
    assert 'universe_name' not in pending_keys
    assert 'initial_position' not in pending_keys
    assert parameter_values['initial_position'] == 10
    assert parameter_values['grid_interval'] == 2
    assert parameter_values['buy_size_pct'] == 5
    assert parameter_values['sell_step_pct'] == 5
    assert parameter_values['sell_size_pct'] == 5


def test_build_confirmation_extracts_sp500_momentum_rotation_fields():
    payload = build_confirmation(
        _messages('标普动量策略 每年1.1和7.1取标普成分股过去12个月（移除最近1个月）的收益排名前10名，按各成分10%标准建仓、调仓，不再前10的清仓')
    )

    top_level = payload['top_level']
    parameter_values = {
        item['key']: item.get('value')
        for item in payload['confirmation_fields']['parameters']
    }
    pending_keys = {item['key'] for item in payload['pending_inputs']}

    assert top_level['strategy_type'] == 'MOMENTUM'
    assert top_level['universe_name'] == '标普500成分股'
    assert top_level['rebalance_frequency'] == '每半年'
    assert parameter_values['lookback_months'] == 12
    assert parameter_values['skip_recent_months'] == 1
    assert parameter_values['top_n'] == 10
    assert parameter_values['weighting_method'] == 'equal_weight'
    assert parameter_values['rebalance_anchor_dates'] == '01-01,07-01'
    assert 'lookback_months' not in pending_keys
    assert 'skip_recent_months' not in pending_keys
    assert 'top_n' not in pending_keys
    assert 'weighting_method' not in pending_keys
    assert payload['manual_conflicts'] == []


def test_build_confirmation_preserves_manual_override_and_emits_manual_conflict():
    existing = blank_confirmation_fields('MOMENTUM')
    for entry in existing['parameters']:
        if entry['key'] == 'top_n':
            entry['value'] = 20
            entry['source'] = 'manual_override'
            break
    else:
        raise AssertionError('top_n field missing from momentum template')

    payload = build_confirmation(
        _messages('我想选前5名'),
        existing=existing,
        forced_type='MOMENTUM',
    )

    top_n_entry = next(item for item in payload['confirmation_fields']['parameters'] if item['key'] == 'top_n')

    assert top_n_entry['value'] == 20
    assert top_n_entry['source'] == 'manual_override'
    assert any(item['key'] == 'top_n' for item in payload['manual_conflicts'])
    conflict = next(item for item in payload['manual_conflicts'] if item['key'] == 'top_n')
    assert conflict['manual_value'] == 20
    assert conflict['ai_value'] == 5
