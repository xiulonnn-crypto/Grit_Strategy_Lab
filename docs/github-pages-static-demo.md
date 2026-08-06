# GitHub Pages 静态演示工作台

GitHub Pages 发布的是 `web/` 的 React 构建结果，而不是本地 FastAPI 或 SQLite 数据库。发布流程启用 `VITE_STATIC_DEMO=true`，因此页面使用仓库内置的互动演示数据，并在浏览器本地保存每次交互结果。

## 启用 Pages

1. 推送 `Compose1.3` 或 `main`。
2. 在 GitHub 仓库的 **Settings → Pages** 中把发布源设为 **GitHub Actions**。
3. 等待 `Deploy GitHub Pages` 工作流完成。

## 云端保存演示数据

静态页面右下角的“连接云端演示数据”可以把演示数据保存到用户自己的私有 GitHub Gist。

1. 创建一个仅拥有 **Gist** 权限的 GitHub token。不要使用具有仓库写入或组织管理权限的 token。
2. 打开静态演示页面，点击右下角按钮，输入 token。
3. 首次连接时不填写 Gist ID，页面会创建私有 Gist；复制页面显示的 Gist ID。
4. 在另一台设备上，输入同一个 token 和 Gist ID，即可下载并继续使用同一份演示数据。

Token 只保留在当前页面运行内存，不会写入浏览器的长期存储、Gist 内容或仓库。页面只把演示状态 JSON 写入该私有 Gist。

## 本地验证

```powershell
$env:VITE_STATIC_DEMO='true'
npm.cmd --prefix web run build -- --base /Grit_Strategy_Lab/
Remove-Item Env:VITE_STATIC_DEMO
```

运行 `web/src/lib/staticDemoApi.test.ts` 可验证本地恢复与 GitHub Gist API 同步契约。
