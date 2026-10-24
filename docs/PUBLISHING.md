# 公开内容检查与源码打包

仓库只收录经过检查的源码、测试、示例配置和通用说明。原始工作目录还可能留有真实部署材料；不要直接压缩整个目录，也不要使用 `git add -f` 绕过忽略规则。

## 不公开的内容

- `.env`、真实账号配置、密码、Token、Cookie、浏览器资料、SSH 密钥和会话状态。
- SQLite 数据库及 WAL/SHM、私有备份、诊断日志、抓包文件和截图。
- `reports/`、`.test-work/`、`upstream/`、旧交付目录及根目录历史安装包、安装器和校验文件。
- `SERVER_VALIDATION.md`、`TEST_RESULTS.md` 原始验收材料，以及绑定特定 NAS、临时 SSH 授权或传输地址的历史运维工具。
- 尚未审查的新根目录文件。根目录采用允许列表；新增公开文件需要同时更新 `.gitignore` 和 `scripts/publication-policy.mjs`。

这些文件保留在维护者本机，忽略规则不会删除、脱敏或加密它们。不要将其上传到 Release、Issue 或第三方网盘。

## 每次提交前

```bash
git add .
npm run audit:public
git diff --cached --check
git diff --cached --stat
git diff --cached
```

检查程序读取 **Git 暂存区中的实际 blob**，拒绝禁止路径、二进制文件、软链接、私钥、常见凭据格式、非示例邮箱、非回环 IPv4、个人主目录和 SSH 公钥，并对凭据赋值及可疑高熵字面量给出定位。输出只包含文件、行号和规则名称，不回显命中的内容。

测试中的固定假凭据仅限 `tests/`，使用 `example.invalid` 等保留示例域名；程序不会把任意放在测试目录里的真实邮箱、私钥或供应商 Token 当成安全内容。人工检查不能被正则扫描替代；任何疑似真实凭据都应先从源码中移除，并在泄露时撤销。

每次提交前用 `git var GIT_AUTHOR_IDENT` 和 `git var GIT_COMMITTER_IDENT` 检查最终使用的姓名与邮箱。使用 GitHub 隐私邮箱时，应从自己的 GitHub 设置复制，或依据已核实的账户 ID、用户名及 [GitHub 官方格式](https://docs.github.com/en/account-and-profile/reference/email-addresses-reference#your-noreply-email-address) 确定，不要编造身份。只为当前仓库设置邮箱可使用 `git config --local user.email`，不会改变其他仓库。创建本地提交不会上传，推送需要另外执行。

## 创建源码归档

```bash
npm run package:public -- rewards-stack-source
```

或在 PowerShell 中使用 `./scripts/package.ps1 -Name rewards-stack-source`。名称只能包含字母、数字、连字符或下划线。

打包前会重新检查暂存区，并要求已纳入 Git 的工作文件与暂存内容一致。归档仅从经过检查的 Git tree 创建，不遍历整个磁盘目录，也不包含 `.git` 或忽略文件。ZIP 与 SHA256 写入忽略的 `dist/` 目录，已有同名产物会被保留并拒绝覆盖。

归档包含完整的公开源码及许可证，不是旧版本热更新包。发布归档前应解压到独立目录复核内容，并按 [测试说明](TESTING.md) 验证。不要继续使用本地旧版打包器：它们依赖历史交付目录，部分会收集原始报告或机器专用脚本，已从本仓库排除。

## 发布状态

本仓库初始化不代表已经公开。只有维护者后续明确执行配置远程仓库、提交和推送等操作后，内容才会上传；本地 Git 审核报告不包含凭据、主机信息或历史运行数据。
