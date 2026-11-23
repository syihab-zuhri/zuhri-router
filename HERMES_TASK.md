# Pekerjaan paralel untuk Hermes

Ditulis 2026-11-14. Dua agen bekerja bersamaan di folder ini tanpa Git, jadi pembagian berkas di bawah mengikat: mengedit berkas milik agen lain akan saling menimpa.

Baca dulu: `AGENTS.md`, `docs/TOKEN_CREDIT.md`, lalu berkas ini.

## Pembagian wilayah

| Wilayah | Pemilik | Isi |
|---|---|---|
| `server/` (semua isinya) | Claude | Registry upstream (TASK-013), lalu inti gateway (TASK-012) |
| `web/` (folder baru) | Hermes | Tampilan web: portal pelanggan dan backoffice |
| `docs/UI_REFERENCES.md`, `docs/DESIGN.md`, `docs/DSD.md`, `docs/UX.md` | Hermes | Hanya bila pekerjaan UI menuntut perubahan |
| Dokumen `docs/` lainnya, `AGENTS.md`, `HANDOFF.md` | Claude | Jangan diedit Hermes |
| `docs/handoff/hermes-log.md` (berkas baru) | Hermes | Catatan perubahan Hermes |

Hermes tidak mengedit `docs/CHANGELOG.md`, `docs/TASKS.md` atau `docs/PROJECT_MANIFEST.md`. Tulis catatan di `docs/handoff/hermes-log.md` dengan isi: apa yang ditulis, apa yang dijalankan, apa yang lulus, apa yang belum. Claude menggabungkannya ke changelog dan status task.

Bila Hermes butuh perubahan di `server/` (rute baru, field baru, bug), tulis permintaannya di `docs/handoff/hermes-log.md` bagian "Permintaan ke server". Jangan mengubahnya sendiri.

## Pekerjaan Hermes, berurutan

### 1. Pilih dan periksa pustaka UI (sisa TASK-020)

- React sudah disetujui. Pilih alat build, routing dan pengambil data; kandidat dan metadata awal ada di `docs/ARCHITECTURE.md` section 9.
- Untuk tiap pustaka catat: versi persis, lisensi, sumber, jumlah dependency, hasil `npm audit`. Tulis di `web/README.md`.
- Baca source registry UIArc untuk komponen Free yang akan dipakai (`docs/UI_REFERENCES.md`) dan periksa lisensi dependency-nya. Tetapkan per komponen: DIRECT_ADOPTION atau PATTERN_ADAPTATION. Jangan memakai atau merekonstruksi item Pro.

### 2. Kerangka `web/`

- Token visual dari `docs/DESIGN.md` sebagai satu berkas variabel CSS; itu satu-satunya sumber nilai warna, ukuran dan durasi.
- Shell aplikasi (CMP-001) untuk portal dan backoffice, dengan navigasi keyboard dan tampilan 360 px.
- Klien API kecil: semua request yang mengubah data wajib membawa header `x-router-csrf: 1`; cookie sesi dikirim otomatis; nilai saldo datang sebagai string mikro-kredit (bagi 1.000.000 untuk kredit token) dan tidak boleh diolah dengan angka floating point.
- Server pengembangan mem-proxy `/api` dan `/admin/api` ke server lokal. Cara menjalankan server lokal: `.hermes/environment.json` dan `server/README.md`.

### 3. Layar pelanggan, dalam urutan ini

Daftar rute yang tersedia ada di `server/src/http/app.ts`; itu kontraknya. Spesifikasi layar di `docs/UX.md`, komponen di `docs/DSD.md`.

1. Masuk, aktivasi undangan, atur ulang password (SCR-004, 005, 006). Tautan email memakai `/aktivasi#token=...` dan `/atur-ulang#token=...`: baca token dari fragment URL, lalu hapus dari bilah alamat.
2. Isi saldo dengan kode redeem (SCR-001): `POST /api/redeem`, tampilkan receipt; jawaban `code_unusable` dan 429 punya teks sendiri.
3. Beranda dengan saldo token dan daftar paket (`GET /api/balance`, `GET /api/packs`).
4. API key (SCR-008): buat, tampilkan secret sekali (CMP-022), cabut.
5. Transaksi (SCR-011): `GET /api/ledger`.

### 4. Layar admin

Login dengan kode autentikator dan dialog step-up (CMP-021), lalu: pelanggan dan tambah saldo, paket token, kode redeem, harga model. Satuan di semua layar adalah token, bukan Rupiah; Rupiah hanya muncul sebagai harga tampilan paket.

## Aturan khusus UI

- Hasil aksi saldo tidak ditampilkan sebelum server menjawab, dan tidak lewat toast.
- Secret (API key, kode redeem) hanya ada di memori halaman: tidak di URL, storage, atau log.
- Maskot belum ada. Pakai placeholder geometris. Jangan mengambil gambar dari internet dan jangan memakai karakter pada `Portrait Version.jpg`.
- Teks antarmuka Bahasa Indonesia, dari satu berkas pesan.
- Jangan deploy, jangan mengirim email nyata, jangan memanggil upstream.

## Selesai berarti

Untuk tiap layar: berjalan terhadap server lokal, dapat dipakai dengan keyboard saja, utuh pada lebar 360 px, state loading/kosong/gagal ada, dan ada test yang dijalankan. Catat perintah test yang benar-benar dipakai di `web/README.md`.

## Yang belum bisa dikerjakan Hermes

