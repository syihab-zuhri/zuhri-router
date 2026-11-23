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

## 2026-11-15 sore, dua temuan audit aksesibilitas pada layar Hermes

Untuk Hermes. Antigravity mengaudit 58 kombinasi layar dan lebar (axe WCAG 2.2 AA, 360 dan 1280 px, keyboard, reduced motion) terhadap server nyata. Claude menjalankan ulang auditnya dan memeriksa kedua temuan di kode: keduanya benar. Mohon diperbaiki sebagai bagian dari tahap tiga, masing-masing dengan test:

1. `/pemakaian` pada 360 px (WCAG 1.4.10 Reflow): baris grafik harian melebar keluar panel. `styles.css` baris 11, `.usage-bar-row` memakai `grid-template-columns: minmax(6rem, 1fr) minmax(5rem, 2fr) minmax(7rem, auto)`, minimum sekitar 312 px sedangkan ruang isi 294 px. Usul: satu kolom atau wrap secara bawaan, tiga kolom hanya pada layar lebar.
2. `/admin/batas-lebih-pakai` (WCAG 2.4.3 Focus Order): `OverdraftPage` di `admin-operations.tsx` mengembalikan `<Pending />` sebelum `<PageTitle>`, sehingga `h1` belum ada saat `RouteFocus` berjalan dan fokus tertinggal di tombol Menu atau tautan navigasi. Usul: render `PageTitle` lebih dulu seperti layar lain, dan beri `RouteFocus` cadangan ke `main` bila `h1` belum ada. Periksa layar lain yang berpola sama.

Skrip auditnya (`web/scripts/a11y-audit.mjs`) masuk ke `main` saat cabang Antigravity digabung, sesudah pekerjaan Anda yang sekarang selesai. Skrip itu keluar dengan kode 1 selama dua temuan ini masih ada.

## 2026-11-15 malam, tahap tiga lanjutan Hermes dan tugas dua Antigravity digabung dan dipasang

Terpasang sebagai `zrouter:r11152211` (sebelumnya `r11151123`), backup `zrouter-20261115T151236Z.dump` dibuat lebih dulu. Dijalankan dan lulus sesudah penggabungan: typecheck, 5 unit, 38/38 Playwright, `account-local-verify`, `local-browser-verify`, `a11y-audit` (58 kombinasi, 0 temuan).

Perbaikan Claude pada berkas Hermes saat memeriksa:

- `admin-customers.tsx`: kotak hasil undangan memakai `ref={node => node?.focus()}`. Fungsi `ref` inline dibuat baru di setiap render, sehingga fokus direbut setiap kali ada ketikan di kolom email atau filter. Diganti `useRef` + `useEffect` yang bergantung pada `invitation`.
- `messages.ts`: `errorText.conflict` diubah Hermes menjadi pesan khusus email, padahal kode `conflict` juga dipakai model, upstream dan route. Dikembalikan ke pesan umum; form undangan sudah punya pesan khususnya sendiri (`inviteConflict`).
- Koreksi saldo menampilkan dua struk (juga mengisi struk tambah saldo); sekarang satu. Dialog tangguhkan menampilkan baris alasan kosong; dihapus. Teks sesudah menyalin tautan memakai `m.copied`, bukan "Saya sudah mengirim tautan". Kalimat pengiriman manual tampil sekali.
- Temuan audit 1 (`styles.css`, `.usage-bar-row`): dua kolom di bawah 640 px dengan batang di baris kedua. Temuan audit 2 (`admin-operations.tsx`, `OverdraftPage`): judul halaman dirender juga saat memuat dan saat gagal.

Catatan: test `returnTo` di `portal.spec.ts` hanya memeriksa teks sumber; test perilaku diberikan ke Antigravity (tugas tiga, bagian B).

## 2026-11-16 malam, tugas tiga Antigravity diperiksa dan digabung; pekerjaan untuk Hermes

Sandbox Antigravity sempat tidak bisa commit (`.git` read-only) dan tidak bisa menjangkau PostgreSQL. Claude menjalankan semuanya di host lalu meng-commit bagian B sampai D atas namanya (`62187e7`) dan menggabungkannya ke `main`:

- `admin-customers-local-verify.mjs` (undang, aktivasi, tolak tautan ulang, konflik email, tangguhkan/pulihkan sampai admission, koreksi +2,5/-1, idempotency, kebersihan rahasia): PASS.
- `a11y-audit.mjs` diperluas ke 134 kombinasi layar/lebar (keadaan kosong, error 500, dialog baru): 6 temuan, satu sebab (lihat butir 2).
- `return-to.spec.ts`: 8 lulus, **3 gagal karena bug nyata** (butir 1). Test ini sekarang ada di `main`, jadi seluruh Playwright Hermes akan merah di tiga test itu sampai butir 1 diperbaiki. Itu disengaja.

### Untuk Hermes

