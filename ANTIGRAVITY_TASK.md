# Pekerjaan untuk Antigravity

Ditulis 2026-11-15 oleh Claude. Tiga agen bekerja bersamaan: Claude (server, deploy, penggabungan), Hermes (web, layar pelanggan dan admin yang sudah ada), Antigravity (berkas ini). Aturan proyek ada di `AGENTS.md` dan mengikat Anda juga.

## Tempat kerja: folder Anda sendiri

| | |
|---|---|
| Folder Anda | `D:\router.dev.zuhri-antigravity` (di WSL: `/mnt/d/router.dev.zuhri-antigravity`) |
| Cabang Git | `antigravity/akun` |
| Port | web 5183, API 55490, verifikasi lokal 55491/5185, dist 55492 |
| Database uji | `router_test_antigravity` di container `router-spike-pg` (127.0.0.1:55432) |

- Jangan membuka atau mengedit `D:\router.dev.zuhri`. Hermes dan Claude bekerja di sana; perubahan Anda masuk lewat penggabungan cabang oleh Claude.
- Jalankan semua perintah di terminal WSL, bukan PowerShell/CMD. `node_modules` sudah dipasang untuk Linux; menjalankan `npm ci` dari Windows akan merusaknya.
- Di setiap terminal baru, sebelum perintah apa pun:

      cd /mnt/d/router.dev.zuhri-antigravity && source .antigravity-env.sh

  Berkas itu memasang port dan database di atas serta `CI=1`, agar Playwright menyalakan server Vite sendiri dan tidak memakai server Hermes di port 5173.
- Commit ke cabang `antigravity/akun` boleh dan dianjurkan per langkah. Jangan push, jangan merge ke `main`, jangan membuat cabang lain.
- Jangan menghentikan, menghapus atau mengubah container `router-spike-pg` dan database selain milik Anda.

## Baca dulu

1. `AGENTS.md` (aturan dan invariant).
2. `HERMES_TASK.md` bagian "Aturan khusus UI" dan "Selesai berarti": berlaku juga untuk Anda.
3. `docs/UX.md` (SCR-013 dan aturan umum layar), `docs/DESIGN.md`, `docs/DSD.md` (CMP-021 step-up, CMP-022 tampil sekali), `docs/UI_REFERENCES.md`.
4. `web/README.md`, lalu `web/src/app.tsx`, `ui.tsx`, `api.ts`, `hooks.tsx`, `messages.ts` untuk pola yang sudah ada. Ikuti pola itu; jangan membuat komponen dasar baru bila `ui.tsx` sudah punya.
5. Kontrak server: `server/src/http/app.ts` (rute di bawah), `server/src/identity.ts`, `server/src/admin.ts`, dan `docs/handoff/claude-log.md` bagian "rute akun admin".

## Pekerjaan

### A. Akun pelanggan (SCR-013), rute `/akun`

- **Ubah password**: `POST /api/account/password` `{ current, next }`. Error `invalid_credentials` (password lama salah), `weak_password`.
- **Sesi**: `GET /api/account/sessions` -> `{ current, sessions: [{ id, createdAt, lastSeenAt }] }` (ISO 8601; versi awal berkas ini salah menulis snake_case). Tandai sesi yang sedang dipakai. Cabut: `POST /api/account/sessions/:id/revoke`. Mencabut sesi yang sedang dipakai berarti keluar: arahkan ke halaman masuk.
- **Tutup akun**: `POST /api/account/close` `{ currentPassword, confirmUsername, expectedVersion }`; `expectedVersion` dari `GET /api/me`. Dialog konfirmasi wajib: pelanggan mengetik username dan password. Teks akibatnya (key berhenti bekerja, tidak bisa masuk lagi, nasib saldo) ambil dari dokumen; bila dokumen tidak menyebutkan, jangan mengarang: tulis di log sebagai pertanyaan. Sesudah berhasil, arahkan ke halaman masuk.

### B. Akun admin, rute `/admin/akun`

Semua butuh step-up (CMP-021, pola sama dengan layar admin lain).

