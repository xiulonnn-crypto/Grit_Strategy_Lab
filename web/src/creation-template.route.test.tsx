import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from './app-runtime';
import { installMockApiServer } from './testApiMock';

let mockServer: ReturnType<typeof installMockApiServer> | null = null;

async function renderTemplateRoute(): Promise<void> {
  await act(async () => {
    window.location.hash = '#/strategies';
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
  it('按策略库页面渲染正式标题区并移除旧模板页标题', async () => {
    await renderTemplateRoute();

    expect(await screen.findByRole('heading', { name: '策略库', level: 1 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '选择模板', level: 1 })).not.toBeInTheDocument();
    expect(document.querySelector('.page-heading')).toBeNull();
    expect(document.body).not.toHaveTextContent('策略全生命周期管理');
    expect(document.body).not.toHaveTextContent('收益列展示对应期限的最近正式回测结果');
    expect(screen.queryByRole('button', { name: '刷新' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\\u[0-9a-fA-F]{4}/);
  });

  it('按设计稿列顺序展示策略表格与操作列', async () => {
    await renderTemplateRoute();

    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(
      screen
        .getAllByRole('columnheader')
        .map((header) => header.textContent?.replace(/升序|降序/g, '')),
    ).toEqual([
      '策略名',
      '版本',
      '策略类型',
      '10Y年化收益/夏普',
      '20Y年化收益/夏普',
      '30Y年化收益/夏普',
      '状态',
      '最近编辑时间',
      '操作',
    ]);
    expect(screen.getAllByRole('button', { name: '查看' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: '回测' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: '优化' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /一键生成/ }).length).toBeGreaterThan(0);
  });

  it('把新建策略入口改为策略类型弹层', async () => {
    await renderTemplateRoute();

    fireEvent.click(await screen.findByRole('button', { name: '新建策略' }));

    const dialog = await screen.findByRole('dialog', { name: '选择策略类型' });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText('动量 / 趋势跟随')).toBeInTheDocument();
    expect(within(dialog).getByText('用于研究截面动量、趋势延续和相对强弱轮动框架。')).toBeInTheDocument();
    expect(within(dialog).getByText('网格交易')).toBeInTheDocument();
    expect(within(dialog).getByText('用于研究区间震荡下的分层买入、分层卖出和仓位再平衡规则。')).toBeInTheDocument();
    expect(within(dialog).getByText('均值回归')).toBeInTheDocument();
    expect(within(dialog).getByText('指数 / 定投')).toBeInTheDocument();
    expect(within(dialog).getByText('通用策略')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: '创建动量策略' })).toBeInTheDocument();
  });
});
