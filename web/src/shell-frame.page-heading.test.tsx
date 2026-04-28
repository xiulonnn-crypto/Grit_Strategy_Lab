import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ShellFrameCn } from './shell-frame-cn';

describe('shell frame page heading hooks', () => {
  it('hides the shell heading on page-owned routes and keeps it on list routes', () => {
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
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(container.querySelector('.page-heading--runs-index')).not.toBeNull();

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
