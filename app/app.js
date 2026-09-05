/* ============================================
   课程余量管理 - Application Logic
   ============================================ */

const App = {
    // ---- State ----
    state: {
        users: [
            { username: 'liyong', password: '123456', displayName: '爸爸' },
            { username: 'xiaokai', password: '123456', displayName: '妈妈' }
        ],
        currentUser: null,
        children: [],
        courses: [],
        transactions: [],
        settings: {
            theme: 'light',
            lowThreshold: 5,
            syncKey: '',
            syncEnabled: false
        },
        // Cloud sync timestamps
        updatedAt: 0,        // last local modification time
        lastSyncedAt: 0,     // version already synced with cloud
        lastSyncTime: 0,     // last successful sync wall-clock time
        dataVersion: 0,     // ★ 递增版本号，每次 save +1，高版本覆盖低版本
        lastSyncedVersion: 0, // ★ 上次推送成功时的版本号
        currentView: 'dashboard',
        currentFilter: 'all',
        selectedCourseId: null,
        calCourseId: null,
        calYear: new Date().getFullYear(),
        calMonth: new Date().getMonth()
    },

    // Child color palette · 「暖阳」家庭色板（大宝向日葵黄 / 二宝湖水青 打头）
    childColors: ['#E8992E', '#2E8C7E', '#E8604C', '#D98A26', '#7A9E7E', '#C77DBA'],
    childEmojis: ['👦', '👧', '🧒', '👶', '🧑', '👨', '👩'],

    // ---- Storage ----
    STORAGE_KEY: 'courseManagerData',

    save(bump = true) {
        if (bump) {
            this.state.updatedAt = Date.now();
            this.state.dataVersion = (this.state.dataVersion || 0) + 1;
        }
        const data = {
            users: this.state.users,
            currentUser: this.state.currentUser,
            children: this.state.children,
            courses: this.state.courses,
            transactions: this.state.transactions,
            settings: this.state.settings,
            updatedAt: this.state.updatedAt,
            lastSyncedAt: this.state.lastSyncedAt,
            lastSyncTime: this.state.lastSyncTime,
            dataVersion: this.state.dataVersion,
            lastSyncedVersion: this.state.lastSyncedVersion
        };
        try {
            localStorage.setItem(this.STORAGE_KEY, JSON.stringify(data));
        } catch (e) {
            console.error('Save failed:', e);
        }
        // Auto push to cloud after local modifications (debounced)
        if (bump && this.isSyncActive()) this.scheduleSyncPush();
    },

    load() {
        try {
            const raw = localStorage.getItem(this.STORAGE_KEY);
            if (raw) {
                const data = JSON.parse(raw);
                if (data.users) this.state.users = data.users;
                this.state.currentUser = data.currentUser || null;
                this.state.children = data.children || [];
                this.state.courses = data.courses || [];
                this.state.transactions = data.transactions || [];
                this.state.settings = Object.assign(this.state.settings, data.settings || {});
                this.state.updatedAt = data.updatedAt || 0;
                this.state.lastSyncedAt = data.lastSyncedAt || 0;
                this.state.lastSyncTime = data.lastSyncTime || 0;
                this.state.dataVersion = data.dataVersion || 0;
                this.state.lastSyncedVersion = data.lastSyncedVersion || 0;
                this.migrateData();
            }
        } catch (e) {
            console.error('Load failed:', e);
        }
    },

    // Migrate old display names to new ones
    migrateData() {
        let changed = false;
        const renames = { '李勇': '爸爸', '小凯': '妈妈' };
        this.state.users.forEach(u => {
            if ((u.username === 'liyong' || u.username === 'xiaokai') && renames[u.displayName]) {
                u.displayName = renames[u.displayName];
                changed = true;
            }
        });
        if (this.state.currentUser && renames[this.state.currentUser.displayName]) {
            this.state.currentUser.displayName = renames[this.state.currentUser.displayName];
            changed = true;
        }
        this.state.transactions.forEach(t => {
            if (t.operator && renames[t.operator]) {
                t.operator = renames[t.operator];
                changed = true;
            }
        });
        // 迁移旧补签数据：历史 attend 记录被固化为 00:00:00 / 12:00:00，
        // 无法恢复真实操作时刻，只补 signDate（归属日期），显示时标"补签 YYYY-MM-DD"
        this.state.transactions.forEach(t => {
            if (t.type === 'attend' && t.backfill && !t.signDate) {
                const d = new Date(t.date);
                if (!isNaN(d.getTime())) {
                    const hh = d.getHours(), mm = d.getMinutes(), ss = d.getSeconds();
                    if ((hh === 0 && mm === 0 && ss === 0) || (hh === 12 && mm === 0 && ss === 0)) {
                        t.signDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                        changed = true;
                    }
                }
            }
        });
        // 修复：当天操作却被误标为补签的记录（signDate 与操作时刻同一天 → 恢复为正常签到）
        this.state.transactions.forEach(t => {
            if (t.type === 'attend' && t.backfill && t.signDate) {
                const d = new Date(t.date);
                if (!isNaN(d.getTime())) {
                    const opDay = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    if (t.signDate === opDay) {
                        t.backfill = undefined;
                        t.signDate = undefined;
                        changed = true;
                    }
                }
            }
        });
        // 「暖阳」改版：旧冷色板 → 新家庭暖色板 一一映射（只改默认色的孩子，手动选过的保留）
        const colorMigrate = {
            '#4F46E5': '#E8992E',  // 靛蓝 → 向日葵黄
            '#EC4899': '#2E8C7E',  // 桃粉 → 湖水青
            '#0D9488': '#E8604C',  // 深青 → 珊瑚橙
            '#F59E0B': '#D98A26',  // 琥珀 → 暖橙黄
            '#8B5CF6': '#7A9E7E', // 紫 → 橄榄绿
            '#EF4444': '#C77DBA'   // 红 → 藕紫
        };
        this.state.children.forEach(c => {
            if (c.color && colorMigrate[c.color.toUpperCase()]) {
                c.color = colorMigrate[c.color.toUpperCase()];
                changed = true;
            }
        });
        if (changed) this.save(false);
    },

    // ---- ID Generator ----
    genId() {
        return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    },

    // ---- Initialization ----
    init() {
        this.load();
        this.applyTheme();
        this.bindEvents();
        // Check if logged in
        if (!this.state.currentUser) {
            this.showLogin();
        } else {
            this.showApp();
        }
    },

    // ---- Authentication ----
    showLogin() {
        document.getElementById('loginScreen').classList.remove('hidden');
        document.getElementById('app').style.display = 'none';
        document.getElementById('loginHint').textContent = '';
        document.getElementById('loginPassword').value = '';
        this._renderLoginWhoCards();
    },

    // 家庭成员快速选择卡片（默认选上次登录的人）
    _renderLoginWhoCards() {
        const row = document.getElementById('loginWhoRow');
        if (!row) return;
        const lastUser = this.state.currentUser ? this.state.currentUser.username : null;
        let selected = lastUser;
        // 若没有上次登录记录，默认选第一位用户
        if (!selected && this.state.users.length > 0) selected = this.state.users[0].username;
        row.innerHTML = this.state.users.map((u, idx) => {
            const isPapa = idx === 0;
            const emoji = u.emoji || (isPapa ? '👨' : '👩');
            const on = u.username === selected ? ' selected' : '';
            return `
                <button type="button" class="who-card${on}" data-username="${this.escape(u.username)}">
                    <span class="who-avatar ${isPapa ? 'papa' : 'mama'}">${emoji}</span>
                    <span><b>${this.escape(u.displayName || u.username)}</b><span>${this.escape(u.username)}</span></span>
                </button>
            `;
        }).join('');
        row.querySelectorAll('.who-card').forEach(card => {
            card.addEventListener('click', () => {
                row.querySelectorAll('.who-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                document.getElementById('loginUsername').value = card.dataset.username;
                setTimeout(() => document.getElementById('loginPassword').focus(), 80);
            });
        });
        document.getElementById('loginUsername').value = selected || '';
    },

    showApp() {
        document.getElementById('loginScreen').classList.add('hidden');
        document.getElementById('app').style.display = 'flex';
        // Update user badge
        const badge = document.getElementById('userBadgeName');
        if (badge && this.state.currentUser) {
            badge.textContent = this.state.currentUser.displayName || this.state.currentUser.username;
        }
        this.render();
        this.maybeShowSetup();
        // Auto pull from cloud on open + start periodic pull
        if (this.isSyncActive()) {
            setTimeout(() => this.syncPull(true), 1000);
            // ★ 每 5 秒自动拉取云端，确保两台手机近实时同步
            if (this._syncPullInterval) clearInterval(this._syncPullInterval);
            this._syncPullInterval = setInterval(() => {
                if (this.isSyncActive() && !this._syncPushing) {
                    this.syncPull(true);
                }
            }, 5000);
        }
    },

    doLogin() {
        const username = document.getElementById('loginUsername').value.trim();
        const password = document.getElementById('loginPassword').value;
        const hint = document.getElementById('loginHint');

        if (!username || !password) {
            hint.textContent = '请选择家庭成员并输入密码';
            hint.className = 'login-hint';
            return;
        }

        const user = this.state.users.find(u => u.username === username);
        if (!user || user.password !== password) {
            hint.textContent = '用户名或密码错误';
            hint.className = 'login-hint';
            return;
        }

        this.state.currentUser = { username: user.username, displayName: user.displayName };
        this.save(false);
        this.showApp();
    },

    doLogout() {
        this.confirmAction({
            title: '退出登录',
            message: '确定要退出当前账号吗？<br><br><span style="color: var(--on-surface-variant); font-size: 13px;">数据会保留在本地，下次登录后仍可使用。</span>',
            confirmText: '退出',
            danger: true,
            onConfirm: () => {
                this.state.currentUser = null;
                this.save(false);
                this.showLogin();
            }
        });
    },

    // 通用确认弹窗（替代浏览器原生 confirm，PWA 环境更可靠）
    confirmAction({ title, message, confirmText = '确定', cancelText = '取消', danger = false, onConfirm, onCancel }) {
        const safeTitle = this.escape(title || '提示');
        const confirmBtnStyle = danger
            ? 'flex:1; background: var(--danger); color: var(--on-danger, #fff);'
            : 'flex:1;';
        this.openModal(safeTitle, `
            <div style="font-size: 15px; line-height: 1.55; color: var(--on-surface);">${message}</div>
            <div style="display: flex; gap: 10px; margin-top: 20px;">
                <button class="btn btn-tonal" id="confirmActionCancel" style="flex:1;">${this.escape(cancelText)}</button>
                <button class="btn btn-filled" id="confirmActionOk" style="${confirmBtnStyle}">${this.escape(confirmText)}</button>
            </div>
        `);
        const ok = document.getElementById('confirmActionOk');
        const cancel = document.getElementById('confirmActionCancel');
        const cleanup = () => {
            ok.removeEventListener('click', okClick);
            cancel.removeEventListener('click', cancelClick);
        };
        const okClick = () => { cleanup(); this.closeModal(); try { onConfirm && onConfirm(); } catch (e) { console.error(e); } };
        const cancelClick = () => { cleanup(); this.closeModal(); try { onCancel && onCancel(); } catch (e) { console.error(e); } };
        ok.addEventListener('click', okClick);
        cancel.addEventListener('click', cancelClick);
    },

    showChangePassword() {
        const usernames = this.state.users.map(u =>
            `<option value="${u.username}">${this.escape(u.displayName || u.username)} (${u.username})</option>`
        ).join('');
        this.openModal('修改密码', `
            <div class="form-group">
                <label class="form-label">选择账号</label>
                <select class="form-select" id="pw-user">${usernames}</select>
            </div>
            <div class="form-group">
                <label class="form-label">新密码</label>
                <input type="password" class="form-input" id="pw-new" placeholder="输入新密码">
            </div>
            <div class="form-group">
                <label class="form-label">确认新密码</label>
                <input type="password" class="form-input" id="pw-confirm" placeholder="再次输入新密码">
            </div>
            <div style="display: flex; gap: 10px; margin-top: 20px;">
                <button class="btn btn-tonal" onclick="App.closeModal()" style="flex:1;">取消</button>
                <button class="btn btn-filled" onclick="App._savePassword()" style="flex:1;">保存</button>
            </div>
        `);
    },

    _savePassword() {
        const username = document.getElementById('pw-user').value;
        const newPw = document.getElementById('pw-new').value;
        const confirmPw = document.getElementById('pw-confirm').value;

        if (!newPw || newPw.length < 4) {
            this.showToast('密码至少4位');
            return;
        }
        if (newPw !== confirmPw) {
            this.showToast('两次密码不一致');
            return;
        }

        const user = this.state.users.find(u => u.username === username);
        user.password = newPw;
        user._ts = Date.now();
        this.save();
        this.closeModal();
        this.showToast('密码已修改');
    },

    // ============================================
    // Cloud Sync (textdb.online free storage)
    // ============================================
    SYNC_API: 'https://textdb.online',

    isSyncActive() {
        return !!(this.state.settings.syncEnabled && this.state.settings.syncKey);
    },

    genSyncKey() {
        const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
        let s = 'cm';
        for (let i = 0; i < 28; i++) s += chars[Math.floor(Math.random() * chars.length)];
        return s;
    },

    buildSyncPayload() {
        return JSON.stringify({
            v: 2,
            dataVersion: this.state.dataVersion || 0,
            updatedAt: this.state.updatedAt,
            users: this.state.users,
            children: this.state.children,
            courses: this.state.courses,
            transactions: this.state.transactions,
            settings: this.state.settings
        });
    },

    _syncTimer: null,
    _syncPullInterval: null,
    _syncPushing: false,  // 防止并发推送

    scheduleSyncPush() {
        clearTimeout(this._syncTimer);
        this._syncTimer = setTimeout(() => this.syncPush(true), 2000);
    },

    async syncPush(silent = true) {
        if (!this.isSyncActive()) return false;
        if (this._syncPushing) return false;  // 防止并发
        this._syncPushing = true;
        try {
            // ★ 推送前先拉取云端，检查版本号
            const pullRes = await fetch(this.SYNC_API + '/' + this.state.settings.syncKey, { cache: 'no-store' });
            const pullText = (await pullRes.text()).trim();
            if (pullText) {
                try {
                    const cloudCheck = JSON.parse(pullText);
                    const cloudVer = cloudCheck.dataVersion || 0;
                    const localVer = this.state.dataVersion || 0;
                    if (cloudVer > localVer) {
                        // ★ 云端版本更高 → 先合并再推送
                        this._mergeCloudData(cloudCheck, true);
                    }
                } catch (e) { /* 云端格式异常，继续推送本机 */ }
            }
            // 推送本机最新数据（可能已合并了云端）
            const body = new URLSearchParams();
            body.append('key', this.state.settings.syncKey);
            body.append('value', this.buildSyncPayload());
            const res = await fetch(this.SYNC_API + '/update', { method: 'POST', body });
            const json = await res.json();
            if (json.status === 1) {
                this.state.lastSyncedVersion = this.state.dataVersion;
                this.state.lastSyncedAt = this.state.updatedAt;
                this.state.lastSyncTime = Date.now();
                this.save(false);
                return true;
            }
            throw new Error(json.error || 'push failed');
        } catch (e) {
            console.error('Sync push failed:', e);
            if (!silent) this.showToast('上传失败，请检查网络');
            return false;
        } finally {
            this._syncPushing = false;
        }
    },

    async syncPull(auto = true) {
        if (!this.isSyncActive()) return;
        try {
            const res = await fetch(this.SYNC_API + '/' + this.state.settings.syncKey, { cache: 'no-store' });
            const text = (await res.text()).trim();
            const localEmpty = this.state.children.length === 0
                && this.state.courses.length === 0
                && this.state.transactions.length === 0;

            // Cloud empty: local data (re)creates the cloud copy
            if (!text) {
                if (!localEmpty) {
                    await this.syncPush(false);
                    if (!auto) this.showToast('已将本机数据上传到云端');
                } else if (!auto) {
                    this.showToast('云端暂无数据');
                }
                return;
            }

            const cloud = JSON.parse(text);
            if (!cloud) {
                if (!auto) this.showToast('云端数据格式异常');
                return;
            }

            const cloudVer = cloud.dataVersion || 0;
            const localVer = this.state.dataVersion || 0;
            const localHasChanges = localVer > (this.state.lastSyncedVersion || 0);

            // ★ 版本号比较：高版本覆盖低版本
            if (cloudVer > localVer) {
                // 云端版本更高
                if (localEmpty) {
                    this.applyCloud(cloud);
                    if (!auto) this.showToast('已从云端同步 ' + this.state.courses.length + ' 门课程');
                    return;
                }
                if (localHasChanges && !auto) {
                    // 双方都有修改 → 弹窗让用户选择
                    this.confirmAction({
                        title: '同步冲突',
                        message: '云端有另一台手机的更新数据（版本 ' + cloudVer + '），本机也有未同步的修改（版本 ' + localVer + '）。<br><br>• <strong>使用云端</strong>：本机未同步的修改将被覆盖<br>• <strong>合并并上传</strong>：保留双方所有修改',
                        confirmText: '使用云端',
                        cancelText: '合并并上传',
                        onConfirm: () => {
                            this.applyCloud(cloud);
                            this.showToast('已使用云端数据');
                        },
                        onCancel: async () => {
                            this._mergeCloudData(cloud, true);
                            await this.syncPush(false);
                            this.showToast('已合并并上传');
                        }
                    });
                    return;
                }
                // 自动模式：智能合并云端数据（不丢失本机修改）
                this._mergeCloudData(cloud, true);
                if (!auto) this.showToast('已从云端同步最新数据');
                return;
            }

            if (localVer > cloudVer) {
                // 本机版本更高 → 推送
                await this.syncPush(false);
                if (!auto) this.showToast('已将本机最新数据上传');
                return;
            }

            // 版本号相同 → 已同步
            this.state.lastSyncTime = Date.now();
            this.save(false);
            if (!auto) this.showToast('数据已是最新');
        } catch (e) {
            console.error('Sync pull failed:', e);
            if (!auto) this.showToast('同步失败，请检查网络');
        }
    },

    // ★ 智能合并云端数据（并集合并，不丢失任何一端的修改）
    _mergeCloudData(cloud, skipRender = false) {
        // courses 按 id 并集合并，同 id 取 _ts 更大的（最近修改的）
        const courseMap = new Map();
        [].concat(this.state.courses || [], cloud.courses || []).forEach(c => {
            if (!c || !c.id) return;
            const ex = courseMap.get(c.id);
            if (!ex || (c._ts || 0) > (ex._ts || 0)) courseMap.set(c.id, c);
        });

        // children 按 id 并集合并
        const childMap = new Map();
        [].concat(this.state.children || [], cloud.children || []).forEach(c => {
            if (!c || !c.id) return;
            const ex = childMap.get(c.id);
            if (!ex || (c._ts || 0) > (ex._ts || 0)) childMap.set(c.id, c);
        });

        // transactions 按 id 并集合并：取 _ts 更大的（删除/修改记录都有 _ts）
        // 没有 _ts 的视为本地旧版本，让有 _ts 的覆盖
        const txMap = new Map();
        [].concat(this.state.transactions || [], cloud.transactions || []).forEach(t => {
            if (!t || !t.id) return;
            const ex = txMap.get(t.id);
            if (!ex) {
                txMap.set(t.id, t);
            } else {
                const exTs = ex._ts || 0;
                const newTs = t._ts || 0;
                if (newTs > exTs) txMap.set(t.id, t);
            }
        });

        // users 按 username 并集合并，取 _ts 更大或密码更新的
        const userMap = new Map();
        [].concat(this.state.users || [], cloud.users || []).forEach(u => {
            if (!u || !u.username) return;
            const ex = userMap.get(u.username);
            if (!ex || (u._ts || 0) > (ex._ts || 0)) userMap.set(u.username, u);
        });

        this.state.courses = Array.from(courseMap.values());
        this.state.children = Array.from(childMap.values());
        this.state.transactions = Array.from(txMap.values())
            .sort((a, b) => (b.date || 0) - (a.date || 0));
        // users: 取并集，如果密码不同取 _ts 更大的
        this.state.users = Array.from(userMap.values());
        if (cloud.settings) {
            // 只合并非同步相关设置（theme 等个人偏好保留本机）
            const mySyncKey = this.state.settings.syncKey;
            const mySyncEnabled = this.state.settings.syncEnabled;
            this.state.settings = Object.assign({}, this.state.settings, cloud.settings);
            this.state.settings.syncKey = mySyncKey;
            this.state.settings.syncEnabled = mySyncEnabled;
        }
        // ★ 版本号取较大值
        this.state.dataVersion = Math.max(this.state.dataVersion || 0, cloud.dataVersion || 0);
        this.state.updatedAt = Math.max(this.state.updatedAt || 0, cloud.updatedAt || 0);
        this.state.lastSyncTime = Date.now();
        this.save(false);
        if (!skipRender) {
            this.applyTheme();
            this.render();
        }
    },

    // 直接使用云端数据覆盖本机（空数据初始化或用户选择"使用云端"时）
    applyCloud(cloud) {
        // Union-merge transactions by id with _ts-aware merging
        const txMap = new Map();
        [].concat(this.state.transactions || [], cloud.transactions || []).forEach(t => {
            if (!t || !t.id) return;
            const ex = txMap.get(t.id);
            if (!ex) {
                txMap.set(t.id, t);
            } else {
                const exTs = ex._ts || 0;
                const newTs = t._ts || 0;
                if (newTs > exTs) txMap.set(t.id, t);
            }
        });
        if (cloud.users && cloud.users.length) this.state.users = cloud.users;
        this.state.children = cloud.children || [];
        this.state.courses = cloud.courses || [];
        this.state.transactions = Array.from(txMap.values())
            .sort((a, b) => (b.date || 0) - (a.date || 0));
        if (cloud.settings) {
            const mySyncKey = this.state.settings.syncKey;
            const mySyncEnabled = this.state.settings.syncEnabled;
            this.state.settings = Object.assign({}, this.state.settings, cloud.settings);
            this.state.settings.syncKey = mySyncKey;
            this.state.settings.syncEnabled = mySyncEnabled;
        }
        this.state.updatedAt = cloud.updatedAt || 0;
        this.state.lastSyncedAt = cloud.updatedAt || 0;
        this.state.dataVersion = cloud.dataVersion || 0;
        this.state.lastSyncedVersion = cloud.dataVersion || 0;
        this.state.lastSyncTime = Date.now();
        this.save(false);
        this.applyTheme();
        this.render();
    },

    syncNow() {
        if (!this.isSyncActive()) {
            this.showToast('请先开启云同步');
            this.showSyncSetup();
            return;
        }
        this.showToast('正在同步…');
        this.syncPull(false);
    },

    // ---- Sync UI ----
    showSyncSetup() {
        if (this.isSyncActive()) {
            const lastSync = this.state.lastSyncTime ? this.formatDate(this.state.lastSyncTime) : '从未';
            this.openModal('云同步', `
                <div style="text-align:center; margin-bottom:16px;">
                    <div style="font-size:40px;">☁️</div>
                    <p style="color:var(--on-surface-variant); font-size:13px;">两台手机通过云端共享同一份课程数据</p>
                </div>
                <div class="form-group">
                    <label class="form-label">同步码（在另一台手机上输入此码即可加入同步）</label>
                    <div class="sync-key-box" onclick="App.copyText('${this.state.settings.syncKey}')">${this.state.settings.syncKey}</div>
                    <p style="font-size:12px; color:var(--on-surface-variant); text-align:center;">点击同步码即可复制</p>
                </div>
                <div style="background:var(--surface-container); border-radius:var(--radius-md); padding:12px; font-size:13px; color:var(--on-surface-variant); margin-bottom:16px;">
                    上次同步：${lastSync}<br>同步码是唯一访问凭证，请勿泄露给他人
                </div>
                <button class="btn btn-filled btn-block" onclick="App.closeModal(); App.syncNow()">立即同步</button>
                <button class="btn btn-danger btn-block" style="margin-top:10px;" onclick="App.disableSync()">关闭云同步</button>
            `);
            return;
        }
        this.openModal('开启云同步', `
            <div style="text-align:center; margin-bottom:20px;">
                <div style="font-size:40px;">☁️</div>
                <p style="color:var(--on-surface-variant); font-size:13px; line-height:1.6;">开启后，两台手机可实时共享同一份课程数据<br>（如：老婆续费后，老公手机立即能看到）</p>
            </div>
            <button class="btn btn-filled btn-block" onclick="App.showSyncCreate()">
                创建云同步（本机数据作为初始数据）
            </button>
            <button class="btn btn-tonal btn-block" style="margin-top:10px;" onclick="App.showSyncJoin()">
                加入云同步（输入另一台手机的同步码）
            </button>
            <p style="font-size:12px; color:var(--on-surface-variant); margin-top:16px; text-align:center;">
                💡 建议：先在录入课程较多的那台手机上"创建"，<br>再在其他手机上"加入"
            </p>
        `);
    },

    async showSyncCreate() {
        if (!this.state.settings.syncKey) {
            this.state.settings.syncKey = this.genSyncKey();
        }
        this.state.settings.syncEnabled = true;
        this.save(false);
        const ok = await this.syncPush(false);
        this.renderSettings();
        this.openModal(ok ? '✅ 云同步已开启' : '云同步已开启（上传失败）', `
            <div class="form-group">
                <label class="form-label">同步码（请发给家人，在其手机上输入）</label>
                <div class="sync-key-box" onclick="App.copyText('${this.state.settings.syncKey}')">${this.state.settings.syncKey}</div>
            </div>
            <button class="btn btn-filled btn-block" onclick="App.copyText('${this.state.settings.syncKey}')">复制同步码</button>
            <p style="font-size:12px; color:var(--on-surface-variant); margin-top:14px; line-height:1.6;">
                📱 在另一台手机（如 iPhone）上打开本应用 → 设置 → 云同步 → 加入云同步 → 输入此同步码<br><br>
                ⚠️ 同步码是唯一访问凭证，请勿泄露给他人；本机数据已上传云端
            </p>
            ${ok ? '' : '<p style="font-size:12px; color:var(--danger); margin-top:8px;">⚠️ 上传失败，请检查网络后在设置中点"立即同步"重试</p>'}
            <button class="btn btn-tonal btn-block" style="margin-top:12px;" onclick="App.closeModal()">完成</button>
        `);
    },

    showSyncJoin() {
        this.openModal('加入云同步', `
            <p style="color:var(--on-surface-variant); font-size:13px; margin-bottom:16px;">输入另一台手机上生成的同步码，两台手机将共享同一份课程数据。</p>
            <div class="form-group">
                <label class="form-label">同步码</label>
                <input type="text" class="form-input" id="syncKeyInput" placeholder="cm开头的一串字符" autocomplete="off">
            </div>
            <button class="btn btn-filled btn-block" onclick="App.doJoinSync()">加入并同步</button>
            <p style="font-size:12px; color:var(--on-surface-variant); margin-top:12px;">⚠️ 若本机已有课程数据，加入时可能需要选择保留哪边的数据</p>
        `);
    },

    async doJoinSync() {
        const input = document.getElementById('syncKeyInput');
        const key = input.value.trim();
        if (!/^[0-9a-zA-Z-]{6,60}$/.test(key)) {
            this.showToast('同步码格式不正确');
            return;
        }
        this.state.settings.syncKey = key;
        this.state.settings.syncEnabled = true;
        this.save(false);
        this.closeModal();
        this.showToast('正在从云端同步…');
        await this.syncPull(false);
        this.renderSettings();
    },

    disableSync() {
        this.confirmAction({
            title: '关闭云同步',
            message: '关闭后本机数据保留，但两台手机不再实时共享。<br><br><span style="color: var(--on-surface-variant); font-size: 13px;">之后可在设置里重新开启同步。</span>',
            confirmText: '关闭',
            danger: true,
            onConfirm: () => {
                this.state.settings.syncEnabled = false;
                this.save(false);
                this.renderSettings();
                this.showToast('云同步已关闭');
            }
        });
    },

    copyText(text) {
        const done = () => this.showToast('已复制到剪贴板');
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(done).catch(() => this._copyFallback(text, done));
        } else {
            this._copyFallback(text, done);
        }
    },

    _copyFallback(text, done) {
        try {
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.position = 'fixed';
            ta.style.opacity = '0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            done();
        } catch (e) {
            this.showToast('复制失败，请长按手动复制');
        }
    },

    maybeShowSetup() {
        if (this.state.children.length === 0) {
            this.showSetup();
        }
    },

    bindEvents() {
        // Navigation
        document.querySelectorAll('[data-view]').forEach(btn => {
            btn.addEventListener('click', () => {
                this.switchView(btn.dataset.view);
            });
        });

        // Filter chips (delegated)
        document.getElementById('filterBar').addEventListener('click', (e) => {
            if (e.target.classList.contains('filter-chip')) {
                this.state.currentFilter = e.target.dataset.filter;
                document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
                e.target.classList.add('active');
                this.renderCourseList();
            }
        });

        // Modal overlay click
        document.getElementById('modalOverlay').addEventListener('click', () => this.closeModal());
        document.getElementById('sheetOverlay').addEventListener('click', () => this.closeSheet());

        // Login form: press Enter to submit
        ['loginUsername', 'loginPassword'].forEach(id => {
            document.getElementById(id).addEventListener('keydown', (e) => {
                if (e.key === 'Enter') this.doLogin();
            });
        });

        // Prevent body scroll on iOS
        document.addEventListener('touchmove', (e) => {
            if (e.target.closest('.modal-body, .bottom-sheet, .view, .login-screen, .modal')) return;
            e.preventDefault();
        }, { passive: false });

        // Install prompt
        let deferredPrompt;
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            deferredPrompt = e;
        });
    },

    applyTheme() {
        document.documentElement.setAttribute('data-theme', this.state.settings.theme);
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) {
            meta.content = this.state.settings.theme === 'dark' ? '#1A1B22' : '#4F46E5';
        }
    },

    toggleTheme() {
        this.state.settings.theme = this.state.settings.theme === 'light' ? 'dark' : 'light';
        this.applyTheme();
        this.save();
        this.renderSettings();
    },

    // ---- View Switching ----
    switchView(view) {
        this.state.currentView = view;
        document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
        document.getElementById('view-' + view).classList.add('active');

        // Update nav active state
        document.querySelectorAll('.nav-rail-item, .bottom-nav-item').forEach(item => {
            item.classList.toggle('active', item.dataset.view === view);
        });

        // Update title（仪表盘显示家庭问候语）
        let title;
        if (view === 'dashboard') {
            const hour = new Date().getHours();
            const greeting = hour < 6 ? '夜深了' : hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好';
            const who = this.state.currentUser ? (this.state.currentUser.displayName || '') : '';
            title = `${greeting}${who ? '，' + who : ''}`;
        } else {
            const titles = { courses: '全部课程', stats: '统计', settings: '设置' };
            title = titles[view] || '';
        }
        document.getElementById('appBarTitle').textContent = title;

        // Show/hide FAB
        document.getElementById('fab').style.display = (view === 'dashboard' || view === 'courses') ? 'flex' : 'none';

        // Render specific view
        if (view === 'dashboard') this.renderDashboard();
        if (view === 'courses') this.renderCourseList();
        if (view === 'stats') this.renderStats();
        if (view === 'settings') this.renderSettings();

        // Scroll to top
        document.getElementById('view-' + view).scrollTop = 0;
    },

    // ---- Dashboard ----
    renderDashboard() {
        this.renderDashboardSwitcher();
        this.renderSummary();
        this.renderCoursesByChild();
    },

    renderDashboardSwitcher() {
        const bar = document.getElementById('dashboardSwitcher');
        if (!bar) return;
        const currentId = this.state.dashboardChildId || 'all';
        const items = [{ id: 'all', label: '全部', emoji: '🏠', color: '#33302B' }]
            .concat(this.state.children.map(c => ({
                id: c.id, label: c.childName, emoji: c.emoji || '👦', color: c.color || this.childColors[0]
            })));
        bar.innerHTML = items.map(it => `
            <button class="dash-switch-chip ${currentId === it.id ? 'active' : ''}" data-child-id="${it.id}" style="${currentId === it.id ? `background: ${it.color}; color: #fff; border-color: ${it.color};` : ''}">
                <span class="chip-emoji">${it.emoji}</span>
                <span>${this.escape(it.label)}</span>
            </button>
        `).join('');
        bar.querySelectorAll('.dash-switch-chip').forEach(b => {
            b.addEventListener('click', () => {
                const cid = b.dataset.childId;
                this.state.dashboardChildId = cid === 'all' ? null : cid;
                this.updateThemeByChild();
                this.renderDashboard();
            });
        });
    },

    _dashFilter() {
        const cid = this.state.dashboardChildId;
        return cid ? this.state.courses.filter(c => c.childId === cid) : this.state.courses;
    },

    // 动态更新主题颜色（根据选中的孩子）
    updateThemeByChild() {
        const root = document.documentElement;
        const cid = this.state.dashboardChildId;
        const child = cid ? this.state.children.find(c => c.id === cid) : null;

        if (child && child.color) {
            // 解析孩子颜色
            const color = child.color;
            root.style.setProperty('--kid-primary', color);
            root.style.setProperty('--kid-primary-deep', this._darken(color, 0.15));
            root.style.setProperty('--kid-primary-light', this._lighten(color, 0.25));
            root.style.setProperty('--kid-soft', this._lighten(color, 0.9));
            root.style.setProperty('--kid-soft-2', this._lighten(color, 0.85));
            root.style.setProperty('--kid-deco', this._shiftHue(color, 30));
        } else {
            // 默认使用第一个孩子的颜色
            const firstChild = this.state.children[0];
            const color = firstChild ? (firstChild.color || this.childColors[0]) : this.childColors[0];
            root.style.setProperty('--kid-primary', color);
            root.style.setProperty('--kid-primary-deep', this._darken(color, 0.15));
            root.style.setProperty('--kid-primary-light', this._lighten(color, 0.25));
            root.style.setProperty('--kid-soft', this._lighten(color, 0.9));
            root.style.setProperty('--kid-soft-2', this._lighten(color, 0.85));
            root.style.setProperty('--kid-deco', this._shiftHue(color, 30));
        }

        // 更新 theme-color
        const themeColor = child && child.color ? child.color : (this.state.children[0] ? this.state.children[0].color || this.childColors[0] : this.childColors[0]);
        document.querySelector('meta[name="theme-color"]').setAttribute('content', themeColor);
    },

    // 颜色辅助函数
    _lighten(hex, amount) {
        const num = parseInt(hex.replace('#', ''), 16);
        const r = Math.min(255, (num >> 16) + Math.round(255 * amount));
        const g = Math.min(255, ((num >> 8) & 0x00FF) + Math.round(255 * amount));
        const b = Math.min(255, (num & 0x0000FF) + Math.round(255 * amount));
        return '#' + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
    },

    _darken(hex, amount) {
        const num = parseInt(hex.replace('#', ''), 16);
        const r = Math.max(0, (num >> 16) - Math.round(255 * amount));
        const g = Math.max(0, ((num >> 8) & 0x00FF) - Math.round(255 * amount));
        const b = Math.max(0, (num & 0x0000FF) - Math.round(255 * amount));
        return '#' + (0x1000000 + r * 0x10000 + g * 0x100 + b).toString(16).slice(1);
    },

    _shiftHue(hex, degrees) {
        // 简化版：偏移色相，用于装饰色
        const num = parseInt(hex.replace('#', ''), 16);
        const r = (num >> 16) & 0xFF;
        const g = (num >> 8) & 0xFF;
        const b = num & 0xFF;
        // 转为HSL再偏移（简化处理，直接调整RGB）
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        let h = 0;
        if (max !== min) {
            if (max === r) h = ((g - b) / (max - min) + 6) % 6;
            else if (max === g) h = (b - r) / (max - min) + 2;
            else h = (r - g) / (max - min) + 4;
            h *= 60;
        }
        h = (h + degrees) % 360;
        // HSL to RGB
        const sat = (max - min) / (max + min);
        const l = (max + min) / 2 / 255;
        const c = (1 - Math.abs(2 * l - 1)) * sat;
        const x = c * (1 - Math.abs((h / 60) % 2 - 1));
        const m = l - c / 2;
        let r2 = 0, g2 = 0, b2 = 0;
        if (h < 60) { r2 = c; g2 = x; } else if (h < 120) { r2 = x; g2 = c; }
        else if (h < 180) { g2 = c; b2 = x; } else if (h < 240) { g2 = x; b2 = c; }
        else if (h < 300) { r2 = x; b2 = c; } else { r2 = c; b2 = x; }
        r2 = Math.round((r2 + m) * 255); g2 = Math.round((g2 + m) * 255); b2 = Math.round((b2 + m) * 255);
        return '#' + (0x1000000 + r2 * 0x10000 + g2 * 0x100 + b2).toString(16).slice(1);
    },

    renderSummary() {
        const grid = document.getElementById('summaryGrid');
        const courses = this._dashFilter();
        const totalRemaining = courses.reduce((s, c) => s + Math.max(0, c.remaining), 0);
        const totalCourses = courses.length;
        const lowCount = courses.filter(c => c.remaining > 0 && c.remaining <= this.state.settings.lowThreshold).length;
        const finishedCount = courses.filter(c => c.remaining <= 0).length;

        grid.innerHTML = `
            <div class="summary-card primary">
                <div class="summary-icon">📚</div>
                <div class="summary-value">${totalRemaining}</div>
                <div class="summary-label">总剩余课时</div>
            </div>
            <div class="summary-card success">
                <div class="summary-icon">📖</div>
                <div class="summary-value">${totalCourses}</div>
                <div class="summary-label">课程总数</div>
            </div>
            <div class="summary-card warning">
                <div class="summary-icon">⚠️</div>
                <div class="summary-value">${lowCount}</div>
                <div class="summary-label">余量不足</div>
            </div>
            <div class="summary-card danger">
                <div class="summary-icon">✅</div>
                <div class="summary-value">${finishedCount}</div>
                <div class="summary-label">已完结</div>
            </div>
        `;
    },

    renderCoursesByChild() {
        const container = document.getElementById('coursesByChild');
        const emptyState = document.getElementById('emptyState');

        const courses = this._dashFilter();
        if (this.state.courses.length === 0) {
            container.innerHTML = '';
            emptyState.classList.remove('hidden');
            return;
        }

        emptyState.classList.add('hidden');

        let html = '';
        // 若仪表盘指定了某个宝宝，只显示该宝宝的分组（去掉 group header）
        const focusedChildId = this.state.dashboardChildId;
        const focusedChild = focusedChildId ? this.state.children.find(c => c.id === focusedChildId) : null;

        this.state.children.forEach(child => {
            if (focusedChildId && child.id !== focusedChildId) return;
            const childCourses = courses.filter(c => c.childId === child.id);
            if (childCourses.length === 0) return;

            const childRemaining = childCourses.reduce((s, c) => s + Math.max(0, c.remaining), 0);

            if (focusedChild) {
                // 单一宝宝视图：省略分组标题
                html += `<div class="child-section" data-kid="${child.id}">`;
            } else {
                html += `
                    <div class="child-section" data-kid="${child.id}">
                        <div class="child-flag"></div>
                        <div class="child-section-header">
                            <div class="child-avatar">${child.emoji || '👦'}</div>
                            <h3>${this.escape(child.childName)}</h3>
                            <span class="child-summary">剩余 ${childRemaining} 课时 · ${childCourses.length} 门课程</span>
                        </div>
                `;
            }

            childCourses.forEach(course => {
                html += this.renderCourseCard(course);
            });

            html += '</div>';
        });

        // Show courses without a child assignment (shouldn't normally happen)
        const orphanCourses = this.state.courses.filter(c => !this.state.children.find(ch => ch.id === c.childId));
        if (orphanCourses.length > 0) {
            html += '<div class="child-section"><div class="child-section-header"><h3>未分配</h3></div>';
            orphanCourses.forEach(course => {
                html += this.renderCourseCard(course);
            });
            html += '</div>';
        }

        if (html === '') {
            if (focusedChild) {
                html = `<div class="empty-state"><div class="empty-state-icon">${focusedChild.emoji || '📚'}</div><h2>${this.escape(focusedChild.childName)}还没有课程</h2><p>点击下方按钮为ta添加课程</p></div>`;
            } else {
                html = '<div class="empty-state"><div class="empty-state-icon">📚</div><h2>还没有课程</h2><p>点击右下角按钮添加课程</p></div>';
            }
        }

        container.innerHTML = html;

        // 左滑卡片 → 露出删除按钮
        container.querySelectorAll('.course-swipe-wrap').forEach(wrap => {
            this._attachCourseSwipe(wrap);
        });

        // Bind card clicks
        container.querySelectorAll('.course-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.btn-mini')) return;
                const wrap = card.closest('.course-swipe-wrap');
                if (wrap && wrap.classList.contains('swipe-open')) {
                    e.stopPropagation();
                    e.preventDefault();
                    this._closeCourseSwipe(wrap);
                    return;
                }
                this.showCourseDetail(card.dataset.courseId);
            });
        });

        container.querySelectorAll('.btn-mini.attend').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showCheckInSheet(btn.dataset.courseId);
            });
        });

        container.querySelectorAll('.btn-mini.renew').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showRenewSheet(btn.dataset.courseId);
            });
        });

        container.querySelectorAll('[data-swipe-delete]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const wrap = btn.closest('.course-swipe-wrap');
                if (wrap) this._closeCourseSwipe(wrap);
                this.deleteCourseWithPassword(btn.dataset.swipeDelete);
            });
        });
    },

    renderCourseCard(course) {
        const child = this.state.children.find(c => c.id === course.childId);
        const status = this.getStatus(course.remaining);
        const percent = course.total > 0 ? Math.min(100, (course.remaining / course.total) * 100) : 0;
        const childColor = child ? (child.color || this.childColors[0]) : '#999';

        return `
            <div class="course-swipe-wrap" data-course-id="${course.id}">
                <div class="course-swipe-actions">
                    <button class="swipe-delete-btn" data-swipe-delete="${course.id}" aria-label="删除课程">
                        <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                        <span>删除</span>
                    </button>
                </div>
                <div class="course-card${status.key === 'low' ? ' low-warm' : ''}" data-course-id="${course.id}" data-kid="${child ? child.id : ''}" style="border-left-color: ${childColor}">
                    <div class="course-card-header">
                        <div class="course-card-info">
                            <h4>${this.escape(course.courseName)}</h4>
                            <div class="course-institution">${this.escape(course.institutionName)}</div>
                        </div>
                        <div class="course-card-balance">
                            <div class="balance-number" style="color: var(--${status.color})">${course.remaining}</div>
                            <div class="balance-label">剩余 / ${course.total}</div>
                        </div>
                    </div>
                    <div class="progress-track">
                        <div class="progress-fill status-${status.key}" style="width: ${percent}%"></div>
                    </div>
                    <div class="course-card-footer">
                        <span class="status-badge ${status.key}">${status.label}</span>
                        <span>已上 ${course.total - course.remaining} / ${course.total} 课时</span>
                    </div>
                    <div class="course-card-actions">
                        <button class="btn-mini attend" data-course-id="${course.id}">
                            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                            签到
                        </button>
                        <button class="btn-mini renew" data-course-id="${course.id}">
                            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 6v3l4-4-4-4v3c-4.42 0-8 3.58-8 8 0 1.57.46 3.03 1.24 4.26L6.7 14.8A5.87 5.87 0 016 12c0-3.31 2.69-6 6-6z"/></svg>
                            续费
                        </button>
                    </div>
                </div>
            </div>
        `;
    },

    // ---- Status Helper ----
    getStatus(remaining) {
        if (remaining <= 0) return { key: 'low', color: 'danger', label: '已完结' };
        if (remaining <= this.state.settings.lowThreshold) return { key: 'low', color: 'danger', label: '余量不足' };
        if (remaining <= this.state.settings.lowThreshold * 3) return { key: 'moderate', color: 'warning', label: '余量适中' };
        return { key: 'good', color: 'success', label: '余量充足' };
    },

    // ---- Course List View ----
    renderCourseList() {
        this.renderFilterChips();
        const list = document.getElementById('courseList');
        let courses = [...this.state.courses];

        // Apply filter
        if (this.state.currentFilter !== 'all') {
            if (this.state.currentFilter === 'low') {
                courses = courses.filter(c => c.remaining > 0 && c.remaining <= this.state.settings.lowThreshold);
            } else if (this.state.currentFilter === 'finished') {
                courses = courses.filter(c => c.remaining <= 0);
            } else {
                courses = courses.filter(c => c.childId === this.state.currentFilter);
            }
        }

        if (courses.length === 0) {
            list.innerHTML = '<div class="empty-state"><div class="empty-state-icon">📭</div><h2>暂无课程</h2></div>';
            return;
        }

        list.innerHTML = courses.map(c => this.renderCourseCard(c)).join('');

        // 左滑卡片 → 露出删除按钮
        list.querySelectorAll('.course-swipe-wrap').forEach(wrap => {
            this._attachCourseSwipe(wrap);
        });

        list.querySelectorAll('.course-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('.btn-mini')) return;
                const wrap = card.closest('.course-swipe-wrap');
                if (wrap && wrap.classList.contains('swipe-open')) {
                    // 已打开则点击关闭，不再进入详情
                    e.stopPropagation();
                    e.preventDefault();
                    this._closeCourseSwipe(wrap);
                    return;
                }
                this.showCourseDetail(card.dataset.courseId);
            });
        });

        list.querySelectorAll('.btn-mini.attend').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showCheckInSheet(btn.dataset.courseId);
            });
        });

        list.querySelectorAll('.btn-mini.renew').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.showRenewSheet(btn.dataset.courseId);
            });
        });

        list.querySelectorAll('[data-swipe-delete]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const wrap = btn.closest('.course-swipe-wrap');
                if (wrap) this._closeCourseSwipe(wrap);
                this.deleteCourseWithPassword(btn.dataset.swipeDelete);
            });
        });
    },

    // ---- Course Card Swipe (左滑删除) ----
    _attachCourseSwipe(wrap) {
        const card = wrap.querySelector('.course-card');
        if (!card) return;
        const OPEN_TX = -96;     // 打开时位移
        const LIMIT_TX = -150;   // 最大位移（再远加阻力）

        let startX = 0, startY = 0;
        let tracking = false;
        let directionLocked = false;
        let isOpen = wrap.classList.contains('swipe-open');
        let lastDx = 0;
        let moved = false;

        const close = () => {
            wrap.classList.remove('swipe-open');
            card.style.transition = 'transform 0.22s ease-out';
            card.style.transform = '';
            isOpen = false;
            // transition 结束后清掉 style 避免影响其他状态
            setTimeout(() => { card.style.transition = ''; }, 260);
        };

        // 暴露在对象上以便 click handler 调用
        wrap._closeSwipe = close;

        const onStart = (e) => {
            if (e.touches.length !== 1) return;
            tracking = true;
            directionLocked = false;
            moved = false;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            isOpen = wrap.classList.contains('swipe-open');
            lastDx = 0;
            card.style.transition = 'none';
        };

        const onMove = (e) => {
            if (!tracking || e.touches.length !== 1) return;
            const curX = e.touches[0].clientX;
            const curY = e.touches[0].clientY;
            const dx = curX - startX;
            const dy = curY - startY;

            if (!directionLocked) {
                if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
                if (Math.abs(dx) > Math.abs(dy) * 1.4) {
                    directionLocked = 'h';
                } else if (Math.abs(dy) > Math.abs(dx) * 1.4) {
                    directionLocked = 'v';
                    tracking = false;
                    if (isOpen) close();
                    return;
                }
            }
            if (directionLocked !== 'h') return;

            // 阻止 click 触发（滑动距离足够时即视为 swipe）
            if (Math.abs(dx) > 6) moved = true;

            let baseTx = isOpen ? OPEN_TX : 0;
            let target = baseTx + dx;
            // 不允许右滑出正值
            if (target > 0) target = 0;
            // 阻力：超过 LIMIT 后放缓
            if (target < LIMIT_TX) {
                target = LIMIT_TX + (target - LIMIT_TX) * 0.3;
            }
            card.style.transform = `translateX(${target}px)`;
            lastDx = dx;
        };

        const onEnd = () => {
            if (!tracking) return;
            tracking = false;
            card.style.transition = 'transform 0.22s ease-out';
            if (directionLocked === 'h' && lastDx < -30 && moved) {
                // 打开
                wrap.classList.add('swipe-open');
                card.style.transform = `translateX(${OPEN_TX}px)`;
                isOpen = true;
            } else if (isOpen && lastDx > 30 && moved) {
                // 已经打开状态下大幅右滑 → 关闭
                card.style.transform = '';
                wrap.classList.remove('swipe-open');
                isOpen = false;
            } else {
                // 回到原状态
                if (isOpen) {
                    card.style.transform = `translateX(${OPEN_TX}px)`;
                } else {
                    card.style.transform = '';
                }
            }
            setTimeout(() => { card.style.transition = ''; }, 260);
        };

        card.addEventListener('touchstart', onStart, { passive: true });
        card.addEventListener('touchmove', onMove, { passive: true });
        card.addEventListener('touchend', onEnd);
        card.addEventListener('touchcancel', onEnd);
    },

    _closeCourseSwipe(wrap) {
        if (wrap && typeof wrap._closeSwipe === 'function') wrap._closeSwipe();
    },

    // ---- 删除课程（密码二次校验）----
    deleteCourseWithPassword(courseId) {
        const course = this.state.courses.find(c => c.id === courseId);
        if (!course) return;
        const me = this.state.currentUser;
        const msg = `
            <div style="font-size: 15px; line-height: 1.55; color: var(--on-surface); margin-bottom: 14px;">
                为防止误操作，删除课程 <strong>${this.escape(course.courseName)}</strong> 需要输入登录密码。
                <br><span style="color: var(--on-surface-variant); font-size: 13px;">该课程的所有操作记录也会一并删除，此操作不可恢复。</span>
            </div>
            <div class="form-group" style="margin-bottom: 16px;">
                <label class="form-label">账号：${this.escape(me ? (me.displayName || me.username) : '')}</label>
                <input type="password" class="form-input" id="delPwInput" placeholder="请输入登录密码" autocomplete="current-password">
            </div>
            <div style="display:flex; gap:10px;">
                <button class="btn btn-tonal" id="delPwCancel" style="flex:1;">取消</button>
                <button class="btn btn-filled" id="delPwOk" style="flex:1; background: var(--danger); color:#fff;">确认删除</button>
            </div>
        `;
        this.openModal('删除课程', msg);

        const pwInput = document.getElementById('delPwInput');
        const okBtn = document.getElementById('delPwOk');
        const cancelBtn = document.getElementById('delPwCancel');

        if (pwInput) setTimeout(() => pwInput.focus(), 50);

        const cleanup = () => {
            okBtn.removeEventListener('click', okClick);
            cancelBtn.removeEventListener('click', cancelClick);
            pwInput.removeEventListener('keydown', onKey);
        };
        const okClick = () => {
            const pw = pwInput.value;
            const user = this.state.users.find(u => u.username === (me && me.username));
            if (!user) {
                this.showToast('账号异常');
                cleanup(); this.closeModal();
                return;
            }
            if (user.password !== pw) {
                this.showToast('密码错误');
                pwInput.value = '';
                pwInput.focus();
                return;
            }
            cleanup();
            this.closeModal();
            this.state.courses = this.state.courses.filter(c => c.id !== courseId);
            this.state.transactions = this.state.transactions.filter(t => t.courseId !== courseId);
            this.save();
            this.render();
            this.showToast('课程已删除');
        };
        const cancelClick = () => { cleanup(); this.closeModal(); };
        const onKey = (e) => { if (e.key === 'Enter') okClick(); };

        okBtn.addEventListener('click', okClick);
        cancelBtn.addEventListener('click', cancelClick);
        pwInput.addEventListener('keydown', onKey);
    },

    renderFilterChips() {
        const bar = document.getElementById('filterBar');
        let html = `<button class="filter-chip ${this.state.currentFilter === 'all' ? 'active' : ''}" data-filter="all">全部</button>`;

        this.state.children.forEach(child => {
            const active = this.state.currentFilter === child.id ? 'active' : '';
            html += `<button class="filter-chip ${active}" data-filter="${child.id}">${this.escape(child.childName)}</button>`;
        });

        html += `<button class="filter-chip ${this.state.currentFilter === 'low' ? 'active' : ''}" data-filter="low">余量不足</button>`;
        html += `<button class="filter-chip ${this.state.currentFilter === 'finished' ? 'active' : ''}" data-filter="finished">已完结</button>`;

        bar.innerHTML = html;
    },

    // ---- Statistics View ----
    renderStats() {
        const container = document.getElementById('statsContent');
        const courses = this.state.courses;
        const transactions = this.state.transactions;

        const totalRemaining = courses.reduce((s, c) => s + Math.max(0, c.remaining), 0);
        const totalAttended = courses.reduce((s, c) => s + (c.total - c.remaining), 0);
        const totalSpent = transactions
            .filter(t => t.type === 'renew')
            .reduce((s, t) => s + (t.amount * (t.unitPrice || 0)), 0);
        const totalRenewed = transactions.filter(t => t.type === 'renew').reduce((s, t) => s + t.amount, 0);

        // Per-child stats
        let childStatsHtml = '';
        this.state.children.forEach(child => {
            const childCourses = courses.filter(c => c.childId === child.id);
            const childRemaining = childCourses.reduce((s, c) => s + Math.max(0, c.remaining), 0);
            const childAttended = childCourses.reduce((s, c) => s + (c.total - c.remaining), 0);
            const childSpent = childCourses.reduce((s, c) => s + (c.totalPrice || 0), 0);

            childStatsHtml += `
                <div class="stat-row">
                    <span class="stat-label">${this.escape(child.childName)} · 剩余/已上</span>
                    <span class="stat-value">${childRemaining} / ${childAttended} 课时</span>
                </div>
            `;
        });

        // Per-course bar chart
        let barChartHtml = '';
        const chartCourses = courses.filter(c => c.total > 0).slice(0, 8);
        chartCourses.forEach(course => {
            const percent = Math.min(100, (course.remaining / course.total) * 100);
            const status = this.getStatus(course.remaining);
            barChartHtml += `
                <div class="bar-chart-item">
                    <div style="font-size: 11px; color: var(--on-surface-variant); margin-bottom: 2px;">${course.remaining}</div>
                    <div class="bar-chart-bar" style="height: ${percent}%; background: var(--${status.color == 'danger' ? 'danger' : status.color == 'warning' ? 'warning' : 'success'});"></div>
                    <div class="bar-chart-label">${this.escape(course.courseName.length > 4 ? course.courseName.substring(0, 4) : course.courseName)}</div>
                </div>
            `;
        });

        // Recent transactions
        let recentHtml = '';
        const recent = [...transactions].sort((a, b) => b.date - a.date).slice(0, 10);
        if (recent.length === 0) {
            recentHtml = '<p style="color: var(--on-surface-variant); text-align: center; padding: 20px;">暂无记录</p>';
        } else {
            recent.forEach(t => {
                const course = courses.find(c => c.id === t.courseId);
                const courseName = course ? course.courseName : '未知课程';
                const dateStr = this.formatTxnDate(t);
                if (t.type === 'renew') {
                    recentHtml += `
                        <div class="transaction-item">
                            <div class="transaction-icon renew">➕</div>
                            <div class="transaction-info">
                                <div class="trans-title">${this.escape(courseName)} · 续费${t.note ? ' · ' + this.escape(t.note) : ''}${t.operator ? '<span class="trans-operator">' + this.escape(t.operator) + '</span>' : ''}</div>
                                <div class="trans-date${t.backfill ? ' backfill' : ''}">${dateStr}</div>
                            </div>
                            <div class="transaction-amount renew">+${t.amount}</div>
                        </div>
                    `;
                } else {
                    recentHtml += `
                        <div class="transaction-item">
                            <div class="transaction-icon attend">✓</div>
                            <div class="transaction-info">
                                <div class="trans-title">${this.escape(courseName)} · 上课${t.note ? ' · ' + this.escape(t.note) : ''}${t.operator ? '<span class="trans-operator">' + this.escape(t.operator) + '</span>' : ''}</div>
                                <div class="trans-date${t.backfill ? ' backfill' : ''}">${dateStr}</div>
                            </div>
                            <div class="transaction-amount attend">-${t.amount}</div>
                        </div>
                    `;
                }
            });
        }

        container.innerHTML = `
            <div class="stat-card">
                <h4>总览</h4>
                <div class="stat-row"><span class="stat-label">总剩余课时</span><span class="stat-value">${totalRemaining}</span></div>
                <div class="stat-row"><span class="stat-label">已上课时</span><span class="stat-value">${totalAttended}</span></div>
                <div class="stat-row"><span class="stat-label">累计续费课时</span><span class="stat-value">${totalRenewed}</span></div>
                <div class="stat-row"><span class="stat-label">累计花费</span><span class="stat-value">¥${totalSpent.toFixed(0)}</span></div>
            </div>

            <div class="stat-card">
                <h4>各孩子统计</h4>
                ${childStatsHtml || '<p style="color: var(--on-surface-variant);">暂无数据</p>'}
            </div>

            <div class="stat-card">
                <h4>课程余量一览</h4>
                <div class="bar-chart">${barChartHtml || '<p style="color: var(--on-surface-variant);">暂无数据</p>'}</div>
            </div>

            <div class="stat-card">
                <h4>最近操作</h4>
                <div class="transaction-list">${recentHtml}</div>
            </div>
        `;
    },

    // ---- Settings View ----
    renderSettings() {
        const container = document.getElementById('settingsContent');
        const theme = this.state.settings.theme;
        const syncOn = this.isSyncActive();
        const lastSync = this.state.lastSyncTime ? this.formatDate(this.state.lastSyncTime) : '从未';

        let childrenHtml = '';
        this.state.children.forEach((child, idx) => {
            const courseCount = this.state.courses.filter(c => c.childId === child.id).length;
            childrenHtml += `
                <div class="settings-item" onclick="App.editChild('${child.id}')">
                    <div class="settings-item-icon" style="background: ${child.color || this.childColors[idx % this.childColors.length]}; color: white; font-size: 18px;">
                        ${child.emoji || '👦'}
                    </div>
                    <div class="settings-item-content">
                        <div class="settings-item-title">${this.escape(child.childName)}</div>
                        <div class="settings-item-subtitle">${courseCount} 门课程</div>
                    </div>
                    <div class="settings-item-value">编辑 ›</div>
                </div>
            `;
        });

        container.innerHTML = `
            <div class="settings-section">
                <div class="settings-section-title">当前账号</div>
                <div class="settings-item">
                    <div class="settings-item-icon" style="background: var(--primary); color: white;">
                        ${this.state.currentUser ? this.escape((this.state.currentUser.displayName || '?').charAt(0)) : '?'}
                    </div>
                    <div class="settings-item-content">
                        <div class="settings-item-title">${this.state.currentUser ? this.escape(this.state.currentUser.displayName) : ''}</div>
                        <div class="settings-item-subtitle">用户名：${this.state.currentUser ? this.escape(this.state.currentUser.username) : ''}</div>
                    </div>
                </div>
                <div class="settings-item" onclick="App.showChangePassword()">
                    <div class="settings-item-icon" style="background: var(--primary-container); color: var(--primary);">🔑</div>
                    <div class="settings-item-content">
                        <div class="settings-item-title">修改密码</div>
                        <div class="settings-item-subtitle">两个账号均可修改</div>
                    </div>
                </div>
                <div class="settings-item" onclick="App.doLogout()">
                    <div class="settings-item-icon" style="background: var(--danger-container); color: var(--danger);">🚪</div>
                    <div class="settings-item-content">
                        <div class="settings-item-title">退出登录</div>
                        <div class="settings-item-subtitle">切换其他账号</div>
                    </div>
                </div>
            </div>

            <div class="settings-section">
                <div class="settings-section-title">孩子管理</div>
                ${childrenHtml}
                <div class="settings-item" onclick="App.addChild()">
                    <div class="settings-item-icon" style="background: var(--primary-container); color: var(--primary);">+</div>
                    <div class="settings-item-content">
                        <div class="settings-item-title">添加孩子</div>
                    </div>
                </div>
            </div>

            <div class="settings-section">
                <div class="settings-section-title">显示</div>
                <div class="settings-item" onclick="App.toggleTheme()">
                    <div class="settings-item-icon" style="background: var(--primary-container); color: var(--primary);">
                        ${theme === 'light' ? '☀️' : '🌙'}
                    </div>
                    <div class="settings-item-content">
                        <div class="settings-item-title">深色模式</div>
                        <div class="settings-item-subtitle">${theme === 'dark' ? '已开启' : '已关闭'}</div>
                    </div>
                    <div class="switch ${theme === 'dark' ? 'active' : ''}"></div>
                </div>
            </div>

            <div class="settings-section">
                <div class="settings-section-title">提醒设置</div>
                <div class="settings-item" onclick="App.editLowThreshold()">
                    <div class="settings-item-icon" style="background: var(--warning-container); color: var(--warning);">⚠️</div>
                    <div class="settings-item-content">
                        <div class="settings-item-title">余量不足阈值</div>
                        <div class="settings-item-subtitle">剩余 ≤ ${this.state.settings.lowThreshold} 课时时提醒</div>
                    </div>
                    <div class="settings-item-value">${this.state.settings.lowThreshold} ›</div>
                </div>
            </div>

            <div class="settings-section">
                <div class="settings-section-title">云同步（两台手机共享数据）</div>
                <div class="settings-item">
                    <div class="settings-item-icon" style="background: var(--primary-container); color: var(--primary);">☁️</div>
                    <div class="settings-item-content">
                        <div class="settings-item-title">同步状态</div>
                        <div class="settings-item-subtitle">${syncOn ? '已开启 · 上次同步：' + lastSync : '未开启 · 两台手机数据相互独立'}</div>
                    </div>
                    <div class="settings-item-value">${syncOn ? '✅' : '○'}</div>
                </div>
                <div class="settings-item" onclick="App.showSyncSetup()">
                    <div class="settings-item-icon" style="background: var(--primary); color: white;">🔗</div>
                    <div class="settings-item-content">
                        <div class="settings-item-title">${syncOn ? '管理云同步' : '开启云同步'}</div>
                        <div class="settings-item-subtitle">${syncOn ? '查看同步码 / 立即同步 / 关闭' : '创建或加入同步，两台手机共享数据'}</div>
                    </div>
                    <div class="settings-item-value">›</div>
                </div>
                ${syncOn ? `
                <div class="settings-item" onclick="App.syncNow()">
                    <div class="settings-item-icon" style="background: var(--success-container); color: var(--success);">🔄</div>
                    <div class="settings-item-content">
                        <div class="settings-item-title">立即同步</div>
                        <div class="settings-item-subtitle">手动拉取/推送云端数据</div>
                    </div>
                    <div class="settings-item-value">›</div>
                </div>` : ''}
            </div>

            <div class="settings-section">
                <div class="settings-section-title">数据管理</div>
                <div class="settings-item" onclick="App.exportData()">
                    <div class="settings-item-icon" style="background: var(--success-container); color: var(--success);">📤</div>
                    <div class="settings-item-content">
                        <div class="settings-item-title">导出数据</div>
                        <div class="settings-item-subtitle">备份所有课程数据</div>
                    </div>
                </div>
                <div class="settings-item" onclick="App.importData()">
                    <div class="settings-item-icon" style="background: var(--primary-container); color: var(--primary);">📥</div>
                    <div class="settings-item-content">
                        <div class="settings-item-title">导入数据</div>
                        <div class="settings-item-subtitle">从备份恢复</div>
                    </div>
                </div>
            </div>

            <div class="settings-section">
                <div class="settings-section-title">关于</div>
                <div class="settings-item">
                    <div class="settings-item-icon" style="background: var(--surface-container-highest); color: var(--on-surface-variant);">📚</div>
                    <div class="settings-item-content">
                        <div class="settings-item-title">课程余量管理</div>
                        <div class="settings-item-subtitle">版本 1.0.0 · 单机版</div>
                    </div>
                </div>
            </div>
        `;
    },

    // ---- Setup Wizard ----
    showSetup() {
        this.openModal('欢迎使用', `
            <p style="color: var(--on-surface-variant); margin-bottom: 20px; line-height: 1.6;">
                让我们先添加孩子的信息，之后就可以开始管理课程了。
            </p>
            <div id="setupChildren"></div>
            <button class="btn btn-filled btn-block" onclick="App.confirmSetup()">开始使用</button>
        `);

        // Add 2 default children inputs
        const container = document.getElementById('setupChildren');
        container.innerHTML = `
            <div class="form-group">
                <label class="form-label">孩子1 姓名</label>
                <input type="text" class="form-input" id="setupChild1" placeholder="如：小明">
            </div>
            <div class="form-group">
                <label class="form-label">孩子2 姓名</label>
                <input type="text" class="form-input" id="setupChild2" placeholder="如：小红">
            </div>
        `;
    },

    confirmSetup() {
        const name1 = document.getElementById('setupChild1').value.trim();
        const name2 = document.getElementById('setupChild2').value.trim();

        if (name1) {
            this.state.children.push({
                id: this.genId(),
                childName: name1,
                emoji: this.childEmojis[0],
                color: this.childColors[0]
            });
        }
        if (name2) {
            this.state.children.push({
                id: this.genId(),
                childName: name2,
                emoji: this.childEmojis[1],
                color: this.childColors[1]
            });
        }

        this.save();
        this.closeModal();
        this.render();
        this.showToast('设置完成！现在可以添加课程了');
    },

    // ---- Add Course ----
    showAddCourse(courseId) {
        const isEdit = !!courseId;
        const course = isEdit ? this.state.courses.find(c => c.id === courseId) : null;

        if (this.state.children.length === 0) {
            this.showToast('请先添加孩子信息');
            this.showSetup();
            return;
        }

        let childOptions = this.state.children.map(c =>
            `<option value="${c.id}" ${course && course.childId === c.id ? 'selected' : ''}>${this.escape(c.childName)}</option>`
        ).join('');

        this.openModal(isEdit ? '编辑课程' : '添加课程', `
            <div class="form-group">
                <label class="form-label">孩子 *</label>
                <select class="form-select" id="f-child">
                    ${childOptions}
                </select>
            </div>
            <div class="form-group">
                <label class="form-label">培训机构 *</label>
                <input type="text" class="form-input" id="f-institution" placeholder="如：学而思" value="${course ? this.escape(course.institutionName) : ''}">
            </div>
            <div class="form-group">
                <label class="form-label">课程名称 *</label>
                <input type="text" class="form-input" id="f-course" placeholder="如：数学思维" value="${course ? this.escape(course.courseName) : ''}">
            </div>
            <div class="form-group">
                <label class="form-label">老师</label>
                <input type="text" class="form-input" id="f-teacher" placeholder="如：王老师（选填）" value="${course ? this.escape(course.teacher || '') : ''}">
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">总课时 *</label>
                    <input type="number" class="form-input" id="f-total" placeholder="如：24" min="1" value="${course ? course.total : ''}" inputmode="numeric">
                </div>
                <div class="form-group">
                    <label class="form-label">剩余课时 *</label>
                    <input type="number" class="form-input" id="f-remaining" placeholder="如：24" min="0" value="${course ? course.remaining : ''}" inputmode="numeric">
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label class="form-label">总价格（元）</label>
                    <input type="number" class="form-input" id="f-price" placeholder="如：4800" min="0" value="${course ? course.totalPrice || '' : ''}" inputmode="decimal">
                </div>
                <div class="form-group">
                    <label class="form-label">每课时单价（元）</label>
                    <div style="display:flex; gap:6px; align-items:stretch;">
                        <input type="number" class="form-input" id="f-unitPrice" placeholder="自动计算" value="${course ? course.unitPrice || '' : ''}" inputmode="decimal" style="flex:1;">
                        <button type="button" class="btn btn-tonal" id="f-unitPriceAuto" style="flex:0 0 auto; padding:0 12px; min-height:auto;" title="按总价÷总课时重新计算">↺</button>
                    </div>
                </div>
            </div>
            <div class="form-group">
                <label class="form-label">备注</label>
                <textarea class="form-textarea" id="f-notes" placeholder="如：每周六上午上课">${course ? this.escape(course.notes || '') : ''}</textarea>
            </div>
            <div style="display: flex; gap: 10px; margin-top: 20px;">
                ${isEdit ? '<button class="btn btn-danger" onclick="App.deleteCourse(\'' + courseId + '\')" style="flex:0 0 auto;">删除</button>' : ''}
                <button class="btn btn-tonal" onclick="App.closeModal()" style="flex:1;">取消</button>
                <button class="btn btn-filled" onclick="App.saveCourse(${isEdit ? '\'' + courseId + '\'' : 'null'})" style="flex:1;">${isEdit ? '保存' : '添加'}</button>
            </div>
        `);

        // Auto-calculate unit price (totalPrice / total)
        const totalInput = document.getElementById('f-total');
        const priceInput = document.getElementById('f-price');
        const unitInput = document.getElementById('f-unitPrice');
        const autoBtn = document.getElementById('f-unitPriceAuto');
        let unitPriceManual = false; // 用户是否手动改过

        const computeUnit = () => {
            if (unitPriceManual) return;
            const total = parseFloat(totalInput.value);
            const price = parseFloat(priceInput.value);
            if (total > 0 && price >= 0) {
                unitInput.value = (price / total).toFixed(2);
            } else if (!price) {
                unitInput.value = '';
            }
        };
        totalInput.addEventListener('input', computeUnit);
        priceInput.addEventListener('input', computeUnit);
        unitInput.addEventListener('input', () => {
            // 用户手动输入即标记
            unitPriceManual = true;
            unitInput.style.background = 'var(--tertiary-container, #FFF4E1)';
            autoBtn.style.opacity = '1';
        });
        autoBtn.addEventListener('click', () => {
            unitPriceManual = false;
            unitInput.style.background = '';
            computeUnit();
            autoBtn.blur();
        });

        // 表单打开时若总价/总课时都有效，立即重算一次（覆盖旧值/历史值）
        setTimeout(computeUnit, 0);
    },

    saveCourse(courseId) {
        const childId = document.getElementById('f-child').value;
        const institutionName = document.getElementById('f-institution').value.trim();
        const courseName = document.getElementById('f-course').value.trim();
        const teacher = document.getElementById('f-teacher').value.trim();
        const total = parseInt(document.getElementById('f-total').value) || 0;
        const remaining = parseInt(document.getElementById('f-remaining').value) || 0;
        const totalPrice = parseFloat(document.getElementById('f-price').value) || 0;
        const unitPrice = parseFloat(document.getElementById('f-unitPrice').value) || 0;
        const notes = document.getElementById('f-notes').value.trim();

        if (!institutionName || !courseName) {
            this.showToast('请填写培训机构和课程名称');
            return;
        }
        if (total <= 0) {
            this.showToast('请输入有效的总课时');
            return;
        }
        if (remaining > total) {
            this.showToast('剩余课时不能超过总课时');
            return;
        }

        if (courseId) {
            // Edit existing
            const course = this.state.courses.find(c => c.id === courseId);
            Object.assign(course, { childId, institutionName, courseName, teacher, total, remaining, totalPrice, unitPrice, notes, _ts: Date.now() });
        } else {
            // Add new
            const course = {
                id: this.genId(),
                childId, institutionName, courseName, teacher, total, remaining, totalPrice, unitPrice, notes,
                createdAt: Date.now(),
                _ts: Date.now()
            };
            this.state.courses.push(course);
        }

        this.save();
        this.closeModal();
        this.render();
        this.showToast(courseId ? '课程已更新' : '课程已添加');
    },

    deleteCourse(courseId) {
        this.confirmAction({
            title: '删除课程',
            message: '确定要删除这个课程吗？<br><br><span style="color: var(--on-surface-variant); font-size: 13px;">该课程的所有操作记录也会一并删除。</span>',
            confirmText: '删除',
            danger: true,
            onConfirm: () => {
                this.state.courses = this.state.courses.filter(c => c.id !== courseId);
                this.state.transactions = this.state.transactions.filter(t => t.courseId !== courseId);
                this.save();
                this.render();
                this.showToast('课程已删除');
            }
        });
    },

    // ---- Course Detail ----
    showCourseDetail(courseId) {
        const course = this.state.courses.find(c => c.id === courseId);
        if (!course) return;

        // 设置日历上下文
        this.state.calCourseId = courseId;
        // 默认定位到最近一条记录所在月份，没有记录则当月
        const latestTxn = this.state.transactions
            .filter(t => t.courseId === courseId)
            .sort((a, b) => b.date - a.date)[0];
        if (latestTxn) {
            const ld = new Date(latestTxn.date);
            this.state.calYear = ld.getFullYear();
            this.state.calMonth = ld.getMonth();
        } else {
            const now = new Date();
            this.state.calYear = now.getFullYear();
            this.state.calMonth = now.getMonth();
        }

        const child = this.state.children.find(c => c.id === course.childId);
        const status = this.getStatus(course.remaining);
        const percent = course.total > 0 ? Math.min(100, (course.remaining / course.total) * 100) : 0;
        const attended = course.total - course.remaining;
        const unitPrice = course.unitPrice || (course.totalPrice && course.total ? (course.totalPrice / course.total) : 0);

        // Transactions for this course
        const txns = this.state.transactions
            .filter(t => t.courseId === courseId)
            .sort((a, b) => b.date - a.date);

        let txnsHtml = '';
        if (txns.length === 0) {
            txnsHtml = '<p style="color: var(--on-surface-variant); text-align: center; padding: 16px;">暂无记录</p>';
        } else {
            txns.forEach(t => {
                const actions = (t.type === 'attend') ? `
                    <div class="txn-actions">
                        <button class="txn-action-btn edit" data-txn-id="${t.id}" title="修改数量/日期" aria-label="编辑签到">
                            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                        </button>
                        <button class="txn-action-btn delete" data-txn-id="${t.id}" title="删除签到" aria-label="删除签到">
                            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                        </button>
                    </div>` : '';
                if (t.type === 'renew') {
                    txnsHtml += `
                        <div class="transaction-item">
                            <div class="transaction-icon renew">➕</div>
                            <div class="transaction-info">
                                <div class="trans-title">续费 ${t.amount} 课时${t.note ? ' · ' + this.escape(t.note) : ''}${t.operator ? '<span class="trans-operator">' + this.escape(t.operator) + '</span>' : ''}</div>
                                <div class="trans-date${t.backfill ? ' backfill' : ''}">${this.formatTxnDate(t)}</div>
                            </div>
                            <div class="transaction-amount renew">+${t.amount}</div>
                        </div>
                    `;
                } else {
                    txnsHtml += `
                        <div class="transaction-item txn-attend" data-txn-id="${t.id}">
                            <div class="transaction-icon attend">✓</div>
                            <div class="transaction-info">
                                <div class="trans-title">上课 ${t.amount} 课时${t.note ? ' · ' + this.escape(t.note) : ''}${t.operator ? '<span class="trans-operator">' + this.escape(t.operator) + '</span>' : ''}</div>
                                <div class="trans-date${t.backfill ? ' backfill' : ''}">${this.formatTxnDate(t)}</div>
                            </div>
                            <div class="transaction-amount attend">-${t.amount}</div>
                            ${actions}
                        </div>
                    `;
                }
            });
        }

        this.openModal('课程详情', `
            <div class="detail-header">
                <div class="detail-balance" style="color: var(--${status.color})">${course.remaining}</div>
                <div class="detail-balance-label">剩余课时 / 共 ${course.total} 课时</div>
            </div>
            <div class="detail-progress">
                <div class="progress-track">
                    <div class="progress-fill status-${status.key}" style="width: ${percent}%"></div>
                </div>
            </div>
            <div class="detail-meta">
                <div class="detail-meta-item">
                    <div class="detail-meta-label">孩子</div>
                    <div class="detail-meta-value">${child ? this.escape(child.childName) : '未分配'}</div>
                </div>
                <div class="detail-meta-item">
                    <div class="detail-meta-label">培训机构</div>
                    <div class="detail-meta-value">${this.escape(course.institutionName)}</div>
                </div>
                <div class="detail-meta-item">
                    <div class="detail-meta-label">课程名称</div>
                    <div class="detail-meta-value">${this.escape(course.courseName)}</div>
                </div>
                <div class="detail-meta-item">
                    <div class="detail-meta-label">老师</div>
                    <div class="detail-meta-value">${course.teacher ? this.escape(course.teacher) : '-'}</div>
                </div>
                <div class="detail-meta-item">
                    <div class="detail-meta-label">已上课时</div>
                    <div class="detail-meta-value">${attended} / ${course.total}</div>
                </div>
                <div class="detail-meta-item">
                    <div class="detail-meta-label">每课时单价</div>
                    <div class="detail-meta-value">¥${unitPrice ? unitPrice.toFixed(2) : '-'}</div>
                </div>
            </div>
            ${course.notes ? `<div style="background: var(--surface-container); padding: 12px; border-radius: var(--radius-md); margin: 12px 0; font-size: 14px;"><strong>备注：</strong>${this.escape(course.notes)}</div>` : ''}
            <div class="action-buttons">
                <button class="btn btn-tonal" onclick="App.showCheckInSheet('${courseId}')">
                    <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                    签到
                </button>
                <button class="btn btn-success" onclick="App.showRenewSheet('${courseId}')">
                    <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 6v3l4-4-4-4v3c-4.42 0-8 3.58-8 8 0 1.57.46 3.03 1.24 4.26L6.7 14.8A5.87 5.87 0 016 12c0-3.31 2.69-6 6-6z"/></svg>
                    续费
                </button>
            </div>
            <div style="display: flex; gap: 10px;">
                <button class="btn btn-outlined btn-block" onclick="App.showAddCourse('${courseId}')">编辑课程</button>
            </div>
            <div style="margin-top: 20px;">
                <h4 style="font-size: 15px; font-weight: 600; margin-bottom: 8px;">课程日历</h4>
                <div id="courseCalendarBox">${this.renderCourseCalendar(courseId, this.state.calYear, this.state.calMonth)}</div>
            </div>
            <div style="margin-top: 20px;">
                <h4 style="font-size: 15px; font-weight: 600; margin-bottom: 8px;">操作记录</h4>
                <div class="transaction-list">${txnsHtml}</div>
            </div>
        `);

        // 绑定签到编辑/删除按钮
        document.querySelectorAll('.txn-action-btn.edit').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.editTransaction(btn.dataset.txnId);
            });
        });
        document.querySelectorAll('.txn-action-btn.delete').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.deleteTransaction(btn.dataset.txnId);
            });
        });
    },

    // ---- Transaction Edit / Delete ----
    editTransaction(txnId) {
        const txn = this.state.transactions.find(t => t.id === txnId);
        if (!txn) return;
        if (txn.type !== 'attend') {
            this.showToast('仅签到记录可编辑');
            return;
        }
        const course = this.state.courses.find(c => c.id === txn.courseId);
        if (!course) return;

        // 初始日期：补签记录显示归属日期，否则显示操作日期
        let dateStr;
        if (txn.signDate) {
            dateStr = txn.signDate;
        } else {
            const d = new Date(txn.date);
            dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        this.openModal('修改签到', `
            <p style="color: var(--on-surface-variant); font-size: 13px; margin-bottom: 14px;">
                当前剩余 <strong>${course.remaining}</strong> 课时 · 课程：${this.escape(course.courseName)}
            </p>
            <div style="margin-bottom: 14px;">
                <label class="form-label">签到日期（选今天为当日签到，选过往为补签）</label>
                <input type="date" id="txnDate" class="form-input" value="${dateStr}" max="${todayStr}">
            </div>
            <div>
                <label class="form-label">上课数量</label>
                <div class="stepper">
                    <button class="stepper-btn" data-step="-0.5">−</button>
                    <span class="stepper-value" id="txnAmountVal">${this._fmtAmount(txn.amount)}</span>
                    <button class="stepper-btn" data-step="0.5">+</button>
                </div>
                <input type="hidden" id="txnAmount" value="${txn.amount}">
            </div>
            <div class="form-group" style="margin-top: 14px;">
                <label class="form-label">备注（选填）</label>
                <input type="text" class="form-input" id="txnNote" placeholder="如：上了半节课、请假补课等" value="${txn.note ? this.escape(txn.note) : ''}">
            </div>
            <p style="color: var(--on-surface-variant); font-size: 12px; margin: 12px 0 0;">
                保存后记录时间更新为当前操作时刻，日期用于日历标记
            </p>
            <button class="btn btn-filled btn-block" style="margin-top: 14px;" id="txnSaveBtn">保存修改</button>
        `);

        const updateAmount = (delta) => {
            const valEl = document.getElementById('txnAmountVal');
            const hidEl = document.getElementById('txnAmount');
            let v = Math.round((parseFloat(valEl.textContent) + delta) * 10) / 10;
            if (v < 0.5) v = 0.5;
            valEl.textContent = this._fmtAmount(v);
            hidEl.value = v;
        };
        document.querySelectorAll('.stepper-btn').forEach(b => {
            b.addEventListener('click', () => updateAmount(parseFloat(b.dataset.step)));
        });
        document.getElementById('txnSaveBtn').addEventListener('click', () => {
            const newAmount = Math.round((parseFloat(document.getElementById('txnAmount').value) || 1) * 10) / 10;
            const newNote = document.getElementById('txnNote').value.trim();
            const dateInput = document.getElementById('txnDate').value;
            if (!dateInput) { this.showToast('请选择日期'); return; }
            const parts = dateInput.split('-').map(Number);
            if (parts.length !== 3 || parts.some(n => isNaN(n))) { this.showToast('日期无效'); return; }
            const picked = new Date(parts[0], parts[1] - 1, parts[2]);
            const now = new Date();
            const sameDay = picked.getFullYear() === now.getFullYear()
                && picked.getMonth() === now.getMonth()
                && picked.getDate() === now.getDate();

            // 调整 course.remaining：先把原 amount 加回，再扣新的
            const diff = Math.round((newAmount - txn.amount) * 10) / 10;
            if (diff > 0 && diff > course.remaining + 1e-9) {
                this.showToast(`只能再扣 ${course.remaining} 课时，无法 +${this._fmtAmount(diff)}`);
                return;
            }
            course.remaining = Math.max(0, Math.round((course.remaining - diff) * 10) / 10);
            txn.amount = newAmount;
            txn.note = newNote || undefined;
            // 编辑即重新确认：时间 = 编辑时刻；日期改归属（补签则存 signDate）
            txn.date = Date.now();
            if (sameDay) {
                txn.signDate = undefined;
                txn.backfill = undefined;
            } else {
                txn.signDate = dateInput;
                txn.backfill = true;
            }
            txn._ts = Date.now();
            this.save();
            this.closeModal();
            this.showCourseDetail(txn.courseId);
            this.render();
            this.showToast('签到已修改');
        });
    },

    deleteTransaction(txnId) {
        const txn = this.state.transactions.find(t => t.id === txnId);
        if (!txn) return;
        if (txn.type !== 'attend') {
            this.showToast('仅签到记录可删除');
            return;
        }
        const course = this.state.courses.find(c => c.id === txn.courseId);
        if (!course) return;

        const d = new Date(txn.date);
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

        this.confirmAction({
            title: '删除签到',
            message: `确定删除这条签到吗？<br><br>
                <strong>${this.escape(course.courseName)}</strong> · 上课 <strong>${txn.amount}</strong> 课时<br>
                日期：<strong>${dateStr}</strong><br>
                操作人：${this.escape(txn.operator || '未知')}<br><br>
                删除后 <strong>${txn.amount}</strong> 课时将退还到课程余额。`,
            confirmText: '删除',
            cancelText: '取消',
            danger: true,
            onConfirm: () => {
                course.remaining = course.remaining + txn.amount;
                course._ts = Date.now();
                this.state.transactions = this.state.transactions.filter(t => t.id !== txnId);
                this.save();
                this.showCourseDetail(txn.courseId);
                this.render();
                this.showToast('已删除，退还 ' + txn.amount + ' 课时');
            }
        });
    },

    // ---- Course Calendar ----
    renderCourseCalendar(courseId, year, month) {
        const course = this.state.courses.find(c => c.id === courseId);
        if (!course) return '';

        // 按日期(YYYY-MM-DD)分组本课程交易记录（补签记录用 signDate 归属到补签那天）
        const byDay = {};
        this.state.transactions
            .filter(t => t.courseId === courseId)
            .forEach(t => {
                let key;
                if (t.signDate) {
                    key = t.signDate;
                } else {
                    const d = new Date(t.date);
                    key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                }
                if (!byDay[key]) byDay[key] = [];
                byDay[key].push(t);
            });

        const firstDay = new Date(year, month, 1);
        const startWeekday = firstDay.getDay(); // 0=日
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const today = new Date();
        const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'];
        const weekdays = ['日', '一', '二', '三', '四', '五', '六'];

        let cells = '';
        // 前置空白
        for (let i = 0; i < startWeekday; i++) {
            cells += '<div class="cal-cell empty"></div>';
        }
        for (let day = 1; day <= daysInMonth; day++) {
            const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const txns = byDay[key] || [];
            const isToday = key === todayKey;
            // 汇总当天操作: 去重 (type + operator)
            const marks = {};
            txns.forEach(t => {
                const opShort = (t.operator || '').includes('妈') ? '妈' : (t.operator || '').includes('爸') ? '爸' : (t.operator ? t.operator.charAt(0) : '?');
                const mk = t.type === 'renew' ? `renew-${opShort}` : `attend-${opShort}`;
                if (!marks[mk]) marks[mk] = { type: t.type, op: opShort, count: 0 };
                marks[mk].count++;
            });
            const markKeys = Object.keys(marks);
            let marksHtml = '';
            if (markKeys.length > 0) {
                marksHtml = '<div class="cal-marks">' + markKeys.map(k => {
                    const m = marks[k];
                    const cls = m.type === 'renew' ? 'renew' : 'attend';
                    const sym = m.type === 'renew' ? '+' : '✓';
                    // 汇总当天该 (type+operator) 组合的总课时（因为每条 transaction 有 amount 字段）
                    const totalAmount = txns.filter(t => {
                        const tOpShort = (t.operator || '').includes('妈') ? '妈' : (t.operator || '').includes('爸') ? '爸' : (t.operator ? t.operator.charAt(0) : '?');
                        const tKey = t.type === 'renew' ? `renew-${tOpShort}` : `attend-${tOpShort}`;
                        return tKey === k;
                    }).reduce((sum, t) => sum + (t.amount || 1), 0);
                    return `<span class="cal-mark ${cls}" title="${m.type === 'renew' ? '续费' : '上课'} · ${m.op} · 共${totalAmount}课时">${sym}${m.op}<span class="cal-mark-count">${totalAmount}</span></span>`;
                }).join('') + '</div>';
            }
            cells += `<div class="cal-cell${isToday ? ' today' : ''}${txns.length ? ' has-marks' : ''}" data-date="${key}"><span class="cal-day">${day}</span>${marksHtml}</div>`;
        }

        // 统计当月汇总（补签记录按 signDate 归属月份）
        let monthAttend = 0, monthRenew = 0;
        Object.values(byDay).forEach(arr => {
            arr.forEach(t => {
                const d = new Date(t.date);
                const dYear = t.signDate ? parseInt(t.signDate.slice(0, 4), 10) : d.getFullYear();
                const dMonth = t.signDate ? parseInt(t.signDate.slice(5, 7), 10) - 1 : d.getMonth();
                if (dYear === year && dMonth === month) {
                    if (t.type === 'attend') monthAttend += t.amount;
                    else if (t.type === 'renew') monthRenew += t.amount;
                }
            });
        });

        return `
            <div class="course-calendar">
                <div class="cal-header">
                    <button class="cal-nav" onclick="App._calPrev()" aria-label="上一月">‹</button>
                    <span class="cal-title">${year}年${monthNames[month]}</span>
                    <button class="cal-nav" onclick="App._calNext()" aria-label="下一月">›</button>
                </div>
                <button class="cal-today-btn" onclick="App._calToday()">今天</button>
                <div class="cal-weekdays">${weekdays.map(w => `<span>${w}</span>`).join('')}</div>
                <div class="cal-grid">${cells}</div>
                <div class="cal-legend">
                    <span class="legend-item"><span class="legend-dot attend"></span>上课</span>
                    <span class="legend-item"><span class="legend-dot renew"></span>续费</span>
                    <span class="legend-item"><span class="legend-tag">爸</span>爸爸操作</span>
                    <span class="legend-item"><span class="legend-tag">妈</span>妈妈操作</span>
                </div>
                <div class="cal-month-summary">
                    本月：上课 <strong>${monthAttend}</strong> 课时 · 续费 <strong>${monthRenew}</strong> 课时
                </div>
            </div>
        `;
    },

    _calRerender() {
        const box = document.getElementById('courseCalendarBox');
        if (box && this.state.calCourseId) {
            box.innerHTML = this.renderCourseCalendar(this.state.calCourseId, this.state.calYear, this.state.calMonth);
        }
    },

    _calPrev() {
        this.state.calMonth--;
        if (this.state.calMonth < 0) { this.state.calMonth = 11; this.state.calYear--; }
        this._calRerender();
    },

    _calNext() {
        this.state.calMonth++;
        if (this.state.calMonth > 11) { this.state.calMonth = 0; this.state.calYear++; }
        this._calRerender();
    },

    _calToday() {
        const now = new Date();
        this.state.calYear = now.getFullYear();
        this.state.calMonth = now.getMonth();
        this._calRerender();
    },

    // ---- Check-in Sheet (签到) ----
    showCheckInSheet(courseId) {
        const course = this.state.courses.find(c => c.id === courseId);
        if (!course) return;

        if (course.remaining <= 0) {
            this.showToast('课时已用完，请先续费');
            return;
        }

        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const todayStr = `${yyyy}-${mm}-${dd}`;

        this.openSheet(`
            <h3 style="font-size: 18px; font-weight: 700; margin-bottom: 4px;">${this.escape(course.courseName)}</h3>
            <p style="color: var(--on-surface-variant); font-size: 13px; margin-bottom: 16px;">当前剩余 ${course.remaining} 课时 · 本次签到</p>
            <div style="display: flex; gap: 12px; margin-bottom: 16px;">
                <div style="flex:1;">
                    <label class="form-label">签到日期</label>
                    <input type="date" id="checkinDate" class="form-input" value="${todayStr}" max="${todayStr}">
                </div>
                <div style="flex:0 0 auto;">
                    <label class="form-label">本次课时</label>
                    <div class="stepper" style="margin:0;">
                        <button class="stepper-btn" onclick="App._stepperChange(-0.5)">−</button>
                        <span class="stepper-value" id="stepperValue">1</span>
                        <button class="stepper-btn" onclick="App._stepperChange(0.5)">+</button>
                    </div>
                    <input type="hidden" id="stepperInput" value="1">
                </div>
            </div>
            <div class="form-group" style="margin-bottom: 16px;">
                <label class="form-label">备注（选填）</label>
                <input type="text" class="form-input" id="checkinNote" placeholder="如：上了半节课、请假补课等">
            </div>
            <p style="color: var(--on-surface-variant); font-size: 12px; margin: -8px 0 16px;">
                <span style="display:inline-block;width:6px;height:6px;background:var(--primary);border-radius:50%;margin-right:6px;vertical-align:middle;"></span>
                记录时间=当前操作时刻；日期选过往则为补签（日历按所选日期标记）
            </p>
            <button class="btn btn-filled btn-block" onclick="App.doAttendCustom('${courseId}')">
                <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
                确认签到
            </button>
        `);
    },

    // 数字格式化：1 显示 "1"，0.5 显示 "0.5"，避免出现 "1.0"
    _fmtAmount(v) {
        return (Math.round(v * 10) / 10).toString();
    },

    _stepperChange(delta) {
        const el = document.getElementById('stepperValue');
        let val = parseFloat(el.textContent) + delta;
        if (val < 0.5) val = 0.5;
        val = Math.round(val * 10) / 10;
        el.textContent = this._fmtAmount(val);
        document.getElementById('stepperInput').value = val;
    },

    doAttend(courseId, amount) {
        const course = this.state.courses.find(c => c.id === courseId);
        if (!course) return;

        if (amount > course.remaining + 1e-9) {
            this.showToast('超出剩余课时');
            return;
        }

        // 备注先读取（补签确认弹窗可能关闭签到面板）
        const noteEl = document.getElementById('checkinNote');
        const note = noteEl ? noteEl.value.trim() : '';

        // 签到时间 = 实际点击签到的时刻；若选了补签日期，signDate 记录归属日期（日历按它标记）
        let isBackfill = false;
        let signDate = undefined;
        const dateEl = document.getElementById('checkinDate');
        if (dateEl && dateEl.value) {
            const parts = dateEl.value.split('-').map(Number);
            if (parts.length === 3 && parts.every(n => !isNaN(n))) {
                const pickedDay = new Date(parts[0], parts[1] - 1, parts[2]);
                if (!isNaN(pickedDay.getTime())) {
                    // 比较日期部分（当天0点），而不是当天23:59:59，否则"今天"也会被误拦
                    const todayStart = new Date();
                    todayStart.setHours(0, 0, 0, 0);
                    if (pickedDay.getTime() > todayStart.getTime()) {
                        this.showToast('签到日期不能晚于今天');
                        return;
                    }
                    // 判断是不是今天：日期部分一致就算今天
                    const now = new Date();
                    const sameDay = pickedDay.getFullYear() === now.getFullYear()
                        && pickedDay.getMonth() === now.getMonth()
                        && pickedDay.getDate() === now.getDate();
                    if (!sameDay) {
                        // 补签：时间仍是操作时刻，另存归属日期供日历定位
                        isBackfill = true;
                        signDate = `${parts[0]}-${String(parts[1]).padStart(2, '0')}-${String(parts[2]).padStart(2, '0')}`;
                    }
                }
            }
        }

        // 补签前明确提示，避免误以为"当天签到被标成补签"
        if (isBackfill && signDate) {
            this.confirmAction({
                title: '补签确认',
                message: `所选签到日期是 <strong>${signDate}</strong>（早于今天，属于补签），记录将显示"补签"并标记到该日期。<br><br>如果是要签今天，请点取消，把日期改回今天。`,
                confirmText: '确认补签',
                cancelText: '取消',
                onConfirm: () => this._commitAttend(courseId, amount, isBackfill, signDate, note)
            });
            return;
        }
        this._commitAttend(courseId, amount, isBackfill, signDate, note);
    },

    _commitAttend(courseId, amount, isBackfill, signDate, note) {
        const course = this.state.courses.find(c => c.id === courseId);
        if (!course) return;

        course.remaining = Math.max(0, Math.round((course.remaining - amount) * 10) / 10);
        course._ts = Date.now();

        this.state.transactions.push({
            id: this.genId(),
            courseId,
            type: 'attend',
            amount,
            operator: this.state.currentUser ? this.state.currentUser.displayName : '',
            date: Date.now(),
            backfill: isBackfill || undefined,
            signDate,
            note: note || undefined
        });

        this.save();
        this.closeSheet();
        this.closeModal();
        this.render();

        const status = this.getStatus(course.remaining);
        let msg = `已签到 ${this._fmtAmount(amount)} 课时`;
        if (course.remaining === 0) {
            msg = '课时已用完！请及时续费';
        } else if (status.key === 'low') {
            msg = `剩余 ${course.remaining} 课时，余量不足`;
        }
        this.showToast(msg);
    },

    doAttendCustom(courseId) {
        const amount = Math.round((parseFloat(document.getElementById('stepperInput').value) || 1) * 10) / 10;
        this.doAttend(courseId, amount);
    },

    // ---- Renew Sheet ----
    showRenewSheet(courseId) {
        const course = this.state.courses.find(c => c.id === courseId);
        if (!course) return;

        const unitPrice = course.unitPrice || (course.totalPrice && course.total ? (course.totalPrice / course.total).toFixed(2) : 0);

        this.openSheet(`
            <h3 style="font-size: 18px; font-weight: 700; margin-bottom: 4px;">${this.escape(course.courseName)}</h3>
            <p style="color: var(--on-surface-variant); font-size: 13px; margin-bottom: 16px;">当前剩余 ${course.remaining} 课时 · 续费增加课时</p>
            <div class="form-group">
                <label class="form-label">增加课时数 *（点击数字可自定义输入）</label>
                <div class="stepper">
                    <button class="stepper-btn" onclick="App._renewStepper(-1)">−</button>
                    <input type="number" class="stepper-input" id="renewStepperValue" value="10" inputmode="numeric" min="0" max="9999" step="1" aria-label="续费课时数">
                    <button class="stepper-btn" onclick="App._renewStepper(1)">+</button>
                </div>
                <input type="hidden" id="renewStepperInput" value="10">
            </div>
            <div class="quick-class-grid">
                ${[5, 10, 12, 16, 24, 48].map(n => `
                    <button class="quick-class-btn" onclick="App._setRenewAmount(${n})">${n}</button>
                `).join('')}
            </div>
            <div class="form-group" style="margin-top: 16px;">
                <label class="form-label">本次支付金额（选填）</label>
                <input type="number" class="form-input" id="renewPrice" placeholder="如：2400" inputmode="decimal">
            </div>
            <div class="form-group">
                <label class="form-label">备注（选填）</label>
                <input type="text" class="form-input" id="renewNote" placeholder="如：2024春季续费">
            </div>
            <button class="btn btn-success btn-block" style="margin-top: 16px;" onclick="App.doRenew('${courseId}')">
                <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 6v3l4-4-4-4v3c-4.42 0-8 3.58-8 8 0 1.57.46 3.03 1.24 4.26L6.7 14.8A5.87 5.87 0 016 12c0-3.31 2.69-6 6-6z"/></svg>
                确认续费
            </button>
        `);
    },

    _renewStepper(delta) {
        const el = document.getElementById('renewStepperValue');
        let val = (parseFloat(el.value) || 0) + delta;
        if (val < 0) val = 0;
        val = Math.round(val * 10) / 10;
        el.value = val;
        document.getElementById('renewStepperInput').value = val;
    },

    _setRenewAmount(n) {
        const el = document.getElementById('renewStepperValue');
        el.value = n;
        document.getElementById('renewStepperInput').value = n;
        el.blur(); // 快捷键选完收起键盘
    },

    doRenew(courseId) {
        const course = this.state.courses.find(c => c.id === courseId);
        if (!course) return;

        // 优先读输入框实时值（支持自定义输入，含小数如 0.5）
        const valEl = document.getElementById('renewStepperValue');
        const amount = Math.round((parseFloat(valEl && valEl.value) || 0) * 10) / 10;
        if (!amount || amount <= 0) {
            this.showToast('请输入续费课时数');
            return;
        }
        const price = parseFloat(document.getElementById('renewPrice').value) || 0;
        const note = document.getElementById('renewNote').value.trim();

        course.remaining += amount;
        course.total += amount;
        if (price > 0) {
            course.totalPrice = (course.totalPrice || 0) + price;
            course.unitPrice = course.totalPrice / course.total;
        }
        course._ts = Date.now();

        this.state.transactions.push({
            id: this.genId(),
            courseId,
            type: 'renew',
            amount,
            unitPrice: price > 0 ? price / amount : 0,
            note,
            operator: this.state.currentUser ? this.state.currentUser.displayName : '',
            date: Date.now()
        });

        this.save();
        this.closeSheet();
        this.closeModal();
        this.render();
        this.showToast(`已续费 ${amount} 课时，当前剩余 ${course.remaining} 课时`);
    },

    // ---- Child Management ----
    addChild() {
        this.openModal('添加孩子', this.renderChildForm());
        this._bindChildForm();
    },

    editChild(childId) {
        const child = this.state.children.find(c => c.id === childId);
        if (!child) return;
        this.openModal('编辑孩子', this.renderChildForm(child));
        this._bindChildForm(childId);
    },

    renderChildForm(child) {
        const c = child || {};
        const emojiList = this.childEmojis;
        const colorList = this.childColors;

        let emojiHtml = emojiList.map((e, i) =>
            `<button class="emoji-option ${c.emoji === e ? 'selected' : ''}" data-emoji="${e}" onclick="App._selectEmoji(this)">${e}</button>`
        ).join('');

        let colorHtml = colorList.map((cl, i) =>
            `<button class="color-option ${c.color === cl ? 'selected' : ''}" data-color="${cl}" onclick="App._selectColor(this)" style="background: ${cl}"></button>`
        ).join('');

        return `
            <div class="form-group">
                <label class="form-label">姓名 *</label>
                <input type="text" class="form-input" id="c-name" placeholder="孩子姓名" value="${c.childName ? this.escape(c.childName) : ''}">
            </div>
            <div class="form-group">
                <label class="form-label">头像</label>
                <div class="emoji-grid">${emojiHtml}</div>
                <input type="hidden" id="c-emoji" value="${c.emoji || emojiList[0]}">
            </div>
            <div class="form-group">
                <label class="form-label">颜色标签</label>
                <div class="color-grid">${colorHtml}</div>
                <input type="hidden" id="c-color" value="${c.color || colorList[0]}">
            </div>
            <div style="display: flex; gap: 10px; margin-top: 20px;">
                ${child ? `<button class="btn btn-danger" onclick="App.deleteChild('${child.id}')" style="flex:0 0 auto;">删除</button>` : ''}
                <button class="btn btn-tonal" onclick="App.closeModal()" style="flex:1;">取消</button>
                <button class="btn btn-filled" onclick="App._saveChild(${child ? `'${child.id}'` : 'null'})" style="flex:1;">保存</button>
            </div>
        `;
    },

    _bindChildForm(childId) {
        // Selection already handled by onclick in template
    },

    _selectEmoji(el) {
        document.querySelectorAll('.emoji-option').forEach(e => e.classList.remove('selected'));
        el.classList.add('selected');
        document.getElementById('c-emoji').value = el.dataset.emoji;
    },

    _selectColor(el) {
        document.querySelectorAll('.color-option').forEach(e => e.classList.remove('selected'));
        el.classList.add('selected');
        document.getElementById('c-color').value = el.dataset.color;
    },

    _saveChild(childId) {
        const name = document.getElementById('c-name').value.trim();
        const emoji = document.getElementById('c-emoji').value;
        const color = document.getElementById('c-color').value;

        if (!name) {
            this.showToast('请输入孩子姓名');
            return;
        }

        if (childId) {
            const child = this.state.children.find(c => c.id === childId);
            Object.assign(child, { childName: name, emoji, color, _ts: Date.now() });
        } else {
            this.state.children.push({
                id: this.genId(),
                childName: name,
                emoji,
                color,
                _ts: Date.now()
            });
        }

        this.save();
        this.closeModal();
        this.render();
        this.showToast(childId ? '已更新' : '已添加');
    },

    deleteChild(childId) {
        const courseCount = this.state.courses.filter(c => c.childId === childId).length;
        const performDelete = () => {
            if (courseCount > 0) {
                this.state.courses = this.state.courses.filter(c => c.childId !== childId);
                const courseIds = new Set(this.state.courses.map(c => c.id));
                this.state.transactions = this.state.transactions.filter(t => courseIds.has(t.courseId));
            }
            this.state.children = this.state.children.filter(c => c.id !== childId);
            this.save();
            this.render();
            this.showToast('已删除');
        };

        if (courseCount > 0) {
            this.confirmAction({
                title: '删除孩子',
                message: `这个孩子有 <strong>${courseCount}</strong> 门课程。<br>删除孩子后，这些课程及所有操作记录也会一并删除。<br><br><span style="color: var(--danger); font-size: 13px;">此操作不可恢复。</span>`,
                confirmText: '删除',
                danger: true,
                onConfirm: performDelete
            });
        } else {
            this.confirmAction({
                title: '删除孩子',
                message: '确定要删除这个孩子吗？',
                confirmText: '删除',
                danger: true,
                onConfirm: performDelete
            });
        }
    },

    // ---- Low Threshold ----
    editLowThreshold() {
        this.openModal('余量不足阈值', `
            <p style="color: var(--on-surface-variant); margin-bottom: 16px;">当课程剩余课时 ≤ 此值时，仪表盘会显示"余量不足"提醒。</p>
            <div class="form-group">
                <label class="form-label">阈值（课时）</label>
                <input type="number" class="form-input" id="thresholdInput" value="${this.state.settings.lowThreshold}" min="1" max="50" inputmode="numeric">
            </div>
            <div style="display: flex; gap: 10px; margin-top: 20px;">
                <button class="btn btn-tonal" onclick="App.closeModal()" style="flex:1;">取消</button>
                <button class="btn btn-filled" onclick="App._saveThreshold()" style="flex:1;">保存</button>
            </div>
        `);
    },

    _saveThreshold() {
        const val = parseInt(document.getElementById('thresholdInput').value) || 5;
        this.state.settings.lowThreshold = Math.max(1, Math.min(50, val));
        this.save();
        this.closeModal();
        this.render();
        this.showToast('已更新提醒阈值');
    },

    // ---- Export/Import ----
    exportData() {
        const data = {
            users: this.state.users,
            children: this.state.children,
            courses: this.state.courses,
            transactions: this.state.transactions,
            settings: this.state.settings,
            exportDate: new Date().toISOString()
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `课程数据备份_${new Date().toISOString().slice(0,10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        this.showToast('数据已导出');
    },

    importData() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const data = JSON.parse(ev.target.result);
                    if (!data.children || !data.courses) {
                        this.showToast('文件格式不正确');
                        return;
                    }
                    const doImport = () => {
                        if (data.users) this.state.users = data.users;
                        this.state.children = data.children;
                        this.state.courses = data.courses;
                        this.state.transactions = data.transactions || [];
                        if (data.settings) this.state.settings = Object.assign(this.state.settings, data.settings);
                        this.save();
                        this.applyTheme();
                        this.render();
                        this.showToast('数据已导入');
                    };
                    this.confirmAction({
                        title: '导入数据',
                        message: '导入会覆盖当前所有数据。<br><br><span style="color: var(--danger); font-size: 13px;">建议先导出当前数据备份。</span>',
                        confirmText: '覆盖导入',
                        danger: true,
                        onConfirm: doImport
                    });
                } catch (err) {
                    this.showToast('导入失败：文件格式错误');
                }
            };
            reader.readAsText(file);
        };
        input.click();
    },

    // ---- Modal ----
    openModal(title, body) {
        document.getElementById('modalTitle').textContent = title;
        document.getElementById('modalBody').innerHTML = body;
        document.getElementById('modalOverlay').classList.add('active');
        document.getElementById('modal').classList.add('active');
    },

    closeModal() {
        document.getElementById('modalOverlay').classList.remove('active');
        document.getElementById('modal').classList.remove('active');
    },

    // ---- Bottom Sheet ----
    openSheet(content) {
        document.getElementById('sheetContent').innerHTML = content;
        document.getElementById('sheetOverlay').classList.add('active');
        document.getElementById('bottomSheet').classList.add('active');
    },

    closeSheet() {
        document.getElementById('sheetOverlay').classList.remove('active');
        document.getElementById('bottomSheet').classList.remove('active');
    },

    // ---- Toast ----
    toastTimer: null,
    showToast(msg) {
        const toast = document.getElementById('toast');
        toast.textContent = msg;
        toast.classList.add('active');
        if (this.toastTimer) clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(() => {
            toast.classList.remove('active');
        }, 2800);
    },

    // ---- Render All ----
    render() {
        const view = this.state.currentView;
        if (view === 'dashboard') this.renderDashboard();
        if (view === 'courses') this.renderCourseList();
        if (view === 'stats') this.renderStats();
        if (view === 'settings') this.renderSettings();
    },

    // ---- Utils ----
    escape(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    formatDate(timestamp) {
        const d = new Date(timestamp);
        const Y = d.getFullYear();
        const M = String(d.getMonth() + 1).padStart(2, '0');
        const D = String(d.getDate()).padStart(2, '0');
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        const ss = String(d.getSeconds()).padStart(2, '0');
        return `${Y}-${M}-${D} ${hh}:${mm}:${ss}`;
    },

    // 交易记录时间显示：一律显示操作时刻（补签也只显示点击签到的时刻）。
    // 老版本补签数据（signDate 存在但 date 无真实时刻）显示"补签 YYYY-MM-DD"避免误导
    formatTxnDate(txn) {
        if (!txn) return '';
        if (txn.backfill && txn.signDate) {
            const d = new Date(txn.date);
            if (!isNaN(d.getTime())) {
                // 防御：signDate 与操作时刻同一天 → 实际是当天签到，不显示补签
                const opDay = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                if (txn.signDate === opDay) {
                    return this.formatDate(txn.date);
                }
                const hh = d.getHours(), mm = d.getMinutes(), ss = d.getSeconds();
                // 旧数据：date 被固化为 00:00:00 或 12:00:00，没有真实操作时刻 → 只显示补签日期
                if ((hh === 0 && mm === 0 && ss === 0) || (hh === 12 && mm === 0 && ss === 0)) {
                    return '补签 ' + txn.signDate;
                }
                // 新数据：显示真实操作时刻
                return '补签 ' + txn.signDate + ' · ' + this.formatTime(txn.date);
            }
        }
        return this.formatDate(txn.date);
    },

    formatTime(timestamp) {
        const d = new Date(timestamp);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        const ss = String(d.getSeconds()).padStart(2, '0');
        return `${hh}:${mm}:${ss}`;
    }
};

// ---- Start ----
document.addEventListener('DOMContentLoaded', () => {
    App.init();
});
