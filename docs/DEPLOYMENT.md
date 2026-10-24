# Microsoft Rewards 一体化部署说明

[返回首页](../README.md) · [文档目录](README.md)

本仓库提供固定版本的中文集成源码及部署扩展。首次部署没有账号、没有启用计划，不会自动执行 Rewards 任务。开发验证方式及边界见 [docs/TESTING.md](TESTING.md)；私人服务器验收记录不随仓库公开。

## 架构与版本

```text
浏览器 → SSH 隧道 / 后续自行配置的 1Panel HTTPS
       → 127.0.0.1:8890 → dashboard
                         → rewards-stack_rewards 网络 → script:3010
```

- Script：发布镜像 4.3.2；扩展镜像默认标签 `20261023-reliability`，包含浏览器初始化保护、账号管理、网页人工验证输入及额度修复。
- Dashboard：以发布镜像 v1.3.9 为基础，附加中文界面、账号管理、网页输入和 PushPlus；扩展镜像默认标签 `20261023-reliability`。
- Compose 固定两者的 manifest digest，具体值见 `.env.example`，不依赖可变的 `latest`。
- 基于这两个镜像构建本地扩展镜像，添加启动保护、日志脱敏及检查/备份工具。Dashboard 显示文案、日期和计划描述已汉化；Script 的功能修复以受版本哈希约束的补丁应用，范围见各功能文档。
- 初次交付支持 registry 失败时构建固定源码：Script `d0f07d74a0ed4dda127855d6e3dde98bf4c89d6e`、Dashboard `4a81f9f3bd2aacce59b9cda6377562721760d854`。当前中文版只支持固定的 Dashboard v1.3.9 发布镜像，构建时检查版本文件 SHA256；较新的源码回退会被拒绝，需先重新审核汉化兼容性。
- 默认时区 `Asia/Jakarta`；两个服务共用 `.env` 的 `TZ`。
- Script 3010 只在项目的 bridge 网络监听，没有宿主机端口映射。`expose` 不会发布公网端口。
- Dashboard 用 UID/GID 1000 运行；Script 上游入口需要初始化 `/etc` 时区和配置，沿用其 root 用户，但没有 privileged、Docker Socket 或宿主机管理权限。
- 两个常驻服务均 `restart: unless-stopped`、具备真实 HTTP 健康检查；维护服务只通过 tools profile 临时运行。

## 上游依据

已读取 README、Dockerfile、Compose、环境变量、Control API、调度器、SQLite store、会话和人工登录工具，并检查发布镜像中的实际应用代码。