- **Ganti password**: `POST /admin/api/account/password` `{ current, next }`, minimal 14 karakter. Error `invalid_credentials`, `weak_password`.
- **Ganti autentikator**, dua langkah:
  1. `POST /admin/api/account/authenticator/start` -> `{ secretBase32, otpauthUri }`. Tampilkan kunci dalam kelompok 4 karakter untuk diketik manual di aplikasi autentikator, dengan tombol salin. Jangan menjadikan `otpauthUri` tautan dan jangan memakai layanan QR luar. Kode QR hanya boleh bila dibuat di browser tanpa dependency baru; kalau tidak bisa, cukup kunci manual.
  2. `POST /admin/api/account/authenticator/confirm` `{ code }` -> `{ recoveryCodes: [8 kode] }`. Tampilkan sekali (CMP-022) dengan tombol salin, dan jelaskan bahwa autentikator lama berhenti berlaku. Error `no_rotation`, `invalid_code`.
- Kunci dan kode pemulihan hanya ada di memori komponen: tidak di URL, storage, log, atau pesan error, dan dibuang saat layar ditinggalkan.

### Batas berkas

| Boleh | Berkas |
|---|---|
| Membuat | `web/src/account-customer.tsx`, `web/src/account-admin.tsx`, `web/test/e2e/account-customer.spec.ts`, `web/test/e2e/account-admin.spec.ts`, `web/scripts/account-local-verify.mjs`, `docs/handoff/antigravity-log.md` |
| Menambah saja, dalam satu blok bertanda `akun (Antigravity)` di akhir berkas | `web/src/messages.ts` (semua teks antarmuka), `web/src/styles.css` (hanya bila perlu, nilai hanya dari `tokens.css`) |
| Menambah baris rute dan tautan navigasi saja | `web/src/app.tsx` |
| Tidak boleh | berkas lain di `web/`, `server/`, `deploy/`, dokumen di `docs/` selain log Anda, `package.json`, lockfile (tidak ada dependency baru) |

Bila butuh perubahan di luar batas ini (misalnya komponen di `ui.tsx` perlu prop baru, atau server perlu field baru), tulis permintaannya di log Anda. Jangan mengubahnya sendiri.

## Test

Dari `web/`, setelah `source ../.antigravity-env.sh`:

    npm run typecheck
    npm test
    npx playwright test --reporter=line
    node scripts/account-local-verify.mjs

- Saat folder ini dibuat, `typecheck` gagal hanya di `test/e2e/upstreams.spec.ts` dan tiga test arsip di Playwright gagal (`admin.spec.ts` dua test arsip model, `upstreams.spec.ts` satu test arsip upstream). Itu pekerjaan Hermes yang belum selesai. Selain itu semuanya harus lulus, termasuk test baru Anda.
- Test Playwright Anda memakai mock rute seperti test lain, termasuk uji negatif: password lama salah, kode salah, step-up dibatalkan, server menolak.
- `account-local-verify.mjs`: contoh polanya `scripts/local-browser-verify.mjs` (server Fastify nyata, schema privat acak yang dibuang di akhir, `VERIFY_API_PORT`/`VERIFY_WEB_PORT` dari environment). Buktikan terhadap server nyata: ganti password lalu masuk dengan password baru, cabut sesi lain, tutup akun lalu tidak bisa masuk, admin ganti password dan ganti autentikator lalu masuk dengan kode dari kunci baru.
- Periksa 360 px, keyboard saja, dan reduced motion untuk kedua layar.
- Simpan keluaran test di `web/evidence/antigravity-*.txt` (tidak masuk Git).

## Selesai

Tulis di `docs/handoff/antigravity-log.md`: apa yang ditulis, apa yang dijalankan, apa yang lulus, apa yang belum, pertanyaan untuk founder, dan permintaan ke Claude/Hermes. Bedakan "ditulis", "dijalankan" dan "lulus". Commit semuanya ke cabang `antigravity/akun`, lalu laporkan ke founder. Claude yang memeriksa, menggabungkan ke `main`, dan memasang ke server.

Tidak boleh: deploy, request ke upstream, email nyata, dependency baru, menonaktifkan atau melewati test agar hijau.

---

# Tugas dua (2026-11-15 siang)

Tugas pertama diterima dan sudah terpasang di https://zrouter.web.id. Satu temuan dari pemeriksaan Claude: kode QR tidak terbaca untuk QR versi 7 ke atas (semua tautan autentikator), karena pola alignment yang berimpit dengan garis timing dilewati. Sudah diperbaiki di `web/src/qr.ts` dengan unit test `web/test/unit/qr.test.ts`. Pelajarannya untuk tugas ini: test harus memeriksa hasil yang benar-benar dipakai orang (QR yang dipindai), bukan hanya bahwa elemennya tampil.

## Mulai dengan menyamakan folder

    cd /mnt/d/router.dev.zuhri-antigravity && source .antigravity-env.sh
    git checkout antigravity/akun && git pull --ff-only origin main

