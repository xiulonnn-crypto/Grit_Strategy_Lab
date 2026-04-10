import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from './app-runtime';
import { installMockApiServer } from './testApiMock';

let mockServer: ReturnType<typeof installMockApiServer> | null = null;

async function renderApp(hash: string): Promise<HTMLElement> {
  let container: HTMLElement | null = null;
  await act(async () => {
    window.location.hash = hash;
    ({ container } = render(<App />));
  });
  return container!;
}

beforeEach(() => {
  mockServer = installMockApiServer();
});

afterEach(() => {
  mockServer?.restore();
  mockServer = null;
  cleanup();
  window.location.hash = '';
});

describe('optimization module flow', () => {
  it('navigates from jobs to select, config, and results', async () => {
    const container = await renderApp('#/optimization-jobs');

    await waitFor(() => expect(container.querySelector('.optimization-lab-page')).not.toBeNull());
    expect(container.querySelector('.optimization-steps')).toBeNull();

    const createButton = container.querySelector('.optimization-lab-panel--header .primary-button') as HTMLButtonElement | null;
    expect(createButton).toBeTruthy();
    fireEvent.click(createButton!);

    await waitFor(() => expect(window.location.hash).toBe('#/optimization-jobs/new'));

    await waitFor(() => expect(container.querySelector('.optimization-lab-panel__heading h2')).toBeTruthy());
    await waitFor(() => expect(container.querySelector('tbody tr:first-child td:last-child button')).toBeTruthy());
    const selectButton = container.querySelector('tbody tr:first-child td:last-child button') as HTMLButtonElement | null;
    expect(selectButton).toBeTruthy();
    fireEvent.click(selectButton!);

    await waitFor(() =>
      expect(window.location.hash).toMatch(/^#\/optimization-jobs\/new\/config\?strategy_id=strat-001/),
    );
    await waitFor(() => expect(container.querySelector('.optimization-config-grid')).not.toBeNull());

    const startButton = container.querySelector('.optimization-hero-actions .primary-button') as HTMLButtonElement | null;
    expect(startButton).toBeTruthy();
    fireEvent.click(startButton!);

    await waitFor(() => expect(window.location.hash).toMatch(/^#\/optimization-jobs\/opt-/));
    await waitFor(() => expect(container.querySelector('.optimization-progress-panel')).not.toBeNull());
    expect(container.querySelector('.optimization-results-grid')).toBeNull();
    await waitFor(() => expect(container.querySelector('.optimization-results-grid')).not.toBeNull());
  });

  it('syncs the stability center and shelf when selecting a different candidate', async () => {
    const container = await renderApp('#/optimization-jobs/opt-001');

    await waitFor(() => expect(container.querySelector('.optimization-results-grid')).not.toBeNull());
    const title = container.querySelector('.optimization-lab-panel--hero h1') as HTMLHeadingElement | null;
    expect(title).toBeTruthy();
    expect(title?.textContent).toContain('参数优化：');
    const subtitle = container.querySelector('.optimization-lab-panel--hero p:not(.optimization-lab-eyebrow)') as HTMLParagraphElement | null;
    expect(subtitle?.textContent).toContain('回看');
    const parameterSummary = container.querySelector('.optimization-parameter-summary') as HTMLElement | null;
    expect(parameterSummary).toBeTruthy();
    expect(parameterSummary?.querySelectorAll('.optimization-parameter-summary__line').length).toBeGreaterThan(0);
    expect(parameterSummary?.textContent).not.toContain('equal_weight');
    expect(container.querySelector('.optimization-parameter-chip-list')).toBeTruthy();
    expect(container.querySelectorAll('.optimization-heatmap-cell').length).toBeGreaterThan(1);
    const initialSelectedParameter = container.querySelector('.optimization-parameter-chip strong')?.textContent;
    const initialActiveShelfCard = container.querySelector('.optimization-shelf-card--active') as HTMLButtonElement | null;
    const initialActiveShelfText = initialActiveShelfCard?.textContent;
    const chips = container.querySelector('.optimization-meta-chips') as HTMLElement | null;
    expect(chips?.textContent).toContain('任务编号：');
    expect(chips?.textContent).not.toContain('策略：');
    expect(chips?.textContent).not.toContain('参数优化：');

    const rows = container.querySelectorAll('.optimization-results-grid tbody tr');
    expect(rows.length).toBeGreaterThan(1);
    fireEvent.click(rows[1] as HTMLTableRowElement);

    await waitFor(() =>
      expect(container.querySelector('.optimization-parameter-chip strong')?.textContent).not.toBe(initialSelectedParameter),
    );
    const activeShelfCard = container.querySelector('.optimization-shelf-card--active') as HTMLButtonElement | null;
    expect(activeShelfCard).toBeTruthy();
    expect(activeShelfCard?.textContent).not.toBe(initialActiveShelfText);
  });

  it('locks fixed search fields and recalculates budget combinations when the range changes', async () => {
    const container = await renderApp('#/optimization-jobs/new/config?strategy_id=strat-001');

    await waitFor(() => expect(container.querySelector('.optimization-config-grid')).not.toBeNull());

    const budgetInput = container.querySelector('input[aria-label="预算组合"]') as HTMLInputElement | null;
    expect(budgetInput).toBeTruthy();
    const initialBudget = Number(budgetInput!.value);
    expect(initialBudget).toBeGreaterThan(0);

    const firstRow = container.querySelector('.optimization-lab-table-shell--form tbody tr') as HTMLTableRowElement | null;
    expect(firstRow).toBeTruthy();

    const currentValue = firstRow!.children[1]?.textContent?.trim() ?? '';
    const modeSelect = firstRow!.querySelector('select') as HTMLSelectElement | null;
    const rowInputs = firstRow!.querySelectorAll('input');
    const startInput = rowInputs[0] as HTMLInputElement;
    const endInput = rowInputs[1] as HTMLInputElement;
    const stepInput = rowInputs[2] as HTMLInputElement;

    fireEvent.change(endInput, { target: { value: '10' } });
    await waitFor(() => expect(Number(budgetInput!.value)).toBeGreaterThan(initialBudget));
    const expandedBudget = Number(budgetInput!.value);

    fireEvent.change(modeSelect!, { target: { value: 'fixed' } });
    await waitFor(() => {
      expect(startInput.value).toBe(currentValue);
      expect(endInput.value).toBe(currentValue);
      expect(startInput.disabled).toBe(true);
      expect(endInput.disabled).toBe(true);
      expect(stepInput.disabled).toBe(true);
    });
    expect(Number(budgetInput!.value)).toBeLessThan(expandedBudget);
  });

  it('keeps search range inputs editable while the user clears or types a minus sign', async () => {
    const container = await renderApp('#/optimization-jobs/new/config?strategy_id=strat-001');

    await waitFor(() => expect(container.querySelector('.optimization-config-grid')).not.toBeNull());

    const firstRow = container.querySelector('.optimization-lab-table-shell--form tbody tr') as HTMLTableRowElement | null;
    expect(firstRow).toBeTruthy();

    const startInput = firstRow!.querySelectorAll('input')[0] as HTMLInputElement;
    expect(startInput).toBeTruthy();

    fireEvent.change(startInput, { target: { value: '' } });
    expect(startInput.value).toBe('');

    fireEvent.change(startInput, { target: { value: '-' } });
    expect(startInput.value).toBe('-');

    fireEvent.change(startInput, { target: { value: '-2' } });
    expect(startInput.value).toBe('-2');
  });
});
