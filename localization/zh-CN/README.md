# Dashboard 简体中文界面

以服务器正在使用的固定 Dashboard v1.3.9 发布镜像为基准，覆盖概览、账号、日志、运行记录、运行计划、配置和诊断七个页面，以及按钮、状态、帮助说明、弹窗、日期和 cron 计划描述。

`catalog.json` 保存翻译，`overrides.mjs` 和 `runtime.js` 处理动态显示文案与日期格式。`dashboard-zh-CN/` 是可直接构建镜像的生成产物，不需要在服务器安装 npm。原始任务日志、未知上游错误、配置键名、接口路径、枚举值和数据库数据保持原文。

维护翻译时，将固定发布镜像中的应用目录提取至 `.test-work/image/dashboard`。例如在安装 Docker 的开发机上：

```bash
docker create --name rewards-zh-source ghcr.io/mgrimace/rewards-dashboard@sha256:b0363471e6a17323dc8a3a61616c4c8e4f47a8e4cdd897e9b84b304922b95e59
mkdir -p .test-work/image/dashboard
docker cp rewards-zh-source:/usr/src/rewards-dashboard/. .test-work/image/dashboard/
docker rm rewards-zh-source
npm ci
npm run localize
npm run test:zh-CN
TEST_VARIANT=zh-CN npm test
```

生成脚本逐文件检查 `source-lock.json` 中的 SHA256，拒绝未经审核的上游变更。集成测试另需原项目的 Script 测试源码/镜像提取目录和 Edge 或 Playwright Chromium；使用独立的假账号与假任务，不访问 Microsoft。

Dashboard 和 Script 的扩展标签分别由 `.env` 中的 `DASHBOARD_STACK_VERSION`、`SCRIPT_STACK_VERSION` 指定。仅当所选改动确实只影响 Dashboard 时，才可单独更新面板；涉及账号、登录或额度修复时按主部署文档协调两者版本。单独更新面板前，关闭计划并确认任务空闲，在服务器先备份，再执行：

```bash
cd /opt/rewards-stack
bash scripts/backup.sh
docker compose config -q
docker compose build dashboard
docker compose up -d --no-build --no-deps --wait --wait-timeout 180 dashboard
bash scripts/healthcheck.sh
```

Docker 构建会确认 v1.3.9 基础版本，并为页面模块目录保留 755 权限，使 UID 1000 能读取模块。浏览器使用新的缓存版本；更新后按 Ctrl+F5，必要时关闭页面后重新打开。

测试步骤和验证边界见 [开发测试说明](../../docs/TESTING.md)。报告、截图和旧交付压缩包只保留在维护者本机，不随仓库发布。
