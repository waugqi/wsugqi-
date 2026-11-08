// app.js —— 前端单页应用逻辑
/* global fetch */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let currentUser = null;
let currentView = 'feed';
let commentModalPostId = null;
let replyTo = null; // { id, nickname }
let chatPeer = null; // { id, nickname, avatar, color }
let chatPollTimer = null;

// ---------- API 封装 ----------
async function api(method, url, body) {
  const opts = { method, credentials: 'same-origin', headers: {} };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

// ---------- 工具 ----------
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function timeAgo(iso) {
  const t = new Date(iso.replace(' ', 'T') + (iso.includes('+') ? '' : 'Z'));
  const diff = (Date.now() - t.getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return Math.floor(diff / 60) + ' 分钟前';
  if (diff < 86400) return Math.floor(diff / 3600) + ' 小时前';
  if (diff < 86400 * 7) return Math.floor(diff / 86400) + ' 天前';
  return t.toLocaleDateString('zh-CN');
}

function showToast(msg) {
  const toast = $('#toast');
  toast.textContent = msg;
  toast.classList.remove('hidden');
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.add('hidden'), 2200);
}

// 渲染头像
function renderAvatar(user, sizeClass = '') {
  const div = document.createElement('div');
  div.className = 'avatar ' + sizeClass;
  div.style.background = user.color || '#7c5cff';
  const av = (user.avatar || '').trim();
  if (av.startsWith('http://') || av.startsWith('https://') || av.startsWith('data:')) {
    const img = document.createElement('img');
    img.src = av;
    img.alt = '';
    div.appendChild(img);
  } else if (av) {
    div.textContent = av.slice(0, 4);
    div.style.fontSize = '18px';
  } else {
    div.textContent = (user.nickname || user.username || '?').charAt(0).toUpperCase();
  }
  return div;
}

// 图片压缩（默认最大宽 900px，JPEG）
function compressImage(file, maxWidth = 900) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.75));
      };
      img.onerror = () => reject(new Error('图片读取失败'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

// ---------- 视图切换 ----------
function switchView(name) {
  currentView = name;
  $$('.view').forEach((v) => v.classList.add('hidden'));
  $('#feed-view').classList.toggle('hidden', name !== 'feed');
  $('#friends-view').classList.toggle('hidden', name !== 'friends');
  $('#messages-view').classList.toggle('hidden', name !== 'messages');
  $('#profile-view').classList.toggle('hidden', name !== 'profile');

  $$('.nav-item[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === name));

  if (name === 'feed') loadFeed();
  if (name === 'friends') loadFriends();
  if (name === 'messages') { loadConversations(); startChatPolling(); }
  else stopChatPolling();
  if (name === 'profile') loadProfile();
}

// ---------- 登录 / 注册 ----------
function showAuth() {
  $('#app-view').classList.add('hidden');
  $('#auth-view').classList.remove('hidden');
}

function showApp() {
  $('#auth-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  switchView('feed');
}

$$('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.tab-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const isLogin = btn.dataset.tab === 'login';
    $('#login-form').classList.toggle('hidden', !isLogin);
    $('#register-form').classList.toggle('hidden', isLogin);
    $('#auth-error').textContent = '';
  });
});

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#auth-error').textContent = '';
  try {
    await api('POST', '/api/login', {
      username: $('#login-username').value.trim(),
      password: $('#login-password').value
    });
    await initApp();
  } catch (err) {
    $('#auth-error').textContent = err.message;
  }
});

$('#register-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#auth-error').textContent = '';
  try {
    await api('POST', '/api/register', {
      username: $('#reg-username').value.trim(),
      nickname: $('#reg-nickname').value.trim(),
      password: $('#reg-password').value
    });
    await initApp();
  } catch (err) {
    $('#auth-error').textContent = err.message;
  }
});

$('#logout-btn').addEventListener('click', async () => {
  await api('POST', '/api/logout').catch(() => {});
  currentUser = null;
  stopChatPolling();
  showAuth();
});
$('#logout-mobile-btn').addEventListener('click', async () => {
  await api('POST', '/api/logout').catch(() => {});
  currentUser = null;
  stopChatPolling();
  showAuth();
});

