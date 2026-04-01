import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from './app-runtime';
import { installMockApiServer } from './testApiMock';

let mockServer: ReturnType<typeof installMockApiServer> | null = null;

async function renderTemplateRoute(): Promise<void> {
  await act(async () => {
    window.location.hash = '#/creation/new';
    render(<App />);
  });
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

describe('创建模板页', () => {
  it('只保留一套页面标题区并且不再渲染原样 unicode 转义文本', async () => {
    await renderTemplateRoute();

    expect(await screen.findByRole('heading', { name: '选择模板', level: 1 })).toBeInTheDocument();
    expect(screen.getAllByText('选择模板')).toHaveLength(1);
    expect(screen.getAllByText('策略创建')).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/\\u[0-9a-fA-F]{4}/);
  });

  it('按简洁模板卡渲染五个策略选项', async () => {
    await renderTemplateRoute();

    expect(await screen.findByText('动量 / 趋势跟随')).toBeInTheDocument();
    expect(screen.getByText('适合过去一段时间强势延续持有的轮动策略。')).toBeInTheDocument();
    expect(screen.getByText('网格交易')).toBeInTheDocument();
    expect(screen.getByText('适合区间震荡，以规则化挂单分批买卖。')).toBeInTheDocument();
    expect(screen.getByText('均值回归')).toBeInTheDocument();
    expect(screen.getByText('适合偏离均值回归的交易框架。')).toBeInTheDocument();
    expect(screen.getByText('指数 / 定投')).toBeInTheDocument();
    expect(screen.getByText('适合长期持有和固定节奏增持。')).toBeInTheDocument();
    expect(screen.getByText('通用策略')).toBeInTheDocument();
    expect(screen.getByText('自定义规则，不强制固定模板参数。')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: '使用此模板' })).toHaveLength(5);
  });
});