Layar pemakaian per request, model dan harga untuk pelanggan, upstream dan route: server-nya belum ada. Claude akan menulis di `docs/handoff/claude-log.md` saat rute baru siap dipakai.

---

# Tahap dua (2026-11-14)

Tahap satu diterima: 12/12 test browser lulus menurut laporan Anda. Pembagian wilayah dan aturan di atas tetap berlaku. Kontrak rute ada di `docs/handoff/claude-log.md` (baca seluruhnya) dan `server/src/http/app.ts`.

Database: pakai `router_test` atau schema privat Anda; Claude memakai `router_test_claude`. Jangan menghentikan container `router-spike-pg`.

## Pekerjaan, berurutan

1. **Pemakaian (SCR-010)**: `GET /api/requests`. Tampilkan model, waktu, status, token yang ditagih per kategori, dan biaya dalam token. `final=false` berarti "Biaya belum final, dana ditahan"; `estimated=true` berarti "Biaya dari estimasi". Jangan menampilkan `unbilled`; itu urusan admin.
2. **Model dan harga untuk pelanggan (SCR-009)**: `GET /api/models` mengembalikan `{ models: [{ id, displayName, multiplier, protocols: ["CHAT"|"ANTHROPIC"|"RESPONSES"], creditsPerToken: { input, output, cacheRead, cacheWrite } }] }` (nilai string desimal: berapa token saldo terpakai per satu token). Bila keempat nilai sama, tampilkan cukup pengalinya ("x2"); bila berbeda, tampilkan per kategori.
3. **Panduan integrasi (SCR-012)**: base URL adalah origin halaman ditambah `/v1`; tiga permukaan (`/v1/chat/completions`, `/v1/messages`, `/v1/responses`), daftar model `/v1/models`, cara mengirim key, daftar kode error beserta tindakan, dan catatan bahwa `/v1/responses` tidak mendukung percakapan tersimpan. Contoh memakai placeholder key. Jangan menulis "teruji dengan <tool>"; belum ada tool yang diuji.
4. **Upstream dan route (SCR-016)**: form upstream dengan base URL per protokol, field API key bertipe password yang tidak pernah diisi ulang dari server (hanya `keySet`/`keySetAt`), ubah status dengan alasan, daftar dan form route. Tangani `base_url_rejected`, `api_key_required`, `protocol_not_offered`, `version_conflict`, dan step-up.
5. **Daftar pelanggan (SCR-015)**: `GET /admin/api/customers` berhalaman dengan filter awalan; dari daftar masuk ke detail yang sudah ada.
6. **Request menunggu keputusan (SCR-017)**: `GET /admin/api/requests/unresolved` dan `POST /admin/api/requests/:id/resolve`. Dialog konfirmasi menampilkan username, dana ditahan dan jumlah yang akan ditagih; `0` berarti dilepas.
7. **Pengaturan batas lebih-pakai** dan **audit (SCR-018)**: `GET|POST /admin/api/settings/overdraft`, `GET /admin/api/audit`.
8. **Build produksi**: pastikan `npm run build` menghasilkan `web/dist` yang berjalan bila disajikan dari origin yang sama dengan API (tanpa proxy Vite), dengan fallback SPA ke `index.html`. Tulis di `web/README.md` rute mana saja yang harus jatuh ke `index.html` dan mana yang tidak boleh (`/api/`, `/admin/api/`, `/v1/`, `/healthz`, `/readyz`). Claude akan memasang penyajiannya di server.

Untuk tiap layar berlaku syarat "Selesai berarti" di atas. Catat hasil di `docs/handoff/hermes-log.md` pada bagian baru bertanggal, jangan menimpa catatan lama.

## Tetap bukan pekerjaan Hermes

Deploy, perubahan `server/`, maskot (placeholder tetap dipakai), dan commit ke Git untuk berkas di luar `web/`. Untuk `web/` sendiri: jangan meng-commit `node_modules`, `dist`, `test-results`, atau berkas kredensial; tanyakan founder sebelum push.

---

# Tahap tiga (2026-11-15): yang masih kurang untuk pilot

Hasil tinjauan Claude atas `web/` pada 2026-11-15 (baca-saja). Tidak ditemukan pelanggaran aturan: saldo memakai BigInt, tidak ada penyimpanan browser atau log, token aktivasi diambil dari fragment lalu dibuang, header CSRF hanya pada mutasi, tidak ada sumber luar. Yang kurang adalah layar, urut prioritas:

1. **Undang pelanggan (paling mendesak; tanpa ini founder tidak dapat menambah pelanggan dari web).** Di layar Pelanggan: form email -> `POST /admin/api/invites` -> `{ inviteId, emailSent, activationLink }`. Server produksi berjalan tanpa email, jadi `emailSent=false` adalah keadaan normal: tampilkan `activationLink` sekali dengan tombol salin (CMP-022) dan teks bahwa admin harus mengirimkannya sendiri. Tautan dari server sudah lengkap dengan origin. Jangan simpan di URL, storage, atau log. Error: `conflict` (email sudah punya akun), `invalid_request`.
2. **Tangguhkan/pulihkan pelanggan dan koreksi saldo** pada detail pelanggan: `POST /admin/api/customers/:username/suspend|restore` `{ expectedVersion, reason }`; `POST /admin/api/adjustments` `{ username, amountMicro (string bertanda), reason, idempotencyKey }`. Keduanya step-up dengan dialog konfirmasi yang menampilkan username dan nilai.
3. **Akun admin**: ganti password dan ganti autentikator (rute ada di claude-log, bagian "rute akun admin"). Untuk autentikator: tampilkan kunci untuk diketik manual; kode QR boleh hanya bila dibuat di browser tanpa layanan luar dan tanpa dependency baru yang belum diperiksa.
4. **Akun pelanggan (SCR-013)**: ganti password (`POST /api/account/password`), daftar dan cabut sesi (`GET /api/account/sessions`, `POST /api/account/sessions/:id/revoke`), tutup akun (`POST /api/account/close` `{ currentPassword, confirmUsername, expectedVersion }`).
5. Butir pada claude-log "daftar model upstream dan arsip" dan "pemeriksaan browser pada situs publik" (judul ZRouter, ikon, halaman aktivasi tanpa token) bila belum selesai.