Bila `git pull` menolak, berhenti dan laporkan; jangan memaksa.

## A. Teks tutup akun (keputusan founder, CR-035)

Founder memutuskan tidak ada pengembalian saldo (`docs/TOKEN_CREDIT.md` section 2). Ganti `closeConsequenceBalance` di blok `am` menjadi: "Sisa saldo token hangus dan tidak dapat dikembalikan atau diuangkan. Riwayat transaksi tetap tersimpan." Sesuaikan test yang memeriksa teks itu.

## B. Audit aksesibilitas dan tampilan untuk semua layar

Hermes mencatat bahwa audit aksesibilitas independen dan pemeriksaan 360 px untuk tiap state belum pernah dilakukan. Anda yang melakukannya, sebagai pemeriksa: **Anda tidak mengubah berkas Hermes**, hanya melaporkan.

1. Tulis `web/scripts/a11y-audit.mjs` dengan pola `account-local-verify.mjs`: server Fastify nyata, schema privat acak yang dibuang di akhir, port dari `VERIFY_API_PORT`/`VERIFY_WEB_PORT`. Siapkan data lewat fungsi server (admin, pelanggan bersaldo, paket, kode redeem, API key, model berharga) agar layar tidak hanya menampilkan keadaan kosong. Data yang butuh jaringan luar (upstream) tidak perlu; catat layar yang hanya teraudit dalam keadaan kosong.
2. Untuk setiap rute portal dan admin di `web/src/app.tsx`, pada lebar 360x640 dan 1280x800:
   - axe (`@axe-core/playwright`, sudah ada) dengan tag `wcag2a`, `wcag2aa`, `wcag21aa`, `wcag22aa`;
   - tidak ada gulir horizontal;
   - semua elemen interaktif dapat dicapai dengan Tab dan fokusnya terlihat;
   - judul halaman (`h1`) ada dan fokus berpindah ke konten saat ganti rute;
   - dengan `prefers-reduced-motion: reduce`, tidak ada animasi berjalan.
   Untuk dialog (step-up, konfirmasi): fokus masuk ke dialog, Escape menutup, fokus kembali ke tombol pembuka.
3. Skrip keluar dengan kode 1 bila ada temuan. Simpan hasil di `web/evidence/antigravity-audit.json` dan ringkasannya di `web/evidence/antigravity-audit.txt`.

## Batas berkas

Boleh: `web/scripts/a11y-audit.mjs` (baru), berkas milik Anda dari tugas pertama, blok `am`, log Anda. Temuan pada layar milik Anda (`/akun`, `/admin/akun`) boleh langsung diperbaiki. Temuan pada layar lain **jangan diperbaiki**; tulis di log.

## Laporan

Di `docs/handoff/antigravity-log.md`, bagian baru bertanggal: tabel temuan dengan kolom layar, lebar, masalah, kriteria WCAG, cara mengulang, berkas, pemilik (Hermes/Antigravity), usulan perbaikan. Urutkan dari yang paling menghalangi pengguna. Lalu hasil test seperti tugas pertama (typecheck, unit, seluruh Playwright, `account-local-verify.mjs`, `a11y-audit.mjs`), dengan membedakan "ditulis", "dijalankan" dan "lulus". Commit ke cabang `antigravity/akun`, jangan push.

---

# Tugas tiga (2026-11-15 malam)

Tugas dua diterima, digabung ke `main` dan audit Anda sekarang lulus dengan 0 temuan (dua temuan pada layar Hermes sudah diperbaiki). Tugas ini sengaja lebih besar: empat bagian yang tidak saling bergantung. Kerjakan berurutan, commit per bagian, dan laporkan sekali di akhir. Bila satu bagian terhalang, catat di log lalu lanjut ke bagian berikutnya; jangan berhenti menunggu.

## Mulai

    cd /mnt/d/router.dev.zuhri-antigravity && source .antigravity-env.sh
    git checkout antigravity/akun && git pull --ff-only origin main

## A. Bukti terhadap server nyata untuk aksi admin pelanggan

Layar `/admin/pelanggan` kini punya undang pelanggan, tangguhkan/pulihkan dan koreksi saldo (Hermes), tetapi hanya diuji dengan mock. Tulis `web/scripts/admin-customers-local-verify.mjs` (pola `account-local-verify.mjs`: server Fastify nyata, schema privat acak, port dari environment) yang membuktikan lewat browser:

1. Admin mengundang email baru; tautan aktivasi tampil; membuka tautan itu, memilih username dan password, lalu pelanggan baru bisa masuk. Tautan yang sama dipakai kedua kali ditolak. Mengundang email yang sama lagi menampilkan pesan konflik.
2. Admin menangguhkan pelanggan (dengan step-up): request API memakai key pelanggan itu ditolak; setelah dipulihkan diterima lagi. Cukup sampai tahap admission; tidak boleh ada request ke upstream nyata.
3. Koreksi saldo +2,5 dan -1 kredit: saldo di layar dan entri ledger berubah persis sebesar itu dalam mikro-kredit; mengirim ulang dengan kunci idempotency yang sama tidak menggandakan entri.
4. Token undangan dan kode step-up tidak muncul di URL, storage, atau log konsol.

## B. Test perilaku `returnTo`

Test yang ada di `portal.spec.ts` hanya memeriksa teks sumber. Tulis `web/test/e2e/return-to.spec.ts` (berkas baru milik Anda) yang membuktikan perilakunya: untuk setiap rute portal dan admin, sesi berakhir di rute itu lalu masuk kembali mendarat di rute yang sama; `returnTo` berisi alamat luar (`//evil.example`, `https://...`), rute tak dikenal, rute admin pada login pelanggan dan sebaliknya, atau fragment, mendarat di halaman bawaan.

## C. Perluas audit ke state dan dialog baru

Tambahkan ke `a11y-audit.mjs`: form undangan dan kotak hasil undangan, dialog tangguhkan/pulihkan, dialog koreksi saldo, keadaan error tiap layar (server menjawab 500 pada pembacaan utama), dan keadaan kosong. Aturan sama: temuan pada layar Hermes dilaporkan, tidak diperbaiki.

## D. Dua laporan pemeriksaan (tanpa mengubah berkas orang lain)

1. **Token desain**: daftar setiap nilai di `web/src/styles.css` dan atribut `style` di `web/src/*.tsx` yang bukan dari `tokens.css` (warna, ukuran, jarak, radius, durasi), dengan baris dan token pengganti yang diusulkan. Catatan: `.refund-policy` dan `.activation-link` dipakai di komponen tetapi belum punya aturan CSS.
2. **Teks antarmuka**: baca seluruh `web/src/messages.ts` dan laporkan salah ketik, istilah yang tidak konsisten (misalnya "kredit token" vs "token", "key" vs "kunci"), kalimat yang tidak jelas bagi pelanggan awam, dan teks yang bertentangan dengan `docs/UX.md` atau `docs/TOKEN_CREDIT.md`. Beri usulan kalimat pengganti.

Tulis keduanya sebagai tabel di log Anda.

## Batas berkas

Boleh membuat: tiga berkas di atas. Boleh mengubah: berkas milik Anda dari tugas sebelumnya, blok `am`, log Anda. Tidak boleh: berkas lain. Aturan test dan larangan dari tugas pertama tetap berlaku.

## Laporan

Bagian baru bertanggal di `docs/handoff/antigravity-log.md`, per bagian A sampai D, dengan "ditulis", "dijalankan", "lulus". Jalankan juga seluruh rangkaian (typecheck, unit, Playwright, `account-local-verify.mjs`, `a11y-audit.mjs`). Commit ke `antigravity/akun`, jangan push.

---

# Tugas empat (2026-11-16 malam)

Tugas tiga diterima dan digabung ke `main` (Claude meng-commit bagian B sampai D karena `.git` Anda read-only, dan menjalankan audit serta verifikasi di host). Temuan Anda nyata: tiga bug `returnTo` dan `Shell` tanpa judul saat error; semuanya diserahkan ke Hermes. Laporan teks dan token juga diteruskan.

Tugas ini besar dan terdiri dari empat bagian yang tidak saling menunggu. Kerjakan berurutan, commit per bagian, lapor sekali di akhir. Bila satu bagian terhalang, catat dan lanjut.

**Sebelum mulai, pastikan lingkungan Anda bisa commit dan menjangkau `127.0.0.1:55432`** (`git commit --allow-empty -m probe && git reset --soft HEAD~1`, lalu `node -e "require('net').connect(55432,'127.0.0.1').on('connect',()=>{console.log('ok');process.exit(0)}).on('error',e=>{console.log(e.message);process.exit(1)})"`). Bila salah satu gagal, minta founder memulai ulang sesi Anda di terminal WSL, bukan sandbox.

    cd /mnt/d/router.dev.zuhri-antigravity && source .antigravity-env.sh
    git checkout antigravity/akun && git pull --ff-only origin main