1. **`returnTo` tertimpa saat sesi berakhir** (`hooks.tsx`, `catalogue.tsx`). Saat beberapa pembacaan gagal 401 bersamaan (atau `Shell` dan halaman sama-sama gagal), pengalihan pertama membawa `returnTo` yang benar, lalu pengalihan berikutnya membaca `window.location` yang sudah `/masuk` dan menimpa `returnTo` dengan `/masuk`. Akibatnya pelanggan selalu mendarat di Beranda, bukan halaman asal. `/model-harga` memakai `useQuery` mentah sehingga 401 tidak pernah mengalihkan ke halaman masuk. Perbaikan yang sudah Claude uji (11/11 `return-to.spec.ts` dan `catalogue.spec.ts` lulus, lalu dikembalikan karena berkas Anda):
   - di efek `useResource`, sebelum `cache.clear()`: `if (/^\/(admin\/)?masuk$/.test(window.location.pathname)) return;`
   - `CataloguePage`: ganti `useQuery({...})` dengan `useResource<Catalogue>('/api/models')` dan buang impor `useQuery`/`api` yang tidak terpakai.
2. **`Shell` tanpa judul saat server error** (`app.tsx`, cabang `probe.isError` bukan 401): merender `<main className="standalone"><ErrorBox/></main>` tanpa `h1`, sehingga pembaca layar tidak tahu halaman apa. Beri `PageTitle` (misalnya `m.failed`) di atas `ErrorBox`. Ini menutup 6 temuan audit (portal dan admin, 360 dan 1280; `/admin/paket` error 500 adalah kasus yang sama karena probe admin memakai `/admin/api/packs`).
3. **Teks dari laporan Antigravity** (`docs/handoff/antigravity-log.md`, D.2) yang perlu diperbaiki karena salah atau usang, bukan sekadar gaya:
   - `unbilledInput` "Input belum ditagih": maknanya input berlebih yang **tidak** ditagih (CR-018), bukan akan ditagih nanti. Usul: "Input tidak ditagih".
   - `modelScopeHelp`, `modelHelp`, `untestedTools`: masih menyebut katalog pelanggan atau tool belum ada; keduanya sudah ada.
   - `customerHelp`: masih "masukkan username lengkap"; layar sekarang daftar dengan filter awalan.
   - `redeemed` "Saldo berhasil ditambah" juga tampil pada struk koreksi negatif. Bedakan teks struk koreksi.
   - `protocolHelp` "Protocol" -> "Protokol"; `statusPending`/`statusEligible` "Set status ..." -> "Ubah status menjadi ...".
   Butir lain di D.2 dan seluruh D.1 bersifat usulan; ambil yang menurut Anda layak, tidak wajib.
4. **CSS yang belum ada** selain `.refund-policy`/`.activation-link` (sudah di tahap empat): `.guide-code`, `.protocol-list`, `.model-multiplier`, dan warna badge untuk `ELIGIBLE`, `PENDING`, `BLOCKED` sesuai `docs/DESIGN.md` section 3.

Saat menjalankan test server, pakai `TEST_DATABASE_URL` yang mengarah ke `router_test` hanya bila tidak ada skrip verifikasi lain yang sedang berjalan di database yang sama: test server membuat ulang skema dan bentrok (14 gagal palsu terlihat hari ini). Claude memakai `router_test_claude`.

### Server: `GET /admin/api/overview` (baru, untuk SCR-014)

Admin saja (tanpa step-up). Semua nilai uang string integer mikro-kredit.

    { generatedAt,
      customers: { ACTIVE, SUSPENDED, CLOSED },                       // jumlah tenant
      balances: { postedMicro, heldMicro, positiveMicro, negativeAccounts, negativeMicro },  // tanpa tenant CLOSED
      activeVouchers: { count, amountMicro },                          // kode aktif belum kedaluwarsa: kewajiban token yang belum ditukar
      requests24h: { total, failed, estimated, debitMicro },
      unresolved: { count, heldMicro },
      upstreams: { PENDING, ELIGIBLE, BLOCKED } }                       // tanpa yang diarsipkan

Belum ada biaya upstream, margin, atau kill switch (TASK-003, TASK-018); layar tidak boleh mengarang angka itu.

## 2026-11-16 larut malam, tahap empat Hermes + tugas empat Antigravity digabung dan dipasang

Terpasang sebagai `zrouter:r11162256` (sebelumnya `r11152211`), backup `zrouter-20261116T155827Z.dump` lebih dulu. Container sehat, tidak ada log error.

Claude mengambil alih sisa perbaikan agar tidak menunggu satu putaran Hermes lagi (commit `2d5f110`): butir 1 sampai 4 bagian "Untuk Hermes" di atas, `ringkasan` di allowlist `returnTo` admin, pola regex ID model upstream (`admin-upstreams.tsx`, error Chromium flag `v`), struk koreksi negatif "Saldo berhasil dikurangi", dan tab Ringkasan pelanggan tidak lagi mengulang judul nama serta label "Rincian" (dua region bernama sama).

Dijalankan pada pohon yang sama persis dengan `main`: typecheck, 5 unit, Playwright 58/58 (dua yang gagal pada run penuh lulus saat diulang: satu daftar test yang Claude lupa perbarui, satu timeout saat jaringan WSL berubah), `test:local`, `account-local-verify`, `admin-overview-local-verify`, `portal-local-verify`, `admin-catalog-local-verify`: PASS. **Belum lulus**: `admin-customers-local-verify` dan `a11y-audit`, karena kedua skrip masih mengikuti tata letak detail pelanggan lama (tanpa tab); bukan bug produk. Diserahkan ke Antigravity (tugas lima).

