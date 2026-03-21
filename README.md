# patioer
smart ecommerce SAAS -harness engineering , ai agent native

## 本地目录与仓库目录差异说明

为避免协作时“本地看得到、GitHub 看不到”的困惑，这里说明默认行为：

- `node_modules/` 不会提交到 GitHub。它是依赖安装产物，由 `package.json` + `pnpm-lock.yaml` 通过 `pnpm install` 重新生成。
- `paperclip/` 在本仓库中被 `.gitignore` 忽略，作为本地参考副本使用，不纳入主仓库版本管理。
- GitHub 页面默认展示 `main` 分支内容；若你在功能分支开发（例如 `feat/...`），请切换分支或查看 PR 的 `Files changed` 以看到最新改动。
- `pnpm dev` 对 `paperclip/` 缺失具备容错：若未检测到 `paperclip/package.json`，只启动 API，不会整体启动失败。

如果需要拉起本地开发环境，请以仓库已跟踪文件为准，并先执行依赖安装命令：

```bash
pnpm install
pnpm dev
```

如需本地同时启动 API + Paperclip，请先在仓库根目录准备 `paperclip/`（需包含 `package.json`）。
