# GitHub Pages 静态演示

本仓库的 GitHub Pages 使用 GitHub 的 **Deploy from a branch** 模式。`gh-pages` 分支的仓库根目录就是公开站点根目录，其中的 `index.html` 是由现有 React 工作台构建出来的静态入口，而不是另一套手写页面。

## 部署方式

1. 在 `Compose1.3` 分支运行：

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\scripts\codex-build-pages-static.ps1 -OutputDirectory .\.tmp\github-pages-static
   ```

2. 将 `.tmp\github-pages-static` 的全部内容提交到 `gh-pages` 分支根目录。
3. 在 GitHub 仓库的 **Settings → Pages** 中选择：
   - **Source**: `Deploy from a branch`
   - **Branch**: `gh-pages`
   - **Folder**: `/(root)`
4. 部署地址为：<https://xiulonnn-crypto.github.io/Grit_Strategy_Lab/>。

构建会设置 `VITE_STATIC_DEMO=true`，并从本机 API 捕获工作台所需的只读快照。因此 Pages 首屏使用与本地工作台相同的 React 路由、组件、样式、文案和当次工作台内容，但不公开本机 FastAPI、SQLite 或任何本地连接。

## 演示数据与云端保存

静态演示的交互状态默认保存到浏览器。默认工作台不额外显示演示控件，以确保它与本地页面一致。需要跨设备同步时，在 URL 查询串增加 `?demo-sync=1` 后再打开页面，例如 `https://xiulonnn-crypto.github.io/Grit_Strategy_Lab/?demo-sync=1#/workspace`；右下角会出现连接私有 GitHub Gist 的面板：

1. 创建一个仅拥有 **Gist** 权限的 GitHub token。
2. 在页面中输入 token。token 只保留在当前页面内存，不会写入浏览器存储或 Gist。
3. 首次连接会创建私有 Gist；之后在其他设备输入 token 和 Gist ID 即可恢复演示状态。

## 验证要求

每次发布前都必须验证：

- `gh-pages` 分支根目录含有 `index.html`、`.nojekyll` 和 `assets/`。
- `https://xiulonnn-crypto.github.io/Grit_Strategy_Lab/#/workspace` 能打开工作台。
- 与本地 `http://127.0.0.1:4173/#/workspace` 比较工作台的模块顺序、文案、布局、数据与关键交互。