Catatan untuk semua agen: jangan menjalankan suite Playwright dua folder bersamaan di port bawaan; Hermes melihat kegagalan palsu karena itu.

## 2026-11-18

Founder meminta skill `modern-web-guidance` dipasang di proyek. Paket npm `modern-web-guidance@1.0.1` (GoogleChrome, Apache-2.0) diperiksa dulu: perintah `install` hanya memanggil `npx skills add GoogleChrome/modern-web-guidance` (vercel-labs `skills@1.9.0`). Dipasang dengan `--copy` untuk Claude Code, Antigravity dan Hermes Agent: 211 berkas Markdown per salinan, tanpa skrip, sama persis dengan salinan uji di folder kosong. Skill memanggil `npx modern-web-guidance@latest search/retrieve` yang mengirim telemetri anonim termasuk teks kueri ke Google; aturan di `AGENTS.md` meminta `DISABLE_TELEMETRY=1` dan kueri generik.

Antigravity Tugas lima diterima (A: dua skrip mengikuti tab; B: `web/scripts/verify-all.mjs`; C: Ringkasan tahan data rusak). Run ulang `verify-all.mjs` di cabang integrasi: 9/11. Playwright 58/59, satu yang gagal (`portal.spec.ts:5`) lulus 3 kali berturut-turut saat diulang sendiri, jadi flaky di bawah beban; `a11y-audit` 16 temuan dari tiga masalah nyata di detail pelanggan bertab, diserahkan ke Hermes sebagai "Tahap lima, tambahan".

## 2026-11-18 siang: Tahap lima Hermes, Tugas lima dan enam Antigravity, terpasang `r11181828`

Digabung: Tahap lima Hermes (beranda admin Ringkasan, teks D.2, penanda panduan), Tugas lima dan enam Antigravity (verify-all, matriks rute, restore drill, golden path, smoke publik). Butir 5 sampai 8 tambahan Hermes dikerjakan Claude karena Hermes berhenti sesudah butir 4:

- `RouteFocus` tidak mencuri fokus dari tab, dan kini berjalan pada setiap navigasi (`location.key`), termasuk memilih halaman yang sedang dibuka dari menu.
- Hover tab aktif berkontras penuh; fokus kembali ke tombol cabut sesudah dialog ditutup, dan ke judul panel sesudah key dicabut.
- `web/test/e2e/customer-tabs-focus.spec.ts` (baru) berjalan di aplikasi penuh; tiga test gagal pada kode lama dan lulus sesudahnya.
- Temuan sendiri: Hermes mengganti judul panel sekali tampil menjadi "Salin API key ini sekarang", padahal panel yang sama dipakai untuk kode redeem. `SecretReveal` kini punya `kind` (`key`/`voucher`) dengan teks masing-masing.
- Usulan perbaikan test tidak stabil dari Antigravity diterapkan di berkas Hermes (`admin-models.tsx` urutan refetch, `upstreams.spec.ts`, `portal.spec.ts`). Skrip Antigravity disesuaikan dengan teks baru Hermes.
- Dokumen disamakan dengan kode (CHANGELOG 0.38.0): `SETTLED_ESTIMATED` di tabel state; daftar voucher tanpa step-up.

Bukti: `verify-all.mjs` 14/14 (server 140/140, Playwright 67/67, audit aksesibilitas 0 temuan, semua skrip server nyata PASS). Terpasang `zrouter:r11181828` sesudah backup `zrouter-20261118T112950Z.dump`; `smoke-public.sh https://zrouter.web.id` PASS 7/7; `restore-drill.sh` terhadap backup produksi itu PASS (invariant kosong, migrasi 13=13, database drill terhapus). `restore-drill.sh` diperbaiki: `$DOCKER` tidak boleh dikutip agar `DOCKER="sudo docker"` bekerja.

## 2026-11-18 sore: endpoint kill switch dan daftar request di main

Kedua endpoint kini ada di `main` (belum terpasang di zrouter.web.id). Kontraknya sama dengan yang tertulis di `ANTIGRAVITY_TASK.md` Tugas tujuh D dan `HERMES_TASK.md` Tahap enam 1, dengan satu tambahan: filter `state` juga menerima `RESOLVED`. Itu state request sesudah admin memutuskan kasus unresolved, dan bisa muncul di daftar. Rincian lengkap ada di `docs/ARCHITECTURE.md` section 5.7.

- Kill switch: `GET /admin/api/settings/gateway` mengembalikan `{ paused, reason, changedAt, changedBy }`. `POST` yang sama butuh step-up, dengan body `{ paused: true, reason }` (1..200 karakter) atau `{ paused: false }`. Selama dijeda, key sah mendapat 503 `service_paused` dengan `Retry-After: 60`, sedangkan key salah tetap 401. `/admin/api/overview` mendapat field `gateway`.
- `GET /admin/api/requests?username=&state=&model=&before=&limit=` mengembalikan `{ requests: [...], nextBefore }` dengan field persis seperti kontrak.

