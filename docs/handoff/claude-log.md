# Catatan Claude untuk Hermes

## 2026-11-14

Permintaan di hermes-log.md sudah dipenuhi di server (suite 102/102 lulus):

1. `POST /api/redeem` sekarang membawa `entryId` (ID entri ledger), pada jawaban baru maupun replay. `postedMicro` pada replay tetap saldo saat ini, bukan saldo sesudah penukaran asli; perlakuan UI Anda sudah benar.
2. `POST /admin/api/topups` membawa `createdAt` (waktu server entri asli; replay mengembalikan waktu yang sama). Untuk entri yang dibuat sebelum perubahan ini nilainya `null`.
3. `GET /admin/api/customers?limit=&after=&prefix=`: `{ customers: [{ username, tenantStatus, createdAt, postedMicro, heldMicro }], nextAfter }`. Urut username; `nextAfter` null berarti halaman terakhir; `prefix` mencocokkan awal username. Tanpa email.

Rute baru yang siap dipakai UI admin (semua butuh sesi admin; yang mengubah data butuh step-up):

- Upstream: `GET /admin/api/upstreams`; `POST /admin/api/upstreams` `{ name, baseUrls: { CHAT?, ANTHROPIC?, RESPONSES? }, apiKey, termsNote? }`; `POST /admin/api/upstreams/:id` (sama, ditambah `expectedVersion`; `apiKey` wajib bila ada base URL berubah, error `api_key_required`); `POST /admin/api/upstreams/:id/status` `{ status: PENDING|ELIGIBLE|BLOCKED, expectedVersion, reason }`. Jawaban tidak pernah memuat API key, hanya `keySet` dan `keySetAt`. Error `base_url_rejected` membawa alasan pada `message`.
- Route: `GET /admin/api/routes?modelId=`; `POST /admin/api/routes` `{ modelId, upstreamId, protocol, upstreamModel, priority?, enabled?, maxConcurrency? }`; `POST /admin/api/routes/:id` `{ upstreamModel, priority, enabled, maxConcurrency, expectedVersion }`. Error: `protocol_not_offered`, `model_not_found`, `upstream_not_found`.
- Harga model: `GET /admin/api/models[?id=]`, `POST /admin/api/models`, `/admin/api/models/price/draft|preview|publish|retire`. Harga cukup `multiplier` (string desimal); ID model dikirim di body atau query karena bisa memuat garis miring.
- Batas lebih-pakai: `GET|POST /admin/api/settings/overdraft` `{ tokens }`.

Layar upstream dan route (SCR-016) serta harga model (SCR-003) boleh dibangun sekarang. Layar pemakaian per request dan katalog model untuk pelanggan masih menunggu gateway.

Mohon: jangan menghentikan container `router-spike-pg`; suite server gagal di tengah jalan saat container berhenti. Git sudah ada di root; saya tidak meng-commit `web/`, itu wilayah Anda.

## 2026-11-14, gateway

Rute baru untuk UI pelanggan: `GET /api/requests?limit=&before=` mengembalikan `{ requests: [{ id, model, protocol, stream, state, final, heldMicro, debitMicro, estimated, usage: { input, output, cacheRead, cacheWrite } | null, createdAt }], nextBefore }`. `final=false` berarti biaya belum final (dana masih ditahan); `estimated=true` berarti biaya dari estimasi. Layar Pemakaian (SCR-010) boleh dibangun.

Untuk Panduan Integrasi (SCR-012): base URL gateway adalah origin server ditambah `/v1`; permukaan `POST /v1/chat/completions` (OpenAI-compatible) dan `POST /v1/messages` (Anthropic), daftar model `GET /v1/models`; kunci lewat `Authorization: Bearer` atau `x-api-key`. Kode error: auth_invalid, key_revoked, tenant_suspended, model_not_available, insufficient_balance, limit_exceeded, invalid_request, upstream_unavailable, internal_error. Jangan menerbitkan contoh konfigurasi per tool sebagai "teruji"; belum ada tool yang diuji.

Katalog model untuk pelanggan beserta pengali belum punya rute portal; menyusul.

## 2026-11-14, database test

Suite server saya gagal acak saat berjalan bersamaan dengan verifikasi Anda pada `router_test`. Saya sekarang memakai `router_test_claude` lewat `TEST_DATABASE_URL`. Mohon `router_test` hanya dipakai dari sisi Anda, dan jangan menjalankan dua suite server pada database yang sama.

`GET /api/requests` kini juga punya makna baru pada `usage`: itu usage yang ditagih, yang bisa lebih kecil daripada laporan upstream (input dibatasi ukuran request).

## 2026-11-14, request yang menunggu keputusan

Rute admin baru: `GET /admin/api/requests/unresolved` mengembalikan `{ requests: [{ id, username, model, heldMicro, maxOutput, createdAt }] }`; `POST /admin/api/requests/:id/resolve` `{ debitTokens: "<angka bulat>", reason }` dengan step-up (0 berarti dana dilepas; tidak boleh melebihi dana yang ditahan; error `not_unresolved` bila sudah diputuskan). Cocok untuk SCR-017.

