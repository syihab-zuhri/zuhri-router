# Log Handoff Antigravity (Layar `/akun` dan `/admin/akun`)

- Tanggal: 2026-11-15 (Asia/Jakarta)
- Cabang git: `antigravity/akun`
- Ruang lingkup: `ANTIGRAVITY_TASK.md` — implementasi layar akun pelanggan (`/akun`, SCR-013) dan layar akun admin (`/admin/akun`).

## 1. File yang Ditulis / Diubah

### Ditulis (file baru)
- [`web/src/account-customer.tsx`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/account-customer.tsx): Komponen `CustomerAccountPage` untuk `/akun`:
  - Ringkasan akun dari `GET /api/me` (`username`, `tenantStatus`, `version`).
  - Form ubah password (`POST /api/account/password` `{ current, next }`), memetakan `invalid_credentials` (`am.wrongCurrentPassword`) dan `weak_password` (`am.weakCustomerPassword`), membersihkan input setelah berhasil, tidak memindah ke `/masuk` saat password saat ini salah, serta memicu `sessions.refetch()`.
  - Daftar sesi aktif (`GET /api/account/sessions`), menandai sesi saat ini vs sesi lain (`current`), menampilkan `createdAt` / `lastSeenAt` (dengan fallback `created_at` / `last_seen_at`), dan konfirmasi cabut sesi (`POST /api/account/sessions/:id/revoke`). Mencabut sesi saat ini membersihkan cache query lalu mengarahkan ke `/masuk`.
  - Panel penutupan akun permanen (`POST /api/account/close` `{ currentPassword, confirmUsername, expectedVersion }`) dengan dialog konfirmasi wajib mengetik username dan password saat ini serta daftar konsekuensi sesuai dokumen. Menangani `version_conflict` dengan tombol muat ulang `/api/me`, `invalid_credentials`, dan `invalid_request`, serta mengarahkan ke `/masuk` saat berhasil.
- [`web/src/account-admin.tsx`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/account-admin.tsx): Komponen `AdminAccountPage` untuk `/admin/akun`:
  - Form ubah password admin (`POST /admin/api/account/password` `{ current, next }`, minimal 14 karakter) memakai `useAdminAction()` (CMP-021 step-up).
  - Penggantian autentikator 2 langkah:
    1. `POST /admin/api/account/authenticator/start`: menampilkan kode QR SVG lokal di browser (`qrPathForText` ISO/IEC 18004 Byte mode ECC-M versi 1–10 tanpa dependency baru dan tanpa layanan eksternal), kunci manual dalam kelompok 4 karakter + tombol salin (`Salin kunci` dengan fallback pesan gagal salin browser), dan tidak pernah merender `otpauthUri` sebagai tautan.
    2. `POST /admin/api/account/authenticator/confirm`: memverifikasi kode 6 digit baru, menangani `invalid_code` (kunci baru tetap tampil) dan `no_rotation` (mengembalikan ke tombol mulai), lalu menampilkan modal `RecoveryCodesModal` (CMP-022) berisi 8 kode pemulihan sekali tampil dengan tombol salin dan konfirmasi buang pada `Escape`/tutup modal serta penegasan bahwa autentikator lama berhenti berlaku.
  - Seluruh secret, password, `otpauthUri`, dan `recoveryCodes` disimpan hanya pada state komponen React (dibersihkan saat unmount/tutup modal) dan tidak ditulis ke URL, `localStorage`, `sessionStorage`, atau console.
