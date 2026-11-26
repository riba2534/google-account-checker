# google-account-checker

Cloudflare Worker 上的站内账号与任务后台。用户可以管理自己的账号，并查看已有任务和记录状态。管理员可以查看全站统计和任务概览，以及封禁或解封用户。封禁会立即撤销该用户的站内会话。

## 本地运行

需要 Node.js 24 或更高版本。启动前先对本地 D1 应用迁移。

```sh
npm ci
npm run db:migrate:local
npm run dev
```

打开 Wrangler 输出的本地地址。新数据库中的任务列表和统计从空状态开始。

默认开放普通用户注册。如需注册管理员，将 `.dev.vars.example` 复制为已被 Git 忽略的 `.dev.vars`，然后设置以下三个值。

- `ADMIN_USERNAMES` 是逗号分隔的预留管理员用户名。
- `INVITE_CODE` 是发给普通用户的注册邀请码。
- `ADMIN_BOOTSTRAP_CODE` 是管理员注册时填写的单独邀请码。它必须与普通邀请码不同。

先用预留用户名和管理员邀请码注册。角色在注册时写入 D1。

## 验证

```sh
npm run check
```

测试在本地 Workers 测试运行时执行。仓库中保留了已有的队列脚手架，当前可运行的页面只读取已有任务和记录。
