# 许可证与第三方来源

本仓库是两个独立开源项目的部署集成及功能扩展，未获 Microsoft 或上游维护者的官方背书。仓库名称、面板文字和说明中的第三方名称仅用于说明兼容性及来源。

## 本项目新增内容

除另有注明的第三方文件、衍生文件和许可证文本外，本项目新增的部署脚本、补丁工具、扩展模块、翻译及测试采用 GNU General Public License version 3.0，全文见根目录 [LICENSE](LICENSE)。这不移除或更改第三方原有许可及版权通知，也不宣称拥有上游代码版权。

本次发布没有替原作者补写姓名或邮箱。后续贡献者可在其贡献中保留自己的版权通知；Git 提交作者身份应由维护者自行确认。

## Microsoft Rewards Script

- 来源：[TheNetsky/Microsoft-Rewards-Script](https://github.com/TheNetsky/Microsoft-Rewards-Script)。
- 本地锁定源码：`d0f07d74a0ed4dda127855d6e3dde98bf4c89d6e`；发布镜像基线为 4.3.2，二者不是同一次构建。
- 许可证：GNU GPL v3.0。根目录 `LICENSE` 保留了本地上游快照中的 GPLv3 全文。
- 相关文件：`docker/install-account-ui.mjs`、`docker/install-web-login.mjs`、`docker/install-rewards-reliability.mjs` 中针对 Script 的构建变更、嵌入的代码片段，以及配套运行扩展。
- `upstream/script/` 是私有构建缓存，未随本仓库纳入版本管理；部署时使用的镜像、源码及其依赖仍受各自许可证约束。

分发修改后的 Script 源码或镜像时，应保留原版权和许可证，并按 GPLv3 要求提供相应版本的完整对应源码及构建所需内容。仅附上一个可能变化的上游链接，不能据此保证已完成镜像的源码交付；本仓库当前提供的是集成源码，并非完整镜像源码发行包。

## Rewards Dashboard

- 来源：[mgrimace/rewards-dashboard](https://github.com/mgrimace/rewards-dashboard)。
- 本地锁定源码：`4a81f9f3bd2aacce59b9cda6377562721760d854`；前端衍生文件以固定 v1.3.9 发布镜像为基准。
- 许可证：MIT，原文及上游 `Copyright (c) 2026` 通知保留于 [LICENSES/rewards-dashboard-MIT.txt](LICENSES/rewards-dashboard-MIT.txt)。
- `dashboard-zh-CN/public/` 下来自上游的前端文件、`dashboard-zh-CN/lib/cron.js` 及其翻译改动保留 MIT 许可。`localization/zh-CN/overrides.mjs` 和安装脚本包含针对上游代码的变更及上下文，须同时保留此来源说明。
- 独立新增的账号表单、登录输入、PushPlus 等模块采用本项目新增代码的 GPLv3；目录中的 MIT 文件不会因同目录存在 GPLv3 模块而失去其 MIT 许可。
- 中文翻译、界面行为及集成扩展是本项目的修改，不应当作上游原生功能。

## 开发依赖

以下清单来自本仓库 `package-lock.json` 中记录的许可字段，未将依赖包源码打包进仓库。实际安装包的许可证及通知以对应固定版本包内文件为准。

| 包 | 固定版本 | 记录的许可证 |
| --- | --- | --- |
| @playwright/test | 1.64.1 | Apache-2.0 |
| playwright | 1.64.1 | Apache-2.0 |
| playwright-core | 1.64.1 | Apache-2.0 |
| acorn | 8.19.0 | MIT |
| acorn-walk | 8.3.5 | MIT |
| parse5 | 8.0.1 | MIT |
| entities | 8.1.0 | BSD-2-Clause |
| yaml | 2.9.1 | ISC |

Docker 基础系统、Node.js、浏览器、Script 依赖以及镜像中其他软件不在此表范围内。分发镜像、浏览器或依赖本体时需要保留对应组件的许可证及通知，不能将整套镜像简单标为只有一个许可证。

许可依据：[GNU GPLv3 全文](https://www.gnu.org/licenses/gpl-3.0.html)及上述仓库保留的 MIT 许可文本。