Antigravity dan Hermes boleh beralih dari mock ke server nyata.

## 2026-11-18 malam: Tahap enam Hermes digabung

Hermes mengerjakan butir 1 (daftar request lintas pelanggan di `/admin/rekonsiliasi`), 2 (Panduan), 3 (fokus sesudah login lewat `MutationObserver` di `RouteFocus`) dan 4 (mock), tetapi tidak menulis log, tidak menambah test untuk butir 1 dan 3, dan kodenya tidak lolos typecheck. Claude memperbaiki dan melengkapi:

- `admin-operations.tsx`: impor `grouped` yang hilang; fungsi `requestStateLabel` yang tidak dipakai dihapus.
- `guide.tsx`: `service_paused` adalah HTTP 503 (bukan 403), dengan `Retry-After`; request yang berjalan tidak terputus.
- `RouteFocus`: halaman di luar `Shell` (masuk, aktivasi, 404, error) tidak punya `main#main`; kini memakai `main` pertama sebagai cadangan, sehingga judul halaman masuk tetap mendapat fokus.
- `admin-requests.spec.ts` (baru): baris, badge, alasan, filter (termasuk `RESOLVED`), paginasi, tautan ke pelanggan, 360 px; dan fokus judul sesudah `Shell` selesai memuat serta di halaman masuk.
- `return-to.spec.ts`: mock `GET /admin/api/requests` (halaman rekonsiliasi kini memanggilnya). `admin.spec.ts`: test arsip model menunggu kiriman ulang sesudah step-up (empat kiriman, bukan tiga); sebelumnya lulus hanya karena waktu.
- Cache `web/node_modules/.vite` di folder utama dibersihkan: optimasi dependensi yang terputus (`deps_temp_*`) membuat Vite memuat ulang di tengah test.

Bukti: typecheck, unit, Playwright 69/69 (test arsip 3/3 sesudah perbaikan), `test-local`, `test-browser`, enam skrip server nyata PASS, audit aksesibilitas 0 temuan. Belum terpasang; menunggu layar kill switch Antigravity.

## 2026-11-19: Tahap tujuh Hermes digabung

Hermes mengerjakan tab Request di detail pelanggan dan filter audit, menulis test dan log, dan semua perintah lulus; jauh lebih rapi dari tahap enam. Claude menemukan dan memperbaiki:

- Label aksi audit: log Hermes menyebut "33 nama, 33 label, tidak ada yang belum dilokalkan", padahal server menulis 43 aksi. Sepuluh aksi yang namanya dipilih dengan ternary terlewat: `model.archive/restore`, `upstream.archive/restore`, `tenant.suspend/restore`, `setting.gateway_pause/resume`, `request.recover_release`, `request.mark_unresolved`. Semuanya kini berlabel. Test unit baru `web/test/unit/audit-actions.test.ts` memindai `server/src` sehingga aksi baru tanpa label membuat test gagal.
- Kelompok filter aksi: `customer.` dan `key.` tidak pernah ditulis server (contoh di HERMES_TASK yang keliru, salah Claude), sehingga pilihan itu selalu kosong, dan ada dua pilihan berlabel "API key". Kini daftar kelompok persis sama dengan awalan yang ada di server, termasuk `tenant.` dan `password_reset.`; test unit yang sama memeriksanya.
- Wilayah filter audit memakai label `m.filters` ("Filter pemakaian"); kini `m.auditFilters` ("Filter audit").
- Daftar request menampilkan "Biaya estimasi" dua kali (badge dan paragraf); paragrafnya dihapus. Navigasi paginasi audit tidak lagi dirender kosong.
- `.git/index.lock` basi (0 byte, dari 2026-11-18 21:37, tanpa proses git) dihapus.

Teks baru yang terlihat (untuk skrip Antigravity): `m.auditFilters`, sepuluh label aksi di atas, label kelompok "Status pelanggan", "Saldo", "Sesi masuk", "Ganti password", "Pemulihan password".

Bukti: typecheck web, unit 6/6 (test baru gagal pada versi Hermes), Playwright terkait 30/30 (admin-operations, admin-customers, admin-requests, return-to, customer-tabs-focus). verify-all penuh dijalankan sesudah cabang Antigravity Tugas tujuh digabung.

### Tugas tujuh Antigravity digabung; `servicePaused` di `/api/me`

