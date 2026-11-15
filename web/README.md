# Web portal dan backoffice

Wilayah Hermes: `web/`, empat dokumen UI bila perlu, dan `docs/handoff/hermes-log.md`. Tidak mengedit `server/` atau dokumen status milik Claude. Belum ada deploy.

## Butir 1: keputusan pustaka (2026-11-14)

Dipilih React SPA, Vite, React Router declarative, TanStack Query untuk pembacaan server dan fetch bawaan untuk mutasi. Routing memakai browser history, bukan hash, agar fragment token aktivasi/reset dapat segera dibuang. Cache Query hanya berisi pembacaan metadata, tidak pernah secret atau respons mutasi. Mutasi tanpa retry otomatis. Tidak ada framework CSS, font unduhan, pustaka ikon atau animasi.

Versi dipasang persis, `package-lock.json` terpisah dari server. `npm install --ignore-scripts --save-exact` dijalankan, berhasil. Node aktual v24.21.0, npm 11.19.0. Semua engines pustaka terpilih cocok; React Router membutuhkan Node >=22.22.0. Jumlah di bawah tidak menghitung peer/optional dependency sebagai dependency langsung. Kolom transitif menghitung dependency terpasang yang dijangkau dari paket itu (termasuk langsung), tanpa peer/optional.

| Pustaka | Versi | Lisensi | Langsung | Transitif | Sumber |
|---|---|---|---:|---:|---|
| react | 19.3.1 | MIT | 0 | 0 | https://github.com/react/react |
| react-dom | 19.3.1 | MIT | 1 | 1 | https://github.com/react/react |
| vite | 8.3.8 | MIT | 5 | 12 | https://github.com/vitejs/vite |
| react-router | 8.5.1 | MIT | 2 | 2 | https://github.com/remix-run/react-router |
| @tanstack/react-query | 5.107.1 | MIT | 1 | 1 | https://github.com/TanStack/query |
| typescript | 7.0.2 | Apache-2.0 | 0 | 0 | https://github.com/microsoft/TypeScript |
| @types/node | 24.10.1 | MIT | 1 | 1 | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/react | 19.3.0 | MIT | 1 | 1 | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/react-dom | 19.3.0 | MIT | 0 | 0 | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @playwright/test | 1.65.1 | Apache-2.0 | 1 | 2 | https://github.com/microsoft/playwright |
| @axe-core/playwright | 4.14.0 | MPL-2.0 | 1 | 1 | https://github.com/dequelabs/axe-core-npm |

Playwright dan axe ditambahkan sebagai alat verifikasi keyboard, reflow, state, dan aksesibilitas browser, bukan runtime produksi. MPL-2.0 berlaku pada tool axe yang tidak dibundel ke produk; tidak dimodifikasi. TypeScript memakai binary optional platform, bukan lifecycle script. Satu install script tercatat pada fsevents (macOS optional, tidak berjalan di Linux). Seluruh install script dinonaktifkan.

`npm audit --json` dan `npm run evidence:deps` dijalankan: exit 0, 0 kerentanan (info/low/moderate/high/critical semuanya 0). Audit melaporkan 86 dependency total termasuk optional lintas platform, prod 12, dev 75, optional 54 (kelompok npm saling tumpang tindih, jangan dijumlah). Daftar versi/lisensi seluruh lockfile, metadata registry awal, dan audit mentah: `evidence/dependencies.json`, `evidence/npm-metadata.json`. Bukan jaminan bebas celah; ulangi audit saat rilis.

Table 1 includes all entries and lists clients, TypeScript and Vite. The version, license, source, direct dependency counts and the reason these packages are development-only are retained as discovered metadata. The browser harness uses the existing Playwright devDependency; no new package is installed for Stage 2.

## UIArc Free

Source registry benar-benar diambil dan dibaca, bukan menjalankan installer shadcn. Fetch awal urllib ditolak 403; berhasil lewat request User-Agent browser dan Accept application/json. Snapshot JSON utuh dan daftar file/dependency: `evidence/uiarc/`. Tidak ada source Pro yang diambil. Kebijakan Free MIT: https://uiarc.dev/license (Copyright (c) 2026 Elia Kuratli).

Seluruh komponen yang digunakan ditetapkan PATTERN_ADAPTATION. Implementasi native React/HTML/CSS dengan token proyek; tidak menyalin source, CSS foundation, demo backend atau animasi angka. DIRECT_ADOPTION tidak dipilih: biaya animasi, pengolahan angka Number dan fokus sumber kurang sesuai dengan saldo eksak dan target fokus proyek.

