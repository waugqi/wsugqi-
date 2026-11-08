// index.js —— Express 服务入口，含全部路由
const path = require('path');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
// 部署在云平台时通常位于反向代理之后，需信任代理头
app.set('trust proxy', 1);
app.use(session({
  secret: process.env.SESSION_SECRET || 'social-app-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

// 静态资源：前端页面
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- 辅助函数 ----------
function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: '未登录' });
  }
  next();
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    username: u.username,
    nickname: u.nickname,
    avatar: u.avatar,
    bio: u.bio,
    cover: u.cover || '',
    color: u.color,
    created_at: u.created_at
  };
}

// ---------- 认证 ----------
app.post('/api/register', (req, res) => {
  const { username, password, nickname } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (username.length < 3 || password.length < 6) {
    return res.status(400).json({ error: '用户名至少3位，密码至少6位' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) {
    return res.status(409).json({ error: '用户名已被占用' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const colors = ['#7c5cff', '#ff5c8a', '#ff9f1c', '#2ec4b6', '#3a86ff', '#e5383b'];
  const color = colors[Math.floor(Math.random() * colors.length)];
  const info = db.prepare(
    'INSERT INTO users (username, password, nickname, color) VALUES (?, ?, ?, ?)'
  ).run(username, hash, nickname || username, color);

  req.session.userId = info.lastInsertRowid;
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid);
  res.json({ user: publicUser(user) });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  req.session.userId = user.id;
  res.json({ user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  res.json({ user: publicUser(user) });
});

// ---------- 用户资料 ----------
app.get('/api/users', requireAuth, (req, res) => {
  const q = (req.query.q || '').trim();
  let rows;
  if (q) {
    rows = db.prepare(
      'SELECT * FROM users WHERE username LIKE ? OR nickname LIKE ? ORDER BY id LIMIT 50'
    ).all(`%${q}%`, `%${q}%`);
  } else {
    rows = db.prepare('SELECT * FROM users ORDER BY id LIMIT 50').all();
  }
  res.json({ users: rows.map(publicUser) });
});

app.get('/api/users/:id', requireAuth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  const postCount = db.prepare('SELECT COUNT(*) AS n FROM posts WHERE author_id = ?').get(user.id).n;
  const friendCount = db.prepare(
    'SELECT COUNT(*) AS n FROM friendships WHERE status = ? AND (user_id = ? OR friend_id = ?)'
  ).get('accepted', user.id, user.id).n;
  res.json({ user: { ...publicUser(user), post_count: postCount, friend_count: friendCount } });
});

// 某用户的动态列表（含点赞/评论统计）
app.get('/api/users/:id/posts', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: '用户不存在' });
  res.json({ posts: fetchPosts(req.session.userId, 'WHERE p.author_id = ?', [user.id]) });
});

app.put('/api/me', requireAuth, (req, res) => {
  const { nickname, avatar, bio, color, cover } = req.body || {};
  const cur = db.prepare('SELECT * FROM users WHERE id = ?').get(req.session.userId);
  const nextNick = nickname !== undefined ? String(nickname).slice(0, 30) : cur.nickname;
  const nextAvatar = avatar !== undefined ? String(avatar).slice(0, 500) : cur.avatar;
  const nextBio = bio !== undefined ? String(bio).slice(0, 200) : cur.bio;
  const nextColor = color !== undefined ? String(color).slice(0, 20) : cur.color;
  const nextCover = cover !== undefined ? String(cover).slice(0, 1000000) : cur.cover;
  db.prepare('UPDATE users SET nickname=?, avatar=?, bio=?, color=?, cover=? WHERE id=?')
    .run(nextNick, nextAvatar, nextBio, nextColor, nextCover, cur.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(cur.id);
  res.json({ user: publicUser(user) });
});

// ---------- 动态 ----------
function fetchPosts(viewerId, extraWhere = '', extraParams = []) {
  const rows = db.prepare(`
    SELECT p.*, u.nickname, u.avatar, u.color, u.username, u.cover,
      (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
      (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
      EXISTS(SELECT 1 FROM likes l2 WHERE l2.post_id = p.id AND l2.user_id = ?) AS liked
    FROM posts p JOIN users u ON u.id = p.author_id
    ${extraWhere}
    ORDER BY p.id DESC LIMIT 100
  `).all(viewerId, ...extraParams);

  return rows.map(p => ({
    id: p.id,
    content: p.content,
    image: p.image,
    created_at: p.created_at,
    like_count: p.like_count,
    comment_count: p.comment_count,
    liked: !!p.liked,
    author: { id: p.author_id, nickname: p.nickname, avatar: p.avatar, color: p.color, username: p.username, cover: p.cover }
  }));
}

app.get('/api/posts', requireAuth, (req, res) => {
  res.json({ posts: fetchPosts(req.session.userId) });
});

app.post('/api/posts', requireAuth, (req, res) => {
  const content = (req.body?.content || '').trim();
  const image = (req.body?.image || '').slice(0, 1000000);
  if (!content && !image) return res.status(400).json({ error: '内容不能为空' });
  const info = db.prepare('INSERT INTO posts (author_id, content, image) VALUES (?, ?, ?)')
    .run(req.session.userId, content.slice(0, 2000), image);
  res.json({ id: info.lastInsertRowid });
});

// ---------- 评论 ----------
app.get('/api/posts/:id/comments', requireAuth, (req, res) => {
  const comments = db.prepare(`
    SELECT c.*, u.nickname, u.avatar, u.color, u.username
    FROM comments c JOIN users u ON u.id = c.author_id
    WHERE c.post_id = ? ORDER BY c.id ASC
  `).all(req.params.id);
  res.json({ comments: comments.map(c => ({
    id: c.id,
    post_id: c.post_id,
    content: c.content,
    parent_id: c.parent_id,
    created_at: c.created_at,
    author: { id: c.author_id, nickname: c.nickname, avatar: c.avatar, color: c.color, username: c.username }
  })) });
});

app.post('/api/posts/:id/comments', requireAuth, (req, res) => {
  const content = (req.body?.content || '').trim();
  if (!content) return res.status(400).json({ error: '评论内容不能为空' });
  const parent_id = req.body?.parent_id || null;
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '动态不存在' });
  const info = db.prepare('INSERT INTO comments (post_id, author_id, content, parent_id) VALUES (?, ?, ?, ?)')
    .run(req.params.id, req.session.userId, content.slice(0, 1000), parent_id);
  const c = db.prepare('SELECT * FROM comments WHERE id = ?').get(info.lastInsertRowid);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(c.author_id);
  res.json({ comment: { id: c.id, post_id: c.post_id, content: c.content, parent_id: c.parent_id, created_at: c.created_at, author: publicUser(u) } });
});

// ---------- 点赞 ----------
app.post('/api/posts/:id/like', requireAuth, (req, res) => {
  const liked = req.body?.liked !== false; // 默认点赞，传 liked=false 表示取消
  const post = db.prepare('SELECT id FROM posts WHERE id = ?').get(req.params.id);
  if (!post) return res.status(404).json({ error: '动态不存在' });
  if (liked) {
    db.prepare('INSERT OR IGNORE INTO likes (post_id, user_id) VALUES (?, ?)').run(req.params.id, req.session.userId);
  } else {
    db.prepare('DELETE FROM likes WHERE post_id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  }
  const count = db.prepare('SELECT COUNT(*) AS n FROM likes WHERE post_id = ?').get(req.params.id).n;
  res.json({ liked, like_count: count });
});

// ---------- 好友 ----------
app.get('/api/friends', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const rows = db.prepare(`
    SELECT f.id, f.status,
      CASE WHEN f.user_id = ? THEN f.friend_id ELSE f.user_id END AS other_id,
      CASE WHEN f.user_id = ? THEN 'outgoing' ELSE 'incoming' END AS direction
    FROM friendships f
    WHERE (f.user_id = ? OR f.friend_id = ?)
  `).all(uid, uid, uid, uid);

  const friends = [];
  const requests = [];
  for (const r of rows) {
    const other = db.prepare('SELECT * FROM users WHERE id = ?').get(r.other_id);
    const entry = {
      friendship_id: r.id,
      direction: r.direction,
      user: publicUser(other)
    };
    if (r.status === 'accepted') friends.push(entry);
    else if (r.status === 'pending') requests.push(entry);
  }
  res.json({ friends, requests });
});

// 发送好友请求
app.post('/api/friends/request', requireAuth, (req, res) => {
  const targetId = Number(req.body?.userId);
  if (!targetId || targetId === req.session.userId) {
    return res.status(400).json({ error: '无效的目标用户' });
  }
  const target = db.prepare('SELECT id FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: '用户不存在' });

  // 检查是否已存在关系（任一方向）
  const existing = db.prepare(`
    SELECT * FROM friendships WHERE
      (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)
  `).get(req.session.userId, targetId, targetId, req.session.userId);
  if (existing) {
    return res.status(409).json({ error: '你们之间已经有好友关系或请求了' });
  }
  db.prepare('INSERT INTO friendships (user_id, friend_id, status) VALUES (?, ?, ?)')
    .run(req.session.userId, targetId, 'pending');
  res.json({ ok: true });
});

// 接受好友请求
app.post('/api/friends/accept', requireAuth, (req, res) => {
  const fid = Number(req.body?.friendshipId);
  const f = db.prepare('SELECT * FROM friendships WHERE id = ?').get(fid);
  if (!f || f.friend_id !== req.session.userId) {
    return res.status(404).json({ error: '请求不存在' });
  }
  db.prepare('UPDATE friendships SET status = ? WHERE id = ?').run('accepted', fid);
  res.json({ ok: true });
});

// ---------- 私聊 ----------
app.get('/api/messages/:otherId', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const otherId = Number(req.params.otherId);
  const rows = db.prepare(`
    SELECT * FROM messages
    WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
    ORDER BY id ASC LIMIT 500
  `).all(uid, otherId, otherId, uid);
  // 标记对方发给我的消息为已读
  db.prepare('UPDATE messages SET read = 1 WHERE sender_id = ? AND receiver_id = ? AND read = 0')
    .run(otherId, uid);
  res.json({ messages: rows });
});

app.post('/api/messages/:otherId', requireAuth, (req, res) => {
  const otherId = Number(req.params.otherId);
  const content = (req.body?.content || '').trim();
  if (!content) return res.status(400).json({ error: '消息不能为空' });
  const other = db.prepare('SELECT id FROM users WHERE id = ?').get(otherId);
  if (!other) return res.status(404).json({ error: '用户不存在' });
  const info = db.prepare('INSERT INTO messages (sender_id, receiver_id, content) VALUES (?, ?, ?)')
    .run(req.session.userId, otherId, content.slice(0, 1000));
  const m = db.prepare('SELECT * FROM messages WHERE id = ?').get(info.lastInsertRowid);
  res.json({ message: m });
});

// 会话列表（最近聊天的人 + 未读数）
app.get('/api/conversations', requireAuth, (req, res) => {
  const uid = req.session.userId;
  const rows = db.prepare(`
    SELECT other_id, MAX(id) AS last_id FROM (
      SELECT CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END AS other_id, id
      FROM messages WHERE sender_id = ? OR receiver_id = ?
    ) GROUP BY other_id ORDER BY last_id DESC
  `).all(uid, uid, uid);
  const result = [];
  for (const r of rows) {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(r.other_id);
    const last = db.prepare('SELECT * FROM messages WHERE id = ?').get(r.last_id);
    const unread = db.prepare(
      'SELECT COUNT(*) AS n FROM messages WHERE sender_id = ? AND receiver_id = ? AND read = 0'
    ).get(r.other_id, uid).n;
    result.push({ user: publicUser(user), last_message: last.content, unread });
  }
  res.json({ conversations: result });
});

app.listen(PORT, () => {
  console.log(`社交平台服务已启动： http://localhost:${PORT}`);
});
