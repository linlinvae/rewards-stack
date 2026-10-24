# 开发与测试

所有应用测试使用隔离目录、模拟账号或假执行器，不应连接真实账号执行积分任务。真实部署报告、截图及原始日志不随仓库发布。本文件说明可重复的验证方式；历史部署成功不等于当前所有环境都已验证。

## 独立测试

Node.js 24+ 可直接运行以下不需要上游镜像、真实凭据或浏览器的测试：

```bash
npm run test:unit
npm run test:publication
```

开发依赖安装使用 `npm ci`。`node_modules/` 不入库。公开检查与源码打包本身仅使用 Node.js 内建模块和 Git，不依赖 npm 包或联网。

## 上游及镜像基线

源码测试先执行 `bash scripts/fetch-upstream.sh`，或手动按 `UPSTREAM_LOCK.json` 中的 URL 和提交克隆到 `upstream/script`、`upstream/dashboard`。脚本要求固定提交，且拒绝覆盖有改动的源码。`upstream/` 不入库。

涉及镜像、中文覆盖、登录工具和编译后 Script 补丁的测试，还需要从**固定 digest 的镜像**提取应用文件到以下目录：

```text
.test-work/image/script/
.test-work/image/dashboard/
```

在可使用 Docker 的开发机上，将 `SCRIPT_IMAGE`、`DASHBOARD_IMAGE` 设置为 `UPSTREAM_LOCK.json` 中的完整 `baseImage` 值，然后执行：

```bash
mkdir -p .test-work/image/script .test-work/image/dashboard
docker create --name rewards-test-script "$SCRIPT_IMAGE"
docker cp rewards-test-script:/usr/src/microsoft-rewards-script/. .test-work/image/script/
docker rm rewards-test-script
docker create --name rewards-test-dashboard "$DASHBOARD_IMAGE"
docker cp rewards-test-dashboard:/usr/src/rewards-dashboard/. .test-work/image/dashboard/
docker rm rewards-test-dashboard
```

`docker create` 只创建临时容器，不启动服务。名称冲突时应保留已有容器并换名。提取内容仅作本地测试，不能连同整个缓存目录发布。

## 界面和集成测试

```bash
npm ci
npm run test:zh-CN
npm run test:reliability
npm run test:startup-guard
TEST_VARIANT=source npm test
TEST_VARIANT=image npm test
TEST_VARIANT=zh-CN npm test
```

以上为 Bash 环境变量语法；PowerShell 使用 `$env:TEST_VARIANT='zh-CN'; npm test`。界面集成需要已安装的 Edge 或可用的 Playwright Chromium；可设置 `BROWSER_EXECUTABLE`。测试报告写入忽略的 `reports/`，隔离数据写入 `.test-work/`。

`npm run localize` 会按哈希锁核验镜像文件，再重新生成中文资源；它会修改生成目录和词典清单，运行前应先保存本地修改。生成后重新检查变更及测试，不要直接覆盖未知版本的上游资源。

## 部署检查与边界

实际 Docker 构建、`docker compose config -q`、容器健康、宿主机挂载权限、备份恢复、重建持久化及 HTTPS/反向代理须在目标环境验证。备份、导入和恢复操作应先关闭计划、确认空闲，再按部署文档执行。

本地模拟测试不会证明微软接受登录会话、实际奖励到账或 PushPlus 已送达微信；这些结果应由使用者在私有环境人工确认。不得将平台受理响应直接描述为手机已收件，也不得把未知额度视为任务完成。
