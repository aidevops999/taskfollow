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

首次启动会自动创建默认账号，并在终端打印二次验证密钥和当前动态码：

```text
账号：admin
密码：admin123
```

## 功能

- 用户注册，最多 10 个用户
- 密码登录 + Google Authenticator 6 位动态验证码二次验证
- 注册或重置二次验证后，页面内置显示 Google Authenticator 扫描二维码
- 忘记或丢失二次验证时，可用用户名 + 密码重置 Google 验证器密钥
- 每个用户登录后只看到分配给自己的任务
- 任务分为本周任务和本月任务
- 创建任务时填写负责人、跟进人和计划完成时间
- 支持指派任务、标记进行中、完成、删除
- 任务创建后的标题、类型、负责人、截止时间和原始说明固定，不在执行阶段随意修改
- 执行阶段可以更新状态、执行备注、问题说明、延期原因和计划完成时间
- 自动识别延期任务，并展示延期原因
- 延期和本周、本月同级展示，可直接筛选延期任务
- 展示本月任务到期、完成、延期和完成率
- SQLite 本地持久化

## API

- `GET /api/me`：查看当前登录用户
- `POST /api/register`：注册用户并生成二次验证密钥
- `POST /api/login`：登录
- `POST /api/reset-otp`：用用户名和密码重置 Google Authenticator 密钥
- `GET /api/otp-qr?username=...&secret=...`：生成 Google Authenticator 二维码 PNG
- `POST /api/logout`：退出
- `GET /api/bootstrap`：获取当前用户、用户列表、我的任务、统计
- `GET /api/tasks?type=all&status=all`：获取我的任务
- `POST /api/tasks`：新建任务
- `PATCH /api/tasks/<id>`：更新任务
- `DELETE /api/tasks/<id>`：删除任务