- [`web/test/e2e/account-customer.spec.ts`](file:///mnt/d/router.dev.zuhri-antigravity/web/test/e2e/account-customer.spec.ts): 2 uji E2E Playwright + `@axe-core/playwright` untuk `/akun`.
- [`web/test/e2e/account-admin.spec.ts`](file:///mnt/d/router.dev.zuhri-antigravity/web/test/e2e/account-admin.spec.ts): 2 uji E2E Playwright + `@axe-core/playwright` untuk `/admin/akun`.
- [`web/scripts/account-local-verify.mjs`](file:///mnt/d/router.dev.zuhri-antigravity/web/scripts/account-local-verify.mjs): Verifikasi end-to-end terhadap server Fastify asli, PostgreSQL lokal terisolasi (`router_test_antigravity`, skema temporer `web_verify_*` yang di-drop pada `finally`), Vite dev server (`VERIFY_WEB_PORT=5185`, `VERIFY_API_PORT=55491`), dan Chromium pada viewport `360x640`.

### Diubah (sesuai batas file tugas)
- [`web/src/messages.ts`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts): Menambahkan satu blok `// --- akun (Antigravity) ---` berisi objek `am` di bagian akhir file.
- [`web/src/styles.css`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/styles.css): Menambahkan satu blok `/* --- akun (Antigravity) --- */` (`.danger-panel`, `.consequence-list`, `.qr-box`, `.qr-svg`) memakai token dari [`web/src/tokens.css`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/tokens.css).
- [`web/src/app.tsx`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/app.tsx): Menambahkan import halaman akun, tautan `['/akun', am.account]` dan `['/admin/akun', am.account]`, serta `<Route>` `/akun` dan `/admin/akun`.

File terlarang di `server/`, `deploy/`, `docs/` (selain log ini), `package.json`, lockfile, dan repo asli tidak diubah.

## 2. Status Verifikasi (Ditulis vs Dijalankan vs Lulus)

Seluruh perintah verifikasi di bawah **dijalankan ulang setelah suntingan kode/test terakhir** dari folder `web/` setelah `source ../.antigravity-env.sh`. Bukti tersimpan di `web/evidence/` (di-gitignore, tanpa secret):

| Pemeriksaan | Status | Hasil Teramati | File Bukti |
|---|---|---|---|
| `npm run typecheck` (`tsc --noEmit`) | Dijalankan & Lulus | Exit code `0`, 0 error TypeScript | `web/evidence/antigravity-typecheck.txt` |
| `npm test` (`node --test test/unit/*.test.ts`) | Dijalankan & Lulus | Exit code `0`, `2` test lulus, `0` gagal | `web/evidence/antigravity-unit.txt` |
| `npm run build` (`vite build`) | Dijalankan & Lulus | Exit code `0`, `159` modul terbundle | `web/evidence/antigravity-build.txt` |
| `npx playwright test test/e2e/account-customer.spec.ts test/e2e/account-admin.spec.ts --reporter=line` | Dijalankan & Lulus | Exit code `0`, `4 passed` (`11.6s`) | `web/evidence/antigravity-account-e2e.txt` |
| `npx playwright test --reporter=line` (seluruh suite `web/`) | Dijalankan; Lulus pada seluruh test akun (`4/4`), gagal pada 4 test pra-ada | `29 passed, 4 failed` (`1.6m`): gagal pada test lama di luar cakupan tugas (`admin.spec.ts:128`, `admin.spec.ts:183`, `admin.spec.ts:232`, `upstreams.spec.ts:154`) | `web/evidence/antigravity-playwright.txt` |
| `node scripts/account-local-verify.mjs` (Fastify + PostgreSQL asli + Vite + Chromium) | Dijalankan (akses PostgreSQL lokal `127.0.0.1:55432`) & Lulus | Exit code `0`, berakhir `account-local-verify: PASS` | `web/evidence/antigravity-local-verify.txt` |

Cakupan yang diverifikasi pada `account-local-verify.mjs` & E2E:
- Pelanggan: mencabut sesi browser kedua lalu memverifikasi konteks kedua menerima `401` dan diarahkan ke `/masuk`; mencabut sesi saat ini dengan keyboard-only menuju `/masuk`; ubah password -> password lama ditolak `401` -> password baru berhasil masuk; penutupan akun -> login ulang ditolak `401`.
- Admin: ubah password dan rotasi autentikator 2 langkah dengan `auth_at` kedaluwarsa di PostgreSQL (memicu dialog step-up nyata), QR SVG lokal & kunci 4 karakter, 8 recovery code sekali tampil & terbuang saat modal ditutup, lalu verifikasi TOTP lama ditolak (`401 invalid_code`) dan TOTP dari kunci baru berhasil masuk admin.
- UX & Keamanan: reflow `360px` tanpa gulir horizontal (`scrollWidth <= innerWidth`), `prefers-reduced-motion: reduce` (`transitionDuration === '0s'`), audit `@axe-core/playwright` (`violations === []`), serta `localStorage`, `sessionStorage`, query/hash URL, dan log bersih dari secret/password/kode pemulihan.

## 3. Catatan DRIFT

1. **Nama field pada `GET /api/account/sessions`**:
   - `ANTIGRAVITY_TASK.md` menuliskan item sesi memakai `{ id, created_at, last_seen_at }`.
   - Implementasi server aktual (`server/src/identity.ts` / `server/src/http/app.ts`) mengembalikan `{ current, sessions: [{ id, createdAt, lastSeenAt }] }` (camelCase).
   - Mitigasi UI: [`web/src/account-customer.tsx`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/account-customer.tsx) membaca `createdAt ?? created_at` dan `lastSeenAt ?? last_seen_at` tanpa mengubah `server/` maupun `docs/` lainnya.
   - Usulan: selaraskan kontrak tertulis jika dokumen spesifikasi API disunting nanti.

## 4. Pertanyaan untuk Founder

1. **Kebijakan sisa saldo positif saat tutup akun**: Pada UI penutupan akun (`/akun`), teks konsekuensi mengikuti `docs/ARCHITECTURE.md` (kunci langsung dicabut, username dipensiunkan, tidak dapat masuk lagi, tidak ada refund otomatis). Keputusan mengenai nasib sisa saldo positif secara manual di luar aplikasi (manual refund vs hangus/forfeiture) belum tertulis final; mohon konfirmasi founder apabila kalimat konsekuensi penutupan akun perlu dipersempit di iterasi berikutnya.

## 5. Permintaan ke Hermes / Claude

1. **Whitelist `returnTo` pada `web/src/auth.tsx` (ke Hermes)**: Baris 13 pada `web/src/auth.tsx` membatasi `returnTo` hanya ke `(beranda|isi-saldo|api-key|transaksi)` dan `(pelanggan|paket|kode|harga)`. Jika sesi habis saat pengguna berada di `/akun` atau `/admin/akun`, setelah masuk kembali pengguna diarahkan ke `/beranda` atau `/admin/pelanggan`, bukan kembali ke `/akun` atau `/admin/akun`. Mohon pertimbangkan penambahan `akun` ke regex `returnTo` di `web/src/auth.tsx` (juga untuk rute stage-2 lainnya bila diinginkan).
2. **Catatan CSP untuk QR SVG (ke Claude / Hermes)**: Komponen QR pada `/admin/akun` merender elemen `<svg>` inline langsung di DOM memakai `<path fill="currentColor" />` (tanpa URL `data:`, tanpa gambar/script/gaya eksternal), sehingga tidak membutuhkan pelonggaran `img-src` maupun koneksi jaringan eksternal. Tidak ada catatan khusus tambahan untuk CSP selain tetap mempertahankan pembatasan tersebut saat deployment.

---

## 2026-11-15 siang — Tugas dua: Teks `CR-035` & Audit Aksesibilitas / Tampilan

- Tanggal: 2026-11-15 siang (Asia/Jakarta)
- Cabang git: `antigravity/akun` (setelah `git pull --ff-only origin main` sampai `e1ab74c`)
- Ruang lingkup: `ANTIGRAVITY_TASK.md` bagian **Tugas dua** — pembaruan teks konsekuensi penutupan akun (`CR-035`) dan skrip audit aksesibilitas + viewport untuk seluruh layar tanpa menyunting layar milik Hermes.

### 1. Perubahan File (`Tugas dua`)

- [`web/src/messages.ts`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L82): Memperbarui `am.closeConsequenceBalance` menjadi `"Sisa saldo token hangus dan tidak dapat dikembalikan atau diuangkan. Riwayat transaksi tetap tersimpan."` sesuai keputusan founder `CR-035` (menutup pertanyaan #4 pada log sebelumnya).
- [`web/test/e2e/account-customer.spec.ts`](file:///mnt/d/router.dev.zuhri-antigravity/web/test/e2e/account-customer.spec.ts#L133): Menambahkan asersi eksak pada dialog tutup akun untuk kalimat `CR-035`.
- [`web/scripts/account-local-verify.mjs`](file:///mnt/d/router.dev.zuhri-antigravity/web/scripts/account-local-verify.mjs#L205): Menambahkan `expectVisible` pada dialog tutup akun untuk kalimat `CR-035`.
- [`web/scripts/a11y-audit.mjs`](file:///mnt/d/router.dev.zuhri-antigravity/web/scripts/a11y-audit.mjs) (baru): Audit otomatis dengan backend Fastify asli, skema temporer privat `web_audit_*` pada `router_test_antigravity` yang di-drop di blok `finally`, data realistis di-seed melalui fungsi server (`bootstrapAdmin`, `createInvite`, `activateInvite`, `changeTenantStatus`, `ledger.grantAdminTopup`, `vouchers.createPack`/`issue`/`redeem`, `pricing`, `upstreams` berstatus `PENDING` tanpa koneksi eksternal, `api/keys`, serta 3 record `request` via `ledger.placeKeyHold`/`settleHold`: `SETTLED`, `SETTLED_ESTIMATED`, dan `UNRESOLVED`). Seluruh **58 kombinasi layar x viewport (`360x640` & `1280x800`)** beserta dialog utama diaudit dalam kondisi terisi data (**0 layar kosong**).
  - *Catatan pemeriksaan teknis Chromium*: input native `type="date"` / `type="datetime-local"` memindahkan fokus ke sub-elemen Shadow DOM (termasuk tombol pemilih kalender dengan outline bawaan Chromium pada widget shadow), sehingga loop `Tab` pada skrip menunggu hingga sub-stop selesai dan tidak menandai sub-stop tombol kalender Shadow DOM sebagai hilang indikator fokus. Selain itu, audit `RouteFocus` memastikan rute awal (`/beranda` dan `/admin/pelanggan`) diaudit setelah transisi dari rute lain, dan pemeriksaan `prefers-reduced-motion: reduce` menunggu transisi pra-reduksi selesai sebelum memicu `Tab` dalam mode reduksi.

### 2. Temuan Audit Aksesibilitas & Tampilan (Urut Paling Menghambat)

Pada **semua layar milik Antigravity** (`/akun`, `/admin/akun`, `/admin/akun (rotasi aktif)`, serta dialog `Cabut sesi`, `Tutup akun`, `Step-up autentikator admin`, dan `Kode pemulihan`), ditemukan **0 pelanggaran**. Seluruh **2 temuan** berada pada berkas milik Hermes dan sengaja **tidak diperbaiki** oleh Antigravity sesuai batasan tugas; oleh sebab itu `a11y-audit.mjs` keluar dengan kode `1`.

| Layar | Lebar | Masalah | Kriteria WCAG | Cara mengulang | Berkas | Pemilik | Usulan perbaikan |
|---|---|---|---|---|---|---|---|
| `/admin/batas-lebih-pakai` | `360px` | Saat pindah rute dari drawer menu mobile ke `/admin/batas-lebih-pakai`, fokus keyboard/screen reader tidak pindah ke `<h1>` melainkan tertinggal di `<button>` (`"Menu"`). | `wcag2a` (2.4.3 Focus Order) | Buka portal admin pada `360x640`, buka `Menu`, lalu pilih tautan `/admin/batas-lebih-pakai` saat query `/admin/api/settings/overdraft` belum selesai dalam 1 frame. | [`web/src/admin-operations.tsx`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/admin-operations.tsx#L41-L43), [`web/src/app.tsx`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/app.tsx#L30) | Hermes | Di `OverdraftPage` (`admin-operations.tsx`), selalu render `<PageTitle subtitle={m.overdraftSubtitle}>{m.overdraft}</PageTitle>` sebelum `<Pending />` / `<ErrorBox />` (seperti pada layar lainnya) agar `<h1>` langsung tersedia saat `RouteFocus` dijalankan; pertimbangkan juga fallback fokus ke `main#main` di `RouteFocus` bila `<h1>` tertunda. |
| `/pemakaian` | `360px` | Konten grafik batang harian melebihi lebar kontainer `.panel.stack` (`scrollWidth 328px > clientWidth 326px`), menabrak padding kanan dan tepi border panel (dan bertambah lebar jika nominal kredit token lebih panjang). | `wcag21aa` (1.4.10 Reflow) | Buka `/pemakaian` yang sudah memiliki data request pada viewport `360x640`, lalu ukur `scrollWidth` vs `clientWidth` pada `.panel.stack` berisi `.usage-bar-row`. | [`web/src/styles.css`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/styles.css#L11), [`web/src/usage.tsx`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/usage.tsx#L83) | Hermes | Pada [`web/src/styles.css`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/styles.css#L11), `.usage-bar-row` memaksa `grid-template-columns: minmax(6rem, 1fr) minmax(5rem, 2fr) minmax(7rem, auto)` (total minimum `312px` termasuk gap di dalam ruang konten `294px` pada viewport `360px`). Jadikan `.usage-bar-row` 1 kolom/wrap secara default dan terapkan grid 3 kolom tersebut di dalam `@media (min-width: 640px)`. |

Layar yang diaudit dalam kondisi kosong: **tidak ada (`0/58`)**. Seluruh layar publik/auth (`/masuk`, `/admin/masuk`, `/admin/masuk (2FA)`, `/lupa-password`, `/aktivasi` dengan & tanpa token, `/atur-ulang` dengan & tanpa token, `/halaman-tidak-ditemukan`), seluruh 8 rute portal pelanggan (`/beranda`, `/isi-saldo`, `/api-key`, `/model-harga`, `/pemakaian`, `/panduan`, `/transaksi`, `/akun`), serta seluruh 9 rute admin + detail & rotasi aktif (`/admin/pelanggan`, `/admin/pelanggan (detail)`, `/admin/paket`, `/admin/kode`, `/admin/harga`, `/admin/harga (detail)`, `/admin/upstream`, `/admin/rekonsiliasi`, `/admin/batas-lebih-pakai`, `/admin/audit`, `/admin/akun`, `/admin/akun (rotasi aktif)`) memiliki data realistis yang terisi.

### 3. Hasil Verifikasi (`Tugas dua`, Setelah Suntingan Kode Terakhir)

Seluruh perintah dijalankan ulang dari folder `web/` setelah `source ../.antigravity-env.sh` dan setelah perubahan kode/test terakhir:

| Pemeriksaan | Status | Hasil Teramati | File Bukti |
|---|---|---|---|
| `npm run typecheck` (`tsc --noEmit`) | Dijalankan & Lulus | Exit code `0`, `0` error TypeScript | [`web/evidence/antigravity-typecheck.txt`](file:///mnt/d/router.dev.zuhri-antigravity/web/evidence/antigravity-typecheck.txt) |
| `npm test` (`node --test test/unit/*.test.ts`) | Dijalankan & Lulus | Exit code `0`, `5` test lulus (`api`, `credits`, dan `3` test `qr.test.ts`), `0` gagal, `0` skipped | [`web/evidence/antigravity-unit.txt`](file:///mnt/d/router.dev.zuhri-antigravity/web/evidence/antigravity-unit.txt) |
| `npx playwright test --reporter=line` (seluruh suite `web/`) | Dijalankan & Lulus | Exit code `0`, `33 passed (32.9s)` (termasuk `4/4` uji `account-customer.spec.ts` & `account-admin.spec.ts` dengan asersi `CR-035`) | [`web/evidence/antigravity-playwright.txt`](file:///mnt/d/router.dev.zuhri-antigravity/web/evidence/antigravity-playwright.txt) |
| `node scripts/account-local-verify.mjs` | Dijalankan (PostgreSQL `127.0.0.1:55432`) & Lulus | Exit code `0`, diakhiri `account-local-verify: PASS` (memverifikasi asersi `CR-035`; log bersih dari secret) | [`web/evidence/antigravity-local-verify.txt`](file:///mnt/d/router.dev.zuhri-antigravity/web/evidence/antigravity-local-verify.txt) |
| `node scripts/a11y-audit.mjs` | Dijalankan (PostgreSQL `127.0.0.1:55432`) & Melaporkan Temuan Hermes | Exit code `1` (expected karena `2` temuan milik Hermes); `58` kombinasi layar-lebar diaudit, `0` temuan pada layar Antigravity, `2` temuan pada layar Hermes | [`web/evidence/antigravity-audit.txt`](file:///mnt/d/router.dev.zuhri-antigravity/web/evidence/antigravity-audit.txt), [`web/evidence/antigravity-audit.json`](file:///mnt/d/router.dev.zuhri-antigravity/web/evidence/antigravity-audit.json) |

---

## 2026-11-16 — Tugas tiga (2026-11-15 malam): Verifikasi Lanjutan, `returnTo`, Perluasan Audit, dan Laporan Pemeriksaan

- Tanggal pengerjaan: 2026-11-15 malam s.d. 2026-11-16 (Asia/Jakarta)
- Cabang git: `antigravity/akun` (sinkron dengan `origin/main` pada `5d636cf`; commit Bagian A tersimpan di `a13bb65`)
- Ruang lingkup: `ANTIGRAVITY_TASK.md` bagian **Tugas tiga (2026-11-15 malam)** — Bagian A sampai D.

### Status Commit dan Hambatan Lingkungan Sandbox Setelah Restart

1. **Bagian A (`a13bb65`)**: Ditulis, dijalankan terhadap server Fastify + PostgreSQL nyata sebelum sandbox direstart, lulus seluruh asersi, dan **di-commit ke `antigravity/akun`** (`commit a13bb65`).
2. **Setelah restart sesi sandbox (2026-11-16 17:57 WIB)**:
   - `/mnt/d/router.dev.zuhri-antigravity/.git` terpasang **read-only** di lingkungan container (`9p ro`), sehingga `git commit` gagal dengan `fatal: Unable to create '/mnt/d/router.dev.zuhri-antigravity/.git/index.lock': Read-only file system`. Commit per bagian untuk Bagian B, C, dan D tertahan oleh mount read-only `.git` dan siap di-commit dari lingkungan host oleh operator (`git add web/test/e2e/return-to.spec.ts web/scripts/a11y-audit.mjs docs/handoff/antigravity-log.md`).
   - Container PostgreSQL host pada `127.0.0.1:55432` tidak terjangkau dari namespace jaringan sandbox (`connect ECONNREFUSED 127.0.0.1:55432`, `/var/run/docker.sock` tidak ada, `/proc/self/uid_map` hanya memetakan UID `0` sehingga `initdb`/`postgres` lokal juga tidak dapat dijalankan sebagai user non-root). Akibatnya eksekusi `web/scripts/a11y-audit.mjs` (Bagian C), `web/scripts/account-local-verify.mjs`, dan `server` `npm test` terhalang di sandbox pasca-restart ini dan perlu dijalankan ulang di host dengan PostgreSQL lokal aktif.

---

### Bagian A — Bukti terhadap Server Nyata untuk Aksi Admin Pelanggan (`web/scripts/admin-customers-local-verify.mjs`)

- **Status**: **Ditulis, Dijalankan & Lulus** (sebelum restart sandbox), **Di-commit** (`a13bb65`).
- **Berkas**: [`web/scripts/admin-customers-local-verify.mjs`](file:///mnt/d/router.dev.zuhri-antigravity/web/scripts/admin-customers-local-verify.mjs)
- **Bukti eksekusi**: [`web/evidence/antigravity-admin-customers-verify.txt`](file:///mnt/d/router.dev.zuhri-antigravity/web/evidence/antigravity-admin-customers-verify.txt) -> berakhir `admin-customers-local-verify: PASS (invite + activate + replay reject + conflict + suspend/restore admission + adjustments +2.5/-1 + idempotency + secret hygiene)`.
- **Yang dibuktikan terhadap Fastify + PostgreSQL (schema temporer privat `web_admin_cust_*`, tanpa upstream eksternal)**:
  1. **Undangan & aktivasi**: Admin mengundang `pelanggan.baru@example.test`; mailer melempar error pengiriman otomatis sehingga tautan aktivasi sekali tampil (`http://127.0.0.1:5185/aktivasi#token=...`) muncul di layar. Pelanggan membuka tautan itu, `#token=` langsung dihapus `bootstrap.ts` dari URL, memilih username `pelanggan_baru` dan password, lalu masuk ke `/beranda` dan membuat API key. Memakai tautan aktivasi yang sama kedua kali ditolak (`400`, pesan undangan tidak valid). Mengundang `pelanggan.baru@example.test` lagi menampilkan pesan konflik (`m.inviteConflict`).
  2. **Tangguhkan / pulihkan + admission API key**: Dengan `auth_at` dituakan di Postgres agar step-up asli terpicu, admin menangguhkan `pelanggan_baru` lewat dialog konfirmasi + TOTP step-up. Pemanggilan `GET /v1/models` dan `POST /v1/chat/completions` memakai API key pelanggan tersebut ditolak di admission (`403 tenant_suspended`). Setelah dipulihkan lewat step-up, `GET /v1/models` diterima (`200`) kembali.
  3. **Koreksi saldo `+2,5` dan `-1` + idempotensi**: Koreksi `+2,5` menambah saldo layar menjadi `2,5 kredit token`, DB `posted = 2_500_000n` mikro-kredit, entri `ADJUSTMENT_CREDIT`; replay `POST /admin/api/adjustments` dengan `idempotencyKey` yang sama mengembalikan `200 replayed: true` tanpa menggandakan entri. Koreksi `-1` mengubah saldo menjadi `1,5 kredit token`, DB `posted = 1_500_000n` mikro-kredit, entri `ADJUSTMENT_DEBIT`; replay dengan `idempotencyKey` yang sama juga tidak menggandakan entri. Pengiriman `POST /v1/chat/completions` untuk model lokal berharga terbit tanpa route upstream lolos tahap admission (`request` tercatat `outcome = 'no_route'`, `debit = 0`, status `503`) tanpa menyentuh jaringan luar, dan `ledger.invariantViolations(db)` kosong (`[]`).
  4. **Higiene rahasia**: Token undangan, kode TOTP login/step-up, recovery code, dan API key tidak pernah muncul di URL (`search`/`hash`), `localStorage`, `sessionStorage`, ataupun log konsol browser.

---

### Bagian B — Test Perilaku `returnTo` (`web/test/e2e/return-to.spec.ts`)

- **Status**: **Ditulis, Dijalankan (8 lulus / 3 gagal karena bug nyata pada kode Hermes)**; commit tertahan read-only `.git`.
- **Berkas**: [`web/test/e2e/return-to.spec.ts`](file:///mnt/d/router.dev.zuhri-antigravity/web/test/e2e/return-to.spec.ts)
- **Bukti eksekusi**: [`web/evidence/antigravity-return-to.txt`](file:///mnt/d/router.dev.zuhri-antigravity/web/evidence/antigravity-return-to.txt) (`8 passed, 3 failed (47.6s)`).
- **Yang lulus (`8/11`)**:
  - Aksi `401` di dalam `Shell` ketika pembacaan lain tidak ikut berjalan: `/isi-saldo` (`POST /api/redeem`), `/api-key` (`POST /api/keys`), `/akun` (`POST /api/account/password`), `/admin/paket` (`POST /admin/api/packs`), `/admin/akun` (`POST /admin/api/account/authenticator/start`).
  - Rute tunggal-query di dalam `Shell` terpasang + query string: `/api-key`, `/pemakaian`, `/panduan`, `/transaksi`, `/transaksi?before=120`, `/pemakaian?before=2026-11-15T00%3A00%3A00.000Z`, `/admin/pelanggan`, `/admin/harga`, `/admin/rekonsiliasi`, `/admin/batas-lebih-pakai`, `/admin/audit`, `/admin/pelanggan?prefix=uji`, `/admin/audit?before=50`.
  - Allowlist & fallback `returnTo` tidak valid pada `/masuk` dan `/admin/masuk`: `//evil.example`, `https://evil.example/...`, rute tak dikenal, rute lintas peran (`/admin/pelanggan` di `/masuk` dan `/beranda`/`/akun` di `/admin/masuk`), serta URL ber-fragment (`#fragmen`) semuanya mendarat di `/beranda` (pelanggan) atau `/admin/pelanggan` (admin).
- **Temuan bug nyata pada berkas Hermes yang terungkap oleh 3 uji gagal (tidak diperbaiki oleh Antigravity sesuai batas tugas)**:
  1. **Balapan `<Navigate>` vs `useResource` pada `Shell` ([`web/src/app.tsx`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/app.tsx#L35-L41) + [`web/src/hooks.tsx`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/hooks.tsx#L12-L16)) — test 9/11 gagal (`Expected: "/beranda"` atau rute asal, `Received: "/masuk"`)**: Ketika membuka langsung atau me-reload rute apa pun saat sesi sudah berakhir (`401` pada probe `Shell` `/api/me` atau `/admin/api/packs`), `Shell` merender child `<Navigate to="/masuk" replace state={{ expired: true, returnTo: ... }} />`. Effect child `<Navigate>` berjalan lebih dulu dan mengubah `window.location.pathname` menjadi `/masuk` (atau `/admin/masuk`), lalu `useEffect` di `useResource` milik parent `Shell` berjalan sesaat kemudian dan memanggil `navigate(..., { state: { expired: true, returnTo: location.pathname + location.search } })` sehingga menimpa `state.returnTo` menjadi `'/masuk'` / `'/admin/masuk'`. Setelah login, `LoginPage` menolak `/masuk`/`/admin/masuk` dan melempar pengguna ke `/beranda`/`/admin/pelanggan`.
  2. **Timpa-menimpa beberapa `useResource` yang gagal `401` bersamaan ([`web/src/hooks.tsx`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/hooks.tsx#L12-L16)) — test 7/11 gagal (`Expected: "/beranda", Received: "/masuk"`)**: Pada rute dengan lebih dari satu `useResource` (`/beranda`, `/akun`, `/admin/kode`, `/admin/upstream`) atau ketika `/admin/paket` me-refresh `/admin/api/packs` yang dipakai bersama `Shell` probe, respons `401` pertama memindah `window.location.pathname` ke `/masuk` atau `/admin/masuk`, lalu `useEffect` dari `useResource` kedua membaca `location.pathname` yang sudah berubah dan menimpa `returnTo` menjadi `'/masuk'` / `'/admin/masuk'`. (`useAction` di baris 28 juga melakukan `cache.clear()` sebelum `navigate()` tanpa `replace: true`, sehingga jika query observer sempat memicu fetch ulang sebelum komponen terlepas, race yang sama bisa terpicu).
  3. **`/model-harga` memakai `useQuery` mentah, tidak pernah mengarahkan ke `/masuk` pada `401` ([`web/src/catalogue.tsx`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/catalogue.tsx#L27)) — test 8/11 gagal (`Expected pattern: /\/masuk$/, Received: "http://127.0.0.1:5183/model-harga"`)**: `CataloguePage` memanggil `useQuery` langsung alih-alih `useResource`, sehingga saat `/api/models` menjawab `401 unauthorized`, halaman tetap berada di `/model-harga` menampilkan `ErrorBox` tanpa mengalihkan ke `/masuk` ataupun menyimpan `returnTo`.

---

### Bagian C — Perluasan Audit ke State & Dialog Baru (`web/scripts/a11y-audit.mjs`)

- **Status**: **Ditulis & Dicek Sintaks (`node --check` + `npm run typecheck`)**; **Eksekusi terhalang PostgreSQL sandbox** (`ECONNREFUSED 127.0.0.1:55432`) & commit tertahan read-only `.git`.
- **Berkas**: [`web/scripts/a11y-audit.mjs`](file:///mnt/d/router.dev.zuhri-antigravity/web/scripts/a11y-audit.mjs)
- **Cakupan yang telah ditambahkan pada `360x640` dan `1280x800`**:
  1. **Tahap 1 — Keadaan kosong (`emptyData: true`, sebelum seed data)**:
     - Admin (DB nyata sebelum ada pelanggan/paket/kode/model/upstream/request): `/admin/pelanggan (kosong)` (`Belum ada pelanggan.`), `/admin/pelanggan (tanpa hasil pencarian)`, `/admin/paket (kosong)`, `/admin/kode (kosong)`, `/admin/harga (kosong)`, `/admin/upstream (kosong)`, `/admin/rekonsiliasi (kosong)`, serta `/admin/audit (kosong)` (intercept `{ events: [] }`).
     - Pelanggan baru `audit_empty` bersaldo 0 (sebelum paket & model dibuat): `/beranda (kosong)`, `/api-key (kosong)`, `/model-harga (kosong)`, `/pemakaian (kosong)`, `/panduan (kosong)`, `/transaksi (kosong)`, serta `/akun (tanpa sesi)`.
  2. **Tahap 2 — Dialog dan kotak hasil baru pada `/admin/pelanggan`**:
     - Form undangan + kotak hasil undangan dengan pengiriman manual (`emailSent: false` memicu `activationLink` + tombol `Salin tautan aktivasi`): `/admin/pelanggan (hasil undangan)`.
     - Detail pelanggan `ACTIVE` (`audit_user`): dialog **`Tangguhkan pelanggan`** dan **`Konfirmasi koreksi saldo`** (`+2,5 kredit token`).
     - Detail pelanggan `SUSPENDED` (`audit_suspended`): `/admin/pelanggan (detail ditangguhkan)` dan dialog **`Pulihkan pelanggan`**.
  3. **Tahap 3 — Keadaan error (`500 internal_error` pada pembacaan utama tiap layar)**:
     - `Shell pelanggan (error 500 /api/me)`, `/isi-saldo (error 500)`, `/beranda (error 500)`, `/api-key (error 500)`, `/model-harga (error 500)`, `/pemakaian (error 500)`, `/panduan (error 500)`, `/transaksi (error 500)`, `/akun (error 500)`.
     - `Shell admin (error 500 /admin/api/packs)`, `/admin/pelanggan (error 500)`, `/admin/pelanggan (detail error 500)`, `/admin/kode (error 500)`, `/admin/harga (error 500)`, `/admin/harga (detail error 500)`, `/admin/upstream (error 500)`, `/admin/rekonsiliasi (error 500)`, `/admin/batas-lebih-pakai (error 500)`, `/admin/audit (error 500)`, `/admin/akun (error 500)`, dan `/admin/paket (error 500)`.
- **Catatan dugaan temuan statis yang perlu dikonfirmasi setelah `a11y-audit.mjs` dijalankan di host**: Pada [`web/src/app.tsx`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/app.tsx#L41), cabang `probe.isError` di `Shell` merender `<main className="standalone"><ErrorBox ... /></main>` tanpa `<h1>` (`<PageTitle>`), sehingga keadaan error `Shell` dan `/admin/paket (error 500)` diperkirakan akan melanggar pemeriksaan `h1Count === 1` saat skrip dijalankan terhadap PostgreSQL host.

---

### Bagian D — Laporan Pemeriksaan Token Desain & Teks Antarmuka (Tanpa Mengubah Berkas Orang Lain)

#### D.1. Audit Token Desain (`web/src/styles.css` & `web/src/*.tsx` terhadap `web/src/tokens.css` & `docs/DESIGN.md`)

1. **Nilai bukan dari `tokens.css` dan atribut `style` inline**:

| Berkas & Baris | Konteks | Nilai saat ini (non-token) | Token / perbaikan yang diusulkan |
|---|---|---|---|
| [`web/src/styles.css#L6`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/styles.css#L6) | `.usage-detail dl` | `minmax(0, 1fr)` (literal `0`) | Pakai `minmax(var(--zero), 1fr)` atau definisikan `--track-zero: 0` di `tokens.css` agar konsisten dengan pemakaian `--zero` di bagian lain `styles.css` |
| [`web/src/styles.css#L11`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/styles.css#L11) | `.usage-bar-row` | `minmax(0, 1fr)` (literal `0`) | Sama seperti di atas (`var(--zero)`) |
| [`web/src/styles.css#L12`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/styles.css#L12) | `.usage-bar-row .usage-bar-track` | `grid-row: 2` (angka tata letak) | Catatan non-token visual: angka posisi baris grid |
| [`web/src/styles.css#L24`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/styles.css#L24) | `button.text-button` | `background: transparent` | Tambah `--color-transparent: transparent` di `tokens.css` bila seluruh nilai warna wajib lewat token |
| [`web/src/styles.css#L43`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/styles.css#L43) | `.auth-layout` | `min-height: 100dvh` | Tambah token `--viewport-height: 100dvh` di `tokens.css`, lalu pakai `var(--viewport-height)` |
| [`web/src/styles.css#L46`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/styles.css#L46) | `.brand-word` | `line-height: 1` | Tambah token `--leading-display-xl: 1` di `tokens.css` (melengkapi `--leading-xs`..`--leading-display`) |
| [`web/src/styles.css#L76`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/styles.css#L76) | `.app-shell` | `min-height: 100dvh` | Gunakan `var(--viewport-height)` |
| [`web/src/styles.css#L81`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/styles.css#L81) | `.shell-balance` | `order: 1` | Angka urutan flex (lihat baris `105` untuk `order: 0`) |
| [`web/src/styles.css#L87`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/styles.css#L87) | `dialog` | `calc(100dvh - var(--space-8))` | Gunakan `calc(var(--viewport-height) - var(--space-8))` |
| [`web/src/styles.css#L90`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/styles.css#L90) | `.skip` | `z-index: 10` | Tambah token `--z-skip: 10` (atau `--z-overlay: 10`) di `tokens.css` |
| [`web/src/styles.css#L90`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/styles.css#L90) | `.skip` | `transform: translateY(-200%)` | Tambah token `--skip-offset: -200%` di `tokens.css` |
| [`web/src/styles.css#L97`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/styles.css#L97) | `@media (min-width: 640px)` | `640px` | Catat sebagai konstanta breakpoint `DESIGN.md` section 5 (`--breakpoint-md: 40rem` / `@custom-media`), karena CSS `@media` standar tidak menerima `var()` |
| [`web/src/styles.css#L98`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/styles.css#L98) | `.usage-bar-row` (`>= 640px`) | `6rem`, `5rem`, `7rem` | Tiga ukuran `rem` hardcoded di luar `tokens.css`; usul `--usage-label-min: 6rem`, `--usage-track-min: 5rem`, `--usage-value-min: 7rem` |
| [`web/src/styles.css#L103`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/styles.css#L103) | `.metrics` (`>= 640px`) | `repeat(3, minmax(0, 1fr))` | Gunakan `var(--zero)` atau token jumlah kolom/grid |
| [`web/src/styles.css#L105`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/styles.css#L105) | `.shell-balance` (`>= 640px`) | `order: 0` | Gunakan `var(--zero)` (sudah ada di `tokens.css:29`) |
| [`web/src/styles.css#L106`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/styles.css#L106) | `dl` (`>= 640px`) | `minmax(0, 1fr) minmax(0, 2fr)` | Gunakan `var(--zero)` pada batas minimum `minmax` |
| [`web/src/styles.css#L109`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/styles.css#L109) | `@media (min-width: 1024px)` | `1024px` | Konstanta breakpoint `DESIGN.md` section 5 (`--breakpoint-lg: 64rem` / `@custom-media`) |
| [`web/src/styles.css#L110`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/styles.css#L110) | `.auth-layout` (`>= 1024px`) | `minmax(0, 1fr) minmax(0, 1fr)` | Gunakan `var(--zero)` pada batas minimum `minmax` |
| [`web/src/styles.css#L113`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/styles.css#L113) | `.app-shell` (`>= 1024px`) | `minmax(0, 1fr)` | Gunakan `var(--zero)` pada batas minimum `minmax` |
| [`web/src/usage.tsx#L83`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/usage.tsx#L83) | `PageSummary` batang harian | `style={{ width: highestDebit === 0n ? '0%' : `${summary.debitMicro * 100n / highestDebit}%` }}` | Ganti literal `'0%'` / inline `width` dengan custom property CSS atau elemen `<meter>`/`aria` misalnya `style={{ '--bar-ratio': ... } as CSSProperties}` dan aturan CSS `.usage-bar-track > span { width: calc(var(--bar-ratio, var(--zero)) * var(--full)); }` |

2. **Kelas di komponen yang belum memiliki aturan CSS di `web/src/styles.css`** (termasuk `.refund-policy` & `.activation-link`):

| Kelas & Lokasi Pemakaian | Status di `styles.css` | Aturan CSS berbasis token yang diusulkan |
|---|---|---|
| `.refund-policy` ([`web/src/customer.tsx#L22`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/customer.tsx#L22), [`#L26`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/customer.tsx#L26)) | Belum ada aturan sama sekali (hanya tampil sebagai `<p>` polos) | `.refund-policy { color: var(--color-text-muted); font-size: var(--text-sm); line-height: var(--leading-sm); border-left: var(--space-1) solid var(--color-border-control); padding-left: var(--space-3); }` |
| `.activation-link` ([`web/src/admin-customers.tsx#L78`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/admin-customers.tsx#L78)) | Belum ada aturan CSS (hanya mewarisi `.mono`) | `.activation-link { padding: var(--space-3); background: var(--color-surface-muted); border: var(--border-width) solid var(--color-border-control); border-radius: var(--radius-control); user-select: all; }` |
| `.guide-code` ([`web/src/guide.tsx#L34`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/guide.tsx#L34)) | Belum ada aturan CSS | `.guide-code { font-family: var(--font-mono); overflow-wrap: anywhere; padding: var(--space-2) var(--space-3); background: var(--color-surface-muted); border-radius: var(--radius-control); }` |
| `.protocol-list` ([`web/src/catalogue.tsx#L22`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/catalogue.tsx#L22)), `.model-multiplier` ([`#L23`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/catalogue.tsx#L23)) | Belum ada aturan CSS | `.protocol-list { display: flex; flex-wrap: wrap; gap: var(--space-2); }` dan `.model-multiplier { font-weight: var(--weight-bold); font-variant-numeric: tabular-nums; }` |
| `.customer-list-row` ([`web/src/admin-customers.tsx#L91`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/admin-customers.tsx#L91)), `.upstream-row` ([`web/src/admin-upstreams.tsx#L19`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/admin-upstreams.tsx#L19)) | Belum ada aturan CSS khusus | Hanya penanda baris; biarkan atau gunakan untuk jarak/tata letak spesifik bila dibutuhkan |
| `.badge[data-status=...]` ([`web/src/styles.css#L66-L69`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/styles.css#L66-L69)) | Hanya menangani `ACTIVE`, `REDEEMED`, `PUBLISHED`, `REVOKED`, `SUSPENDED`, `PROMO` | Selaraskan dengan `DESIGN.md` section 3: tambahkan `[data-status="ELIGIBLE"]` ke `--color-success-*`, `[data-status="PENDING"]` ke `--color-warning-*`, `[data-status="BLOCKED"]` dan `[data-status="FAILED"]` ke `--color-danger-*` |

---

#### D.2. Audit Teks Antarmuka (`web/src/messages.ts` terhadap `docs/UX.md` & `docs/TOKEN_CREDIT.md`)

| Kunci & Baris | Teks saat ini | Kategori temuan | Usulan kalimat pengganti |
|---|---|---|---|
| `m.customerDetails` ([`messages.ts#L28`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L28)) vs `m.details` ([`#L2`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L2)) | `'Buka detail pelanggan'` vs `'Rincian'` | Istilah tidak konsisten (`detail` vs `rincian`; `UX.md` memakai `Rincian`) | `'Buka rincian pelanggan'` |
| `m.modelPriceLink` ([`messages.ts#L26`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L26)) vs `m.models` ([`#L3`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L3)) | `'Harga Model'` vs `'Harga model'` | Inkonsistensi kapitalisasi dalam navigasi/tautan yang merujuk halaman sama | `'Harga model'` |
| `m.welcome` ([`messages.ts#L8`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L8)) | `'Akses model, kelola token.'` | Istilah kurang konsisten (`token` vs `kredit token` pada `brandCaption` di baris sama & `TOKEN_CREDIT.md`) | `'Akses model AI, kelola saldo kredit token.'` |
| `m.refundPolicy` ([`messages.ts#L8`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L8)) & `am.closeConsequenceBalance` ([`#L82`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L82)) | `'Pembelian token bersifat final...'` & `'Sisa saldo token hangus...'` | Memakai `'token'` alih-alih `'kredit token'` (`TOKEN_CREDIT.md`: saldo berunit *kredit token*, berbeda dari token LLM; catatan: `am.closeConsequenceBalance` mengikuti redaksi Tugas dua sehingga dibiarkan kecuali disetujui founder) | Pada `m.refundPolicy`: `'Pembelian kredit token bersifat final. Saldo tidak dapat dikembalikan atau diuangkan, termasuk saat akun ditutup.'` |
| `m.suspended` ([`messages.ts#L10`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L10)) | `'Akun ditangguhkan. Saldo dan riwayat tetap dapat dilihat; hubungi admin untuk akses API.'` | Konteks kurang tepat saat ditampilkan ke admin di detail pelanggan (`admin-customers.tsx:127`) | Pisahkan kunci admin: `'Akun pelanggan ini sedang ditangguhkan. Saldo dan riwayat tetap dapat dilihat.'` |
| `m.redeemed` ([`messages.ts#L12`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L12)) | `'Saldo berhasil ditambah'` | **Salah/membingungkan** ketika komponen `Receipt` (`ui.tsx:51`) dipakai oleh koreksi saldo negatif (`-1 kredit token` di `admin-customers.tsx:158`) atau replay; serta berbeda format dari `UX.md` section 5 (`'Saldo bertambah {nominal}. Saldo sekarang {saldo}.'`) | Beri parameter/judul terpisah untuk `Receipt`: `'Saldo berhasil ditambah'` khusus redeem/topup baru, `'Penukaran kode sudah tercatat'` untuk replay, dan `'Koreksi saldo tercatat'` untuk adjustment |
| `m.keySubtitle`, `m.secretTitle`, `m.secretWarning`, `m.discardSecret`, `m.discard` ([`messages.ts#L14`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L14)) | Memakai `'Secret'` / `'secret'` tercampur dengan `'key'` (`'Buat key... Secret hanya ditampilkan sekali.'`, `'Salin secret sekarang'`) | Istilah teknis membingungkan pelanggan awam, inkonsisten dengan `UX.md` section 5 (*Secret key*: `'Salin key ini sekarang. Setelah panel ditutup, key tidak dapat ditampilkan lagi.'`) serta kontras dengan blok `am` (`'kunci'`) | Selaraskan dengan `UX.md` section 5: `keySubtitle: 'Buat API key untuk tool Anda. Kunci rahasia hanya ditampilkan sekali.'`, `secretTitle: 'Salin API key ini sekarang'`, `secretWarning: 'Setelah panel ditutup, key ini tidak dapat ditampilkan lagi. Jangan bagikan atau masukkan ke URL.'` |
| `m.limitHelp` ([`messages.ts#L14`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L14)) | `'...Maksimal enam digit pecahan, tanpa pemisah ribuan.'` | Kurang ramah bagi pelanggan awam (`digit pecahan`), dan angka `enam` berbeda gaya dari `'10 karakter'` | `'Kosong berarti tanpa batas tambahan. Isi 0 untuk menghentikan pemakaian key ini. Maksimal 6 angka di belakang koma, tanpa tanda titik pemisah ribuan.'` |
| `m.noModels` ([`messages.ts#L14`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L14)) | `'Tolak semua model'` | Membingungkan pelanggan awam dalam konteks form pembuatan key | `'Blokir semua model (nonaktifkan akses key)'` |
| `m.modelScopeHelp` ([`messages.ts#L14`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L14)) | `'Katalog model pelanggan belum tersedia. Scope khusus model belum dapat dipilih; scope tetap diperiksa server.'` | **Bertentangan dengan keadaan produk sekarang** (layar `/model-harga` / `catalogue.tsx` sudah tersedia) dan memakai istilah `'Scope'` | `'Pemilihan per model belum tersedia pada form ini; gunakan Semua model atau Blokir semua model. Server tetap memeriksa izin model saat request masuk.'` |
| `m.noUsage`, `m.chargedUsage`, `m.estimated`, `m.notFinal` ([`messages.ts#L15`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L15)) | `'Penyedia model tidak melaporkan usage; biaya memakai estimasi gateway.'`, `'Usage yang ditagih'`, `'Biaya dari estimasi'`, `'Biaya belum final, dana ditahan'` | Lebih teknis dan kurang mengikuti kalimat contoh yang sudah disiapkan di `UX.md` section 5 (`Biaya estimasi`: `'Biaya request ini dihitung dari estimasi karena penyedia model tidak melaporkan pemakaian.'`; `Request belum final`: `'Biaya request ini belum final. Dana ... ditahan sampai diselesaikan.'`) | `noUsage: 'Biaya request ini dihitung dari estimasi karena penyedia model tidak melaporkan pemakaian.'`, `chargedUsage: 'Pemakaian token yang ditagih'`, `notFinal: 'Biaya request ini belum final. Dana ditahan sampai selesai diproses.'` |
| `m.statusPending`, `m.statusEligible` ([`messages.ts#L15`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L15)) | `'Set status menunggu tinjauan'`, `'Set status layak'` | Campuran Inggris `'Set status...'` | `'Ubah status menjadi menunggu tinjauan'`, `'Ubah status menjadi layak'` |
| `m.protocolHelp` ([`messages.ts#L15`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L15)) | `'Protocol harus ditawarkan oleh upstream yang dipilih. Kesesuaian server tetap menjadi keputusan akhir.'` | **Salah ejaan / inkonsistensi istilah**: memakai `'Protocol'` padahal `m.protocol: 'Protokol'`, `m.protocolFilter: 'Filter protokol pada halaman'`; `'ditawarkan'` terdengar seperti terjemahan kaku `'offered'` | `'Protokol harus didukung oleh upstream yang dipilih. Server tetap menjadi pemeriksa akhir.'` |
| `m.addRoute` ([`#L15`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L15)) vs `m.createRoute` ([`#L26`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L26)) | Keduanya `'Tambah route'` | Duplikasi kunci dengan teks identik (`createRoute` tampak tidak terpakai) | Satukan menjadi satu kunci saja (`m.addRoute`) |
| `m.catalogueSubtitle`, `m.pricePerCategory` ([`messages.ts#L16`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L16)) | `'Model tersedia dan biaya kredit token per token.'`, `'Kredit token per token yang ditagih'` | Frasa `'kredit token per token'` membingungkan pelanggan awam | `'Daftar model yang tersedia dan biaya kredit untuk setiap token.'`, `'Biaya kredit per jenis pemakaian token'` |
| `m.guideProtocolNote`, `m.responsesStateless` ([`messages.ts#L16`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L16)) | `'Jangan mengubah model secara otomatis.'`, `'Responses hanya stateless; percakapan tersimpan tidak didukung.'` | Kurang jelas bagi pelanggan awam (`stateless`, subjek kalimat larangan tidak jelas) | `guideProtocolNote: 'Pilih endpoint sesuai format tool Anda. Gateway meneruskan nama model persis seperti yang diminta.'`, `responsesStateless: 'Endpoint Responses tidak menyimpan riwayat percakapan di server (stateless); kirim konteks lengkap pada setiap permintaan.'` |
| `m.untestedTools` ([`messages.ts#L16`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L16)) | `'Belum ada tool yang diuji. Jangan anggap contoh kompatibilitas ini sudah terverifikasi.'` | Usang (bertentangan dengan `testedToolVersions` yang menyatakan 3 tool sudah teruji pada 2026-11-14; belum dipakai lagi di `guide.tsx`) | Hapus kunci usang atau tandai per tool belum teruji saja lewat `untestedToolVersions` |
| `m.customerHelp` ([`messages.ts#L18`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L18)) | `'Masukkan username lengkap. Pencarian dan akses diperiksa oleh server.'` | **Bertentangan dengan layar saat ini**: di `admin-customers.tsx`, pelanggan kini langsung tampil sebagai daftar dan filter mencari berdasarkan **awalan username** (`m.customerPrefix`), bukan wajib username lengkap | `'Pilih pelanggan dari daftar atau saring dengan awalan username.'` |
| `m.voucherHelp`, `m.promoReason` ([`messages.ts#L20`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L20)) | `'...menerbitkan kode SALE.'`, `promoReason: 'Promo'` | Menyebut enum mentah `'SALE'` sementara opsi pilihan memakai `'Penjualan'`; label input `Promo` sama persis dengan opsi dropdown sehingga tidak menjelaskan isi field (alasan/referensi promo) | `voucherHelp: 'Konfirmasi pembayaran di luar aplikasi sebelum menerbitkan kode Penjualan. Kode hanya ditampilkan sekali.'`, pisahkan `promoReasonLabel: 'Alasan atau nama promo'` |
| `m.modelHelp` ([`messages.ts#L21`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L21)) | `'Harga terbit tidak berubah untuk request berjalan. Katalog pelanggan dan margin guard belum tersedia; terbit harga bukan bukti route layak.'` | **Bertentangan dengan kondisi saat ini**: katalog pelanggan sudah ada (`/model-harga`, `GET /api/models`) | `'Perubahan harga tidak memengaruhi request yang sedang berjalan. Guard margin belum aktif; harga terbit belum menjamin rute upstream tersedia atau menguntungkan.'` |
| `m.previewHelp` ([`messages.ts#L21`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L21)) | `'Contoh penggunaan sintetis, bukan transaksi atau tagihan nyata.'` | Kata `'sintetis'` kurang lazim bagi pengguna biasa | `'Simulasi perhitungan saja, bukan transaksi atau tagihan nyata.'` |
| `m.receiptCurrent` ([`messages.ts#L23`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L23)) | `'Saldo tercatat saat jawaban ini diterima'` | Kata `'jawaban'` kaku (terjemahan harfiah `'response'`) | `'Saldo tercatat saat respons diterima dari server'` |
| `m.adjustmentHelp`, `m.signedTokenAmount` ([`messages.ts#L28`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L28)) | `'Koreksi menambahkan entri ledger baru tanpa mengubah riwayat. Masukkan nilai token bertanda.'`, `'Koreksi saldo (kredit token)'` | Istilah teknis internal (`entri ledger`, `nilai bertanda`), menyebut `'nilai token'` alih-alih `'kredit token'` (`TOKEN_CREDIT.md`), dan judul/label/tombol mengulang kata `'Koreksi saldo'` tiga kali | `adjustmentHelp: 'Koreksi membuat catatan transaksi baru tanpa mengubah riwayat sebelumnya. Gunakan angka positif untuk menambah atau tanda minus (-) untuk mengurangi kredit token.'`, `signedTokenAmount: 'Nominal koreksi (kredit token)'` |
| `m.unbilledInput` ([`messages.ts#L28`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L28)) | `'Input belum ditagih'` | **Bertentangan dengan makna di `TOKEN_CREDIT.md` section 2 & `server/src/gateway.ts:52` (`unbilled`, CR-018)**: nilai ini adalah selisih token input berlebih yang **tidak ditagih** ke pelanggan, bukan "belum ditagih" (yang memberi kesan akan ditagih nanti) | `'Input tidak ditagih'` |
| `m.unresolvedSubtitle`, `m.resolveConfirm`, `m.debitTokens` ([`messages.ts#L28`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L28)) | `'Request dengan dana ditahan yang perlu keputusan settlement.'`, `'Tentukan debit token atau lepaskan seluruh dana ditahan.'`, `'Debit token'` | Istilah teknis `'settlement'` & **inkonsistensi unit (`TOKEN_CREDIT.md`)**: menyebut `'debit token'` alih-alih `'kredit token'` | `unresolvedSubtitle: 'Request dengan dana ditahan yang memerlukan keputusan penyelesaian biaya.'`, `resolveConfirm: 'Tentukan jumlah debit kredit token atau lepaskan seluruh dana yang ditahan.'`, `debitTokens: 'Nominal debit (kredit token)'` |
| `m.overdraftSubtitle`, `m.overdraftTokens`, `m.overdraftHelp` ([`messages.ts#L28`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L28)) | `'Batas maksimum hold yang boleh melampaui saldo tersedia.'`, `'Batas lebih-pakai dalam token'`, `'Gunakan bilangan bulat token. Nilai 0 menonaktifkan lebih-pakai.'` | Istilah `'hold'` kurang ramah pengguna & **inkonsistensi unit (`TOKEN_CREDIT.md`)**: menyebut `'token'` bukan `'kredit token'` (aturan `TOKEN_CREDIT.md`: batas dalam unit *kredit token*) | `overdraftSubtitle: 'Batas maksimum penahanan dana sementara yang boleh melebihi saldo tersedia.'`, `overdraftTokens: 'Batas lebih-pakai (kredit token)'`, `overdraftHelp: 'Masukkan bilangan bulat kredit token. Isi 0 untuk menonaktifkan lebih-pakai.'` |
| `m.noAudit` ([`messages.ts#L28`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L28)) | `'Belum ada event audit.'` | Istilah Inggris teknis `'event'` | `'Belum ada catatan audit.'` |
| `kindText.ADJUSTMENT_CREDIT`, `ADJUSTMENT_DEBIT` ([`messages.ts#L32`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L32)) | `'Koreksi kredit'`, `'Koreksi debit'` | Istilah akuntansi kurang jelas bagi pelanggan awam di halaman `/transaksi` | `'Koreksi tambah saldo'`, `'Koreksi pengurangan saldo'` |
| `errorText.idempotency_conflict` ([`messages.ts#L40`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L40)) | `'Kunci transaksi sudah dipakai dengan nilai berbeda. Periksa transaksi sebelumnya.'` | Istilah `'Kunci transaksi'` agak teknis bagi pengguna biasa | `'Permintaan ulang tidak cocok dengan isi transaksi sebelumnya. Periksa riwayat transaksi sebelum mencoba lagi.'` |
| `am.manualKeyLabel`, `am.copyKey` ([`messages.ts#L90-L92`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts#L90-L92)) | `'Kunci manual (kelompok 4 karakter)'`, `'Salin kunci'` | Inkonsistensi terjemahan umum di repo (`key` untuk API key pelanggan vs `kunci` untuk kunci autentikator admin) | Pertahankan pembedaan konsep TOTP secret vs API key atau pertegas `'Kunci rahasia autentikator (kelompok 4 karakter)'` |

---

### Ringkasan Hasil Verifikasi (`Tugas tiga`, per Status Eksekusi Terakhir)

Seluruh perintah dijalankan setelah `source .antigravity-env.sh`. Bukti tersimpan di folder `web/evidence/` (di-gitignore):

| Pemeriksaan | Status | Hasil Teramati | File Bukti |
|---|---|---|---|
| `cd server && npm run typecheck` | Dijalankan & Lulus (sesudah suntingan akhir) | Exit code `0`, `0` error TypeScript | — |
| `cd server && npm test` | **Terhalang Sandbox (PostgreSQL)** | Tidak dapat dijalankan setelah sandbox direstart karena `127.0.0.1:55432` tidak terjangkau (`ECONNREFUSED`) dan `uid_map 0 0 1` mencegah `postgres` berjalan di container | — |
| `cd web && npm run typecheck` | Dijalankan & Lulus (sesudah suntingan akhir) | Exit code `0`, `0` error TypeScript | [`web/evidence/antigravity-typecheck.txt`](file:///mnt/d/router.dev.zuhri-antigravity/web/evidence/antigravity-typecheck.txt) |
| `cd web && npm test` (unit) | Dijalankan & Lulus (sesudah suntingan akhir) | Exit code `0`, `5/5` test lulus (`api`, `credits`, `3` uji `qr.test.ts`), `0` gagal | [`web/evidence/antigravity-unit.txt`](file:///mnt/d/router.dev.zuhri-antigravity/web/evidence/antigravity-unit.txt) |
| `cd web && npm run build` | Dijalankan & Lulus | Exit code `0`, `160` modul terbundle | [`web/evidence/antigravity-build.txt`](file:///mnt/d/router.dev.zuhri-antigravity/web/evidence/antigravity-build.txt) |
| `node --check` pada skrip verifikasi (`a11y-audit.mjs`, `admin-customers-local-verify.mjs`, `account-local-verify.mjs`) | Dijalankan & Lulus (sesudah suntingan akhir) | Exit code `0` untuk ketiga berkas skrip | — |
| `node scripts/admin-customers-local-verify.mjs` | Dijalankan & Lulus (sebelum restart sandbox; berkas tidak diubah sesudahnya; commit `a13bb65`) | Exit code `0`, berakhir `admin-customers-local-verify: PASS` | [`web/evidence/antigravity-admin-customers-verify.txt`](file:///mnt/d/router.dev.zuhri-antigravity/web/evidence/antigravity-admin-customers-verify.txt) |
| `npx playwright test test/e2e/return-to.spec.ts --reporter=line` | Dijalankan (sesudah suntingan akhir `return-to.spec.ts`); `8` lulus, `3` gagal pada bug `returnTo` Hermes | Exit code `1`: `8 passed`, `3 failed` (membuktikan bug `Shell` `<Navigate>` + `useResource`, multi-`useResource`, dan `CataloguePage` `useQuery`) | [`web/evidence/antigravity-return-to.txt`](file:///mnt/d/router.dev.zuhri-antigravity/web/evidence/antigravity-return-to.txt) |
| `npx playwright test --reporter=line` (seluruh suite) | Dijalankan (sesudah suntingan akhir `return-to.spec.ts`); `44` lulus, `5` gagal | Exit code `1`, `44 passed` (seluruh `account-*.spec.ts` `4/4` lulus, `8/11` `return-to.spec.ts` lulus), `5 failed`: `3` kasus bug nyata di `return-to.spec.ts` + `2` kegagalan pra-ada pada [`upstreams.spec.ts`](file:///mnt/d/router.dev.zuhri-antigravity/web/test/e2e/upstreams.spec.ts#L29) baris 29 & 134 (helper `mount` timeout) | [`web/evidence/antigravity-playwright-all.txt`](file:///mnt/d/router.dev.zuhri-antigravity/web/evidence/antigravity-playwright-all.txt) |
| `node scripts/account-local-verify.mjs` | **Terhalang Sandbox (PostgreSQL)** | Belum dijalankan ulang setelah restart karena `ECONNREFUSED 127.0.0.1:55432` (terakhir lulus pada Tugas dua) | [`web/evidence/antigravity-local-verify.txt`](file:///mnt/d/router.dev.zuhri-antigravity/web/evidence/antigravity-local-verify.txt) |
| `node scripts/a11y-audit.mjs` (diperluas Bagian C) | **Ditulis, Diperiksa Sintaks; Eksekusi Terhalang Sandbox (PostgreSQL)** | Keluar kode `1` saat koneksi DB: `Error: connect ECONNREFUSED 127.0.0.1:55432` (siap dijalankan di host dengan PostgreSQL aktif) | — |



---

## 2026-11-16 — Tugas empat (2026-11-16 malam): Layar Ringkasan Operasi, Verifikasi Portal & Katalog Backoffice, serta Uji Ulang

- Tanggal pengerjaan: 2026-11-16 malam (Asia/Jakarta)
- Cabang git: `antigravity/akun` (sinkron dengan `origin/main` pada `eaed030`)
- Ruang lingkup: `ANTIGRAVITY_TASK.md` bagian **Tugas empat (2026-11-16 malam)** — Bagian A sampai D.

### Pemeriksaan Lingkungan Awal

- Di dalam sandbox bawaan tool (`BypassSandbox: false`), kedua pemeriksaan gagal karena isolasi container (`.git` ter-mount `ro` sehingga `Read-only file system`, dan `127.0.0.1:55432` menjawab `connect ECONNREFUSED`).
- Dengan persetujuan founder untuk menjalankan perintah `.git` dan skrip verifikasi PostgreSQL memakai `BypassSandbox: true`:
  - `git commit --allow-empty -m probe && git reset --soft HEAD~1`: **Lulus** (exit code `0`).
  - `node -e "require('net').connect(55432,'127.0.0.1')..."`: **Lulus** (`ok`, exit code `0`).
  - `git pull --ff-only origin main`: **Lulus** (fast-forward `62187e7..eaed030`).

---

### Bagian A — Layar Ringkasan Operasi (SCR-014), rute `/admin/ringkasan`

- **Status**: **Ditulis, Dijalankan & Lulus**, **Di-commit** (`d81d39b`).
- **Berkas baru**:
  - [`web/src/admin-overview.tsx`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/admin-overview.tsx): Layar `AdminOverviewPage` membaca `GET /admin/api/overview`:
    - Kartu metrik: pelanggan (`ACTIVE`, `SUSPENDED`, `CLOSED`), total saldo tercatat & saldo positif (tidak termasuk `CLOSED`), saldo ditahan, akun bersaldo minus (jumlah & totalnya, ditandai `.metric-warning` serta badge teks `'Perlu perhatian'` saat `negativeAccounts > 0`), kode aktif belum ditukar (jumlah & nominal), request 24 jam (total, gagal, estimasi, total debit), request menunggu keputusan (tautan ke `/admin/rekonsiliasi`), dan upstream aktif non-arsip per status (`Menunggu tinjauan`, `Layak`, `Diblokir`, tautan ke `/admin/upstream`).
    - Menampilkan waktu `generatedAt` (`formatDate`), tombol `Muat ulang`, keadaan memuat (`Pending`), keadaan gagal (`ErrorBox` dengan `h1` tetap ada), dan keadaan nol (`0` / `0 kredit token` + `ov.zeroOverviewNote` bila semua nol).
    - Seluruh nilai mikro-kredit diformat memakai `formatCredits` dari [`web/src/credits.ts`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/credits.ts) tanpa `Number()`.
    - Menampilkan tepat satu kalimat bahwa angka biaya upstream, margin, dan kill switch belum tersedia dari server; tidak mengarang angka biaya maupun kontrol kill switch.
  - [`web/test/e2e/admin-overview.spec.ts`](file:///mnt/d/router.dev.zuhri-antigravity/web/test/e2e/admin-overview.spec.ts): 4 uji Playwright (mock): seluruh metrik/peringatan/tautan/catatan biaya + Axe WCAG 2.2 AA, loading/error `500` dengan `h1` tetap ada/nol, angka di atas `2^53` mikro-kredit (`9.007.199.254.740.993,000001` dst.) tampil eksak, serta reflow `360x640`, keyboard-only, dan `prefers-reduced-motion: reduce`.
  - [`web/scripts/admin-overview-local-verify.mjs`](file:///mnt/d/router.dev.zuhri-antigravity/web/scripts/admin-overview-local-verify.mjs): Verifikasi terhadap server Fastify + PostgreSQL nyata (schema temporer `web_overview_*`): 2 pelanggan (1 ditangguhkan dengan request `SETTLED`/`FAILED`/`UNRESOLVED`, 1 minus `-0,25` lewat koreksi), 1 kode aktif (`50` kredit token), 1 upstream `PENDING`; memeriksa kesesuaian seluruh angka layar dengan `GET /admin/api/overview`, penanda peringatan akun minus, reflow `360px`, serta navigasi tautan ke `/admin/rekonsiliasi` dan `/admin/upstream`.
- **Berkas diubah (sesuai batas)**:
  - [`web/src/messages.ts`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/messages.ts): Blok `// --- ringkasan (Antigravity) ---` berisi `ov` di akhir berkas.
  - [`web/src/styles.css`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/styles.css): Blok `/* --- ringkasan (Antigravity) --- */` memakai token dari [`web/src/tokens.css`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/tokens.css) saja.
  - [`web/src/app.tsx`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/app.tsx): Menambah import `AdminOverviewPage`, tautan `['/admin/ringkasan', ov.overview]` di `adminLinks`, dan `<Route path="/admin/ringkasan" ... />` (pengalihan `/admin` tetap ke `/admin/pelanggan`).
  - [`web/scripts/a11y-audit.mjs`](file:///mnt/d/router.dev.zuhri-antigravity/web/scripts/a11y-audit.mjs): Menambah `/admin/ringkasan` pada keadaan kosong, terisi, dan error `500` (`360px` & `1280px`).
- **Hasil verifikasi Bagian A**:
  - `npx playwright test test/e2e/admin-overview.spec.ts --reporter=line`: **4 passed (7.6s)** -> [`web/evidence/antigravity-admin-overview-e2e.txt`](file:///mnt/d/router.dev.zuhri-antigravity/web/evidence/antigravity-admin-overview-e2e.txt).
  - `node scripts/admin-overview-local-verify.mjs`: **PASS (exit 0)** -> [`web/evidence/antigravity-admin-overview-verify.txt`](file:///mnt/d/router.dev.zuhri-antigravity/web/evidence/antigravity-admin-overview-verify.txt).
- **Usulan & Permintaan terkait Bagian A**:
  1. **Untuk Claude / Founder**: Pertimbangkan mengalihkan rute bawaan `/admin` dari `/admin/pelanggan` ke `/admin/ringkasan` setelah disetujui.
  2. **Untuk Hermes**: Tambahkan `ringkasan` pada allowlist `returnTo` di [`web/src/auth.tsx#L13`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/auth.tsx#L13) (serta pembaruannya di [`web/test/e2e/portal.spec.ts#L39-L42`](file:///mnt/d/router.dev.zuhri-antigravity/web/test/e2e/portal.spec.ts#L39-L42)) agar sesi admin yang berakhir di `/admin/ringkasan` kembali ke `/admin/ringkasan` setelah masuk ulang.

---

### Bagian B — Verifikasi Portal Pelanggan terhadap Server Nyata

- **Status**: **Ditulis, Dijalankan & Lulus**, **Di-commit** (`d43ea2a`).
- **Berkas baru**: [`web/scripts/portal-local-verify.mjs`](file:///mnt/d/router.dev.zuhri-antigravity/web/scripts/portal-local-verify.mjs).
- **Bukti eksekusi**: [`web/evidence/antigravity-portal-verify.txt`](file:///mnt/d/router.dev.zuhri-antigravity/web/evidence/antigravity-portal-verify.txt) -> berakhir `portal-local-verify: PASS (redeem SALE + replay/wrong reject + API key secret-once & revoke 401 + usage/ledger pagination + catalogue non-archived)`.
- **Yang dibuktikan terhadap server Fastify + PostgreSQL nyata (tanpa upstream eksternal)**:
  1. **Redeem kode SALE (`/isi-saldo`)**: Kode salah ditolak dengan pesan `code_unusable`; kode `SALE` (`100` kredit token) menaikkan saldo tepat `100_000_000n` mikro-kredit (`100 kredit token`); penukaran ulang oleh pemilik menampilkan pesan replay tanpa kredit ganda; penukaran kode yang sudah terpakai oleh pelanggan kedua ditolak `400 code_unusable` (`Kode ini tidak dapat dipakai. Periksa penulisannya atau hubungi penjual.`).
  2. **API key (`/api-key`)**: Secret tampil sekali pada modal `SecretReveal`, tidak bocor di URL, storage, atau konsol; setelah modal ditutup dan halaman dimuat ulang, hanya prefix tersamar (`rtr_...`) yang terlihat; key aktif diterima `GET /v1/models` (`200`); setelah key dicabut lewat UI, `GET /v1/models` ditolak dengan `401 key_revoked`.
  3. **Pemakaian & Transaksi (`/pemakaian`, `/transaksi`)**: 55 request selesai (total debit `6.650.000` mikro-kredit) di-seed lewat `ledger.placeKeyHold` & `ledger.settleHold` tanpa upstream. `/pemakaian` menampilkan debit (`1,25 kredit token`) sesuai ledger dan pagination bekerja across 2 halaman (`50` + `5`); `/transaksi` mencantumkan entri ledger yang sama (`-1,25 kredit token` + ID entri DB) dan pagination bekerja (`50` + `6` termasuk entri redeem awal `100 kredit token`).
  4. **Model dan Harga (`/model-harga`)**: Menampilkan model terbit non-arsip (`portal/uniform-2x` dengan `x2`, `portal/varied-rates` dengan tarif per kategori sama persis dengan `/api/models`), sedangkan `portal/archived-model` (diarsipkan) dan `portal/draft-only` (belum terbit) tidak tampil.

---

### Bagian C — Verifikasi Backoffice Katalog terhadap Server Nyata

- **Status**: **Ditulis, Dijalankan & Lulus**, **Di-commit** (`9818830`).
- **Berkas baru**: [`web/scripts/admin-catalog-local-verify.mjs`](file:///mnt/d/router.dev.zuhri-antigravity/web/scripts/admin-catalog-local-verify.mjs).
- **Bukti eksekusi**: [`web/evidence/antigravity-admin-catalog-verify.txt`](file:///mnt/d/router.dev.zuhri-antigravity/web/evidence/antigravity-admin-catalog-verify.txt) -> berakhir `admin-catalog-local-verify: PASS (packs create/edit/deactivate + voucher issue/once/revoke + model draft/preview/publish/retire + upstream base_url_rejected/route + overdraft step-up)`.
- **Yang dibuktikan terhadap server Fastify + PostgreSQL nyata (resolver offline, tanpa request luar)**:
  1. **Paket (`/admin/paket`)**: Buat paket (`Paket Katalog Awal`, `50` / `Rp100.000`), ubah (`Paket Katalog Baru`, `75` / `Rp140.000`, `Promo`), buat lalu nonaktifkan paket kedua (`Paket Nonaktif Uji` -> `Ditarik`), dan setiap perubahan langsung tercermin pada `/beranda` pelanggan.
  2. **Kode redeem (`/admin/kode`)**: Terbitkan kode dari `Paket Katalog Baru` lewat dialog konfirmasi + step-up asli; kode mentah tampil sekali lalu hilang setelah panel ditutup dan tidak bocor ke URL/storage/konsol; cabut kode lewat step-up (`Dicabut`) lalu penukaran di `/isi-saldo` ditolak `code_unusable`.
  3. **Harga model (`/admin/harga` & `/model-harga`)**: Buat model `cat/model-uji`, tambah route ke upstream `ELIGIBLE` offline melalui UI `/admin/upstream` + step-up; simpan draf (belum tampil di pelanggan); hitung preview (`6.300 kredit token`); terbit harga via step-up (pelanggan melihat tarif per kategori); simpan draf baru `x2,5` (pelanggan tetap melihat harga terbit lama sebelum dipublikasikan) lalu terbitkan (`x2.5` tampil di `/model-harga`); tarik harga via step-up (`cat/model-uji` hilang dari `/model-harga`).
  4. **Batas lebih-pakai (`/admin/batas-lebih-pakai`)**: Ubah menjadi `125` kredit token lewat dialog konfirmasi + step-up; bertahan setelah muat ulang (`ledger.overdraftMicro(db) === 125_000_000n`).
  5. **Upstream (`/admin/upstream`)**: Validasi alamat internal (`https://internal.example.test/v1` via resolver offline) ditolak server dengan pesan `Base URL ditolak. Gunakan HTTPS pada alamat publik yang tidak mengarah ke jaringan internal.` (`base_url_rejected`) dan tidak tersimpan ke DB.
- **Temuan bug baru pada berkas Hermes (dilaporkan, tidak diperbaiki)**:
  - [`web/src/admin-upstreams.tsx#L105`](file:///mnt/d/router.dev.zuhri-antigravity/web/src/admin-upstreams.tsx#L105): Atribut `pattern="[A-Za-z0-9][A-Za-z0-9_.:/\[\]-]{0,127}"` pada input `ID model di upstream` memicu error konsol Chromium (flag `/v` UnicodeSets): `Pattern attribute value [A-Za-z0-9][A-Za-z0-9_.:/\[\]-]{0,127} is not a valid regular expression: Uncaught SyntaxError: Invalid regular expression: /[A-Za-z0-9][A-Za-z0-9_.:/\[\]-]{0,127}/v: Invalid character in character class`. Usul ke Hermes: perbaiki escape karakter kelas agar valid di mode RegExp `/v`.

---

### Bagian D — Uji Ulang Setelah Hermes Selesai & Ringkasan Verifikasi Akhir

- **Status sinkronisasi `origin/main`**: `git fetch origin` dan `git log --oneline HEAD..origin/main` menunjukkan **belum ada commit baru** dari Hermes di `origin/main` setelah `eaed030` (perbaikan `returnTo` pada `hooks.tsx`/`catalogue.tsx` serta judul `Shell` pada `app.tsx` belum masuk ke `main`). Sesuai instruksi, hasil dicatat tanpa menunggu dan seluruh rangkaian verifikasi dijalankan ulang pada kondisi terkini:

| Pemeriksaan | Status | Hasil Teramati | File Bukti |
|---|---|---|---|
| `cd server && npm run typecheck` | **Dijalankan & Lulus** (sesudah suntingan akhir) | Exit code `0`, `0` error | — |
| `cd web && npm run typecheck` | **Dijalankan & Lulus** (sesudah suntingan akhir) | Exit code `0`, `0` error | [`web/evidence/antigravity-typecheck.txt`](file:///mnt/d/router.dev.zuhri-antigravity/web/evidence/antigravity-typecheck.txt) |
| `cd web && npm test` (unit) | **Dijalankan & Lulus** (sesudah suntingan akhir) | Exit code `0`, `5/5` lulus (`api`, `credits`, `3` uji `qr.test.ts`) | [`web/evidence/antigravity-unit.txt`](file:///mnt/d/router.dev.zuhri-antigravity/web/evidence/antigravity-unit.txt) |
| `cd web && npm run build` | **Dijalankan & Lulus** (sesudah suntingan akhir) | Exit code `0`, `161` modul terbundle | [`web/evidence/antigravity-build.txt`](file:///mnt/d/router.dev.zuhri-antigravity/web/evidence/antigravity-build.txt) |
| `npx playwright test test/e2e/admin-overview.spec.ts --reporter=line` | **Dijalankan & Lulus** | Exit code `0`, `4/4` lulus | [`web/evidence/antigravity-admin-overview-e2e.txt`](file:///mnt/d/router.dev.zuhri-antigravity/web/evidence/antigravity-admin-overview-e2e.txt) |
| `node scripts/admin-overview-local-verify.mjs` | **Dijalankan & Lulus** (`127.0.0.1:55432`) | Exit code `0`, `admin-overview-local-verify: PASS` | [`web/evidence/antigravity-admin-overview-verify.txt`](file:///mnt/d/router.dev.zuhri-antigravity/web/evidence/antigravity-admin-overview-verify.txt) |
| `node scripts/portal-local-verify.mjs` | **Dijalankan & Lulus** (`127.0.0.1:55432`) | Exit code `0`, `portal-local-verify: PASS` | [`web/evidence/antigravity-portal-verify.txt`](file:///mnt/d/router.dev.zuhri-antigravity/web/evidence/antigravity-portal-verify.txt) |
| `node scripts/admin-catalog-local-verify.mjs` | **Dijalankan & Lulus** (`127.0.0.1:55432`) | Exit code `0`, `admin-catalog-local-verify: PASS` | [`web/evidence/antigravity-admin-catalog-verify.txt`](file:///mnt/d/router.dev.zuhri-antigravity/web/evidence/antigravity-admin-catalog-verify.txt) |
| `npx playwright test test/e2e/return-to.spec.ts --reporter=line` | **Dijalankan**; `8` lulus / `3` gagal (menunggu perbaikan Hermes) | Exit code `1`: `8 passed`, `3 failed` (bug `returnTo` di `hooks.tsx` & `catalogue.tsx` belum diperbaiki di `origin/main`) | [`web/evidence/antigravity-return-to.txt`](file:///mnt/d/router.dev.zuhri-antigravity/web/evidence/antigravity-return-to.txt) |
| `npx playwright test --reporter=line` (seluruh suite `web/`) | **Dijalankan**; `50` lulus / `3` gagal | Exit code `1`: `50 passed` (seluruh `account-admin` `2/2`, `account-customer` `2/2`, `admin-overview` `4/4`, `upstreams` `5/5`, dll. lulus), `3 failed` hanya pada `return-to.spec.ts` | [`web/evidence/antigravity-playwright-all.txt`](file:///mnt/d/router.dev.zuhri-antigravity/web/evidence/antigravity-playwright-all.txt) |
| `node scripts/a11y-audit.mjs` (`140` kombinasi layar-lebar) | **Dijalankan**; `0` temuan layar Antigravity, `6` temuan pra-ada milik Hermes | Exit code `1`: `/admin/ringkasan`, `/akun`, dan `/admin/akun` lulus `0` temuan; `6` temuan `h1` kosong saat error `500` pada `Shell` (`app.tsx` & `admin-packs.tsx`) masih menunggu perbaikan Hermes | [`web/evidence/antigravity-audit.txt`](file:///mnt/d/router.dev.zuhri-antigravity/web/evidence/antigravity-audit.txt), [`web/evidence/antigravity-audit.json`](file:///mnt/d/router.dev.zuhri-antigravity/web/evidence/antigravity-audit.json) |