Sesudah satu kelompok layar lulus test, tulis di hermes-log bagian baru bertanggal dan sebutkan bahwa build siap dipasang; Claude yang membangun image dan memasangnya ke server.

## Pembagian dengan Antigravity (2026-11-15)

Founder menambah agen ketiga, Antigravity. **Hermes mengerjakan nomor 1, 2 dan 5 saja.** Nomor 3 (akun admin) dan 4 (akun pelanggan) dikerjakan Antigravity di folder terpisah `D:\router.dev.zuhri-antigravity`, cabang Git `antigravity/akun`; lihat `ANTIGRAVITY_TASK.md`.

- Jangan membuat berkas `web/src/account-*.tsx` atau `web/test/e2e/account-*.spec.ts`; nama itu milik Antigravity.
- Antigravity akan menambah satu blok bertanda `akun (Antigravity)` di akhir `messages.ts` (dan mungkin `styles.css`), serta baris rute dan navigasi di `app.tsx`. Claude yang menggabungkan dan menyelesaikan bentrok; Anda tidak perlu menyiapkan apa pun.
- Penggabungan juga membawa perubahan kecil dari Claude: port di `vite.config.ts`, `playwright.config.ts`, skrip `dev`/`preview` di `package.json`, dua skrip verifikasi, dan `guide.spec.ts` dapat diatur lewat environment (`WEB_PORT`, `VERIFY_*_PORT`). Nilai bawaan tidak berubah (5173, 4173, 55480 sampai 55482), jadi perintah Anda tetap sama.
- `web/` sudah masuk Git (commit `cf0bf2c`, titik aman). `node_modules`, `dist`, `evidence`, `test-results` diabaikan Git.
- Container `router-spike-pg` sempat mati (Docker/WSL restart) dan sudah dinyalakan lagi, sekarang dengan restart otomatis. Bila test Anda gagal karena koneksi database sekitar waktu itu, ulangi.

## Tahap tiga, lanjutan (2026-11-15 siang)

Pekerjaan arsip dan daftar model upstream Anda sudah digabung dan terpasang di https://zrouter.web.id (image `zrouter:r11151123`). Halaman akun dari Antigravity juga sudah ada di `main`; baca `docs/handoff/claude-log.md` bagian "layar akun dari Antigravity sudah digabung" sebelum mulai.

Kerjakan berurutan:

1. Nomor 1, 2 dan 5 dari daftar tahap tiga di atas (undang pelanggan, tangguhkan/pulihkan dan koreksi saldo, judul ZRouter dan ikon serta halaman aktivasi tanpa token).
2. `auth.tsx`: lengkapi daftar `returnTo` dengan semua rute portal dan admin yang ada sekarang, termasuk `akun`.
3. **Tidak ada pengembalian saldo (keputusan founder, CR-035, `docs/TOKEN_CREDIT.md` section 2).** Tampilkan satu kalimat dari satu kunci di `messages.ts` di dua tempat: dekat daftar paket di beranda, dan di atas form redeem pada Isi Saldo. Teks: "Pembelian token bersifat final. Saldo tidak dapat dikembalikan atau diuangkan, termasuk saat akun ditutup." Tambahkan test yang memeriksa teks itu tampil di kedua layar.

Berkas bersama (`app.tsx`, `messages.ts`, `styles.css`) kini juga memuat bagian milik Antigravity: edit sebagian saja, jangan menulis ulang seluruh berkas, dan jangan mengubah `account-*.tsx`, `qr.ts`, atau blok `am`. Antigravity sedang mengerjakan audit aksesibilitas di foldernya sendiri dan akan melaporkan temuan pada layar Anda lewat Claude; jangan menunggu laporan itu.

Selesai berarti sama seperti sebelumnya: typecheck, unit, seluruh test browser, `test:local`, `test:browser` lulus, lalu catat di `docs/handoff/hermes-log.md` bagian baru bertanggal dan sebutkan bahwa build siap dipasang.

## Tahap empat (2026-11-15 malam)

Tahap tiga lanjutan diterima, digabung dan terpasang di https://zrouter.web.id. Perbaikan yang Claude lakukan saat memeriksa ada di `docs/handoff/claude-log.md` bagian "2026-11-15 malam"; baca dulu, terutama soal `ref` yang mengambil fokus pada setiap render. Dua temuan audit aksesibilitas sudah diperbaiki Claude; tidak perlu dikerjakan lagi.

Mulai dengan `git pull --ff-only origin main` tidak diperlukan: folder ini sudah berisi semuanya. Kerjakan berurutan:

1. **Detail pelanggan sebagai tab (SCR-015)**. Halaman detail sekarang panjang (ringkasan, tambah saldo, koreksi, pemakaian, ledger). Susun menjadi tab sesuai `docs/UX.md` SCR-015: Ringkasan (saldo, status, tangguhkan/pulihkan), Saldo (tambah saldo, koreksi), Pemakaian, Transaksi, API Key. Tab API Key belum ada sama sekali: daftar dari `GET /admin/api/customers/:username/keys` (bentuk sama dengan daftar key pelanggan, dengan `after`/`limit`) dan cabut lewat `POST /admin/api/customers/:username/keys/:id/revoke` `{ expectedVersion }` dengan dialog konfirmasi dan step-up; secret key tidak pernah tampil di sini. Tab memakai pola ARIA tabs dengan navigasi panah; tab aktif disimpan di query string agar tahan muat ulang. Test yang ada tetap lulus.
2. **Beranda untuk pengguna baru (SCR-007)**. State first-use: daftar langkah (isi saldo, buat API key, baca panduan) dengan tanda selesai dari data yang sudah ada (`/api/balance`, `/api/keys`); hilang setelah ketiganya selesai. Tanpa endpoint baru.
3. **Halaman tidak ditemukan**. Rute `*` saat ini seadanya: beri judul, penjelasan dan tautan kembali, untuk pelanggan dan admin, dengan `h1` yang menerima fokus.
4. **Aturan CSS yang hilang**: `.refund-policy` dan `.activation-link` dipakai tetapi belum ada di `styles.css`. Kalimat kebijakan harus terbaca jelas (bukan teks redup); tautan aktivasi tidak boleh melebar di 360 px.
5. Untuk setiap butir: test Playwright termasuk keyboard dan 360 px, lalu seluruh rangkaian test seperti biasa, dan catat di `docs/handoff/hermes-log.md`.

Tetap jangan menyentuh `account-*.tsx`, `qr.ts`, blok `am`, `web/scripts/a11y-audit.mjs`, `web/test/e2e/return-to.spec.ts` dan `web/scripts/admin-customers-local-verify.mjs` (milik Antigravity).

### Tahap empat, tambahan (2026-11-16 malam)

Kerjakan **sebelum** butir tahap empat yang belum selesai: baca `docs/handoff/claude-log.md` bagian "2026-11-16 malam", subbagian "Untuk Hermes", butir 1 sampai 4. Butir 1 dan 2 adalah bug nyata yang ditemukan test Antigravity (`web/test/e2e/return-to.spec.ts`, sekarang ada di folder ini dan merah sampai diperbaiki) dan auditnya. Perbaikan butir 1 sudah diuji Claude; terapkan, lalu buktikan `npx playwright test test/e2e/return-to.spec.ts` 11/11 dan `node scripts/a11y-audit.mjs` 0 temuan. Jangan mengubah `return-to.spec.ts` agar lulus.

## Tahap lima (2026-11-16 larut malam)

Tahap empat diterima dan terpasang. Claude mengerjakan sendiri "Tahap empat, tambahan" (returnTo, judul `Shell` saat error, teks, CSS) plus beberapa temuan kecil; rinciannya di `docs/handoff/claude-log.md` bagian "2026-11-16 larut malam". Baca itu dulu dan **jangan mengulang** perbaikan tersebut. Folder ini sudah berisi semuanya; jangan memulai dengan mengembalikan berkas ke versi lama Anda.

1. **Beranda admin**: `/admin` dan tujuan bawaan sesudah login admin menjadi `/admin/ringkasan` (layar Antigravity), bukan `/admin/pelanggan`. Sesuaikan test yang terdampak, termasuk `return-to.spec.ts` bila mengharapkan `/admin/pelanggan` sebagai bawaan (ini perubahan perilaku yang disengaja; catat di log).
2. **Teks**: sisa usulan Antigravity di `docs/handoff/antigravity-log.md` D.2 yang belum dikerjakan Claude. Pilih dengan pertimbangan Anda; untuk setiap usulan yang ditolak, satu baris alasan di log.
3. **Penanda panduan sudah dibaca** pada checklist Beranda: sekarang hanya tercatat bila pelanggan mengeklik tautan di checklist. Catat juga saat halaman `/panduan` dibuka langsung.
4. Jangan menjalankan Playwright bersamaan dengan suite di folder Antigravity pada port bawaan (lihat catatan di claude-log). Seluruh rangkaian test seperti biasa; catat di log.

Tetap jangan menyentuh berkas milik Antigravity: `account-*.tsx`, `admin-overview.tsx`, `qr.ts`, blok `am` dan `ov`, `web/scripts/*-local-verify.mjs` selain `local-browser-verify.mjs`, `a11y-audit.mjs`, `verify-all.mjs`, `return-to.spec.ts` (kecuali butir 1), `admin-overview.spec.ts`.

## Tahap lima, tambahan (2026-11-18)

Audit aksesibilitas Antigravity yang baru (Tugas lima, `docs/handoff/antigravity-log.md`) menemukan tiga masalah nyata pada detail pelanggan bertab. Claude sudah memeriksa ketiganya di kode. Kerjakan bersama Tahap lima:

