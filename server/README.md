# server: fondasi dan API key

Kode produksi fondasi M1 dan TASK-010 untuk Router AI Komersial. Kontrak ada di `../docs/`; instruksi agen di `../AGENTS.md`.

Yang sudah ada: skema dasar, ledger (saldo, hold, settlement, tambah saldo langsung, adjustment), akun pelanggan lewat undangan, sesi, reset password, login admin dengan TOTP dan step-up, audit append-only, API suspend/restore, adjustment, penutupan akun pemilik, API key pelanggan, dan API HTTP untuk itu.

Yang belum ada: gateway inference, harga dan multiplier, voucher dan redeem, upstream dan routing, UI, pengiriman email nyata, deploy.

## Menjalankan

Butuh Node 24 ke atas dan PostgreSQL. Untuk lokal:

    docker run -d --name router-spike-pg -e POSTGRES_PASSWORD=spike_local_only -e POSTGRES_DB=spike -p 127.0.0.1:55432:5432 postgres:18
    docker exec router-spike-pg psql -U postgres -c "create database router_test"
    npm install
    npm run typecheck
    npm test

Kata sandi di atas hanya untuk container lokal yang terikat ke 127.0.0.1; jangan dipakai di tempat lain. Test menghapus dan membuat ulang skema `public` pada database test. Bila ada agen atau proses lain yang juga menjalankan test, pakai database sendiri lewat `TEST_DATABASE_URL`; dua suite pada database yang sama saling menghapus dan gagal acak.

Menjalankan server (lokal):

    export DATABASE_URL=postgres://...            # database tersendiri, bukan database test
    export APP_SECRET_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
    npm run migrate
    ADMIN_PASSWORD='...' node scripts/bootstrap-admin.ts <username> <email>
    MAILER=none INSECURE_COOKIES=1 npm start       # INSECURE_COOKIES hanya untuk http lokal

`APP_SECRET_KEY` mengenkripsi seed TOTP admin. Kehilangan kunci ini berarti admin harus dibuat ulang; simpan di luar database dan di luar repo.

## Email

Tanpa email: `MAILER=none`. Dengan email nyata (butuh izin founder):

    MAILER=smtp
    SMTP_HOST=smtp.gmail.com
    SMTP_PORT=465
    SMTP_USER=<alamat Gmail pengirim>
    SMTP_PASS=<app password Gmail, dibuat pemilik akun; bukan password akun>
    MAIL_FROM="ZRouter <alamat yang sama>"
    PUBLIC_BASE_URL=https://zrouter.web.id
    PRODUCT_NAME=ZRouter

Host dan port di atas adalah nilai umum SMTP Gmail dan belum diuji dari proyek ini. Halaman `/aktivasi` dan `/atur-ulang` yang dituju tautan belum ada sampai UI dibangun.

## Konfigurasi tool yang sudah terbukti

Diuji 2026-11-14 terhadap gateway lokal (`scripts/tool-lab.ts`). Ganti `<origin>` dengan alamat gateway dan `<model>` dengan ID model publik.

Codex CLI 0.165.0, `config.toml`:

    model = "<model>"
    model_provider = "zr"
    [model_providers.zr]
    name = "ZRouter"
    base_url = "<origin>/v1"
    env_key = "ZR_API_KEY"
    wire_api = "responses"

Claude Code 2.1.325, variabel lingkungan:

    ANTHROPIC_BASE_URL=<origin>
    ANTHROPIC_AUTH_TOKEN=<api key>
    ANTHROPIC_MODEL=<model>
    ANTHROPIC_DEFAULT_HAIKU_MODEL=<model>
    ANTHROPIC_DEFAULT_SONNET_MODEL=<model>
    ANTHROPIC_DEFAULT_OPUS_MODEL=<model>
    CLAUDE_CODE_SUBAGENT_MODEL=<model>

OpenCode 2.3.0, `opencode.jsonc`, lalu `opencode run --model zr/<model>`:

    { "providers": { "zr": { "name": "ZRouter", "env": ["ZR_API_KEY"], "package": "@opencode/ai/providers/openai-compatible",
        "settings": { "baseURL": "<origin>/v1" }, "models": { "<model>": {} } } } }

Codex dan Claude Code memberi peringatan bahwa model kustom tidak dikenali dan memakai ukuran konteks bawaan; itu bukan kegagalan.

## Struktur

