import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ShellFrameCn } from './shell-frame-cn';
import { getRouteMeta as getRouteMetaCn } from './shell-route-meta-cn';
import { getRouteMeta as getRouteMetaLegacy } from './shell-route-meta';

const WORKSPACE_HEALTH_COPY =
  '总览策略规模、活跃回测与优化进度，直达最新任务。';

function getShellFrameCss(): string {
  return readFileSync('src/app-shell-frame.css', 'utf8');
}

function getCssBlock(css: string, selector: string): string {
  const selectorStart = `${selector} {`;
  let start = css.indexOf(`\n${selectorStart}`);
  if (start >= 0) {
    start += 1;
  } else if (css.startsWith(selectorStart)) {
    start = 0;
  }
  if (start < 0) {
    throw new Error(`Missing CSS selector: ${selector}`);
  }
  const end = css.indexOf('\n}', start);
  if (end < 0) {
    throw new Error(`Unclosed CSS selector: ${selector}`);
  }
  return css.slice(start, end + 2).replace(/\s+/g, ' ');
}

describe('shell frame page heading hooks', () => {
  it('keeps workspace route metadata aligned with the page health copy', () => {
    expect(getRouteMetaCn({ kind: 'workspace' }).description).toBe(WORKSPACE_HEALTH_COPY);
    expect(getRouteMetaLegacy({ kind: 'workspace' }).description).toBe(WORKSPACE_HEALTH_COPY);
  });

  it('keeps the left navigation spacing compact without changing the desktop shell width', () => {
    const css = getShellFrameCss();
    const rootBlock = getCssBlock(css, ':root');
    const sidebarBlock = getCssBlock(css, '.app-sidebar');
    const navBlock = getCssBlock(css, '.sidebar-nav');
    const groupBlock = getCssBlock(css, '.sidebar-nav__group');
    const itemListBlock = getCssBlock(css, '.sidebar-nav__group-items');
    const linkBlock = getCssBlock(css, '.sidebar-nav__link');

    expect(rootBlock).toContain('--sidebar-width: 236px;');
    expect(sidebarBlock).toContain('gap: 16px;');
    expect(sidebarBlock).toContain('padding: 20px 14px 18px;');
    expect(navBlock).toContain('gap: 12px;');
    expect(groupBlock).toContain('gap: 6px;');
    expect(itemListBlock).toContain('gap: 5px;');
    expect(linkBlock).toContain('min-height: 40px;');
    expect(linkBlock).toContain('padding: 0 12px;');
    expect(linkBlock).toContain('border-radius: 12px;');
    expect(linkBlock).not.toContain('min-height: 46px;');
  });

  it('hides the shell heading on page-owned routes including runs aggregation', () => {
    const { container, rerender } = render(
      <ShellFrameCn route={{ kind: 'creation-session', sessionId: 'cs-001' }}>
        <div>creation session</div>
      </ShellFrameCn>,
    );

    expect(container.querySelector('.page-heading')).toBeNull();
    expect(screen.getByRole('link', { name: '数据快照' })).toHaveAttribute('href', '#/snapshots');

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

    rerender(
      <ShellFrameCn route={{ kind: 'factor-library' }}>
        <div>factor library</div>
      </ShellFrameCn>,
    );
    expect(container.querySelector('.page-heading')).toBeNull();

    rerender(
      <ShellFrameCn route={{ kind: 'pit-data' }}>
        <div>pit data</div>
      </ShellFrameCn>,
    );
    expect(container.querySelector('.page-heading')).toBeNull();
  });
});