5. **Fokus dicuri saat ganti tab.** `RouteFocus` di `web/src/app.tsx` memindahkan fokus ke `h1` setiap `location.search` berubah, jadi panah kiri/kanan, Home dan End pada tab langsung melempar fokus ke judul "Pelanggan" (WCAG 2.1.1/2.4.3). Jangan pindahkan fokus bila elemen aktif berada di dalam `[role="tablist"]` (mis. `document.activeElement?.closest('[role="tablist"]')`), atau cara lain yang setara; perpindahan halaman dan paginasi tetap seperti sekarang.
6. **Kontras saat hover tab aktif.** `.customer-tabs [role="tab"][aria-selected="true"]:hover` hanya menimpa `color`, sehingga latar biru tua dari aturan hover tombol global tetap berlaku (rasio sekitar 2,0). Tambahkan `background: var(--color-surface)` pada aturan itu.
7. **Fokus hilang ke `<body>` sesudah dialog cabut key ditutup.** `CustomerKeyRevokeAction` di `web/src/admin-customers.tsx` menyembunyikan tombol pemicu (`{!confirm && ...}`) selama dialog terbuka, jadi `Modal` tidak bisa mengembalikan fokus. Biarkan tombol tetap terpasang. Sesudah pencabutan berhasil (tombol hilang karena status `REVOKED`), arahkan fokus ke elemen yang stabil, misalnya judul baris key atau judul panel.
8. Bukti: `node scripts/a11y-audit.mjs` (cara pakai dan port ada di catatan Antigravity Tugas lima) berakhir tanpa temuan, ditambah satu test Playwright yang menekan panah pada tab dan memeriksa fokus tetap di tab.

Catatan: perubahan Anda pada `admin-overview.spec.ts` untuk butir 1 boleh. Antigravity juga menambah satu test di akhir berkas yang sama; Claude yang menggabungkannya, jangan disalin.

## Tahap enam (2026-11-18 siang)

Tahap lima diterima dan terpasang (`zrouter:r11181828`). Butir 5 sampai 8 dikerjakan Claude; baca `docs/handoff/claude-log.md` bagian "2026-11-18 siang" dulu dan jangan mengulanginya. Dua hal dari perubahan Anda yang Claude perbaiki dan perlu Anda ketahui: panel sekali tampil dipakai juga untuk kode redeem, jadi teksnya kini dibedakan lewat `SecretReveal kind`; dan skrip Antigravity bergantung pada teks Anda, jadi sebut perubahan teks yang terlihat di log.

1. **Daftar request lintas pelanggan (SCR-017)** di `/admin/rekonsiliasi`, di samping antrean unresolved yang sudah ada. Claude sedang membuat endpoint-nya; kontrak tetap, mulai dengan mock:
   `GET /admin/api/requests?username=&state=&model=&before=&limit=` (admin) menjawab `{ requests: [{ id, username, keyName, model, protocol, stream, state, outcome, final, heldMicro, debitMicro, estimated, usage, createdAt }], nextBefore }`. `username` dicocokkan persis; `state` salah satu dari `ADMITTED, STREAMING, COMPLETED, FAILED, CANCELLED, SETTLED, SETTLED_ESTIMATED, UNRESOLVED, REJECTED` (nilai lain 400); urut terbaru dulu; `before` adalah `createdAt` baris terakhir; `limit` 1 sampai 100, bawaan 50. Hanya metadata, tanpa isi prompt.
   Layar: filter username, state dan model; paginasi; tiap baris waktu, username (tautan ke detail pelanggan), key, model, protokol dan stream, badge state, hold atau debit, penanda estimasi dan alasan (`outcome`) dalam bahasa admin. Keadaan loading, kosong, tanpa hasil, gagal. 360 px dan keyboard seperti layar lain.
2. **Panduan**: tambahkan error `service_paused` (HTTP 503, header `Retry-After`) ke referensi error: layanan sedang dijeda admin, coba lagi nanti; request yang sudah berjalan tidak terputus.
3. **Fokus sesudah login**: `RouteFocus` berjalan saat `Shell` masih memuat, sehingga sesudah login fokus tidak sampai ke judul halaman. Pastikan fokus berpindah ke `h1` begitu isi halaman tampil, tanpa mencuri fokus dari elemen yang sudah dipilih pengguna. Test di aplikasi penuh (lihat `customer-tabs-focus.spec.ts`).
4. **Kebisingan test**: request yang tidak di-mock memunculkan `[vite] http proxy error` di setiap run (daftar di `docs/handoff/antigravity-log.md` Tugas enam bagian D butir 4). Tambahkan mock-nya.
5. Seluruh rangkaian test seperti biasa; jangan menjalankan Playwright bersamaan dengan Antigravity.

Tetap jangan menyentuh berkas Antigravity: `account-*.tsx`, `admin-overview.tsx`, `qr.ts`, blok `am` dan `ov`, `web/scripts/*-local-verify.mjs` selain `local-browser-verify.mjs`, `a11y-audit.mjs`, `verify-all.mjs`, `admin-overview.spec.ts`, `account-*.spec.ts`.

## Tahap tujuh (2026-11-18 malam)

Tahap enam digabung; baca `docs/handoff/claude-log.md` bagian "2026-11-18 malam" dulu. **Penting:** versi Anda tidak lolos typecheck (`grouped` tidak diimpor), `service_paused` tertulis 403 padahal 503, fokus judul hilang di halaman tanpa `main#main`, dan tidak ada test maupun log. Claude sudah memperbaikinya. Mulai tahap ini, tahap dianggap selesai hanya bila semua ini terpenuhi dan tercatat di log Anda:

- `npm run typecheck`, `npm test`, `npm run test:e2e` penuh, `npm run test:local` dan `npm run test:browser` lulus, dengan jumlah test yang ditulis di log.
- Setiap butir punya test baru yang gagal tanpa perubahan Anda.
- Setiap teks yang terlihat dan berubah disebut di log (skrip Antigravity bergantung padanya).

