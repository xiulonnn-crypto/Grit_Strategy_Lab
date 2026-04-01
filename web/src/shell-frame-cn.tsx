import type { ReactNode } from 'react';
import type { AppRoute } from './lib/appRouteContext';
import { SHELL_NAV_ITEMS, getRouteMeta } from './shell-route-meta-cn';

const TEXT = {
  ariaMainNav: '\u4e3b\u5bfc\u822a',
  brandTitle: 'Grit \u7b56\u7565\u5b9e\u9a8c\u5ba4',
  brandSubTitle: 'V1 \u56de\u6d4b\u5e73\u53f0',
  topbarTitle: '\u516c\u53f8\u7ea7\u6295\u8d44\u7b56\u7565\u56de\u6d4b\u5e73\u53f0',
  topbarCopy:
    '\u4ece\u7814\u7a76\u3001\u786e\u8ba4\u5230\u56de\u6d4b\u4e0e\u53c2\u6570\u4f18\u5316\uff0c\u6240\u6709\u5173\u952e\u72b6\u6001\u90fd\u7531\u660e\u786e\u5951\u7ea6\u9a71\u52a8\u3002',
  online: '\u8054\u673a\u6b63\u5e38',
} as const;

function isNavActive(route: AppRoute, navKey: (typeof SHELL_NAV_ITEMS)[number]['key']): boolean {
  return getRouteMeta(route).navKey === navKey;
}

export function ShellFrameCn({
  route,
  children,
}: {
  route: AppRoute;
  children: ReactNode;
}): JSX.Element {
  const meta = getRouteMeta(route);
  const pageHeadingClassName = [
    'page-heading',
    route.kind === 'runs-index' ? 'page-heading--runs-index' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="app-shell">
      <aside className="app-sidebar" aria-label={TEXT.ariaMainNav}>
        <a className="brand-block" href="#/workspace">
          <span className="brand-mark" aria-hidden="true">
            GSL
          </span>
          <span className="brand-copy">
            <strong>{TEXT.brandTitle}</strong>
            <small>{TEXT.brandSubTitle}</small>
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
        <main className="page-shell">
          {meta.showPageHeading === false ? null : (
            <section className={pageHeadingClassName}>
              <p className="page-heading__eyebrow">{meta.eyebrow}</p>
              <h1>{meta.title}</h1>
              <p>{meta.description}</p>
            </section>
          )}

          <div className="page-content">{children}</div>
        </main>
      </div>
    </div>
  );
}