// ---------- 动态流 ----------
async function loadFeed() {
  const data = await api('GET', '/api/posts');
  const list = $('#feed-list');
  list.innerHTML = '';
  if (!data.posts.length) {
    list.innerHTML = '<div class="card" style="text-align:center;color:var(--muted)">还没有动态，快来发布第一条吧 🎉</div>';
    return;
  }
  data.posts.forEach((p) => list.appendChild(renderPost(p)));
}

function renderPost(p) {
  const el = document.createElement('article');
  el.className = 'post';
  el.dataset.id = p.id;

  const header = document.createElement('div');
  header.className = 'post-header';
  header.appendChild(renderAvatar(p.author));
  const meta = document.createElement('div');
  const name = document.createElement('div');
  name.style.fontWeight = '700';
  name.style.fontSize = '15px';
  name.textContent = p.author.nickname || p.author.username;
  const time = document.createElement('div');
  time.className = 'muted';
  time.textContent = timeAgo(p.created_at);
  meta.appendChild(name);
  meta.appendChild(time);
  header.appendChild(meta);
  el.appendChild(header);

  if (p.content) {
    const content = document.createElement('div');
    content.className = 'post-content';
    content.textContent = p.content;
    el.appendChild(content);
  }
  if (p.image) {
    const img = document.createElement('img');
    img.className = 'post-image';
    img.src = p.image;
    el.appendChild(img);
  }

  const actions = document.createElement('div');
  actions.className = 'post-actions';

  const likeBtn = document.createElement('button');
  likeBtn.className = p.liked ? 'liked' : '';
  likeBtn.innerHTML = (p.liked ? '❤️ ' : '🤍 ') + `<span>${p.like_count}</span>`;
  likeBtn.addEventListener('click', async () => {
    try {
      const res = await api('POST', `/api/posts/${p.id}/like`, { liked: !p.liked });
      p.liked = res.liked;
      p.like_count = res.like_count;
      likeBtn.classList.toggle('liked', p.liked);
      likeBtn.innerHTML = (p.liked ? '❤️ ' : '🤍 ') + `<span>${p.like_count}</span>`;
    } catch (err) { showToast(err.message); }
  });

  const commentBtn = document.createElement('button');
  commentBtn.innerHTML = `💬 <span>${p.comment_count}</span>`;
  commentBtn.addEventListener('click', () => openCommentModal(p));

  actions.appendChild(likeBtn);
  actions.appendChild(commentBtn);
  el.appendChild(actions);
  return el;
}

// 发布动态
let postImageData = '';
$('#post-image').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    postImageData = await compressImage(file);
    $('#image-file-name').textContent = '已选择图片 ✓';
  } catch (err) {
    showToast(err.message);
  }
});

$('#post-submit').addEventListener('click', async () => {
  const content = $('#post-content').value.trim();
  if (!content && !postImageData) return showToast('写点什么再发布吧');
  try {
    await api('POST', '/api/posts', { content, image: postImageData });
    $('#post-content').value = '';
    postImageData = '';
    $('#post-image').value = '';
    $('#image-file-name').textContent = '添加图片';
    loadFeed();
    showToast('发布成功 🎉');
  } catch (err) {
    showToast(err.message);
  }
});

// ---------- 评论 ----------
function openCommentModal(post) {
  commentModalPostId = post.id;
  replyTo = null;
  $('#comment-modal').classList.remove('hidden');
  const preview = $('#comment-post-preview');
  preview.innerHTML = '';
  const label = document.createElement('span');
  label.className = 'preview-text';
  label.textContent = (post.content ? post.content.slice(0, 80) : '图片动态');
  preview.appendChild(label);
  if (post.image) {
    const thumb = document.createElement('img');
    thumb.className = 'preview-thumb';
    thumb.src = post.image;
    thumb.alt = '';
    preview.appendChild(thumb);
  }
  $('#comment-input').placeholder = '写下你的评论...';
  $('#comment-input').value = '';
  loadComments();
}

