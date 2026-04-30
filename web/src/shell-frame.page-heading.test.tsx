import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ShellFrameCn } from './shell-frame-cn';
import { getRouteMeta as getRouteMetaCn } from './shell-route-meta-cn';
import { getRouteMeta as getRouteMetaLegacy } from './shell-route-meta';

const WORKSPACE_HEALTH_COPY =
  '总览策略规模、活跃回测与优化进度，直达最新任务。';

describe('shell frame page heading hooks', () => {
  it('keeps workspace route metadata aligned with the page health copy', () => {
    expect(getRouteMetaCn({ kind: 'workspace' }).description).toBe(WORKSPACE_HEALTH_COPY);
    expect(getRouteMetaLegacy({ kind: 'workspace' }).description).toBe(WORKSPACE_HEALTH_COPY);
  });

  it('hides the shell heading on page-owned routes including runs aggregation', () => {
    const { container, rerender } = render(
      <ShellFrameCn route={{ kind: 'creation-session', sessionId: 'cs-001' }}>
        <div>creation session</div>
      </ShellFrameCn>,
    );

    expect(container.querySelector('.page-heading')).toBeNull();

    rerender(
      <ShellFrameCn route={{ kind: 'creation-template' }}>
        <div>strategy library</div>
      </ShellFrameCn>,
    );
    expect(container.querySelector('.page-heading')).toBeNull();

    rerender(
      <ShellFrameCn route={{ kind: 'strategy-detail', strategyId: 'strat-001' }}>
        <div>strategy detail</div>
      </ShellFrameCn>,
    );
    expect(container.querySelector('.page-heading')).toBeNull();

    rerender(
      <ShellFrameCn route={{ kind: 'composition-dashboard' }}>
        <div>composition dashboard</div>
      </ShellFrameCn>,
    );
    expect(container.querySelector('.page-heading')).toBeNull();

    rerender(
      <ShellFrameCn route={{ kind: 'leg-inventory' }}>
        <div>leg inventory</div>
      </ShellFrameCn>,
    );
    expect(container.querySelector('.page-heading')).toBeNull();

    rerender(
      <ShellFrameCn route={{ kind: 'composition-workbench' }}>
        <div>composition workbench</div>
      </ShellFrameCn>,
    );
    expect(container.querySelector('.page-heading')).toBeNull();
    expect(container.querySelector('.sidebar-nav__link--active')?.getAttribute('href')).toBe('#/compositions/list');

    rerender(
      <ShellFrameCn route={{ kind: 'composition-detail', compositionId: 'comp-001' }}>
        <div>composition detail</div>
      </ShellFrameCn>,
    );
    expect(container.querySelector('.page-heading')).toBeNull();

    rerender(
      <ShellFrameCn route={{ kind: 'composition-detail', compositionId: 'detail' }}>
        <div>approved composition detail preview</div>
      </ShellFrameCn>,
    );
    expect(container.querySelector('.page-heading')).toBeNull();
    expect(container.querySelector('.sidebar-nav__link--active')).toBeNull();

    rerender(
      <ShellFrameCn route={{ kind: 'optimization-index' }}>
        <div>optimization jobs</div>
      </ShellFrameCn>,
    );
    expect(container.querySelector('.page-heading')).toBeNull();

    rerender(
      <ShellFrameCn route={{ kind: 'optimization-select', strategyId: 'strat-001' }}>
        <div>optimization select</div>
      </ShellFrameCn>,
    );
    expect(container.querySelector('.page-heading')).toBeNull();

    rerender(
      <ShellFrameCn route={{ kind: 'optimization-config', strategyId: 'strat-001' }}>
        <div>optimization config</div>
      </ShellFrameCn>,
    );
    expect(container.querySelector('.page-heading')).toBeNull();

    rerender(
      <ShellFrameCn route={{ kind: 'optimization', jobId: 'opt-001' }}>
        <div>optimization results</div>
      </ShellFrameCn>,
    );
    expect(container.querySelector('.page-heading')).toBeNull();

    rerender(
      <ShellFrameCn route={{ kind: 'runs-index' }}>
        <div>runs</div>
      </ShellFrameCn>,
    );
    expect(container.querySelector('.page-heading')).toBeNull();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();

    rerender(
      <ShellFrameCn route={{ kind: 'run', runId: 'bt-001' }}>
        <div>run detail</div>
      </ShellFrameCn>,
    );
    expect(container.querySelector('.page-heading')).toBeNull();

    rerender(
      <ShellFrameCn route={{ kind: 'backtest', strategyId: 'strat-001' }}>
        <div>backtest submit</div>
      </ShellFrameCn>,
    );
    expect(container.querySelector('.page-heading')).toBeNull();
  });
});