## A. Layar Ringkasan Operasi (SCR-014), rute `/admin/ringkasan`

Server sudah ada: `GET /admin/api/overview`, kontraknya di `docs/handoff/claude-log.md` bagian "2026-11-16 malam" (`server/src/overview.ts`). Baca `docs/UX.md` SCR-014 dan aturan umum layar.

- Berkas baru `web/src/admin-overview.tsx`. Kartu angka: pelanggan aktif/ditangguhkan, total saldo, saldo ditahan, akun bersaldo minus (jumlah dan totalnya, ditandai warna peringatan bila lebih dari nol), kode aktif belum ditukar, request 24 jam (total, gagal, estimasi, debit), request menunggu keputusan (tautan ke `/admin/rekonsiliasi`), upstream per status (tautan ke `/admin/upstream`).
- Tampilkan waktu `generatedAt` dan tombol muat ulang; keadaan memuat, gagal (dengan `h1` tetap ada), dan nol.
- Angka uang lewat `formatCredits` dari `credits.ts`; tidak ada `Number()` pada nilai mikro-kredit.
- Jangan menampilkan biaya upstream, margin, atau kill switch: belum ada di server. Tulis satu kalimat bahwa angka biaya belum tersedia.
- Tambah baris rute dan tautan navigasi di `app.tsx` (hanya itu). Jadikan `/admin` mengarah ke `/admin/ringkasan`? **Jangan**; itu keputusan Claude/founder, catat sebagai usulan.
- Test: `web/test/e2e/admin-overview.spec.ts` (mock, termasuk error, nol, angka besar di atas 2^53 mikro-kredit tampil eksak, 360 px, keyboard) dan `web/scripts/admin-overview-local-verify.mjs` (server nyata: siapkan dua pelanggan, satu ditangguhkan, satu minus lewat koreksi, satu kode aktif; angka di layar sama persis dengan data). Tambahkan layar ini ke `a11y-audit.mjs`.

## B. Verifikasi portal pelanggan terhadap server nyata

`web/scripts/portal-local-verify.mjs`, pola sama. Buktikan lewat browser:
1. Tukar kode SALE: saldo naik persis sebesar nilai kode; menukar kode yang sama lagi ditolak dengan pesan yang benar; kode salah juga.
2. Buat API key: secret tampil sekali, tidak ada di URL/storage/konsol; setelah dialog ditutup tidak bisa dilihat lagi; cabut key lalu key itu ditolak di admission (`GET /v1/models` 401).
3. Pemakaian: siapkan request selesai lewat fungsi server (tanpa upstream), lalu `/pemakaian` menampilkan debit yang sama dengan ledger dan `/transaksi` mencantumkan entrinya; pagination bekerja dengan lebih dari satu halaman data.
4. Halaman Model dan Harga menampilkan model dengan harga terbit dan pengali yang sama dengan server; model diarsipkan tidak tampil.

## C. Verifikasi backoffice katalog terhadap server nyata

`web/scripts/admin-catalog-local-verify.mjs`: paket (buat, ubah, nonaktifkan; harga tampilan di beranda pelanggan ikut berubah), kode redeem (terbitkan dari paket, kode tampil sekali, cabut lalu tidak bisa ditukar), harga model (draf, pratinjau, terbit, tarik; pelanggan melihat perubahan), batas lebih-pakai (ubah dengan step-up, nilai baru tampil). Upstream: bila validasi alamat server menolak alamat uji, cukup buktikan pesan penolakannya dan catat.

## D. Ulang setelah Hermes selesai

Bila Hermes sudah memperbaiki `returnTo` dan judul `Shell` (lihat `git log origin/main`), tarik `main` lalu jalankan seluruh rangkaian: `return-to.spec.ts` harus 11/11 dan `a11y-audit.mjs` 0 temuan. Bila belum, catat dan jangan menunggu.

## Batas berkas

Boleh membuat: `admin-overview.tsx`, dua berkas test/verifikasi A, `portal-local-verify.mjs`, `admin-catalog-local-verify.mjs`. Boleh mengubah: berkas milik Anda sebelumnya, `a11y-audit.mjs`, satu blok baru `ringkasan (Antigravity)` di akhir `messages.ts` dan `styles.css` (nilai hanya dari token), baris rute/navigasi `app.tsx`, log Anda. Tidak boleh: berkas lain, `server/`, dependency baru. Bug di berkas Hermes: laporkan, jangan perbaiki. Bila server perlu field atau fungsi seed baru, tulis permintaannya di log.

