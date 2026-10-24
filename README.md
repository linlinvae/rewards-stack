# Rewards Stack 中文集成增强版

将 Microsoft Rewards Script 与 Rewards Dashboard 整合为可用 Docker Compose 部署的中文面板，并提供账号管理、网页人工验证输入、PushPlus 微信通知、备份恢复及异常处理扩展。

本仓库是社区集成项目，与 Microsoft 及两个上游项目没有官方关联。完整功能依赖固定的上游镜像；不承诺积分收益或所有地区、账号都支持相同任务。

## 上游与版本

| 组件 | 来源 | 当前基线 |
| --- | --- | --- |
| Script | [TheNetsky/Microsoft-Rewards-Script](https://github.com/TheNetsky/Microsoft-Rewards-Script) | 发布镜像 4.3.2，固定 digest |
| Dashboard | [mgrimace/rewards-dashboard](https://github.com/mgrimace/rewards-dashboard) | 发布镜像 v1.3.9，固定 digest |

准确镜像摘要、源码提交与来源见 [UPSTREAM_LOCK.json](UPSTREAM_LOCK.json)。记录的源码提交与发布镜像并非同一次构建，不能互相替代。当前中文覆盖和补丁会核验发布文件哈希；不要直接换成 `latest` 或假定新上游版本兼容。

## 新增功能

- 简体中文面板，覆盖概览、账号、日志、运行记录、计划、配置和诊断。
- 网页添加、删除账号，保留其他账号及其会话；运行时禁止修改。
- 网页输入已出现的验证邮箱、邮箱验证码或 TOTP 动态码，等待过程有超时限制。
- PushPlus 运行汇总、失败提醒、历史记录手动发送及按账号分发。
- 未知搜索额度显示、只读积分接口有限重试及失败任务的最后确认余额。
- 浏览器初始化超时保护、日志脱敏、鉴权、持久化健康检查及 SQLite 一致性备份。

## 首次部署

服务端使用 Linux、Docker Engine、Docker Compose v2.24+、Bash、Python 3、Git、OpenSSL 和常用系统工具。开发测试使用 Node.js 24+。请先阅读 [完整部署说明](docs/DEPLOYMENT.md)，尤其是资源限制、网络访问和已有数据处理。

将仓库源码放入一个**新建的空部署目录**，在该目录执行：

```bash
chmod +x scripts/*.sh docker/*.sh
sudo bash scripts/init.sh
sudoedit .env
```

保存并退出编辑器后执行：

```bash
sudo bash scripts/deploy.sh
sudo bash scripts/healthcheck.sh
```

初始化会生成 API Token 和面板密码，保存在本机 `.env`；示例文件不含可用凭据。首次没有账号，也不启用计划或自动执行任务。

面板默认仅监听服务器 `127.0.0.1:8890`。在自己的电脑建立 SSH 隧道，再访问 [本机面板](http://127.0.0.1:8890)：

```bash
ssh -N -L 8890:127.0.0.1:8890 your-user@your-server
```

已有部署升级前须关闭计划、确认任务空闲并备份；本仓库的源码归档不等于适配任意旧部署的一键升级包。

## 文档

完整导航见 [文档目录](docs/README.md)，详细说明统一放在 `docs/`。文档中的命令均从仓库或部署目录根目录执行。

| 内容 | 文档 |
| --- | --- |
| 部署、登录准备、调度、备份与恢复 | [部署指南](docs/DEPLOYMENT.md) |
| NAS 部署注意事项 | [NAS 部署](docs/NAS.md) |
| 账号删除及会话保留 | [账号删除](docs/ACCOUNT_DELETE.md) |
| 网页人工验证输入 | [网页验证](docs/WEB_LOGIN.md) |
| 微信通知和账号分发 | [PushPlus 通知](docs/PUSHPLUS.md) |
| 额度识别与异常积分修复 | [额度与异常处理](docs/RELIABILITY.md) |
| 开发、测试与验证边界 | [开发与测试](docs/TESTING.md) |
| 公开内容检查与源码打包 | [公开检查与打包](docs/PUBLISHING.md) |
| 许可证及上游归属 | [许可证与第三方来源](THIRD_PARTY_NOTICES.md) |

## 目录

```text
docker/                  运行扩展、Dockerfile、构建时补丁
dashboard-zh-CN/         随仓库提供的固定版本中文界面
localization/zh-CN/      翻译词典、生成逻辑与源文件哈希
scripts/                 初始化、部署、备份恢复和公开检查工具
tests/                   模拟账号与隔离服务测试
docs/                    部署、功能、开发和发布说明
LICENSES/                保留的第三方许可证
UPSTREAM_LOCK.json       上游版本锁定记录
```

`.env`、配置、会话、运行数据库、备份、上游缓存、报告、截图及历史交付包不属于公开源码。Git 忽略规则不会净化原始文件夹；分享源码请按发布说明生成经过检查的归档，不能直接压缩整个工作目录。

## 使用边界

仅使用自己的或获明确授权的账号。人工完成微软要求的身份验证；网页输入扩展不处理 CAPTCHA、通行密钥或完整远程浏览器操作。出现风控、验证或会话错误时应先关闭计划并处理。上游自动化行为可能不计积分或触发账号限制。

面板需要处理登录凭据和会话，仅通过可信网络、SSH 隧道或 HTTPS 使用。备份同样含凭据，不能上传至仓库或公开 Issue。

## 许可证

本项目新增代码按 [GNU GPL v3.0](LICENSE) 发布；上游代码及其衍生文件保留原许可证与版权归属。Dashboard 的 MIT 许可全文见 [LICENSES/rewards-dashboard-MIT.txt](LICENSES/rewards-dashboard-MIT.txt)。完整范围、依赖说明和发布注意事项见 [许可证与第三方来源](THIRD_PARTY_NOTICES.md)。