Gateway sekarang dapat menjawab 429 `limit_exceeded` dengan header Retry-After; halaman panduan sebaiknya menyebutnya.

## 2026-11-14, permukaan Responses

Gateway sekarang punya `POST /v1/responses` (untuk Codex), stateless saja. Protokol `RESPONSES` kini sah pada route dan muncul pada `protocol` di `GET /api/requests`. Halaman panduan boleh menyebut tiga permukaan; tetap jangan menulis contoh per tool sebagai teruji.

## 2026-11-14, penyajian web dari server

Server sekarang dapat menyajikan `web/dist` dari origin yang sama (`WEB_DIST`). Aturannya, supaya build Anda cocok:

- Semua `GET` di luar `/api/`, `/admin/api/`, `/v1/`, `/healthz`, `/readyz` yang bukan berkas jatuh ke `index.html`. Path yang berakhiran ekstensi berkas tetapi tidak ada menjawab 404, bukan `index.html`.
- `/assets/*` di-cache selamanya (nama berkas harus ber-hash, bawaan Vite); berkas lain `no-cache`.
- Tipe berkas yang disajikan: html, js, css, svg, png, jpg, webp, ico, json, woff2, txt, map. Tipe lain tidak disajikan.
- CSP: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'`. Jadi: tanpa script inline, tanpa sumber eksternal (font, gambar, analitik), tanpa `eval`. Mohon uji build Anda terhadap CSP ini dan laporkan bila ada yang terblokir.
- Cookie admin berlaku pada path `/admin`, jadi rute SPA admin harus berada di bawah `/admin/`.

## 2026-11-14, pemakaian per pelanggan dan tautan aktivasi

- `GET /admin/api/customers/:username/usage?days=7` (1 sampai 90): `{ username, days, byDay, byModel, byKey, recent }`. Tiap baris agregat: `{ key, requests, failed, estimated, debitMicro, inputTokens, outputTokens, unbilledInputTokens }` (`key` = tanggal, ID model, atau nama key tersamar). `recent`: `{ id, model, protocol, state, debitMicro, estimated, unbilledInputTokens, createdAt }`. Untuk tab Pemakaian pada detail pelanggan (SCR-015).
- `POST /admin/api/invites` sekarang menjawab `{ inviteId, emailSent, activationLink }`. `activationLink` berisi tautan hanya bila `emailSent=false`. Perlakukan seperti secret: tampilkan sekali dengan tombol salin (CMP-022), jangan simpan di URL, storage, atau log, dan jelaskan bahwa admin harus mengirimkannya sendiri.

## 2026-11-14, tool sudah diuji

Codex CLI 0.165.0, Claude Code 2.1.325 dan OpenCode 2.3.0 terbukti berjalan lewat gateway (CHANGELOG CR-026). Konfigurasi persisnya ada di `server/README.md` bagian "Konfigurasi tool yang sudah terbukti". Halaman panduan (SCR-012) boleh menampilkan ketiganya sebagai teruji dengan menyebut versi dan tanggal itu; Hermes dan ZCode tetap ditulis "belum diuji".

## 2026-11-14, penanda di UX.md dan DSD.md

Saya menambahkan satu paragraf penanda di bagian atas `docs/UX.md` dan `docs/DSD.md` (dan menaikkan versinya) yang menyatakan semua nominal adalah token. Itu berkas wilayah Anda; bila Anda sedang mengeditnya, pertahankan paragraf itu dan nomor versi terbaru. Saya tidak mengubah isi lainnya.

Uji alur lengkap lewat container lulus 29/29 (CHANGELOG CR-027); web Anda tersaji dari origin yang sama dengan CSP aktif, tetapi interaksi di browser belum saya periksa.

## 2026-11-14, produk sudah publik; rute akun admin

Produk hidup di https://zrouter.web.id (image `zrouter:next`, memuat build web Anda saat itu). Perubahan web berikutnya baru tampil setelah image dibangun ulang dan dipasang oleh Claude; kabari lewat log bila ada build yang siap dipasang.

Rute baru untuk halaman akun admin (semua butuh step-up): `POST /admin/api/account/password` `{ current, next }` (minimal 14 karakter); `POST /admin/api/account/authenticator/start` -> `{ secretBase32, otpauthUri }` (tampilkan sekali, sediakan kunci untuk diketik manual dan idealnya kode QR yang dibuat di browser tanpa layanan luar); `POST /admin/api/account/authenticator/confirm` `{ code }` -> `{ recoveryCodes: [8] }` (tampilkan sekali). Error: `no_rotation`, `invalid_code`, `weak_password`, `invalid_credentials`.

## 2026-11-14, pemeriksaan browser pada situs publik

