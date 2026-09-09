// 内部缓存键：每次部署必须递增（否则用户端不拉取新版本）
const CACHE_NAME = 'course-manager-v30';

// 对外显示的版本号：设置-关于 页面读取并展示为「版本：V27」
// 只在正式发版时递增，不受上面的缓存键影响
const APP_BUILD = 27;

const ASSETS = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './icons/icon-maskable-192.png',
    './icons/icon-maskable-512.png'
];

// Install: cache all assets
self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => {
            return cache.addAll(ASSETS).catch(err => {
                console.log('Cache error:', err);
                // Cache what we can, ignore failures
                return Promise.all(
                    ASSETS.map(url => cache.add(url).catch(() => {}))
                );
            });
        }).then(() => self.skipWaiting())
    );
});

// Activate: clean old caches
self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys => {
            return Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            );
        }).then(() => self.clients.claim())
    );
});

// Fetch: cache-first strategy
self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET') return;

    // 连通性探测（sw.js?_probe=xxx）：直接走网络，不查缓存也不写缓存，
    // 保证「服务器连接状态」检测到的是真实服务器，而不是本地缓存
    if (e.request.url.indexOf('_probe=') !== -1) {
        e.respondWith(fetch(e.request));
        return;
    }

    e.respondWith(
        caches.match(e.request).then(cached => {
            if (cached) return cached;
            return fetch(e.request).then(response => {
                // Cache new responses for same-origin requests
                if (response.ok && e.request.url.startsWith(self.location.origin)) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
                }
                return response;
            }).catch(() => {
                // Offline fallback
                return caches.match('./index.html');
            });
        })
    );
});