| Berkas | Isi |
|---|---|
| `migrations/001_foundation.sql` | Skema; trigger append-only untuk `ledger_entry` dan `audit_event` |
| `migrations/002_m1_close.sql` | Versi tenant, identitas tertutup, verifier username pensiun, trigger larangan membuka ulang |
| `migrations/003_api_keys.sql` | API key, batas, counter penggunaan, kaitan hold per tenant dan trigger identitas immutable |
| `migrations/004_pricing.sql` | Model publik dan harga berversi; harga terbit immutable |
| `migrations/005_token_credit.sql` | Saldo berlabel kredit token; pengaturan batas lebih-pakai |
| `migrations/006_packs_vouchers.sql` | Paket token, kode redeem, penukaran |
| `src/vouchers.ts` | Paket token; terbit, cabut, daftar dan redeem kode bernilai token |
| `migrations/007_upstreams.sql` | Upstream dan route |
| `src/netguard.ts` | Pemeriksa base URL upstream (HTTPS, alamat publik) |
| `src/upstreams.ts` | Registry upstream, API key tulis-saja, eligibility, route, kandidat untuk gateway |
| `migrations/008_requests.sql` | Metadata request dan attempt |
| `src/gateway.ts` | Gateway `/v1/chat/completions`, `/v1/messages`, `/v1/models`: admission, routing, fallback, relay stream, settlement |
| `src/http/static.ts` | Menyajikan web hasil build dari origin yang sama (`WEB_DIST`), dengan CSP dan fallback SPA |
| `src/monitor.ts` | Bot Telegram: peringatan dan perintah `/status` (hanya baca) |
| `src/mailer.ts` | Pengirim email SMTP untuk undangan dan reset (nodemailer 10.5.0, MIT-0) |
| `src/pricing.ts` | Katalog model, draft, preview, publish, retire, snapshot harga untuk admission |
| `src/keys.ts` | CRUD key, verifier, scope, autentikasi dan kuota |
| `src/money.ts` | Uang sebagai BigInt mikro-IDR; debit dan hold |
| `src/ledger.ts` | Akun, top-up, adjustment, hold, settlement, pemeriksaan invariant |
| `src/identity.ts` | Undangan, aktivasi, login, sesi, reset password |
| `src/admin.ts` | Bootstrap admin, faktor kedua, step-up |
| `src/crypto.ts` | Token, Argon2id (bawaan Node), AES-GCM, TOTP |
| `src/ratelimit.ts` | Pembatas laju di PostgreSQL |
| `src/http/app.ts` | Rute HTTP |
| `test/` | 130 test integrasi |

## Nilai awal yang dipilih saat implementasi

Kontrak menyerahkan angka-angka ini ke implementasi. Semuanya dapat diubah di satu tempat (`LIMITS` di `identity.ts`, `ADMIN_LIMITS` di `admin.ts`, `ARGON` di `crypto.ts`).

| Hal | Nilai |
|---|---|
| Undangan berlaku | 72 jam |
| Tautan reset berlaku | 30 menit |
| Sesi pelanggan | 7 hari, idle 24 jam |
| Sesi admin | 8 jam, idle 30 menit |
| Step-up admin | Faktor kedua dalam 5 menit terakhir |
| Login gagal | 5 per akun per IP, 30 per IP, 50 per akun dari semua IP; jendela 15 menit |
| Kode TOTP salah | 5 per 15 menit |
| Reset password | 3 per alamat dan 10 per IP per jam |
| Password salah saat penutupan akun | 5 per akun per 15 menit; check/hit dalam transaksi terserialisasi |
| Password | Pelanggan minimal 10 karakter, admin 14 |
| Argon2id | Memori 19456 KiB, 2 pass, paralelisme 1; tinjau terhadap panduan terkini sebelum rilis |
| Username | 3 sampai 24 karakter: a-z, 0-9, garis bawah |

Perlindungan CSRF: cookie `SameSite=Strict` ditambah kewajiban header `x-router-csrf: 1` pada semua request yang mengubah data; tidak ada CORS yang diaktifkan.

## Cakupan test terhadap spesifikasi