## Laporan

Bagian bertanggal di `docs/handoff/antigravity-log.md` per bagian A sampai D: "ditulis", "dijalankan", "lulus", dengan perintah dan bukti di `web/evidence/`. Commit ke `antigravity/akun`, jangan push.

---

# Tugas lima (2026-11-16 larut malam)

Tugas empat diterima, digabung dan terpasang (layar Ringkasan Operasi sekarang ada di https://zrouter.web.id/admin/ringkasan). Cabang Anda sudah Claude majukan ke `main` terbaru (`ba49f5c`), yang juga berisi tahap empat Hermes: **detail pelanggan sekarang memakai tab** (Ringkasan, Saldo, Pemakaian, Transaksi, API key; tab aktif di query `?customer=...&tab=...`). Bug `returnTo` dan judul `Shell` sudah diperbaiki Claude.

    cd /mnt/d/router.dev.zuhri-antigravity && source .antigravity-env.sh
    git checkout antigravity/akun && git pull --ff-only origin main

Periksa dulu bahwa commit dan `127.0.0.1:55432` bekerja seperti di tugas empat.

## A. Sesuaikan dua skrip dengan tab

1. `admin-customers-local-verify.mjs` berhenti di koreksi saldo: form koreksi dan tambah saldo ada di tab **Saldo**, angka saldo di tab **Ringkasan**, entri ledger di tab **Transaksi**. Pindah tab lewat tombol tab (bukan URL) sebelum tiap langkah. Claude sudah mengganti satu asersi: query string boleh berisi parameter navigasi (`customer`, `tab`, `keyAfter`, `prefix`, `after`, `before`), bukan harus kosong; jangan dilonggarkan lebih jauh.
2. `a11y-audit.mjs` berhenti menunggu `Jumlah kredit token` (tab Saldo). Audit setiap tab detail pelanggan sebagai keadaan tersendiri, dan tambahkan pemeriksaan pola ARIA tabs: panah kiri/kanan, Home/End, `aria-selected`, `aria-controls`/`aria-labelledby` menunjuk elemen yang ada, panel dapat dicapai dengan Tab.
3. Hasil yang diharapkan: kedua skrip PASS, audit 0 temuan. Temuan baru pada layar Hermes: laporkan, jangan perbaiki.

## B. Satu perintah untuk semua verifikasi

`web/scripts/verify-all.mjs` (baru): menjalankan berurutan typecheck, unit, Playwright penuh, `test:local` dan semua `*-local-verify.mjs` serta `a11y-audit.mjs`, masing-masing dengan port dan database dari environment; menyimpan keluaran tiap langkah di `web/evidence/verify-all/<langkah>.txt`; mencetak tabel ringkas (langkah, lulus/gagal, durasi); keluar 1 bila ada yang gagal. Opsi `--only <nama>` dan `--skip <nama>`. Ingat: `test:local` milik Hermes mensyaratkan nama database `router_test` (schema privat acak, aman dipakai bersama). Tidak boleh mengubah `package.json`; cara pakainya ditulis di log.

## C. Uji tahan banting layar Ringkasan

Tambahkan ke `admin-overview.spec.ts`: respons yang field-nya hilang atau bertipe salah (misalnya `negativeAccounts` berupa string, `customers` tidak ada) tidak boleh membuat layar putih; tampilkan `ErrorBox` dengan judul tetap ada. Saat ini `formatCount` melempar error di tengah render; bila tidak ada error boundary, perbaiki di berkas Anda sendiri (validasi bentuk data sebelum render).

## Batas berkas

Berkas Anda sendiri, `a11y-audit.mjs`, `verify-all.mjs` (baru), blok `ov` dan `am`, log Anda. Tidak boleh: berkas Hermes, `server/`, `package.json`, dependency baru.

## Laporan

Bagian bertanggal di log Anda per bagian A sampai C, dengan keluaran `verify-all.mjs` lengkap sebagai bukti akhir. Commit ke `antigravity/akun`, jangan push.

---

# Tugas enam (2026-11-18)

Tugas lima diterima. Claude sudah menggabungkannya dengan `main` dan memajukan cabang Anda ke `eb65b65`, yang juga membawa skill `modern-web-guidance` di `.agents/skills/` (aturan pakainya di `AGENTS.md`, bagian Aturan UI). Penggabungan ke `main` dan deploy menunggu Hermes selesai. Temuan aksesibilitas Anda sudah menjadi tugas Hermes.

Tugas ini lebih besar dan sebagian besar di luar `web/`: bukti bahwa server menolak akses yang salah, uji restore cadangan, dan satu alur penuh pelanggan sampai gateway. Kerjakan berurutan, commit per bagian, lapor sekali di akhir.

    cd /mnt/d/router.dev.zuhri-antigravity && source .antigravity-env.sh
    git checkout antigravity/akun && git pull --ff-only origin main

Baca dulu: `AGENTS.md` (invariant uang, tenant, rahasia), `docs/SECURITY.md` section 2 (peran dan izin), `docs/ARCHITECTURE.md` section 2 sampai 4 (state request, hold, settlement), `server/test/helpers.ts` dan satu dua test yang ada untuk pola setup. Test server memakai `TEST_DATABASE_URL` dan **menghapus serta membuat ulang skema** di database itu: hanya `router_test_antigravity`, jangan pernah `router_test`, `router_test_claude` atau database lain.

## A. Matriks otorisasi semua rute (`server/test/route-matrix.test.ts`, baru)

Tujuannya: setiap rute yang ada atau ditambah kelak wajib terklasifikasi, dan penolakan bawaannya terbukti.

1. Ambil daftar seluruh rute dari aplikasi yang dibangun `buildApp` (misalnya `app.printRoutes({ commonPrefix: false })` lalu diurai). Tabel klasifikasi di test: `public`, `customer`, `admin`, `admin-stepup` (aksi keuangan dan sensitif admin), `apikey` (`/v1/*`), `static`. **Rute yang tidak ada di tabel membuat test gagal** dengan pesan yang menyuruh pengembang mengklasifikasikannya; entri tabel yang rutenya sudah tidak ada juga gagal.
2. Untuk setiap rute (pakai nilai parameter tiruan bila perlu):
   - `customer` dan `admin` tanpa cookie: 401, bukan 200, 404 atau 500.
   - Cookie pelanggan pada rute `admin`: ditolak. Cookie admin pada rute `customer`: ditolak.
   - Rute yang mengubah data dengan sesi sah tetapi tanpa header `x-router-csrf: 1`: ditolak (catat kode yang dipakai server).
   - `admin-stepup` dengan sesi admin yang umur autentikasinya lewat ambang step-up: ditolak dengan kode step-up, dan tidak ada perubahan data (periksa tabel terkait).
   - `apikey` tanpa key, key salah, key dicabut: 401 dalam format error permukaan masing-masing.
3. Isolasi tenant: untuk setiap rute `customer` yang menerima ID (key, request, transaksi, dan sebagainya), pelanggan B memakai ID milik pelanggan A mendapat respons yang sama dengan ID yang tidak ada.
4. Bila menemukan celah nyata (rute yang lolos tanpa izin, bocor antar-tenant, aksi keuangan tanpa step-up): **jangan ubah `server/src`**. Biarkan kasus itu gagal, tulis di log bagian "Untuk Claude" dengan langkah reproduksi dan tingkat keparahan, lanjutkan bagian berikutnya.

## B. Uji restore cadangan tanpa merusak apa pun (`deploy/restore-drill.sh`, baru)

`deploy/restore.sh` yang ada mengganti database produksi; yang dibutuhkan adalah latihan yang tidak menyentuh database mana pun selain database sekali pakai.

1. `sh deploy/restore-drill.sh <berkas.dump>`: buat database `zrouter_drill_<waktu>`, `pg_restore --no-owner --exit-on-error` ke sana, jalankan `server/scripts/check-invariants.ts` terhadapnya, cetak jumlah baris penting dan bandingkan jumlah migrasi tercatat dengan jumlah berkas migrasi di repo, lalu **selalu** hapus database drill (pakai `trap`). Keluar 1 bila restore gagal, invariant dilanggar atau migrasi tidak cocok.
2. Harus bisa dipakai di dua tempat dengan variabel lingkungan, ikuti gaya `deploy/backup-cron.sh` (`DOCKER`, `COMPOSE_FILE`, `COMPOSE_PROJECT`): lokal lewat container `router-spike-pg` (port 55432), dan di VPS lewat container database compose. Script menolak berjalan bila nama database tujuan tidak berawalan `zrouter_drill_`.
3. Bukti lokal: buat dump format custom dari `router_test_antigravity` sesudah satu skrip verifikasi mengisi data (ada ledger, voucher, request), jalankan drill (lulus). Lalu buat salinan yang sengaja dirusak (ubah `posted` satu akun di database sekali pakai, dump, drill): drill harus keluar 1 dan menyebut pelanggarannya. Jangan menghentikan atau mengubah container `router-spike-pg`. Claude yang akan menjalankannya terhadap cadangan produksi.

## C. Alur penuh pelanggan sampai gateway (`web/scripts/golden-path-local-verify.mjs`, baru)

Ikuti pola skrip `*-local-verify.mjs` Anda. Gateway diarahkan ke **upstream tiruan di loopback** yang Anda jalankan sendiri dalam skrip (`gateway: { unsafeAllowAnyUpstreamUrl: true }` di `buildApp`, lihat `server/test/gateway.test.ts`). Tidak ada request ke upstream nyata.

1. Persiapan admin (boleh lewat API): upstream ke tiruan, model dengan harga terbit dan pengali bukan 1, voucher.
2. Pelanggan lewat UI: tukar voucher, buat API key (ambil secret dari tampilan sekali-tampil).
3. Panggil `/v1/chat/completions` non-stream dan stream, serta `/v1/messages`, dengan key itu. Periksa: field usage di respons sama persis dengan usage dari upstream tiruan (pengali hanya memengaruhi debit); debit per request sama dengan perhitungan dari harga terbit dalam mikro-kredit integer; saldo turun tepat sebesar jumlah debit.
4. UI pelanggan: Pemakaian menampilkan ketiga request dengan debitnya; Transaksi menampilkan entri debit. UI admin: Ringkasan menunjukkan `requests24h.total` 3 dan total debit yang sama.
5. Stream yang diputus klien sesudah potongan pertama: catat state akhir request dan pastikan tidak ada hold `ACTIVE` tertinggal sesudah selesai. Bila perilakunya tidak sesuai `docs/ARCHITECTURE.md` section 3, laporkan ke Claude, jangan ubah server.
6. Cabut key lewat UI, panggilan berikutnya 401. Di akhir, `invariantViolations` kosong.

## D. Berburu test yang tidak stabil

`portal.spec.ts:5` gagal sekali di run penuh Claude dan Hermes, tetapi lulus 3 kali berturut-turut saat dijalankan sendiri. Jalankan suite Playwright penuh minimal 3 kali (`--repeat-each` atau run berulang), daftar setiap test yang pernah gagal, dan cari sebabnya (batas waktu di bawah beban, request yang tidak di-mock seperti `[vite] http proxy error: /api/balance`, urutan antar-test, dan sebagainya). Perbaiki hanya di berkas Anda sendiri; untuk berkas Hermes tulis usulan diff yang tepat di log. Jangan menaikkan timeout global atau menambah retry untuk menyembunyikan masalah.

## E. Lengkapi `verify-all.mjs`

1. Langkah `server-test` (`npm test` di `server/`): **menolak berjalan** bila nama database di `TEST_DATABASE_URL` adalah `router_test` atau tidak mengandung `test`, karena test server membuat ulang skema.
2. Langkah `test-browser` (build lalu `dist-browser-verify.mjs`) dengan port dari environment.
3. Jalankan `verify-all.mjs` penuh di akhir; keluarannya menjadi bukti laporan.

## F. Bila waktu masih ada: pemeriksaan publik hanya-baca (`deploy/smoke-public.sh <base-url>`, baru)

Hanya GET dan tanpa kredensial: `/readyz` 200, halaman `/`, `/masuk` dan `/admin/masuk` 200 berisi HTML aplikasi, header keamanan yang diwajibkan `docs/SECURITY.md` ada, `/api/me` dan `/admin/api/overview` tanpa cookie 401, `/v1/models` tanpa key 401. Uji hanya terhadap server dist lokal (`VERIFY_DIST_PORT`). **Jangan menjalankannya ke zrouter.web.id**; Claude yang menjalankannya sesudah deploy.

## Batas berkas

Boleh: berkas baru yang disebut di atas, `verify-all.mjs`, `a11y-audit.mjs`, berkas Anda sendiri dan log Anda. Tidak boleh: `server/src/**`, migrasi, `package.json` mana pun, dependency baru, berkas Hermes, request ke upstream nyata atau ke situs publik, menghentikan container bersama.

## Laporan

Bagian bertanggal di log per bagian A sampai F, bedakan ditulis, dijalankan dan lulus. Temuan server di bagian "Untuk Claude", diurutkan dari yang paling berat. Keluaran `verify-all.mjs` lengkap sebagai bukti akhir. Commit ke `antigravity/akun`, jangan push.