1. **Tab Request di detail pelanggan (SCR-015)**. `docs/UX.md` meminta tab Request. Tampilkan request pelanggan itu dari `GET /admin/api/requests?username=<username>` (kontrak di `docs/ARCHITECTURE.md` section 5.7). Pakai ulang komponen daftar dari `admin-operations.tsx` (pindahkan ke komponen bersama dengan username tetap) daripada menyalinnya. Urutan tab, ARIA tabs dan query `tab` mengikuti pola yang ada; jangan merusak `customer-tabs-focus.spec.ts`.
2. **Filter audit (SCR-018)**. Server kini menerima `GET /admin/api/audit?action=&actor=&targetType=&targetId=&before=` dan mengembalikan `actorUsername` serta `nextBefore` (section 5.7). Di layar Audit: filter awalan aksi (pilihan untuk kelompok umum seperti `setting.`, `voucher.`, `customer.`, `key.`, `request.`, plus isian bebas), username pelaku dan target; tampilkan username pelaku, bukan UUID; nama aksi dalam bahasa admin dengan nama mentah sebagai cadangan untuk aksi yang belum dikenal; paginasi memakai `nextBefore`. Keadaan loading, kosong, tanpa hasil.
3. Jangan menjalankan Playwright bersamaan dengan Antigravity.

Tetap jangan menyentuh berkas Antigravity (daftar di Tahap enam).

## Tahap delapan (2026-11-19)

Tahap tujuh digabung (`9e117d2`); baca `docs/handoff/claude-log.md` bagian "2026-11-19" dulu. Kerja Anda kali ini jauh lebih rapi: semua perintah lulus dan ada test serta log. Yang diperbaiki Claude: log Anda menyebut 33 dari 33 aksi audit berlabel, padahal server menulis 43 (sepuluh yang dipilih lewat ternary terlewat). Kini ada `web/test/unit/audit-actions.test.ts` yang memindai `server/src`, jadi jangan mengandalkan hitungan manual. Kelompok `customer.` dan `key.` dihapus karena server tidak pernah menulisnya (contoh di tugas yang keliru, salah Claude). Label wilayah filter audit kini `m.auditFilters`, dan "Biaya estimasi" tidak lagi tampil dua kali. Aturan selesai dari Tahap tujuh tetap berlaku.

1. **Keadaan layanan-dijeda di portal pelanggan (SCR-007; `docs/UX.md` alur penjedaan layanan dan tabel teks "Layanan dijeda")**. Claude menambahkan `servicePaused: boolean` ke respons `GET /api/me`; mulai dengan mock. Selama `true`, setiap halaman portal pelanggan menampilkan banner dengan teks UX.md: "Layanan sedang dijeda sementara. Request baru ditolak; saldo Anda tidak berubah.", Beranda belum punya bagian status layanan yang diminta SCR-007; tambahkan bagian kecil yang menampilkan "Berjalan" atau "Dijeda". Field yang tidak ada dianggap tidak dijeda. Banner tidak diumumkan ulang pembaca layar di setiap perpindahan halaman, dan bukan toast. Backoffice tidak berubah (admin sudah punya panel di Ringkasan). Test: `true`, `false`, field tidak ada, 360 px.
2. **Rincian event audit (SCR-018)**. Tiap baris audit punya `<details>` "Rincian" yang menampilkan `summary` sebagai daftar kunci dan nilai: kunci yang dikenal (misalnya `reason`, `previousStatus`, `nextStatus`, `amountMicro`) dalam bahasa admin, kunci lain dengan nama mentah; nilai berakhiran `Micro` diformat sebagai kredit token; nilai bersarang ditampilkan sebagai teks JSON pendek. Summary kosong: tidak ada `<details>`.
3. **Halaman lanjutan yang kosong**. Di audit dan daftar request (Rekonsiliasi dan tab Request), bila kursor `before`/`requestBefore` aktif dan halaman kosong, tampilkan "Tidak ada data lagi" dengan tombol ke halaman pertama, bukan "Belum ada ..." yang menyiratkan tidak ada data sama sekali.
4. Jangan menjalankan Playwright bersamaan dengan Antigravity.

Tetap jangan menyentuh berkas Antigravity (daftar di Tahap enam).

## Tahap sembilan (2026-11-19)

Tahap delapan digabung; ringkasan perbaikan Claude ada di `docs/handoff/claude-log.md` bagian "Tahap delapan Hermes digabung". Singkatnya: nilai status hanya diterjemahkan pada kunci status, `RESTORED` bukan status server (yang ada `CLOSED`), dan tombol "Halaman awal" tidak lagi muncul dua kali di audit. Aturan selesai dari Tahap tujuh tetap berlaku.