function closeCommentModal() {
  $('#comment-modal').classList.add('hidden');
  commentModalPostId = null;
  replyTo = null;
}
$('#close-comment-modal').addEventListener('click', closeCommentModal);
$('.modal-backdrop').addEventListener('click', closeCommentModal);

async function loadComments() {
  const data = await api('GET', `/api/posts/${commentModalPostId}/comments`);
  commentsCache = data.comments;
  const list = $('#comment-list');
  list.innerHTML = '';
  if (!data.comments.length) {
    list.innerHTML = '<div style="color:var(--muted);text-align:center;padding:20px">还没有评论，来抢沙发～</div>';
    return;
  }
  const byParent = {};
  data.comments.forEach((c) => {
    (byParent[c.parent_id || 'root'] = byParent[c.parent_id || 'root'] || []).push(c);
  });
  const appendGroup = (parentId, isReply) => {
    (byParent[parentId] || []).forEach((c) => {
      list.appendChild(renderComment(c, isReply));
      appendGroup(c.id, true);
    });
  };
  appendGroup('root', false);
}

function renderComment(c, isReply) {
  const el = document.createElement('div');
  el.className = 'comment' + (isReply ? ' reply' : '');
  el.appendChild(renderAvatar(c.author, 'sm'));
  const body = document.createElement('div');
  body.className = 'c-body';

  const author = document.createElement('div');
  author.className = 'c-author';
  author.textContent = c.author.nickname || c.author.username;
  if (c.parent_id) {
    const parent = findCommentById(c.parent_id);
    if (parent) {
      const rt = document.createElement('span');
      rt.className = 'reply-to';
      rt.textContent = ` 回复 @${parent.author.nickname || parent.author.username}`;
      author.appendChild(rt);
    }
  }

  const text = document.createElement('div');
  text.className = 'c-text';
  text.textContent = c.content;

  const actions = document.createElement('div');
  actions.className = 'c-actions';
  const t = document.createElement('span');
  t.textContent = timeAgo(c.created_at);
  const replyBtn = document.createElement('button');
  replyBtn.textContent = '回复';
  replyBtn.addEventListener('click', () => {
    replyTo = { id: c.id, nickname: c.author.nickname || c.author.username };
    $('#comment-input').placeholder = `回复 @${replyTo.nickname}：`;
    $('#comment-input').focus();
  });
  actions.appendChild(t);
  actions.appendChild(replyBtn);

  body.appendChild(author);
  body.appendChild(text);
  body.appendChild(actions);
  el.appendChild(body);
  return el;
}

let commentsCache = [];
function findCommentById(id) {
  return commentsCache.find((c) => c.id === id);
}

$('#comment-submit').addEventListener('click', submitComment);
$('#comment-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitComment();
});

async function submitComment() {
  const content = $('#comment-input').value.trim();
  if (!content) return;
  try {
    await api('POST', `/api/posts/${commentModalPostId}/comments`, {
      content,
      parent_id: replyTo ? replyTo.id : null
    });
    $('#comment-input').value = '';
    replyTo = null;
    $('#comment-input').placeholder = '写下你的评论...';
    loadComments();
    // 更新动态上的评论数（简单起见重新加载信息流）
    if (currentView === 'feed') loadFeed();
  } catch (err) {
    showToast(err.message);
  }
}

