// Plan B: no web push. This file only helps the home-screen app load the shell.
self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
