# MapGuard Webhook Proxy

Middleware proxy untuk game Roblox yang menerima log batch keamanan dan meneruskannya ke webhook Discord secara aman tanpa terkena rate limit.

## 🚀 1-Click Deploy to Cloudflare Workers

Klik tombol di bawah ini untuk men-deploy proxy ini langsung ke akun Cloudflare Anda secara gratis:

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/sitxxar/mapguard-proxy)

---

## ⚙️ Konfigurasi Environment Variables

Setelah deploy berhasil, buka dashboard Cloudflare Worker Anda, masuk ke menu **Settings** -> **Variables**, lalu tambahkan dua variabel berikut:

1. **`DISCORD_WEBHOOK_URL`** (Secret)
   * **Deskripsi:** URL Webhook Discord saluran tujuan Anda.
2. **`MAPGUARD_KEY`** (Secret)
   * **Deskripsi:** API Key rahasia pilihan Anda untuk otentikasi request dari modul server Roblox.

Klik **Save and Deploy** setelah menambahkan kedua variabel tersebut. Salin URL Worker Anda (misal: `https://mapguard-proxy.username.workers.dev/v1/alerts`) dan masukkan ke dalam konfigurasi modul Roblox `Config.lua`.