- Cabang Antigravity (`86fe5bd`..`ec7c6dc`) digabung tanpa konflik: skrip mengambil teks dari `messages.ts`, `server/test/gateway-concurrency.test.ts` dan `server/scripts/stress-gateway.ts` (240 request, 48 bersamaan, `invariantViolations=0`), `server/scripts/bench-gateway.ts`, dan panel kill switch di Ringkasan (konfirmasi dengan alasan, step-up, hasil hanya sesudah server menjawab). Race `admin.spec.ts` yang dilaporkan sudah diperbaiki di `a2ceb36`.
- Angka benchmark: pada satu request, gateway menambah sekitar 20 ms (stream) sampai 30 ms (non-stream) sebelum byte pertama; satu tenant dengan 50 request bersamaan menunggu giliran pada baris akun (p95 stream sekitar 2,6 detik), sesuai RSK-017. NFR-002 menargetkan banyak tenant, jadi Antigravity Tugas delapan A mengukurnya beserta rincian query per request sebelum Claude memutuskan perlu tidaknya optimasi.
- `GET /api/me` kini membawa `servicePaused` (SCR-007 keadaan layanan-dijeda; UX.md alur kill switch meminta portal menampilkan jeda). Hanya pelanggan yang masuk yang mengetahuinya; alasan jeda tetap untuk admin. Test di `control.test.ts`. Banner di portal: Hermes Tahap delapan.
- Suite server 145/145 sesudah penggabungan.

### Terpasang `zrouter:r11191901`

Isi: kill switch dan daftar request (server dan layar), filter audit (server dan layar), tab Request, `servicePaused`. Backup sebelum pemasangan `zrouter-20261119T120238Z.dump`. Migrasi 014 berjalan (14 migrasi; `gateway_paused` = 0, layanan berjalan). Bukti: suite server 145/145, `verify-all.mjs` 13/13 (Playwright 76/76, audit aksesibilitas 0 temuan), `smoke-public.sh` 7/7, `restore-drill.sh` PASS pada backup sesudah pemasangan `zrouter-20261119T120454Z.dump` (14 migrasi, tanpa pelanggaran invariant).

## 2026-11-19: Tahap delapan Hermes digabung

Hermes mengerjakan banner layanan dijeda dan status layanan di Beranda, rincian event audit, dan halaman lanjutan yang kosong, lengkap dengan test, log, dan catatan jujur bahwa sebagian RED tidak sah. Claude memperbaiki:

- Rincian audit menerjemahkan setiap nilai string yang kebetulan berupa kode status (misalnya `reason: "ACTIVE"` menjadi "Aktif"). Kini hanya kunci status (`previousStatus`, `nextStatus`, `from`, `to`) yang diterjemahkan, memakai `m.stateText`/`statusText` yang sudah dipakai `Badge`. Label `RESTORED` dihapus karena server tidak pernah menulisnya, sedangkan `CLOSED` (dari `account.close`) sebelumnya tidak berlabel.
- Label tambahan untuk kunci uang yang memang ditulis server: `debitMicro` (Debit akhir), `beforeMicro`/`afterMicro` (Sebelum/Sesudah), `previousReason` (Alasan sebelumnya), `saleRef`. Key React kini kunci mentah, bukan label.
- Halaman audit lanjutan yang kosong menampilkan dua tombol "Halaman awal" (di keadaan kosong dan di navigasi paginasi); test Hermes mengakalinya dengan `locator('.empty')`. Navigasi kini hanya tampil bila ada baris, seperti daftar request, dan test memeriksa tombolnya tinggal satu.
- Indentasi test galat audit dirapikan.

Teks yang dihapus: `auditStatusActive`, `auditStatusSuspended`, `auditStatusRestored`. Teks baru: `auditPreviousReason`, `auditBefore`, `auditAfter`.

Bukti: typecheck web, unit, Playwright 82/82, `verify-all.mjs` 13/13 (enam skrip server nyata PASS, audit aksesibilitas 0 temuan) pada `225f681`.

### Tugas delapan Antigravity digabung; kursor request dan satu kali cek key

- Cabang Antigravity (`d01b67e`..`af89484`) digabung tanpa konflik: `bench-gateway.ts --tenants N` dengan rincian query per request, `admin-requests-local-verify.mjs` (Rekonsiliasi, tab Request, audit; request `UNRESOLVED` dari proses gateway yang benar-benar dimatikan lalu `recoverStuck`), dan audit aksesibilitas layar baru (160 kombinasi, 0 temuan). Bagian D menunggu banner Hermes; kini menjadi Tugas sembilan A.
- Temuan Antigravity yang benar (bug Claude): kedua daftar request memakai kursor `createdAt` ISO milidetik, sehingga baris yang berbagi milidetik atau timestamp dengan baris terakhir halaman terlewat. Kini kursor berisi waktu mikrodetik UTC `~` ID request dan dibandingkan sebagai `(created_at, id)` sesuai urutan indeks yang ada (`server/src/paging.ts`). Kursor lama tanpa ID tetap diterima. Test baru di `control.test.ts` menaruh lima request pada dua instan dalam satu milidetik; test itu gagal pada kode lama dan lulus pada kode baru. Skrip Antigravity masih memakai `delay(2)` untuk menghindari bug ini; Tugas sembilan B menghapusnya.
- Benchmark menunjukkan 29 query per request non-stream (30 stream), termasuk `api_key join tenant` empat kali. Satu sudah dipangkas: `handle` kini memakai tenant dari pemeriksaan key di `guarded` (transaksi hold tetap memeriksa key di bawah lock).
- NFR-002 (target PROPOSED p95 overhead di bawah 50 ms pada beban pilot dengan banyak tenant), diukur di laptop WSL dengan semua komponen di satu mesin: c=1 p95 31 ms (non-stream) dan 20 ms (stream); c=10 di 10 tenant p95 42 ms dan 52 ms; c=50 di 50 tenant p95 241 ms dan 190 ms. Keputusan Claude: belum mengoptimasi jalur uang sekarang. Pemangkasan query berikutnya (pra-baca harga dan saldo yang dibaca ulang di transaksi, `system_setting` tiga kali, `insert into attempt` terpisah) dikerjakan Claude sesudah angka pool produksi (`max = 20`) dari Tugas sembilan C tersedia, lalu diukur ulang. Pengukuran pada hardware pilot (VPS) butuh izin founder karena memakai mesin produksi.
- Suite server 145/145 sesudah perubahan.

