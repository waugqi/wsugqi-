// seed.js —— 创建演示账号与示例内容（UTF-8，可重复执行）
const bcrypt = require('bcryptjs');
const db = require('./database');

// 生成渐变 SVG 封面图（data URI）
function svgCover(c1, c2, c3) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="420">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${c1}"/><stop offset="0.5" stop-color="${c2}"/><stop offset="1" stop-color="${c3}"/>` +
    `</linearGradient></defs>` +
    `<rect width="1200" height="420" fill="url(#g)"/>` +
    `<circle cx="120" cy="90" r="70" fill="rgba(255,255,255,0.18)"/>` +
    `<circle cx="1080" cy="330" r="100" fill="rgba(255,255,255,0.14)"/>` +
    `<circle cx="620" cy="380" r="55" fill="rgba(255,255,255,0.12)"/>` +
    `<circle cx="900" cy="60" r="35" fill="rgba(255,255,255,0.2)"/>` +
    `</svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

const hash = bcrypt.hashSync('123456', 10);

const users = [
  { username: 'xiaomei', nickname: '小美', color: '#ff5c8a', avatar: '🌸', bio: '爱生活爱分享 🌈 每一天都要闪闪发光', cover: svgCover('#ff9a9e', '#ff5c8a', '#fecfef') },
  { username: 'azhe', nickname: '阿哲', color: '#2ec4b6', avatar: '🎸', bio: '写代码也写歌 | 深夜录音室常驻', cover: svgCover('#43e97b', '#2ec4b6', '#38f9d7') },
  { username: 'xiaoshuai', nickname: '小帅', color: '#ff9f1c', avatar: '⚽', bio: '周末球场见 ⚽ 进球机器', cover: svgCover('#f6d365', '#ff9f1c', '#fda085') }
];

// 清理旧演示数据（可重复执行）
const del = db.prepare('DELETE FROM users WHERE username = ?');
for (const u of users) del.run(u.username);

const insertUser = db.prepare('INSERT INTO users (username, password, nickname, avatar, bio, cover, color) VALUES (?, ?, ?, ?, ?, ?, ?)');
const ids = {};
for (const u of users) {
  const info = insertUser.run(u.username, hash, u.nickname, u.avatar, u.bio, u.cover, u.color);
  ids[u.username] = Number(info.lastInsertRowid);
}

const insertPost = db.prepare('INSERT INTO posts (author_id, content) VALUES (?, ?)');
const p1 = Number(insertPost.run(ids.xiaomei, '今天天气超好，和姐妹们去公园野餐啦！🌸 彩虹社群的第一次线下聚会圆满成功～').lastInsertRowid);
const p2 = Number(insertPost.run(ids.azhe, '新写的歌 demo 出来了，有人想听吗？🎸').lastInsertRowid);
const p3 = Number(insertPost.run(ids.xiaoshuai, '周末足球赛 5:3 赢了！进球 x2 ⚽🔥').lastInsertRowid);

const insertComment = db.prepare('INSERT INTO comments (post_id, author_id, content, parent_id) VALUES (?, ?, ?, ?)');
insertComment.run(p1, ids.azhe, '看起来太棒了！下次带上我 😍', null);
insertComment.run(p1, ids.xiaoshuai, '好想去！', null);
const c1 = Number(insertComment.run(p1, ids.xiaomei, '下次一定约你！', null).lastInsertRowid);
insertComment.run(p1, ids.azhe, '那就这么说定啦 ✌️', c1);
insertComment.run(p2, ids.xiaomei, '想听想听！求分享 🎧', null);

const insertLike = db.prepare('INSERT OR IGNORE INTO likes (post_id, user_id) VALUES (?, ?)');
insertLike.run(p1, ids.azhe);
insertLike.run(p1, ids.xiaoshuai);
insertLike.run(p2, ids.xiaomei);

const insertFriend = db.prepare('INSERT INTO friendships (user_id, friend_id, status) VALUES (?, ?, ?)');
insertFriend.run(ids.xiaomei, ids.azhe, 'accepted');
insertFriend.run(ids.xiaomei, ids.xiaoshuai, 'accepted');

const insertMsg = db.prepare('INSERT INTO messages (sender_id, receiver_id, content, read) VALUES (?, ?, ?, ?)');
insertMsg.run(ids.xiaomei, ids.azhe, '阿哲，你新歌的 demo 发我听听呗！', 1);
insertMsg.run(ids.azhe, ids.xiaomei, '好呀，晚上发你 🎸', 1);
insertMsg.run(ids.xiaomei, ids.xiaoshuai, '小帅，下次踢球叫我！', 1);
insertMsg.run(ids.xiaoshuai, ids.xiaomei, '没问题，周六下午老地方 ⚽', 1);

console.log('✅ 演示数据创建完成');
console.log('演示账号（密码均为 123456）：');
for (const u of users) console.log(`  @${u.username}（${u.nickname}）`);
