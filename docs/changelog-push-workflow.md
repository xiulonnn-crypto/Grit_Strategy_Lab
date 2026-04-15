# CHANGELOG 推送工作流

仓库使用版本化的 `pre-push` hook 管理 `CHANGELOG.md` 顶部的 `Unreleased`。

## 安装方式

首次启用时，把本仓库的 hooks 目录配置到本地 Git：

```powershell
git config --local core.hooksPath .githooks
```

`scripts/push-to-github.ps1` 也会自动确保这个配置存在，因此用一次脚本后，后续普通 `git push` 也会继续走同一个 hook。

## 非发版 push

当 `CHANGELOG.md` 顶部 `Unreleased` 有内容时，hook 会在真正推送前做两件事：

1. 把当前 `Unreleased` 快照成一个历史段落，例如 `## [0.1.1-002] - 2026-03-31`
2. 在最顶部重新保留一个空的 `## [Unreleased]`

只要 hook 重写了 `CHANGELOG.md`，本次 push 就会被直接拦下。你需要先提交这次 changelog 变更，再重试同一个 push 命令。

## 发版 push

发版时通过推送脚本传参：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\push-to-github.ps1 -UseCurrentBranch -TargetBranch restore/stable -Release -ReleaseVersion 0.1.2
```

发版模式下，hook 会把 `Unreleased` 快照成正式版本段落，并同步更新 `src/grit_backtest_platform/_version.py`。同样地，如果 hook 产生了文件改动，本次 push 会被拦下，等你提交这些版本元数据后再推。

## 为什么要拦下 push

因为 `git push` 只能推送已经提交的历史，hook 改出来的 `CHANGELOG.md` 和版本文件如果不先提交，就不会进入远端。这个工作流的目标就是在推送前自动准备元数据，但把最终提交决定留给你自己。