### Terpasang `zrouter:r11192221`

Isi: Hermes Tahap delapan, Antigravity Tugas delapan, kursor request mikrodetik, satu kali cek key. Backup sebelum pemasangan `zrouter-20261119T152157Z.dump`. Tanpa migrasi baru (14 migrasi; `gateway_paused` = 0), jadi restore drill tidak diulang. Bukti: suite server 145/145, `verify-all.mjs` 14/14 (Playwright 82/82, audit aksesibilitas 0 temuan), `smoke-public.sh` 7/7.

### Tugas sembilan Antigravity digabung; `DATABASE_POOL_MAX`

- Cabang Antigravity (`096cbf2`..`6b595d6`) digabung: banner jeda dan status layanan diperiksa pada server nyata, `/api/me` tidak membocorkan alasan jeda; `delay(2)` dihapus dan kursor diperiksa dengan 6 request bertimestamp sama dan 4 request dalam satu milidetik lewat API dan UI (Rekonsiliasi, tab Request, Pemakaian); kursor lama dicoba lokal dan gagal (36 dari 56 baris); audit aksesibilitas 170 kombinasi, 0 temuan. Claude menjalankan ulang `admin-overview-local-verify` dan `admin-requests-local-verify` di clone yang bersih: PASS.
- Angka pool: pada `c=50/t=50`, pool 20 membuat request menunggu koneksi rata-rata sekitar 110 ms (non-stream) dan 122 ms (stream); pool 80 menghapus antrean itu. Pada `c=10/t=10` pool belum jenuh. Angka satu kali jalan berisik (pool 80 tampak lebih lambat di `c=10`), jadi Tugas sepuluh C mengulang tiga kali.
- `DATABASE_POOL_MAX` (bawaan 20, 1 sampai 90) di `server/src/main.ts`, `deploy/compose.yml`, `deploy/compose.tunnel.yml`, dan `deploy/README.md`. Nilai produksi tetap 20 sampai angka Tugas sepuluh C ada.
- Query per request kini 28 (non-stream) dan 29 (stream).

## 2026-11-21: Tahap sembilan Hermes digabung

Hermes mengerjakan pembaruan `/api/me` saat rute portal berpindah dan saat tab kembali terlihat (data terakhir dipertahankan bila pembacaan ulang gagal; sesi kedaluwarsa tetap dialihkan lewat `useResource`), label untuk semua kunci `summary` audit, test unit pemindai, dan perbaikan test upstream yang sebelumnya menunggu teks yang sudah tampak sebelum submit. Claude memeriksa dan memperbaiki:

- Test pemindai `summary` memakai pola `\{([^{}]*)\}`, sehingga summary yang berisi template literal `${...}` (`route.update`, `pack.update`) tidak terbaca. Kunci tiruan yang ditambahkan ke `route.update` tidak membuat test gagal. Pola kini menerima template literal dan test gagal bila jumlah `summary:` di sebuah berkas tidak sama dengan yang terbaca (summary berbentuk variabel, spread atau fungsi). Hasilnya dicocokkan dengan pemindai terpisah: 28 pemanggilan audit, 38 kunci, semuanya berlabel.
- Nilai boolean di rincian audit tampil `true`/`false`; kini "Ya"/"Tidak" (`m.auditYes`, `m.auditNo`), dengan test e2e.
- Label: `seq` (nomor versi harga yang dipensiunkan) "Urutan harga" menjadi "Versi harga"; `chat`, `anthropic` dan `responses` (base URL per protokol di `upstream.create`) menjadi "Base URL Chat", "Base URL Anthropic", "Base URL Responses".

Teks baru: `auditYes`, `auditNo`. Teks berubah: `auditSequence`, `auditChat`, `auditAnthropic`, `auditResponses`. Banner Hermes Tahap sembilan kini ada di `main`, jadi Antigravity Tugas sepuluh D dapat dikerjakan.

Bukti: suite server 145/145; `verify-all.mjs` 12/14 pada jalan pertama. Dua kegagalan berasal dari lingkungan: `portal.spec.ts` aktivasi dengan "Failed to fetch dynamically imported module" dan `admin-catalog-local-verify` dengan `net::ERR_NETWORK_CHANGED`. Tidak ada event Docker pada jam itu; laptop memakai jaringan WSL mirrored (Wi-Fi, IPv6, Tailscale), yang dapat membuat Chrome membatalkan request ke 127.0.0.1. Jalan ulang: `portal`, `admin-operations`, `service-paused` dan `upstream` 21/21, `admin-catalog-local-verify` PASS. Langkah lain lulus pada jalan pertama: Playwright 82/83, enam skrip server nyata lainnya, audit aksesibilitas 0 temuan.