// ---------- 好友 ----------
async function loadFriends() {
  const friendsData = await api('GET', '/api/friends');
  const { friends, requests } = friendsData;

  const friendsList = $('#friends-list');
  friendsList.innerHTML = '';
  if (!friends.length) {
    friendsList.innerHTML = '<div class="card" style="color:var(--muted);grid-column:1/-1">还没有好友，去搜索添加吧 👆</div>';
  } else {
    friends.forEach((f) => {
      const card = renderUserCard(f.user, [
        { text: '💬 发消息', cls: 'outline', action: () => openChat(f.user) },
        { text: '👤 主页', cls: 'outline', action: () => viewUserProfile(f.user) }
      ]);
      friendsList.appendChild(card);
    });
  }

  const reqList = $('#friend-requests');
  reqList.innerHTML = '';
  if (!requests.length) {
    reqList.innerHTML = '<div class="card" style="color:var(--muted);grid-column:1/-1">暂无好友请求</div>';
  } else {
    requests.forEach((r) => {
      const actions = r.direction === 'incoming'
        ? [{ text: '✅ 接受', cls: 'primary', action: async () => { await api('POST', '/api/friends/accept', { friendshipId: r.friendship_id }); showToast('已添加好友 🎉'); loadFriends(); } }]
        : [{ text: '⏳ 已发送', cls: 'outline', action: () => {} }];
      reqList.appendChild(renderUserCard(r.user, actions));
    });
  }
}

function renderUserCard(user, actions) {
  const card = document.createElement('div');
  card.className = 'user-card';
  card.appendChild(renderAvatar(user));
  const name = document.createElement('div');
  name.style.fontWeight = '700';
  name.textContent = user.nickname || user.username;
  const uname = document.createElement('div');
  uname.className = 'uname muted';
  uname.textContent = '@' + user.username;
  const bio = document.createElement('div');
  bio.className = 'muted';
  bio.textContent = (user.bio || '这个人很懒，什么都没写').slice(0, 40);
  card.appendChild(name);
  card.appendChild(uname);
  card.appendChild(bio);
  const btnRow = document.createElement('div');
  btnRow.style.display = 'flex';
  btnRow.style.gap = '8px';
  btnRow.style.flexWrap = 'wrap';
  btnRow.style.justifyContent = 'center';
  actions.forEach((a) => {
    const btn = document.createElement('button');
    btn.className = 'btn ' + (a.cls || 'outline');
    btn.textContent = a.text;
    btn.addEventListener('click', a.action);
    btnRow.appendChild(btn);
  });
  card.appendChild(btnRow);
  return card;
}

let searchTimer = null;
$('#friend-search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  searchTimer = setTimeout(async () => {
    const box = $('#search-results');
    if (!q) { box.classList.add('hidden'); return; }
    try {
      const data = await api('GET', '/api/users?q=' + encodeURIComponent(q));
      box.innerHTML = '';
      const filtered = data.users.filter((u) => u.id !== currentUser.id);
      if (!filtered.length) {
        box.innerHTML = '<div class="card" style="color:var(--muted);grid-column:1/-1">没有找到用户</div>';
      } else {
        filtered.forEach((u) => {
          box.appendChild(renderUserCard(u, [
            {
              text: '➕ 加好友', cls: 'primary', action: async () => {
                try {
                  await api('POST', '/api/friends/request', { userId: u.id });
                  showToast('好友请求已发送 📨');
                } catch (err) { showToast(err.message); }
              }
            }
          ]));
        });
      }
      box.classList.remove('hidden');
    } catch (err) { showToast(err.message); }
  }, 300);
});

function openChat(user) {
  switchView('messages');
  chatPeer = user;
  renderChatPanel(user);
}

// 查看他人主页（简单版：跳到主页并显示提示）
function viewUserProfile(user) {
  switchView('profile');
  loadProfile(user);
}

// ---------- 私聊 ----------
async function loadConversations() {
  const data = await api('GET', '/api/conversations');
  const list = $('#conversation-list');
  list.innerHTML = '';
  if (!data.conversations.length) {
    list.innerHTML = '<div style="padding:20px;color:var(--muted);text-align:center">暂无会话，去好友页找人聊聊吧</div>';
    return;
  }
  data.conversations.forEach((c) => {
    const item = document.createElement('div');
    item.className = 'conv-item';
    if (chatPeer && chatPeer.id === c.user.id) item.classList.add('active');
    item.appendChild(renderAvatar(c.user, 'sm'));
    const meta = document.createElement('div');
    meta.className = 'conv-meta';
    const name = document.createElement('div');
    name.className = 'conv-name';
    name.textContent = c.user.nickname || c.user.username;
    const last = document.createElement('div');
    last.className = 'conv-last';
    last.textContent = c.last_message;
    meta.appendChild(name);
    meta.appendChild(last);
    item.appendChild(meta);
    if (c.unread > 0) {
      const badge = document.createElement('span');
      badge.className = 'conv-badge';
      badge.textContent = c.unread;
      item.appendChild(badge);
    }
    item.addEventListener('click', () => openChat(c.user));
    list.appendChild(item);
  });
}

