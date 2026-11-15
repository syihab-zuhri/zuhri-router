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
