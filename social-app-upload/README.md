# 🌈 多彩圈 —— 社交平台

一个功能完整的社交平台 Demo：活泼多彩风格、响应式布局。

## 技术栈

- **前端**：原生 HTML + CSS + JavaScript（单页应用，无框架）
- **后端**：Node.js（内置 `node:http` 或 Express）+ SQLite（Node 内置 `node:sqlite`）

## 功能

- ✅ 注册 / 登录 / 退出（密码加密存储）
- ✅ 动态发布（文字 + 图片，图片前端自动压缩）
- ✅ 信息流展示
- ✅ 评论 / 回复（支持楼中楼）
- ✅ 点赞 / 取消点赞
- ✅ 好友：搜索用户、发送请求、接受请求
- ✅ 私聊：会话列表、未读提醒、实时轮询
- ✅ 个人主页（Ins 风）：封面背景图（可上传/移除）、个性签名、头像叠加封面、动态/好友统计、动态九宫格
- ✅ 资料编辑：昵称、头像、个性签名、主题色、封面图
- ✅ 响应式：手机端底部导航栏

## 目录结构

```
social-app/
├── server/
│   ├── index.js       # 服务入口 + 全部 API 路由
│   ├── database.js    # SQLite 建表（node:sqlite）
│   └── package.json
└── public/
    ├── index.html
    ├── css/style.css
    └── js/app.js
```

## 运行

```bash
cd server
npm install      # 或 pnpm install；网络慢时可用国内镜像：--registry https://registry.npmmirror.com
npm start        # 启动服务（默认端口 3000）
```

打开浏览器访问 <http://localhost:3000>，注册账号即可体验。

## 演示账号

内置了 3 个演示账号（密码均为 `123456`），登录即可看到现成的动态、评论、好友和聊天记录：

| 用户名 | 昵称 |
| --- | --- |
| xiaomei | 小美 🌸 |
| azhe | 阿哲 🎸 |
| xiaoshuai | 小帅 ⚽ |

> 演示数据由 `npm run seed`（`node seed.js`）创建，可重复执行；删除 `server/social.db` 后再运行 `seed.js` 可重置整个数据库。

## API 一览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | /api/register | 注册 |
| POST | /api/login | 登录 |
| POST | /api/logout | 退出 |
| GET | /api/me | 当前用户 |
| GET/PUT | /api/me | 获取/更新资料 |
| GET | /api/users?q= | 搜索用户 |
| GET | /api/users/:id | 用户详情（含动态数/好友数统计） |
| GET | /api/users/:id/posts | 某用户的动态列表 |
| GET/POST | /api/posts | 动态列表 / 发布动态 |
| GET/POST | /api/posts/:id/comments | 评论列表 / 发评论 |
| POST | /api/posts/:id/like | 点赞/取消 |
| GET | /api/friends | 好友 + 请求列表 |
| POST | /api/friends/request | 发送好友请求 |
| POST | /api/friends/accept | 接受好友请求 |
| GET | /api/conversations | 会话列表 |
| GET/POST | /api/messages/:otherId | 聊天记录 / 发消息 |