function renderChatPanel(user) {
  const panel = $('#chat-panel');
  panel.innerHTML = '';
  const header = document.createElement('div');
  header.className = 'chat-header';
  header.appendChild(renderAvatar(user, 'sm'));
  header.appendChild(document.createTextNode(' ' + (user.nickname || user.username)));
  header.style.display = 'flex';
  header.style.alignItems = 'center';
  header.style.gap = '10px';

  const msgs = document.createElement('div');
  msgs.className = 'chat-messages';
  msgs.id = 'chat-messages';

  const inputRow = document.createElement('div');
  inputRow.className = 'chat-input';
  const input = document.createElement('input');
  input.id = 'chat-input';
  input.placeholder = '输入消息...';
  const sendBtn = document.createElement('button');
  sendBtn.className = 'btn primary';
  sendBtn.textContent = '发送';
  inputRow.appendChild(input);
  inputRow.appendChild(sendBtn);

  panel.appendChild(header);
  panel.appendChild(msgs);
  panel.appendChild(inputRow);

  loadMessages(user.id);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendMessage(user.id); });
  sendBtn.addEventListener('click', () => sendMessage(user.id));
}

async function loadMessages(otherId) {
  const data = await api('GET', `/api/messages/${otherId}`);
  const box = $('#chat-messages');
  box.innerHTML = '';
  data.messages.forEach((m) => {
    const div = document.createElement('div');
    div.className = 'msg ' + (m.sender_id === currentUser.id ? 'mine' : 'theirs');
    div.textContent = m.content;
    box.appendChild(div);
  });
  box.scrollTop = box.scrollHeight;
}

async function sendMessage(otherId) {
  const input = $('#chat-input');
  const content = input.value.trim();
  if (!content) return;
  try {
    await api('POST', `/api/messages/${otherId}`, { content });
    input.value = '';
    loadMessages(otherId);
  } catch (err) {
    showToast(err.message);
  }
}

function startChatPolling() {
  stopChatPolling();
  chatPollTimer = setInterval(() => {
    if (currentView !== 'messages') { stopChatPolling(); return; }
    loadConversations();
    if (chatPeer) loadMessages(chatPeer.id);
  }, 3000);
}
function stopChatPolling() {
  if (chatPollTimer) { clearInterval(chatPollTimer); chatPollTimer = null; }
}

// ---------- 个人主页（Ins 风） ----------
async function loadProfile(userOverride) {
  const user = userOverride || currentUser;
  if (!user) return;
  const isMe = user.id === currentUser.id;

  // 拉取最新资料与统计
  let detail = user;
  try {
    const data = await api('GET', `/api/users/${user.id}`);
    detail = data.user;
    if (isMe) currentUser = detail;
  } catch (err) { /* 保留已有数据 */ }

  // 封面
  const cover = $('#profile-cover');
  if (detail.cover) {
    cover.style.backgroundImage = `url("${detail.cover.replace(/"/g, '%22')}")`;
  } else {
    cover.style.backgroundImage =
      `linear-gradient(135deg, ${detail.color || '#7c5cff'} 0%, ${detail.color || '#7c5cff'}55 50%, #ff9a9e 100%)`;
  }

  // 头像
  const av = renderAvatar(detail, 'xl');
  av.id = 'profile-avatar';
  $('#profile-avatar').replaceWith(av);

  $('#profile-nickname').textContent = detail.nickname || detail.username;
  $('#profile-username').textContent = '@' + detail.username;
  $('#profile-bio').textContent = detail.bio || '';
  $('#profile-posts-title').textContent = isMe ? '我的动态' : `${detail.nickname || detail.username} 的动态`;
  $('#stat-posts').textContent = detail.post_count ?? 0;
  $('#stat-friends').textContent = detail.friend_count ?? 0;
  const joined = new Date((detail.created_at || '').replace(' ', 'T') + 'Z');
  $('#stat-joined').textContent = isNaN(joined) ? '-' : joined.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short' });
  $('#edit-profile-btn').classList.toggle('hidden', !isMe);
  $('#edit-profile-form').classList.add('hidden');

  // 该用户的动态九宫格
  try {
    const data = await api('GET', `/api/users/${detail.id}/posts`);
    const box = $('#my-posts-list');
    box.innerHTML = '';
    if (!data.posts.length) {
      box.innerHTML = '<div class="card" style="text-align:center;color:var(--muted);grid-column:1/-1">还没有动态</div>';
    } else {
      data.posts.forEach((p) => box.appendChild(renderGridTile(p)));
    }
  } catch (err) { /* ignore */ }
}

