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