| Komponen registry Free diperiksa | UAR | Keputusan / adaptasi |
|---|---|---|
| button, input, password-field | 011, 007, 014 | PATTERN_ADAPTATION: tombol native busy, label terhubung, reveal password bernama |
| dialog, drawer | 008, 028 | PATTERN_ADAPTATION: dialog native modal, fokus kembali, Escape, busy tidak menutup |
| copy-button, alert | 004, 010 | PATTERN_ADAPTATION: feedback menetap, salin gagal tetap dapat manual |
| metric-card, sortable-data-table | 003, 002 | PATTERN_ADAPTATION: BigInt, tanpa animated-counter; pagination/sort hanya bila server mendukung |
| badge, pagination | 015, 016 | PATTERN_ADAPTATION: kosakata Indonesia, cursor server, tanpa jumlah halaman fiktif |
| empty-state, skeleton | 017, 018 | PATTERN_ADAPTATION: pesan loading/kosong/gagal, bukan angka dummy |
| select, textarea, checkbox, number-field | 022, 040, 039, 012 | PATTERN_ADAPTATION: kontrol native, string desimal eksak, tidak mengadopsi spinbutton berbasis Number |
| otp-input | 035 | PATTERN_ADAPTATION: satu field enam digit agar paste/autocomplete tetap sederhana, bukan enam tab stop |
| login-centered, signup-form | 006, 034 | PATTERN_ADAPTATION: password dan undangan nyata, tanpa passkey/OAuth/simulasi |
| hero-section, empty-states | 042, 043 | PATTERN_ADAPTATION: tipografi editorial dan placeholder geometris, tanpa aset/demo/mesh |
| confirm-morph, user-menu, usage-meter | 027, 030, 001 | PATTERN_ADAPTATION: konfirmasi eksplisit tanpa undo, menu akun sederhana, batas berupa angka eksak |
| plan-comparison | 005 | Tidak dipakai: paket token bukan langganan. Daftar paket memakai tabel UAR-002 |
| arc-foundation, arc-motion-tokens | lintas komponen | Hanya diperiksa: nama token dipetakan, tidak diimpor atau menggandakan tema |

Source registry menggunakan motion, lucide-react dan Radix. Metadata/lisensinya diperiksa, disimpan di `evidence/uiarc/dependency-metadata.json`: motion 14.14.0 MIT (2 dependency langsung), lucide-react 1.72.0 ISC (0), @radix-ui/react-dialog 1.3.1 MIT (15), @radix-ui/react-select 2.4.1 MIT (21), @radix-ui/react-checkbox 1.4.1 MIT (7). Tidak dipasang; tidak ada impact transitif ke produk dari pola tersebut. Dependency tambahan registry metric-card/hero/plan tidak diadopsi. Tidak ada audit instalasi untuk dependency yang tidak dipasang; audit produk meliputi seluruh lockfile produk saja.

Temuan source: confirm-morph menghapus outline dan menggantinya fill; foundation mengecualikan input dari outline; metric-card/usage-meter memakai animasi nilai. Adaptasi wajib mempertahankan outline fokus semua kontrol dan tidak menganimasikan saldo. Shell UAR-038 tetap CUSTOM_GAP, tidak meniru navigasi Pro.

Design read: portal dan backoffice transaksi, sistem Navy/Blue/Gold dengan editorial cream/coral; ENERGY 2, RHYTHM 2, MOTION 1. Aksen brand pada auth, sedangkan receipt/form uang tenang. Font sistem, tema terang saja, tanpa maskot pihak lain.

## Menjalankan dan verifikasi

Perintah dari `web/`:

    npm ci --ignore-scripts
    npm run dev
    npm run typecheck
    npm test
    npm run build
    npm run test:e2e
    npm run test:local
    npm run build
    npm run test:dist
    npm run test:browser
    npm run evidence:deps

`npm run test:local` menjalankan `scripts/local-browser-verify.mjs`: Fastify dan PostgreSQL lokal dalam schema `web_verify_<uuid>` privat, Vite loopback sementara, dan Chromium cache lokal. Verifier mencakup aktivasi/login, API key buat/cabut, admin TOTP, daftar/prefix pelanggan lalu detail dan top-up step-up, harga/paket/voucher/redeem/replay/ledger, pemakaian pelanggan per-hari/model/key dan request terbaru. Tidak memanggil upstream atau mengirim email nyata; schema dibuang. `npm run test:dist` membangun schema privat, menyajikan `web/dist` langsung dari Fastify tanpa Vite, memakai Chromium terhadap port loopback lain, dan memverifikasi aktivasi/login pelanggan, panduan, CSP, SPA fallback dan batas 404 pada API/path aset; tidak mengirim email/upstream. Bukti akhir ada di `evidence/stage2-*.txt/json`.

## Same-origin production dist serving

The server may serve `web/dist` when `WEB_DIST` points to it. Any GET path without a file extension outside `/api/`, `/admin/api/`, `/v1/`, `/healthz`, or `/readyz` falls back to `index.html`. This includes the portal routes `/beranda`, `/masuk`, `/aktivasi`, `/atur-ulang`, `/lupa-password`, `/isi-saldo`, `/api-key`, `/model-harga`, `/pemakaian`, `/panduan`, `/transaksi` and admin routes under `/admin/` (admin session cookies are scoped to `/admin`). Hashed `/assets/*` files receive immutable caching; `index.html` and other client routes use `no-cache`. Missing paths with file extensions, such as `/missing.js`, return 404 rather than the app shell. API, gateway and health paths must never be served as SPA HTML. The production CSP only permits same-origin scripts and assets, allows inline styles, and blocks inline scripts and external resources. `npm run test:browser` builds `web/dist` and uses Chromium against Fastify serving that exact directory, without Vite.
