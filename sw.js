const CACHE_NAME = 'activity-flow-v2';
const urlsToCache = [
    '/',
    '/index.html',
    '/css/style.css',
    '/js/script.js',
    '/js/toast.js',
    '/manifest.json'
];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
    );
});

self.addEventListener('activate', event => {
    event.waitUntil(
        Promise.all([
            self.clients.claim(),
            caches.keys().then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (cacheName !== CACHE_NAME) {
                            console.log('Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            })
        ])
    );
});

self.addEventListener('fetch', event => {
    // Network-first strategy for navigation and important assets
    const isNavigation = event.request.mode === 'navigate';
    const isImportant = urlsToCache.some(url => event.request.url.includes(url));

    if (isNavigation || isImportant) {
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    const clonedResponse = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clonedResponse));
                    return response;
                })
                .catch(() => caches.match(event.request))
        );
    } else {
        // Cache-first for others
        event.respondWith(
            caches.match(event.request)
                .then(response => response || fetch(event.request))
        );
    }
});