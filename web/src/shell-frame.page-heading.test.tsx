import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ShellFrameCn } from './shell-frame-cn';

describe('shell frame page heading hooks', () => {
  it('hides the shell heading on the creation-session route', () => {
    const { container, rerender } = render(
      <ShellFrameCn route={{ kind: 'creation-session', sessionId: 'cs-001' }}>
        <div>creation session</div>
      </ShellFrameCn>,
    );

    expect(container.querySelector('.page-heading')).toBeNull();

    rerender(
      <ShellFrameCn route={{ kind: 'runs-index' }}>
        <div>runs</div>
      </ShellFrameCn>,
    );

    expect(screen.getByRole('heading', { name: '回测历史', level: 1 })).toBeInTheDocument();
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