function renderGridTile(p) {
  const tile = document.createElement('div');
  tile.className = 'grid-tile';
  if (p.image) {
    const img = document.createElement('img');
    img.src = p.image;
    img.alt = '';
    tile.appendChild(img);
  } else {
    const txt = document.createElement('div');
    txt.className = 'tile-text';
    txt.textContent = p.content;
    tile.appendChild(txt);
  }
  const overlay = document.createElement('div');
  overlay.className = 'tile-overlay';
  overlay.innerHTML = `<span>❤️ ${p.like_count}</span><span>💬 ${p.comment_count}</span>`;
  tile.appendChild(overlay);
  tile.addEventListener('click', () => openCommentModal(p));
  return tile;
}

$('#edit-profile-btn').addEventListener('click', () => {
  $('#edit-profile-form').classList.remove('hidden');
  $('#edit-nickname').value = currentUser.nickname || '';
  $('#edit-avatar').value = currentUser.avatar || '';
  $('#edit-bio').value = currentUser.bio || '';
  $('#edit-color').value = currentUser.color || '#7c5cff';
  editCoverData = currentUser.cover || '';
  renderCoverPreview();
});

$('#cancel-profile-btn').addEventListener('click', () => {
  $('#edit-profile-form').classList.add('hidden');
  editCoverData = currentUser.cover || '';
});

// 封面编辑
let editCoverData = '';
function renderCoverPreview() {
  const box = $('#edit-cover-preview');
  if (editCoverData) {
    box.style.backgroundImage = `url("${editCoverData.replace(/"/g, '%22')}")`;
    box.textContent = '';
  } else {
    box.style.backgroundImage = 'none';
    box.textContent = '未设置封面';
  }
}

$('#edit-cover-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    editCoverData = await compressImage(file, 1200);
    renderCoverPreview();
    showToast('封面已选择 ✅');
  } catch (err) {
    showToast(err.message);
  }
});

$('#remove-cover-btn').addEventListener('click', () => {
  editCoverData = '';
  renderCoverPreview();
  showToast('封面已移除');
});

$('#save-profile-btn').addEventListener('click', async () => {
  try {
    const data = await api('PUT', '/api/me', {
      nickname: $('#edit-nickname').value.trim(),
      avatar: $('#edit-avatar').value.trim(),
      bio: $('#edit-bio').value.trim(),
      color: $('#edit-color').value,
      cover: editCoverData
    });
    currentUser = data.user;
    $('#edit-profile-form').classList.add('hidden');
    loadProfile();
    showToast('资料已更新 ✅');
  } catch (err) {
    showToast(err.message);
  }
});

// ---------- 导航 ----------
$$('.nav-item[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

// ---------- 初始化 ----------
async function initApp() {
  try {
    const data = await api('GET', '/api/me');
    if (data.user) {
      currentUser = data.user;
      showApp();
    } else {
      showAuth();
    }
  } catch {
    showAuth();
  }
}

initApp();