| Spesifikasi | Status |
|---|---|
| TEST-006 akun dan sesi | Tercakup untuk API; UI belum ada |
| TEST-007 admin | Tercakup untuk API |
| TEST-009 API key | Reveal sekali, negatif tenant/auth, version check, quota, expiry/revoke/closure races, cap atomik, settlement setelah revoke, HTTP/log scan |
| TEST-008 batas tenant | Tercakup untuk operasi yang sudah ada (saldo, ledger, sesi) |
| TEST-002 bagian ledger | Hold, settlement, replay, konkurensi, pembulatan; normalizer dan gateway belum |
| TEST-014 bagian API M1 | Top-up dan adjustment: replay, konkurensi, step-up, audit; suspend/restore: version check, negatif otorisasi, guard admission dan settlement; cabut key admin lulus; gateway/pemakaian rinci belum |
| TEST-016 audit | Append-only dan satu event per aksi untuk aksi yang sudah ada |
| FR-019 bagian penutupan akun | Konfirmasi/password, pencabutan akses, pseudonimisasi, username tidak dipakai ulang, konkurensi login/reset/password; job retensi dan TEST-019 body gateway belum |

## API lifecycle M1

- `GET /api/me` dan detail pelanggan admin mengembalikan `tenantStatus` serta `version` sebagai string.
- `POST /admin/api/customers/:username/suspend` dan `/restore`: `expectedVersion` (string versi terakhir) dan `reason`; perlu faktor kedua terbaru. Versi usang, no-op atau akun CLOSED menghasilkan 409 tanpa event baru.
- `POST /admin/api/adjustments`: `username`, `amountMicro` (integer string bertanda nonnol), `reason`, `idempotencyKey`. Perlu step-up. Receipt 201; replay identik 200; kunci sama dengan payload berbeda 409. Koreksi boleh menyebabkan saldo negatif; admission tetap menolak bila saldo tersedia tidak cukup.
- `POST /api/account/close`: sesi owner, `currentPassword`, `confirmUsername` sama persis, `expectedVersion`. Target diambil dari sesi, bukan ID pada body. Password salah dibatasi 5 per 15 menit termasuk request paralel.

Suspend hanya menghentikan admission inference baru; login dan akses saldo/riwayat tetap tersedia. Hold lama tidak hilang dan settlement tetap berjalan sekali. Close mencabut semua sesi/reset, mempseudonimkan profil dan undangan, mempertahankan ledger/hold dan mencatat satu event. Tidak ada refund atau penghapusan uang otomatis.

Username lama dicadangkan sebagai verifier SHA-256 di `retired_username`. Ini bukan anonimisasi penuh: username berentropi rendah dapat ditebak terhadap verifier, dan audit append-only historis tetap memuat email/username pada event onboarding yang sudah ada. Audit historis tidak ditulis ulang. Durasi penyimpanan bukti keuangan, audit, backup dan job retensi belum diputuskan founder; TASK-021 tetap SEBAGIAN, bukan klaim seluruh FR-019 selesai. Penutupan akun mencabut seluruh key aktif beserta audit dalam transaksi yang sama; hold lama tetap diselesaikan.

## API key pelanggan (TASK-010)

Kontrak endpoint dan policy lengkap ada di ../docs/ARCHITECTURE.md section 5.6. Owner membuat key lewat POST /api/keys; daftar/detail tidak mengembalikan secret. Update limits dan revoke memakai expectedVersion. Admin hanya dapat melihat tersamar dan mencabut dengan step-up.

Nilai awal: 10 key aktif per tenant, 100 ID model per scope; batas belanja lifetime key dalam integer string mikro-IDR. allowedModels null tanpa batas key tambahan; [] menolak semua. Cap null tanpa batas tambahan; "0" menolak debit baru. Update limits mengganti seluruh policy, bukan menggabungkan field parsial. Key expired tidak diperpanjang; buat key baru. Model ID yang diizinkan belum membuktikan ketersediaan model, karena katalog dan route belum ada.

Bukti TASK-010: /root/router-task010-rcHSJCJh/. Tidak ada perubahan migrasi 001/002, dependency baru, UI atau gateway inference.

Verifikasi penuh dari root proyek: `hermes verify --json`. Recipe `.hermes/environment.json` menjalankan typecheck, seluruh test, entrypoint server nyata lalu readiness `/readyz`, dan teardown. Start memakai `server/scripts/verify-local.ts`: hanya database lokal `router_test`, key sementara, MAILER=none dan bind 127.0.0.1:55480. Jangan jalankan bersamaan dengan suite lain pada database yang sama.

Bukti siklus RED/GREEN dan baseline: `/root/router-handoff-baseline-z7tKxkG8/`. Hasil suite terbaru: `test-result.txt`. Tidak ada perintah lint/build di package.json; verifikasi yang tersedia adalah typecheck dan test.