- [Script 固定源码 README](https://github.com/TheNetsky/Microsoft-Rewards-Script/blob/d0f07d74a0ed4dda127855d6e3dde98bf4c89d6e/README.md)
- [Control API 文档](https://github.com/TheNetsky/Microsoft-Rewards-Script/blob/d0f07d74a0ed4dda127855d6e3dde98bf4c89d6e/scripts/api/README.md)
- [Script 入口与 cron 分支](https://github.com/TheNetsky/Microsoft-Rewards-Script/blob/d0f07d74a0ed4dda127855d6e3dde98bf4c89d6e/scripts/docker/entrypoint.sh)
- [Dashboard 固定源码 README](https://github.com/mgrimace/rewards-dashboard/blob/4a81f9f3bd2aacce59b9cda6377562721760d854/README.md)
- [Dashboard 调度器](https://github.com/mgrimace/rewards-dashboard/blob/4a81f9f3bd2aacce59b9cda6377562721760d854/rewards-dashboard/lib/scheduler.js)

Dashboard README 中的 `API_ALLOW__CONFIG_WRITE` 有双下划线拼写错误；真实有效变量是 `API_ALLOW_CONFIG_WRITE`。没有照搬旧 sample-stack 中公开 API、启动自动运行及开启敏感权限的设置。

## 系统要求与目录

Linux，Docker Engine，Compose v2.24+ 或兼容的较新插件；主机需 `bash`、`python3`、`git`、`openssl`、`tar`、`sha256sum`、`flock`、`ss`。建议至少 2 核/4 GB 内存和足够的镜像、浏览器及备份空间，实际消耗随账号数变化。此配置针对正常 rootful Docker；rootless/userns remap 的 UID 映射需要单独验证。

Compose 提供一组保守资源限制：Script 0.75 核、768 MiB RAM、RAM+swap 合计 1536 MiB、256 个进程/线程；Dashboard 0.25 核、128 MiB RAM、RAM+swap 合计 256 MiB、64 个进程/线程。它们是示例配置，不代表最低可用资源或适合所有机器。部署前检查宿主机余量和其他应用负载；浏览器可能需要更高限制，达到上限可能导致变慢或 OOM。Swap 不是额外物理内存，本仓库不会自动创建宿主机 swap。资源限制依据 [Docker 官方说明](https://docs.docker.com/engine/containers/resource_constraints/)。

```text
/opt/rewards-stack/
  compose.yaml              # 两个常驻服务，维护服务按需运行
  compose.source.yaml       # registry 不可用时构建上游基础镜像
  .env / .env.example / .gitignore
  docker/                   # 小型部署扩展，不重构前端
  config/                   # Script config.json；不使用旧 cron 计划
  sessions/                 # Script sessions.db（含敏感登录状态）
  data/dashboard/           # dashboard.sqlite、WAL、SHM
  data/diagnostics/         # 可选诊断，默认不采集
  backups/                  # 私密备份及恢复检查目录
  scripts/ / tests/ / docs/ # reports/ 仅为本地生成结果
  upstream/                 # 固定源码构建缓存，不进入 Git
```

真实挂载点为 `/usr/src/microsoft-rewards-script/config`、`/usr/src/microsoft-rewards-script/sessions`、`/usr/src/microsoft-rewards-script/diagnostics`、Dashboard `/data`。只备份当前结构；导入旧部署前要检查是否使用了不同路径和数据库格式。

## 首次部署

先确认服务器 `/opt/rewards-stack` 不存在，或是你确认的空目录。将本仓库源码放入该目录，不能直接覆盖已有部署。以下步骤在服务器执行，分段操作，不要一次粘贴全部命令。

```bash
cd /opt/rewards-stack
chmod +x scripts/*.sh docker/*.sh
sudo bash scripts/init.sh
```

如需改时区等设置，单独执行以下命令；初次只做无账号环境验收时，可以保留生成的默认配置，跳过编辑：

```bash
sudoedit .env
```

这是交互编辑步骤。默认编辑器若为 Vim，按 `i` 编辑，完成后按 `Esc`，输入 `:wq` 并回车保存退出。若误把后续 shell 命令粘进文件，按 `Esc`，输入 `:q!` 并回车，放弃本次未保存的改动。`.env` 只放配置，不能放 `sudo bash ...` 命令。不要截图或公开其 Token/密码。

**退出编辑器并看到 shell 提示符后**，再执行：

```bash
sudo bash scripts/deploy.sh
sudo bash scripts/healthcheck.sh
```

`init.sh` 用 OpenSSL 生成 256 bit API Token 和 192 bit Dashboard 密码；`.env` 权限 600、私密目录 700。它拒绝覆盖已有 `.env`，不递归修改现存数据权限、不删除现有文件。Dashboard 目录首次创建时归 UID/GID 1000 所有。

`preflight.sh` 检查 Docker、Compose、变量、时区、鉴权、调度隔离、数据目录、同名项目及旧 Rewards 容器和 8890 端口占用。现有部署只在目录匹配且明确传入 `--existing` 时继续。未检查过的服务器状态不会被视为无冲突。

`deploy.sh` 优先从固定 GHCR 基础镜像构建扩展镜像；失败后校验/获取固定源码并构建，不切换到随机版本。源码下载也失败则停止，保留现场。完成后等待健康状态并执行只读联调。日志不会输出 `.env` 或 Token。不要把 `docker compose config` 的完整输出贴到公开日志，它含解析后的凭据；使用 `config -q`。

## 配置与账号

| 配置 | 默认/作用 |
| --- | --- |
| `TZ` | Asia/Jakarta，改后重建两个服务，数据库历史日归属不会自动迁移 |
| `API_TOKEN` | 初始化生成，Script 与 Dashboard 同一个值 |
| `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` | 必填；扩展入口拒绝空值和短密码，用户名不能含冒号 |
| `API_ALLOW_CONFIG_WRITE` | false；人工明确设 true 后可从 Config 校验并修改 |
| `STACK_ALLOW_ACCOUNT_CREATE` | 新版默认 true；允许已登录管理员通过账号表单追加账号，任务运行期间拒绝保存 |
| `ACCOUNT_N_EMAIL` / `ACCOUNT_N_PASSWORD` | 沿用上游官方账号格式；密码可省略，序号可不连续 |
| `SCRIPT_BASE_IMAGE` / `DASHBOARD_BASE_IMAGE` | 固定 digest；更新前审查版本并备份 |
| `SCRIPT_STACK_VERSION` / `DASHBOARD_STACK_VERSION` | 两个服务各自的扩展镜像标签；更新时使用新标签并保留旧镜像便于回滚 |

Script 通过 `env_file: .env` 加载所有 `ACCOUNT_N_*`，不限两个账号；Dashboard 只收到其需要的凭据和服务变量。Script 入口还会移除加载进来的 Dashboard 登录凭据。原有环境变量账号继续保留。升级账号管理扩展后，可在中文“账号 → 添加账号”填写邮箱、可选密码、地区和语言；保存后立即进入列表，下次运行生效，不需要重建容器。

表单账号保存在 Script 的持久目录 `config/managed-accounts.json`（600），使用临时文件、fsync 和原子 rename 写入；备份脚本会连同 config 一起保存。Control API 启动时先加载已有环境变量，再校验并合并表单账号；发现邮箱或序号与手动配置冲突时拒绝启动，保留原数据等待处理。每个新账号使用稳定且不覆盖现有配置的序号。单账号运行、排除列表及任务子进程都使用合并后的账号环境。

新增接口为已鉴权的 `GET /accounts/management` 和 `POST /accounts/managed`，面板对应 `GET /api/account-management`、`POST /api/accounts`。网页写入要求同源 JSON 和专用请求头，凭据不返回给列表、不写入浏览器存储、不进入日志。重复邮箱、无效输入和运行中的任务会拒绝保存。账号管理独立于 `API_ALLOW_CONFIG_WRITE`，无需开启通用配置写入或环境覆盖，不向容器挂载 Docker Socket。

新增账号不等于已经登录。无密码或需要 MFA/CAPTCHA 的账号仍须人工完成微软验证并准备对应会话；不得覆盖原有会话数据库。网页保存不会自动登录、启动任务或开启计划。图形界面通过实际固定版本 API 和桌面/手机浏览器的隔离测试，未在生产环境创建测试账号。

密码含 `$`、`#` 等字符时用 Compose dotenv 单引号语法，如 `ACCOUNT_1_PASSWORD='...'`，不要用 shell `source .env`。只配置自己的或明确授权的账号；本部署不设置 TOTP 种子、代理池或额外设备伪装参数。非敏感默认值由上游生成 `config/config.json`；现有文件原样保留，不自动删除重建。

加入账号或修改 `.env` 后，在任务空闲时：

```bash
sudo bash scripts/preflight.sh --existing
sudo docker compose up -d --no-build script dashboard
sudo bash scripts/healthcheck.sh
```

初次环境验收保持账号项注释即可。健康检查不会启动浏览器或访问 Microsoft。运行任务需要你在登录准备完成后主动点击 Start 或启用计划。

## 首次人工登录与会话迁移

官方镜像只含无头浏览器 shell，不支持直接在云容器弹出登录窗口。用受信任、有图形桌面的本地电脑，安装 Node.js 24+，取同一固定 Script 源码：

```bash
git clone https://github.com/TheNetsky/Microsoft-Rewards-Script.git rewards-login
cd rewards-login
git checkout --detach d0f07d74a0ed4dda127855d6e3dde98bf4c89d6e
npm ci --ignore-scripts
npm run build
npx patchright install chromium
# 本地安全创建 .env（ACCOUNT_N_EMAIL 等），复制 config.example.json 为 config.json
npm run manual-login -- --email your-account@example.com --platform both
```

人工在官方登录窗口完成密码、MFA、CAPTCHA 或无密码确认；此命令不执行自动登录处理器和 Rewards 搜索。停留在 Rewards 页面后保存并关闭。真实登录须由使用者在私有环境自行完成。不要提供 TOTP 种子来自动完成 MFA，也不要反复触发登录测试。

会话存放 `sessions/sessions.db`，不应只复制零散 Cookie JSON。退出登录工具后再传输；若数据库仍由程序打开，必须使用 SQLite backup/VACUUM INTO 导出独立快照，不单独复制正在写入的 `.db`。使用 SSH/SCP 在可信机器间传输，避免聊天、网盘公开链接和 Git。

服务器操作需维护窗口：先在 Dashboard 关闭计划，确认任务空闲，运行备份，再 `docker compose stop`。若服务器尚无会话，可将本地会话数据库放入 `sessions/` 并设 600；若已有数据库，先保留整个旧目录，不能直接覆盖或合并数据库。可参照下面恢复流程建立新的会话目录并保留旧目录。启动后只查看 Accounts/会话元数据，再人工决定是否运行。

跨机器/IP 迁移不能保证微软接受该会话；出现重新验证提示时关闭计划、停止任务，由人工重新登录。上游浏览器本身包含 Patchright/指纹注入行为，本包没有增加规避风控功能；若你的使用条件禁止这些内建行为，请保持任务关闭，不能宣称本部署消除了它们。

## Dashboard 访问

在自己的电脑建立 SSH 隧道：

```bash
ssh -N -L 8890:127.0.0.1:8890 your-user@your-server
```

然后访问 `http://127.0.0.1:8890`，使用 `.env` 中 Dashboard 用户名和密码。该地址只有服务器部署且隧道建立后才可用。需要公网访问时请另行配置 HTTPS 反向代理。不要通过公网明文 HTTP 传输 Basic Auth。

## 唯一调度源

使用 Schedule 页 **This dashboard**，计划和最后结果存在 Dashboard SQLite 中。默认关闭；准备完成后设置每日 `0 9 * * *`，选择 `skipIfRunning=true`，错过任务策略 `skip`，再人工启用。09:00 按 `TZ` 计算。可以改用上游 `grace-period`，但 `run-on-startup` 可能在服务恢复后立即运行，不适合初次验证或会话异常期间。

源码确认：Script API 模式只有在 `CRON_SCHEDULE` 非空或有效 `SCHEDULE_FILE` 存在时才启动 cron。这里强制 cron 为空、`RUN_ON_START=false`、schedule 写权限 false，且 `SCHEDULE_FILE` 固定指向不存在的私有路径。即使挂载目录存在旧 `schedule.json` 也不能被加载；入口还拒绝未明确 `enabled:false` 的旧计划，保留文件等待迁移。因此 Script 不启动独立 cron。

不要在 Schedule 页选择 **Bot container**（只读），不要在 1Panel 建立 Rewards 执行 cron，不要横向扩容 Dashboard。Dashboard 的 `firing` 防重复回调、busy 判断和 API 409 防并发共同保护；服务重启从 SQLite 恢复计划，`lastResult` 标出错过、跳过或启动失败。它是单实例调度器，不保证跨故障的 exactly-once：极端宕机或人工点击仍可能在同一天产生不同的串行任务。

`lastResult=started` 仅表示启动成功，最终任务结果看 Runs、Accounts、错误日志。发生 CAPTCHA/MFA/会话失效或风控告警时，立即关闭计划并 Stop；没有自动无限重试机制。API 的 SSE 断线重连只重连监控，不重新登录。

## 功能与日志

Overview/Accounts 展示账号和已观测积分；Logs 用 SSE 显示近期日志；Runs 和积分历史由 SQLite 保存；Schedule 持久化并显示下次时间；Config 默认脱敏只读；Diagnostics 读取上游采集结果。初次没有真实账号数据时积分为空，不能当作零积分验证成功。

```bash
sudo docker compose ps
sudo docker compose logs --tail=200 script dashboard
sudo docker compose logs -f --tail=100 script
```

部署扩展在 API 缓冲/SSE/SQLite 入库前脱敏已知凭据和常见 password/token/cookie 文本，Docker 输出也脱敏。不要打开 debug 日志、配置 secret reveal 或任意 env override。日志脱敏不能自动消除任意第三方 HTML/截图中的敏感内容；`errorDiagnostics` 默认 false，启用后 `data/diagnostics` 及页面仅限可信管理员，并人工审查导出内容。

上游 Script 原始日志/进程退出历史在内存，Dashboard 实时 Logs 也有长度有限的缓存；完整原始日志不会永久保存在 SQLite。SQLite 持久化结构化活动、账号错误、运行和积分历史，活动约保留最近 5000 行；Docker 日志按每文件 10 MB、5 个轮转，重建容器后旧容器日志可能不可用。需要长期完整日志时，在维护前私下导出并审查脱敏，不应把缓存描述为永久全量审计。

## 健康、异常和监控

```bash
sudo bash scripts/healthcheck.sh
```

检查容器 running/healthy，真实 `/health`，匿名和错误 Token 拒绝，Dashboard 内部 DNS 到 `script:3010`，HTTP Basic Auth，七个视图接口、单调度源及持久化目录写权限。遇到 `health: starting` 会等待最多 120 秒，不把尚未完成的初次健康检查报成 unhealthy。只读检测，不触发任务。

进程崩溃后 `unless-stopped` 重启；Docker 不会仅因 unhealthy 自动重启，需先诊断，不要通过自动反复重启导致登录循环。可在 1Panel 计划任务每 5 分钟执行 `cd /opt/rewards-stack && bash scripts/healthcheck.sh`，把非零退出交由你已配置的通知渠道处理。此运维检查不运行 Rewards；PushPlus 通知由管理员另行配置和启用。

浏览器初始化保护从上游“Launching bundled patched Chromium”日志开始计时；180 秒内没有“Created context”时，通过 Control API 的进程管理器记录中文错误并停止整个任务进程组，不自动重试。正常创建上下文、手动停止、任务退出都会取消计时，旧任务的计时回调不会影响新任务。它保护资源和明确报告初始化失败，不会修改浏览器身份、绕过登录验证或修复上游导航问题。

- API unreachable：检查 Script 健康、网络及 URL，不能把 Dashboard 的 localhost 当成 Script。
- 401：核对两服务 Token，重建环境；不要把值贴到日志。
- 权限错误：核对 UID 1000、目录 700，已有数据先备份再手动改权限；不要 chmod 777。
- 数据库异常：停止维护操作，保留 `.sqlite/.db` 和 WAL/SHM，收集私密诊断；不要删除数据库来让健康检查通过。
- 登录验证/会话过期：关闭计划、停止运行、人工处理。不要删除全部会话、无限重试或绕过验证。
- Config 403：默认行为；确需修改时在 `.env` 明确打开 config write，重建后由上游验证器检查。`CONFIG_*` 环境值会覆盖 JSON，某些安全字段在此部署被强制关闭。
- 开机不启动：确认宿主机 Docker 由系统开机启动；人为 `docker compose stop` 后需手动 `up -d`，Docker 的 unless-stopped 尊重停止状态。

## 备份、恢复与回滚

```bash
sudo bash scripts/backup.sh
sudo bash scripts/restore.sh /opt/rewards-stack/backups/snapshot-....tar.gz
sudo bash scripts/restore.sh /opt/rewards-stack/backups/snapshot-....tar.gz --extract
```

备份包含 config、sessions、Dashboard 数据和 `.env`（含凭据），计划在 Dashboard SQLite 中。`snapshot.mjs` 用只读连接 `VACUUM INTO` 在线生成每个 SQLite 的独立一致性快照，运行 `quick_check`，不复制活动 WAL/SHM。其余文件私密复制，输出 tar.gz 和 SHA256；使用锁避免并发备份。不同数据库之间不是同一事务，备份期间有配置/会话变动时，应在维护窗口关闭计划、确认空闲后重做。暂存快照保留，不自动删除旧备份；需自行安排保留周期、容量监测和加密离线备份。

恢复脚本默认只检查 checksum、归档路径和 manifest；`--extract` 仅解到新建的 `backups/restore-review-*` 私密目录并验证 SQLite，永不停止服务或覆盖线上文件。拒绝路径穿越、软链接和特殊文件。实际恢复需你安排服务中断并按以下顺序操作：

1. 在 Web 关闭计划、确认任务空闲，备份当前状态；校验并解出待恢复快照。
2. `sudo docker compose stop`，保留 `.env` 和整个当前目录（包含 WAL/SHM），不混合新旧数据库附属文件。
3. 在已停止状态将旧 `config`、`sessions`、`data/dashboard` 移至一个**新建**的回滚目录；从检查后的快照建立新的同名目录。保留原文件，不执行 rm。命令中的时间戳/恢复路径必须替换为真实值：

```bash
stamp=$(date -u +%Y%m%dT%H%M%SZ)
rollback="backups/rollback-$stamp"
sudo mkdir -m 700 "$rollback"
sudo cp -p .env "$rollback/.env"
sudo mv config "$rollback/config"
sudo mv sessions "$rollback/sessions"
sudo mv data/dashboard "$rollback/dashboard"
# snap 指向 restore.sh --extract 输出的 snapshot 根目录，不是 tar.gz
snap=/opt/rewards-stack/backups/restore-review-REPLACE/snapshot-REPLACE
sudo cp -a "$snap/config" ./config
sudo cp -a "$snap/sessions" ./sessions
sudo cp -a "$snap/data/dashboard" ./data/dashboard
sudo chown -R 1000:1000 data/dashboard
sudo chmod 700 config sessions data/dashboard
```

4. 可选择恢复 `.env`，但先核对 Token、TZ 和镜像标签，保留当前副本。恢复已有计划的数据库时，在服务仍停止的状态运行下面代码关闭计划，避免恢复后立刻执行：

```bash
sudo python3 - <<'PY'
import sqlite3,json
c=sqlite3.connect('data/dashboard/dashboard.sqlite')
r=c.execute("SELECT value FROM meta WHERE key='schedule'").fetchone()
if r:
    s=json.loads(r[0]);s.update(enabled=False,nextRunAt=None,misfirePolicy='skip')
    c.execute("UPDATE meta SET value=? WHERE key='schedule'",(json.dumps(s),))
    c.commit()
c.close()
PY
sudo chown -R 1000:1000 data/dashboard
sudo chmod 600 .env
sudo bash scripts/preflight.sh --existing
sudo docker compose up -d --no-build script dashboard
sudo bash scripts/healthcheck.sh
```

5. 人工确认历史、会话元数据及日计划，再决定恢复运行。若失败，停止两个服务，把恢复后的目录也移到新位置，移回上述回滚目录的原文件；恢复 `.env`/旧镜像并验证。不要在任何服务运行时交换数据库文件。

## 更新

先关闭计划、确认任务空闲，备份，私密保留当前 Compose/.env 和本地镜像标签。人工审查新版本的 API/目录/配置兼容性，把 `.env` 中基础镜像改为验证后的 digest，`SCRIPT_STACK_VERSION` 和 `DASHBOARD_STACK_VERSION` 改成新标签，再：

```bash
sudo bash scripts/deploy.sh --existing
```

当前 `fetch-upstream.sh` 固定源码；当前中文覆盖和发布镜像补丁不保证接受该源码构建，哈希不匹配时会停止。升级源码需同时审查版本锁、补丁和测试，不能用浮动 main 自动更新。若新镜像启动失败，恢复旧基础 digest 及两个服务的扩展镜像标签，再 `docker compose up -d --no-build`；数据库有迁移时需恢复升级前快照，不能假定旧服务能读新 schema。保留旧镜像，不执行全局 prune。

## 1Panel 集成与 HTTPS

先查看 1Panel 的容器/Compose 项目，确认没有同名部署。采用默认项目名 `rewards-stack`，不设固定 container_name、不接管现有 Docker 网络。在支持导入现有 Compose 的 1Panel 版本中选择 `/opt/rewards-stack/compose.yaml` 和同目录 `.env`，复用该项目；不要同时创建第二个不同项目的副本。若界面会将文件复制到其他路径，应停止导入，先在本机目录用 CLI 管理，避免挂载到空数据目录。

可在 1Panel 容器页面查看两个服务日志、启停/重启；重建必须保持项目名、工作目录和挂载路径。Dashboard 卷需 UID 1000，不能由界面重新创建另一套空卷。

没有域名时保持 SSH 隧道。后续自行创建独立站点、TLS 证书，反向代理**仅**指向 Dashboard 8890；不转发 Script 3010。保留 Basic Auth，SSE 路径 `/api/events` 关闭缓冲并增大读取超时，转发 Host/X-Forwarded-Proto，支持长连接；可限制可信来源并避免访问日志记录 Authorization/query token。

如果 1Panel/OpenResty 本身在容器网络中，那里 `127.0.0.1` 指向 OpenResty 容器，并不能自动访问宿主机的 loopback 8890。先核对实际网络模式；可由你授权把代理连接到本项目网络并转发 `dashboard:8890`，或按 1Panel 支持的本机代理方案配置。需要改网络/站点时再人工操作，不能为方便将端口改成 `0.0.0.0` 或关闭鉴权。本任务未改防火墙、1Panel 站点或现有代理配置。

## 常用运维命令

均在 `/opt/rewards-stack`：

```bash
sudo docker compose config -q
sudo docker compose up -d --no-build script dashboard
sudo docker compose stop
sudo docker compose restart script dashboard
sudo docker compose logs -f --tail=100 script dashboard
sudo bash scripts/healthcheck.sh
sudo bash scripts/backup.sh
sudo bash scripts/restore.sh /absolute/path/snapshot-....tar.gz
sudo bash scripts/deploy.sh --existing
```

服务停止/重启会中断当前任务，维护前通过面板先关闭计划并确认空闲。不使用 `down -v`，不删除会话/数据库。

## 限制与人工验收

Docker、Linux 实际挂载权限、开机启动、1Panel 管理和容器重新创建仍需服务器验收。真实账号登录、MFA、积分是否被微软认可、会话跨主机可用性都需人工验证。第三方代码正常退出或面板积分显示并不代表微软保证奖励有效；自动化搜索可能不计积分，并可能触发限制或账号停用。不要绕过 CAPTCHA、MFA、风控或反作弊警告。

本地开发、固定镜像提取及各项模拟测试步骤见 [docs/TESTING.md](TESTING.md)。测试不使用真实账号执行 Rewards 搜索。