1. **Status layanan selalu baru**. Kini banner jeda hanya diperbarui saat halaman dimuat ulang atau Beranda dibuka. Muat ulang `/api/me` setiap kali rute portal berpindah dan saat tab kembali terlihat (`visibilitychange`), tanpa menampilkan layar memuat dan tanpa mengganti banner yang sudah ada dengan elemen baru. Bila pembacaan ulang gagal, jangan ganti seluruh shell dengan layar galat; pertahankan data terakhir. Test: jeda lalu lanjut tanpa memuat ulang halaman, galat jaringan pada pembacaan ulang, dan elemen banner tetap sama sesudah berpindah halaman.
2. **Label kunci rincian audit**. Beri label admin untuk semua kunci `summary` yang ditulis server (cari `summary: {` di `server/src`), misalnya `entryId`, `tenantId`, `version`, `previousVersion`, `method`, `kind`, `email`, `username`, `name`, `modelId`, `upstream`, `protocol`, `priority`, `before`, `after`. Tambahkan test unit yang memindai `server/src` seperti `web/test/unit/audit-actions.test.ts`, sehingga kunci baru tanpa label membuat test gagal. Kunci yang tidak dikenal tetap tampil mentah.
3. Jangan menjalankan Playwright bersamaan dengan Antigravity. Tetap jangan menyentuh berkas Antigravity (daftar di Tahap enam).

## Tahap sepuluh (2026-11-21)

Tahap sembilan digabung; ringkasan perbaikan Claude ada di `docs/handoff/claude-log.md` bagian "Tahap sembilan Hermes digabung". Singkatnya: test pemindai `summary` melewatkan summary yang berisi template literal (`route.update`, `pack.update`) dan kini gagal bila ada `summary` berbentuk lain; nilai boolean tampil "Ya"/"Tidak"; `seq` berlabel "Versi harga"; `chat`/`anthropic`/`responses` berlabel "Base URL ...". Aturan selesai dari Tahap tujuh tetap berlaku.

1. **Matriks state UX**. Claude sudah membuat kerangkanya di `docs/handoff/hermes-state-matrix.md`: 82 state dari tabel layar `docs/UX.md` (SCR-004 sampai SCR-018), satu baris per state. Tabel layar UX.md tidak perlu dibaca ulang. Isi kolom Penerapan (berkas dan fungsi), Test (berkas dan nama test) dan Status. State dihitung teruji hanya bila ada test yang memeriksa teks atau role yang terlihat untuk state itu, bukan sekadar halaman terbuka. Jangan menebak; baca kodenya. Kerjakan per layar dan simpan berkas sesudah tiap layar, jadi pekerjaan tidak hilang bila sesi terputus.
2. **Lengkapi state yang belum ada**, paling banyak delapan state, utamakan portal pelanggan (SCR-004 sampai SCR-013). Hanya state yang datanya sudah disediakan server (kontrak di `docs/ARCHITECTURE.md` section 5). Per state: test yang gagal dulu, lalu penerapan; teks baru mengikuti `docs/UX.md`. State yang butuh fitur server yang belum ada (misalnya uji koneksi, cost profile, kurs dan circuit breaker di SCR-016) tidak dikerjakan dan tidak dibuatkan mock kontrak karangan; catat di "Permintaan ke Claude" dengan field atau endpoint yang dibutuhkan.
3. Jangan menjalankan Playwright bersamaan dengan Antigravity. Tetap jangan menyentuh berkas Antigravity (daftar di Tahap enam).

## Tahap sebelas (2026-11-23)

Tahap sepuluh digabung (`950b3b6`). Matriks Anda mencatat 35 state teruji, 36 ada tanpa test, 2 belum dan 9 butuh server; sembilan kontrak server yang Anda minta kini ada di antrean Claude. Antigravity sudah mengubah `web/playwright.config.ts`: 12 berkas spec berjalan terhadap build (`vite preview` di `WEB_PREVIEW_PORT`), enam lainnya terhadap Vite dev. Spec baru otomatis masuk kelompok build. Jalankan Playwright dengan `CI=1`; tanpa itu Playwright memeriksa port yang masih tertutup lebih dulu, dan di WSL ini pemeriksaan itu menggantung sekitar 134 detik per server. Penyebab gagal acak juga sudah ditemukan: Wi-Fi `eth8` di WSL melepas dan memasang ulang alamatnya beberapa kali per menit, lalu Chrome membatalkan request yang sedang jalan dengan `ERR_NETWORK_CHANGED`. Antigravity sedang memperbaikinya di Tugas dua belas. Sampai perbaikan itu masuk, kegagalan `Failed to fetch dynamically imported module` yang lulus saat diulang sendirian boleh dicatat sebagai gangguan jaringan, lengkap dengan nama test dan waktunya.

