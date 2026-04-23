import type { ReactNode } from 'react';
import type { AppRoute } from './lib/appRouteContext';
import { SHELL_NAV_ITEMS, getRouteMeta } from './shell-route-meta';

function isNavActive(route: AppRoute, navKey: (typeof SHELL_NAV_ITEMS)[number]['key']): boolean {
  if (route.kind === 'composition-detail' && route.compositionId === 'detail') {
    return false;
  }
  return getRouteMeta(route).navKey === navKey;
}

export function ShellFrame({
  route,
  children,
}: {
  route: AppRoute;
  children: ReactNode;
}): JSX.Element {
  const meta = getRouteMeta(route);

  return (
    <div className="app-shell">
      <aside className="app-sidebar" aria-label="主导航">
        <a className="brand-block" href="#/workspace">
          <span className="brand-mark" aria-hidden="true">
            GSL
          </span>
          <span className="brand-copy">
            <strong>Grit Strategy Lab</strong>
            <small>V1 回测平台</small>
          </span>
        </a>

        <nav className="sidebar-nav">
          {SHELL_NAV_ITEMS.map((item) => (
            <a
              className={`sidebar-nav__link ${isNavActive(route, item.key) ? 'sidebar-nav__link--active' : ''}`}
              href={item.href}
              key={item.key}
            >
              {item.label}
            </a>
          ))}
        </nav>
      </aside>

      <div className="app-main">
        <header className="app-topbar">
          <div>
            <p className="app-topbar__title">公司级投资策略回测平台</p>
            <p className="app-topbar__copy">从研究、确认到回测与参数优化，所有关键状态都由明确契约驱动。</p>
          </div>
          <span className="status-pill">联机正常</span>
        </header>

        <main className="page-shell">
          <section className="page-heading">
            <p className="page-heading__eyebrow">{meta.eyebrow}</p>
            <h1>{meta.title}</h1>
            <p>{meta.description}</p>
          </section>

          <div className="page-content">{children}</div>
        </main>
      </div>
    </div>
  );
}
