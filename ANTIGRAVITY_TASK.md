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