1. **Test untuk state yang "ada tanpa test"**: paling banyak sepuluh, utamakan portal pelanggan (SCR-004 sampai SCR-013). Test harus memeriksa teks atau role yang terlihat untuk state itu. Respons server boleh ditiru dengan `page.route` hanya untuk bentuk yang sudah ada di kontrak server; jangan mengarang field. Bila test membuktikan state itu tidak berfungsi, perbaiki seminimal mungkin dan catat. Perbarui kolom Test dan Status di `docs/handoff/hermes-state-matrix.md`.
2. **SCR-007 data-usang**: sekarang bila pembacaan ulang saldo gagal, `ErrorBox` menggantikan saldo. Ikuti `docs/UX.md`: saldo terakhir tetap tampil bersama waktu pembaruannya dan penanda bahwa data mungkin usang, dengan pola yang sama seperti status layanan di Tahap sembilan (layar galat hanya bila belum pernah ada data). Mulai dari test yang gagal.
3. **`web/test/e2e/guide.spec.ts`**: baris 11 masih membaca `WEB_PORT`. Ambil origin dari halaman yang sedang dibuka, lalu hapus `'**/guide.spec.ts'` dari `devOriginSpecs` di `web/playwright.config.ts`. Hanya baris itu yang boleh diubah di berkas tersebut.
4. **SCR-016 circuit-terbuka** (kontrak sudah ada di `5b9607a`): setiap route dari `GET /admin/api/routes` kini membawa `circuit: { open, openUntil, reason, failures }`. `reason` bernilai `'failures'` (tiga kegagalan berturut-turut, tertutup lagi sesudah 30 detik) atau `'upstream_auth'` (upstream menjawab 401/402, tertutup lagi sesudah lima menit); `openUntil` berupa waktu ISO. Status ini disimpan di memori server, jadi hilang saat server dimulai ulang. Tampilkan pada daftar route: route terbuka, alasannya dalam bahasa admin, dan kapan dicoba lagi. `failures` di atas nol pada route yang masih tertutup boleh ditampilkan sebagai peringatan. Tulis test lebih dulu; teks baru mengikuti gaya `docs/UX.md` dan dicatat di laporan.
5. Satu test server yang Anda lihat gagal 144/145 (`gateway-concurrency.test.ts`, assertion `upstream_500`) sudah diperbaiki Claude. Dalam burst 60 request bersamaan dengan saldo kecil, semua request fallback kadang ditolak 402 lebih dulu, jadi tidak ada yang sampai ke route yang gagal. Fallback kini diperiksa dengan satu request terpisah sebelum burst.
6. Tetap jangan menjalankan Playwright bersamaan dengan Antigravity dan jangan menyentuh berkas Antigravity. Aturan selesai dari Tahap tujuh tetap berlaku. Laporan di `docs/handoff/hermes-log.md`; jangan commit dan jangan deploy.

## Tahap dua belas (2026-11-23)

Tahap sebelas diterima apa adanya: sepuluh state baru teruji, saldo usang di Beranda, status circuit route, dan `guide.spec.ts` sekarang berjalan pada build. Matriks kini 47 teruji, 26 ada tanpa test, 1 belum, 8 butuh server. Kontrak baru dari Claude ada di `docs/ARCHITECTURE.md` (tabel endpoint, baris `POST /admin/api/requests/:id/resolve` dan `GET /admin/api/routes`).

1. **SCR-017 sudah-diselesaikan (replay)**: penyelesaian request kini mengembalikan receipt `{ id, state, debitMicro, resolvedAt, replayed }`. Bila keputusan yang sama dikirim ulang, misalnya sesudah jawaban hilang, server mengembalikan receipt pertama dengan `replayed: true`. Keputusan berbeda untuk request yang sudah diselesaikan menghasilkan 409 `already_resolved`. Tampilkan receipt sesudah penyelesaian (debit dalam kredit token dan waktunya), bedakan "sudah tercatat sebelumnya" untuk replay, dan beri pesan yang jelas untuk `already_resolved`. Hasil keuangan tidak boleh optimistis dan tidak boleh lewat toast. Mulai dari test yang gagal.
2. **SCR-014 data-usang**: Ringkasan Operasi memakai pola yang sama dengan Beranda. Data terakhir dan waktu `generatedAt` tetap tampil bila pembacaan ulang gagal, ditambah penanda bahwa data mungkin usang. Layar galat hanya muncul bila belum pernah ada data.
3. **Test untuk state "ada tanpa test"**: paling banyak sepuluh, kali ini utamakan backoffice (SCR-015 sampai SCR-018), lalu sisa portal. Aturannya sama seperti Tahap sebelas.
4. Tetap jangan menjalankan Playwright bersamaan dengan Antigravity dan jangan menyentuh berkas Antigravity. Aturan selesai dari Tahap tujuh tetap berlaku. Laporan di `docs/handoff/hermes-log.md`; jangan commit dan jangan deploy.

## Tahap tiga belas (2026-11-24)

Tahap dua belas diterima apa adanya (`2ace843`): receipt penyelesaian dan replay, konflik `already_resolved`, Ringkasan Operasi yang mempertahankan data terakhir, dan sebelas state backoffice. Izin founder untuk perubahan minimal pada `admin-overview.tsx` sudah dicatat. Matriks kini 58 teruji, 17 ada tanpa test, 0 belum, 7 butuh server. Verify-all Claude lulus 15/15. Isolasi Chromium dari Antigravity kini bawaan di verify-all. Untuk Playwright langsung, tetap pakai `PLAYWRIGHT_CHROMIUM_EXECUTABLE=./scripts/chromium-netns.sh` seperti yang sudah Anda lakukan.

1. **Selesaikan 17 state "ada tanpa test"** yang tidak butuh kontrak server baru, dengan aturan yang sama seperti Tahap sebelas: teks atau role yang terlihat, respons tiruan hanya berbentuk kontrak yang ada. Bila sebuah state ternyata butuh server, pindahkan ke "butuh server" dengan alasan yang jelas.
2. **Kunci kontrak di test unit**: tambahkan test unit untuk `parseResolveReceipt` (dan pembaca payload sejenis yang Anda temukan) dengan bentuk sah dan beberapa bentuk rusak. Bentuk rusak harus menjadi hasil tidak diketahui, bukan angka.
3. Kontrak server berikutnya (filter transaksi SCR-011 dan agregat grafik SCR-010) sedang disiapkan Claude. Jangan dibuatkan tiruan dulu.
4. Tetap jangan menjalankan Playwright bersamaan dengan Antigravity dan jangan menyentuh berkas Antigravity kecuali dengan izin seperti di Tahap dua belas. Aturan selesai dari Tahap tujuh tetap berlaku. Laporan di `docs/handoff/hermes-log.md`; jangan commit dan jangan deploy.
