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