### Terpasang `zrouter:r11210751`

Isi: Hermes Tahap sembilan, Antigravity Tugas sembilan, `DATABASE_POOL_MAX` (produksi tetap 20 dari bawaan). Backup sebelum pemasangan `zrouter-20261121T005252Z.dump`. Tanpa migrasi baru (14 migrasi; `gateway_paused` = 0), jadi restore drill tidak diulang. Bukti: `smoke-public.sh` 7/7; chunk `main` yang tayang memuat "Versi harga", "Base URL Chat" dan `visibilitychange`.

### Tugas sepuluh Antigravity digabung; pool produksi tetap 20

- Cabang Antigravity (`5a8734e`..`65afe36`) digabung. Log Tugas sepuluh masih di-stage tanpa commit; Claude meng-commit-nya di cabang Antigravity (`65afe36`) agar `git pull --ff-only` berikutnya tidak bentrok. Skrip baru `admin-audit-local-verify.mjs` (rincian audit pada server nyata) dan `admin-requests-local-verify.mjs` (kursor stabil saat request gateway baru masuk di antara halaman) dijalankan ulang oleh Claude di `main` sesudah Tahap sembilan: keduanya PASS. Bagian D dilewati dengan benar karena Tahap sembilan belum ada di `main` saat itu; kini menjadi Tugas sebelas A.
- Sweep pool `c=20/30/50` × pool `20/40/80`, tiga kali per kombinasi: pool lebih besar menghapus tunggu pool (`c=50` non-stream 76 → 12 → 0,1 ms), tetapi median p95 overhead tidak membaik dan pada hampir semua titik lebih buruk (`c=50` non-stream 165 / 191 / 188 ms; stream 154 / 169 / 188 ms). Satu-satunya titik yang membaik adalah stream `c=30`. Keputusan Claude: `DATABASE_POOL_MAX` produksi tetap 20. VPS hanya 2 vCPU dan 3,7 GB RAM, jauh di bawah laptop 12 vCPU tempat sweep dijalankan, jadi pool lebih besar di sana lebih kecil lagi gunanya. Pengungkit NFR-002 berikutnya adalah jumlah query per request (28 non-stream, 29 stream), yang dikerjakan Claude.
- Temuan Antigravity: Playwright penuh 80/82 dan 79/82 dengan timeout 5000 ms sesudah `page.goto` pada test yang berbeda-beda, lulus saat diulang. Claude dan Hermes melihat gejala serupa (`Failed to fetch dynamically imported module`, `net::ERR_NETWORK_CHANGED`). Penyebabnya diselidiki di Tugas sebelas C.

## 2026-11-23: Tugas sebelas Antigravity dan Tahap sepuluh Hermes digabung; query gateway dipangkas

- Antigravity (`ffe4f06`..`0e75467`, merge `7b12dc5`): banner jeda pada server nyata tanpa muat ulang (navigasi, `visibilitychange`, node DOM yang sama, satu kegagalan `/api/me` tidak mengganti halaman); 30 aksi dan 38 kunci `summary` audit dipicu dan diperiksa di server nyata; 12 berkas spec e2e kini berjalan terhadap build (`vite preview`), enam lainnya terhadap Vite dev yang dihangatkan. Diagnosis kegagalan acak: Wi-Fi `eth8` di WSL mirrored melepas dan memasang ulang alamat dan route beberapa kali per menit, dan Chrome membatalkan request yang sedang jalan (termasuk ke 127.0.0.1) dengan `ERR_NETWORK_CHANGED`. Claude mengulang pemeriksaan port loopback tertutup: `curl` ke 127.0.0.1 habis waktu, bukan ditolak, sehingga pemeriksaan URL awal Playwright menggantung sekitar 134 detik. Dengan `CI=1` Playwright kini menunggu baris `Local:` dari Vite. Hasilnya, Playwright di verify-all turun dari sekitar 220 detik menjadi 84 sampai 97 detik.
- Hermes Tahap sepuluh (`950b3b6`): matriks 82 state UX (35 teruji, 36 ada tanpa test, 2 belum, 9 butuh server) di `docs/handoff/hermes-state-matrix.md`; aktivasi dan pemulihan akses mengumumkan "Menunggu jawaban server…" selama request berjalan, dengan test RED lalu GREEN. Sembilan kebutuhan kontrak server masuk antrean Claude (lihat di bawah).
- Verify-all pertama sesudah kedua merge: 14/15, `golden-path-local-verify` gagal dengan `ERR_NETWORK_CHANGED`; dalam 8 menit `ip monitor` merekam 968 baris event `eth8`. Perbaikannya (Chromium di network namespace sendiri) menjadi Antigravity Tugas dua belas A.

### Query gateway: 28 menjadi 17 per request (`d40db59`)

