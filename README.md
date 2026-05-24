# 小团队任务 SOP 系统

这是一个纯 Python 标准库实现的小团队任务系统，适合 10 人以内使用。

- 后端：`app.py`，使用 `http.server` 提供页面和 JSON API
- 前端：`templates/index.html` + `static/app.js` + `static/styles.css`
- 数据库：`data/sop.db`，使用 SQLite 自动创建
- 登录：用户名 + 密码 + Google Authenticator 兼容的 6 位 TOTP 动态验证码

## 启动

```bash
python3 app.py
```

如果 8000 端口被占用，可以指定端口：

```bash
python3 app.py 8001
```

如果系统 Python 被 Xcode 工具链拦住，可以使用 Codex 内置 Python：

```bash
/Users/k/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 app.py
```

浏览器打开：

```text
http://127.0.0.1:8000
```

首次启动会自动创建默认账号：

```text
账号：admin
密码：Admin2026
```

如果设置了环境变量 `SOP_ADMIN_PASSWORD`，首次创建管理员时会使用该环境变量作为默认密码。注意：默认密码只在数据库为空时生效；如果 `data/sop.db` 已经存在，更新代码不会覆盖已有账号密码。忘记 Google Authenticator 时，可以在登录页用“重置 Google 验证器”重新生成二维码。

## 功能

- 用户注册，最多 10 个用户
- 密码登录 + Google Authenticator 6 位动态验证码二次验证
- 注册或重置二次验证后，页面内置显示 Google Authenticator 扫描二维码
- 忘记或丢失二次验证时，可用用户名 + 密码重置 Google 验证器密钥
- 每个用户登录后只看到分配给自己的任务
- 任务分为本周任务、本月任务和年度任务
- 创建任务时填写负责人、跟进人和计划完成时间
- 支持指派任务、标记进行中、完成、删除
- 任务创建后的标题、类型、负责人、截止时间和原始说明固定，不在执行阶段随意修改
- 执行阶段可以更新状态、执行备注、问题说明、延期原因和计划完成时间
- 自动识别延期任务，并展示延期原因
- 延期和本周、本月同级展示，可直接筛选延期任务
- 展示本月任务到期、完成、延期和完成率
- 支持按优先级筛选任务，并支持顺延下周、顺延下月和自定义顺延
- 管理员可以停用/删除用户，用户不能再登录，但历史任务仍保留
- SQLite 本地持久化

## API

- `GET /api/me`：查看当前登录用户
- `POST /api/register`：注册用户并生成二次验证密钥
- `POST /api/login`：登录
- `POST /api/reset-otp`：用用户名和密码重置 Google Authenticator 密钥
- `GET /api/otp-qr?username=...&secret=...`：生成 Google Authenticator 二维码
- `POST /api/logout`：退出
- `GET /api/bootstrap`：获取当前用户、用户列表、我的任务、统计
- `GET /api/tasks?type=all&status=all`：获取我的任务
- `POST /api/tasks`：新建任务
- `PATCH /api/tasks/<id>`：更新任务
- `DELETE /api/tasks/<id>`：删除任务
- `POST /api/users/role`：管理员修改用户权限
- `POST /api/users/delete`：管理员停用/删除用户，保留历史任务

## 服务器脚本

服务器上统一使用一个入口脚本：

```bash
./scripts/taskfollow.sh help
```

常用命令：

```bash
./scripts/taskfollow.sh update
./scripts/taskfollow.sh restart
./scripts/taskfollow.sh backup
./scripts/taskfollow.sh install-backup-timer
./scripts/taskfollow.sh status
```

`update` 会先备份 `data/sop.db`，再询问是否拉取 GitHub 最新代码，最后询问是否重启 systemd 服务。数据库和备份都放在 `data/` 目录下，不会被 Git 覆盖。

## 数据库备份

立即备份一次：

```bash
./scripts/taskfollow.sh backup
```

备份文件保存到：

```text
data/backups/sop-年月日-时分秒.db
```

安装每周自动备份，并只保留最近 7 天内的备份：

```bash
./scripts/taskfollow.sh install-backup-timer
```

如果之前安装过旧版备份定时器，拉取这次更新后也执行一次上面的命令，它会把 systemd 定时器更新为新的统一脚本入口。

默认备份时间是每周日 03:30。如果要改备份时间或保留天数，可以这样安装：

```bash
RUN_CALENDAR="Mon *-*-* 02:00:00" RETENTION_DAYS=7 ./scripts/taskfollow.sh install-backup-timer
```