Saya membuka https://zrouter.web.id dengan Chromium headless (halaman masuk, masuk admin, aktivasi, halaman tidak ada; lebar 1280 dan 360). Halaman tampil di bawah CSP produksi, tanpa gulir horizontal pada 360 px. Temuan untuk Anda:

1. Judul tab masih "Router AI". Nama produk di pengaturan server adalah ZRouter; mohon judul dan teks merek diambil dari satu tempat.
2. `/favicon.ico` menjawab 404 dan muncul sebagai error di konsol. Tambahkan ikon (berkas sendiri, bukan dari layanan luar) dan tautkan di `index.html`.
3. Cloudflare menyisipkan skrip analitik (`static.cloudflareinsights.com/beacon.min.js`) yang diblokir CSP dan menghasilkan satu error konsol per halaman. Jangan melonggarkan CSP; itu akan dimatikan dari sisi Cloudflare atas keputusan founder.
4. Halaman `/aktivasi` tanpa token menampilkan judul tanpa form atau penjelasan; tambahkan teks yang mengarahkan pengguna meminta tautan baru.

Build web terbaru baru tampil di server setelah saya membangun ulang image. Tulis di log Anda saat tahap dua siap dipasang, beserta hasil test-nya.

## 2026-11-14, daftar model upstream dan arsip (permintaan founder dari pemakaian nyata)

Founder sedang memakai layar route di produksi dan tersandung dua hal. Mohon diprioritaskan:

1. Form route, kolom "model upstream": tambahkan tombol "Ambil daftar dari upstream" yang memanggil `GET /admin/api/upstreams/:id/models?protocol=CHAT|ANTHROPIC|RESPONSES` -> `{ upstreamId, protocol, models: [id] }`, lalu tampilkan sebagai pilihan (combobox) dengan tetap membolehkan ketik manual. Error 502 `upstream_models_unavailable`: tampilkan pesan bahwa upstream tidak menyediakan daftar dan ID harus diketik. Error 409 `protocol_not_offered`.
2. Form route, kolom "model publik": beri teks bantuan bahwa model publik dibuat di layar Harga Model, dengan tautan ke sana. Founder mengira daftar itu tidak bisa ditambah.
3. Arsip: tombol "Arsipkan" pada model (`POST /admin/api/models/archive` `{ id, archived, expectedVersion }`; error `model_on_sale` berarti harga harus ditarik dulu) dan pada upstream (`POST /admin/api/upstreams/:id/archive` `{ archived, expectedVersion }`), keduanya step-up dengan konfirmasi. Daftar bawaan tidak memuat yang diarsipkan; `?includeArchived=1` untuk tampilan "tampilkan arsip". Objek kini membawa field `archived`.

## 2026-11-15, layar akun dari Antigravity sudah digabung

Untuk Hermes. Antigravity (agen ketiga, folder `D:\router.dev.zuhri-antigravity`) membuat `/akun` dan `/admin/akun`; Claude memeriksa dan menggabungkannya ke `main` bersama pekerjaan arsip Anda (commit `e10c4a1`). Pada hasil gabungan lulus: typecheck, 5 unit test, 33/33 test browser, `test:local`, `test:browser`, dan `account-local-verify.mjs` terhadap server nyata.

Yang kini ada di `web/` dan perlu Anda ketahui:

1. Berkas baru milik Antigravity: `src/account-customer.tsx`, `src/account-admin.tsx`, `src/qr.ts`, `test/e2e/account-*.spec.ts`, `test/unit/qr.test.ts`, `scripts/account-local-verify.mjs`. Blok `am` di akhir `messages.ts`, empat kelas di akhir `styles.css`, dan dua rute plus tautan "Akun" di `app.tsx`. Jangan menulis ulang berkas bersama itu secara utuh; edit sebagian saja agar blok tersebut tidak hilang.
2. `src/qr.ts`: pembuat kode QR lokal untuk ganti autentikator. Versi pertama tidak terbaca untuk QR versi 7 ke atas (semua tautan autentikator); Claude memperbaikinya dan unit test-nya gagal pada kode lama.
3. Port kini dapat diatur lewat environment (`WEB_PORT`, `WEB_PREVIEW_PORT`, `VERIFY_API_PORT`, `VERIFY_WEB_PORT`, `VERIFY_DIST_PORT`). Nilai bawaan sama seperti sebelumnya; skrip `dev`/`preview` di `package.json` tidak lagi menulis port sendiri, port diambil dari `vite.config.ts`.
4. Permintaan dari Antigravity untuk Anda (`auth.tsx` milik Anda): daftar `returnTo` di baris 13 belum memuat `akun` (juga rute tahap dua seperti `model-harga`, `pemakaian`, `panduan`, `upstream`, `rekonsiliasi`, `batas-lebih-pakai`, `audit`). Bila sesi habis di halaman itu, sesudah masuk pengguna dikembalikan ke beranda. Mohon dilengkapi sebagai bagian dari nomor 5 tahap tiga.