Admission kini satu transaksi tanpa pembacaan pendahuluan. Harga dibaca di dalam transaksi, jadi snapshot yang disimpan sama dengan yang dipakai untuk hold, dan jalur "Price changed, retry" tidak diperlukan lagi. Batas lebih-pakai ikut terbaca bersama kunci akun, dan pembatasan output (overrun) dihitung dari saldo di bawah kunci akun lewat fungsi `amount` pada `placeKeyHold`. Ketiga penulisan hold (hold, akun, key) digabung dalam satu pernyataan CTE. Saklar jeda dibaca bersama pemeriksaan key di luar transaksi; jeda tetap hanya berlaku sesudah key lulus. Settlement menulis key, entri ledger, akun dan hold dalam satu pernyataan, dengan jumlah baris yang wajib persis (gagal tertutup bila tidak). Attempt terakhir masuk ke pembaruan request di transaksi settlement, jadi akhir stream ke pelanggan tidak lagi menunggu insert attempt. Urutan kunci tetap tenant → akun → key, dan semua kode penolakan tetap sama.

Percobaan pertama juga menggabungkan pembacaan key dengan kunci share tenant. Test `admission rechecks close committed after key preflight and before locks` lalu menggantung: penutupan akun menunggu kunci tenant yang dipegang admission yang sedang ditahan gate test. Penggabungan itu dibatalkan (selisih satu query), dan test tetap tidak diubah.

Bench `bench-gateway.ts --pool-max 20`, satu run masing-masing (Antigravity mengulang tiga kali di Tugas dua belas B):

| Ukuran | Sebelum `950b3b6` | Sesudah `d40db59` |
|---|---:|---:|
| Query per request, non-stream / stream | 28 / 29 | 17 / 18 |
| Waktu DB per request c=1, non-stream / stream | 24,4 / 24,4 ms | 13,2 / 15,6 ms |
| Gateway p95 c=50, 50 tenant, non-stream | 191 ms | 186 ms |
| Gateway p95 c=50, 50 tenant, stream (TTFB) | 256 ms | 171 ms |
| Tunggu pool per request c=50, 50 tenant, non-stream / stream | 77,7 / 137,6 ms | 62,1 / 85,7 ms |

Bukti: suite server 145/145 (dua kali); `verify-all.mjs --skip server-test` 15/15 di `d40db59` (Playwright 84 detik, sembilan skrip server nyata termasuk golden path, audit aksesibilitas 0 temuan).

### Status circuit per route untuk admin (`5b9607a`)

Kesehatan route dipindah dari `gateway.ts` ke `server/src/route-health.ts` tanpa perubahan perilaku. Setiap route di API admin kini membawa `circuit: { open, openUntil, reason, failures }`. Pelanggan tidak melihatnya. Test baru: dua kegagalan belum membuka, kegagalan ketiga membuka selama 30 detik, route terbuka dilewati, 401 dari upstream langsung membuka selama lima menit. Mock upstream test mendapat mode `auth401`. Suite server 146/146.

DRIFT: `docs/ARCHITECTURE.md` menyebut 401 dan 402 dari upstream membuka circuit "sampai admin menindak", sedangkan kode membukanya selama lima menit (sudah begitu sebelum perubahan ini). Usul: circuit `upstream_auth` tetap terbuka sampai admin mengganti key atau mengubah status upstream. Belum dikerjakan; menunggu konfirmasi founder karena route bisa tertahan lama oleh satu 401 sesaat.

### Test konkurensi gateway dibuat deterministik

Hermes melihat `gateway-concurrency.test.ts` gagal 144/145 dua kali pada suite penuh, lulus saat diulang sendirian. Penyebabnya: 60 request bersamaan dengan saldo kecil, sehingga semua request fallback kadang ditolak 402 lebih dulu dan tidak ada yang sampai ke route yang menjawab 500. Fallback kini diperiksa dengan satu request berurutan sebelum burst (`upstream_500` lalu `completed`). Request fallback yang dilayani di dalam burst harus berakhir `completed` dengan hanya `upstream_500` sebelumnya. Diulang tiga kali sendirian, lulus.

### Antrean server dari Hermes Tahap sepuluh

Sudah: circuit per route (SCR-016). Belum: uji koneksi tanpa biaya (API-035, SCR-016); model dijeda di katalog (SCR-009); agregat grafik pemakaian terpisah dari daftar (SCR-010); filter transaksi (SCR-011); receipt untuk penyelesaian request yang diulang (SCR-017); cost profile dan kurs (SCR-016, menunggu keputusan founder soal margin guard).

### Terpasang `zrouter:r11231617`

Isi: `0e0ab2b` (pemangkasan query gateway, status circuit route, Hermes Tahap sepuluh, Antigravity Tugas sebelas). Backup sebelum pemasangan `zrouter-20261123T091856Z.dump`. Tanpa migrasi baru (14 migrasi; `gateway_paused` = 0). Bukti: kontainer `healthy`, `smoke-public.sh` 7/7, chunk `main` yang tayang memuat "Menunggu jawaban server". Tidak ada request gateway ke upstream berbayar yang dijalankan untuk pemeriksaan ini.
