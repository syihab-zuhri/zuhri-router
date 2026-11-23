# Catatan Hermes

Tanggal: 2026-11-14. Scope sesuai HERMES_TASK.md: `web/`, `docs/UI_REFERENCES.md` dan berkas ini. Tidak mengedit `server/`, `AGENTS.md`, `HANDOFF.md`, `HERMES_TASK.md`, `CHANGELOG.md`, `TASKS.md`, atau `PROJECT_MANIFEST.md`. Perubahan backend yang dicatat di `claude-log.md` menjadi kontrak yang dipakai UI; tidak ada deployment, request ke upstream, email nyata, atau penambahan dependency.

## Tahap satu, catatan terdahulu

Rekaman tahap satu sebelum bagian ini tetap dipertahankan pada `web/evidence/verification-2026-11-14.md` dan entri sebelumnya. E2E browser 12/12, unit 2/2, local-browser verifier, build, audit dan hermes verify memang pernah dijalankan sebelum Tahap dua. Tahap dua mempunyai bukti terpisah di `web/evidence/stage2-*`.


## Tahap dua, ditulis

1. `web/src/usage.tsx`: layar pemakaian SCR-010 membaca `GET /api/requests` berhalaman, memfilter model/protokol/state pada halaman yang ditampilkan, menampilkan status request, usage bertagih, biaya final/estimasi, dana hold dan permintaan unresolved. Grafik debit harian beserta tabel aksesibel memakai BigInt/mikro-kredit; keterangan menyatakan agregat hanya mencakup halaman yang tampil.
2. `web/src/catalogue.tsx`: SCR-009 memakai `GET /api/models`; menampilkan multiplier bila seragam atau harga per kategori sebagai decimal string; protokol bersumber dari respons.
3. `web/src/guide.tsx`: SCR-012 menjelaskan origin + `/v1`, Chat Completions, Anthropic Messages, Responses stateless, `/v1/models`, placeholder kedua skema header, error/action dan `Retry-After`. Sesuai handoff Claude, Codex CLI 0.165.0, Claude Code 2.1.325 dan OpenCode 2.3.0 dinyatakan pernah diuji oleh proyek (2026-11-14); Hermes dan ZCode belum diuji. Tidak ada instruksi setup tool yang belum dites.
4. `web/src/admin-upstreams.tsx`: SCR-016 form upstream write-only key, ganti URL mensyaratkan key baru, status dengan alasan/version, daftar/edit route dan protokol yang tersedia dari upstream. Rute admin ditambah ke `web/src/app.tsx` dan shell. UI tidak membuat request jaringan ke upstream.
5. `web/src/admin-customers.tsx`: SCR-015 kini memuat daftar pelanggan berhalaman dari `GET /admin/api/customers?limit=&after=&prefix=`, filter awalan di URL, saldo/hold/status/waktu buat, dan tombol detail. Detail pelanggan berisi ringkasan saldo, top-up dengan konfirmasi+step-up yang telah ada, ledger serta panel pemakaian per hari/model/key dan request terbaru dari `GET /admin/api/customers/:username/usage?days=`. Secret/key tidak diambil ulang.
6. `web/src/admin-operations.tsx`: SCR-017 antrean unresolved dan form keputusan memakai username, jumlah hold, nilai debit token (0 melepaskan hold), alasan dan step-up; SCR-018 pengaturan overdraft token integer dengan konfirmasi/step-up dan audit ber-cursor. Rute/navigasi masing-masing dipasang di bawah `/admin/`.
7. `web/src/messages.ts`, `web/src/ui.tsx`, `web/src/styles.css`: copy/status Bahasa Indonesia dan grafik daily. Tidak menambah dependency. `web/scripts/local-browser-verify.mjs` menjalankan daftar/pencarian prefix dan detail pilihan pelanggan, lalu pemakaian agregat pelanggan lewat DB lokal.
8. `web/scripts/dist-browser-verify.mjs`, `web/package.json` dan `web/README.md`: menambah `npm run test:dist` / `npm run test:browser` dan mendokumentasikan fallback SPA, cache asset hash, rute API yang tak boleh dilayani sebagai HTML, serta CSP server same-origin.
9. `web/test/e2e/admin-customers.spec.ts`, `web/test/e2e/admin-operations.spec.ts`, serta update tests `usage`, `guide`, `upstream(s)` membuktikan interaksi sesuai kontrak dan 360 px di subset terkait.

## Tahap dua, dijalankan

Bukti final disimpan di `web/evidence/stage2-*`:

- `web/evidence/stage2-final-summary.md`: ringkasan run final aktual.
- `npm run typecheck`: exit 0; `npm test`: 2/2 lulus; `CI=1 npx playwright test --reporter=line`: 24/24 lulus.
- `npm run test:local`: `local-browser-verify: PASS`; backend Fastify/PostgreSQL nyata pada schema privat dan flow lokal, tanpa upstream atau email nyata. Data uji/secret di luar repo dan schema dibuang oleh cleanup.
- `npm run test:browser`: `same-origin-dist-verify: PASS`; build dist dilayani langsung oleh Fastify, browser memeriksa flow activation/login, panduan, CSP, fallback route SPA, batas JSON API dan missing asset. Injeksi email hanya in-memory; tidak ada email/upstream nyata.
- `npm audit --json`: 0 kerentanan, 86 paket inventaris.
- `git diff --check`: lulus.
- Suite server tidak dijalankan pada tahap dua, agar tidak berebut `router_test` dengan Claude. Tidak ada perubahan pada `server/`.

## Verifikasi terbaru (2026-11-15)

- `web/evidence/stage3-typecheck.txt`: `npm run typecheck`, exit 0.
- `web/evidence/stage3-unit.txt`: `npm test`, 2/2 lulus.
- `web/evidence/stage3-e2e.txt`: browser E2E, 29/29 lulus.
- `web/evidence/stage3-local.txt`: `npm run test:local`, `local-browser-verify: PASS`.
- `web/evidence/stage3-browser.txt`: `npm run test:browser`, build dan `same-origin-dist-verify: PASS`.
- `web/evidence/stage3-npm-audit.json`: 0 kerentanan, inventory 86 paket.
- `git diff --check`: lulus.

Build berhasil dengan warning dependency `MODULE_LEVEL_DIRECTIVE`; warning tidak menggagalkan build atau test dist.

## Tahap tiga, lanjutan (2026-11-15)

### Ditulis

- `web/src/admin-customers.tsx`: form undangan via `POST /admin/api/invites`; activationLink dari server ditampilkan hanya ketika email tidak terkirim, dengan tombol salin. Ditambahkan aksi suspend/restore dengan dialog alasan dan expectedVersion, serta adjustment saldo signed token diubah menjadi string amountMicro eksak, dialog username/nominal/alasan, dan step-up admin.
- `web/src/auth.tsx`: allowlist returnTo mencakup rute portal/admin yang tersedia, termasuk `akun`, filter query aman, dan halaman aktivasi tanpa token mengarahkan meminta undangan baru.
- `web/src/messages.ts`, `web/src/customer.tsx`: satu kunci kebijakan token dipakai dekat paket di Beranda dan di atas form Isi Saldo.
- `web/src/ui.tsx`, `web/index.html`, `web/favicon.svg`: brand dan judul tab ZRouter; favicon SVG lokal bernuansa navy/gold.
- Test ditambah pada `web/test/e2e/admin.spec.ts` dan `web/test/e2e/portal.spec.ts` untuk undangan, status/koreksi saldo, aktivasi tanpa token, allowlist returnTo, dan dua penayangan kebijakan.

Tidak mengedit berkas `account-*.tsx`, `qr.ts`, `server/`, `docs/CHANGELOG.md`, `docs/TASKS.md`, `docs/PROJECT_MANIFEST.md`, atau dokumen owner lain. Tidak menambah dependency, mengirim email nyata, memanggil upstream, deploy atau mengubah image.

### Dijalankan dan lulus

- `npm run typecheck`: exit 0.
- `npm test`: 5/5 unit lulus.
- `npm run test:e2e -- --reporter=line`: 38/38 lulus.
- `npm run build`: exit 0, dengan warning dependency `MODULE_LEVEL_DIRECTIVE` dari bundler.
- `npm run test:browser`: `same-origin-dist-verify: PASS` atas dist yang disajikan Fastify.
- `npm run test:local`: `local-browser-verify: PASS` menggunakan `router_test` loopback dan schema verifier privat; verifier membersihkan schema sementara saat selesai.
- `git diff --check`: lulus.

Bukti run aktual: `web/evidence/stage3-continuation-{typecheck,unit,e2e,build,browser,local,diffcheck}.txt`; ringkasan: `web/evidence/stage3-continuation-summary.md`.

Build web siap dipasang. Ini hanya hasil build lokal, belum menjadi deployment/image publik; pemasangan tetap melalui proses rilis terpisah.

## Tahap empat (2026-11-16)

### Ditulis

- `web/src/admin-customers.tsx`: detail pelanggan memakai lima tab (`ringkasan`, `saldo`, `pemakaian`, `transaksi`, `API key`), status tab disimpan dalam query string dan pulih setelah reload. Daftar pelanggan mempertahankan aksi pengelolaan/pencabutan key langsung dari baris, dengan konfirmasi, optimistic version, dan step-up sebelum request mutasi.
- `web/src/customer.tsx`: checklist first-use menghitung saldo dan keberadaan key dari respons API, mencatat panduan yang dibaca pada session storage, dan hilang setelah ketiga langkah selesai. Daftar key yang sudah ada, termasuk key dicabut, tetap dianggap memenuhi langkah “buat API key”.
- `web/src/app.tsx`, `web/src/not-found.tsx`: halaman 404 Bahasa Indonesia dengan arah kembali dan pemulihan fokus.
- `web/src/catalogue.tsx`: typography membedakan label model/protokol, ID teknis dan angka finansial; format kredit tidak diubah.
- `web/src/styles.css`: aturan undangan panjang dan kebijakan kredit; `min-width: var(--zero)` pada tablist memperbaiki overflow mobile. Test real CSS sempat mendeteksi scrollWidth 376 px pada viewport 360 px; test regresi yang sama lulus setelah perbaikan.
- `web/test/e2e/` dan `web/scripts/local-browser-verify.mjs`: uji keyboard, URL tab/reload, pencabutan dari baris, state first-use, 404, kontras, wrapping tautan undangan pada 360 px; harness admin memakai CSS dan wrapper `main#main` aplikasi sebenarnya. Local flow menavigasi ke tab Saldo sebelum top-up.
- `docs/UI_REFERENCES.md`: catatan komparatif typography berdasarkan Cloudscape, GOV.UK, Carbon, Google dan USWDS, dengan keputusan proyek per kategori data, tanpa dependency/font baru. Versi dokumen 0.5.0.

Tidak mengedit `server/`, `HERMES_TASK.md`, `docs/CHANGELOG.md`, `docs/TASKS.md`, `docs/PROJECT_MANIFEST.md`, atau berkas `account-*`. Tidak mengubah unit formatter kredit; hasil tetap memakai koma desimal. Tidak ada commit, deploy, request upstream berbayar atau pengiriman email nyata.

### Dijalankan dan lulus

- `npm run typecheck`: lulus.
- `npm test`: 5/5 lulus.
- E2E fokus Tahap empat (`--workers=1`): 9/9 lulus. Full E2E final: 51/54 lulus; tiga kegagalan berulang di `test/e2e/return-to.spec.ts` (expired session/returnTo), terpisah dari scope tahap ini. Run file tersebut sendiri: 8/11. Detail dan test IDs di `web/evidence/stage-four-full-e2e.md` serta `web/test-results/.last-run.json`. Kegagalan tersebut tidak dimatikan atau diubah.
- `npm run test:local`: `local-browser-verify: PASS`; memakai Fastify/PostgreSQL lokal, `router_test` loopback dan schema sementara `web_verify_<uuid>` yang dibersihkan saat exit.
- `npm run test:browser`: build berhasil, `same-origin-dist-verify: PASS`; schema sementara dist juga terisolasi dan dibersihkan. Build menampilkan warning bundler `MODULE_LEVEL_DIRECTIVE` dari dependency React Query/React Router; tidak menggagalkan build atau smoke.
- `hermes verify --json`: exit 0, readiness lokal HTTP 200, build/typecheck/unit lulus.
- `git diff --check`: lulus. Sitasi dokumen lulus pemeriksaan ledger; sumber diverifikasi pada `docs/UI_REFERENCES.md`.

Output aktual disimpan pada `web/evidence/stage-four-{verification.md,full-e2e.md,focused-e2e.log,typecheck.log,unit.log,local.log,dist.log,diffcheck.log,citations.log,hermes-verify.log}`. Keluaran Playwright terbaru berada di `web/test-results/` (folder evidence/test hasil diabaikan Git).

Status: Tahap empat ditulis dan bukti integrasi lokal serta build/dist tersedia. Full browser suite belum seluruhnya lulus karena tiga kegagalan `returnTo` di luar scope; tidak menyatakan rilis/deployment siap.

### Adendum verifikasi asinkron

- Sesudah verifikasi awal, satu test edit meninggalkan `protocolValue` tidak terpakai di `web/test/e2e/catalogue.spec.ts`; `typecheck` menangkap `TS6133` sebelum Playwright berjalan. Selector yang tidak terpakai dihapus, lalu typecheck kembali lulus dan test typography katalog lulus 1/1.
- Sebuah batch grep lima test diakhiri dengan tiga kegagalan: pencabutan key baris, checklist first-use, dan link 404 admin. Rerun terisolasi tiga tersebut lulus 3/3; rerun berurutan atas lima test yang sama lulus 5/5. Typecheck dan `git diff --check` juga lulus pada rerun terakhir. Kegagalan awal tidak disembunyikan; output run terbaru ada di `web/evidence/stage-four-latest-regressions.log`.
- Ada Playwright suite terpisah di worktree `/mnt/d/router.dev.zuhri-antigravity` pada waktu yang sama. Saat suite tersebut berlangsung, tidak menjalankan kill/stop atau klaim sebab pasti atas batch gagal; versi sumber yang berbeda terlihat pada nomor baris. Pengujian terbaru di worktree ini setelah koreksi lulus.
- Test terbaru selain batch: test lima tab/key umum 2/2 lulus; test katalog typography 1/1 lulus. Latest typecheck/diff check lulus. Ini tidak mengubah hasil full-suite 51/54 sebelumnya, dengan tiga `returnTo` failure.
- Notifikasi batch enam test berikutnya melaporkan 4/6, gagal pada checklist dan 404 dengan source line 88/95. Pada file terkini, 404 test ada di line 111; ini menunjukkan output dari snapshot file yang lebih lama. Run terkini pada source tersebut: typecheck lulus, lima test terkait lulus 5/5, dan katalog lulus 1/1 terpisah. Tidak menyamakan atau menghapus hasil run lama; full detail hanya tersedia di notifikasi `proc_8b0125a853b3`.
- Full suite lain melaporkan 42/43; satu gagal pada `portal.spec.ts:5` (`masuk keyboard, CSRF, shell 360px dan fokus navigasi`), tanpa assertion lengkap. Rerun terisolasi di port 5174 lulus 1/1. Ada suite browser worktree Antigravity di port default yang masih aktif saat itu; bukti ini tidak memastikan benturan sebagai sebab. Rincian di `web/evidence/stage-four-portal-isolated.md`; test tidak diubah.
- Laporan asinkron berikutnya menyatakan `npm run test:e2e -- --reporter=line` lulus 43/43. Namun `npx playwright test --list` pada worktree saat ini menghitung 54 test; laporan 43-test tidak mencantumkan path worktree, sehingga tidak menggantikan hasil full suite 54 test di atas (51/54). Status `.last-run.json` terbaru adalah `passed`, tetapi file tersebut tidak menyimpan jumlah kasus.
- `npm run test:local` sempat gagal saat mengisi label `Jumlah kredit token`: verifier menuju detail pelanggan lalu mencari field tanpa memastikan tab Saldo sudah aktif. Ditambah aksi pilih tab sebelum fill dan assertion field terlihat; rerun penuh `test:local` lulus (`local-browser-verify: PASS`), termasuk top-up yang mendapat HTTP 401 untuk memicu step-up lalu POST ulang HTTP 201.
- Konfirmasi async terbaru `proc_929a2323e72d` juga keluar dengan exit 0 dan `local-browser-verify: PASS`; output mencakup redeem/balance/ledger serta step-up publish harga/voucher. Ringkasan: `web/evidence/stage-four-local-latest.md`.
- Konfirmasi async terbaru `proc_83c15a674af7`: `npm run test:browser` exit 0, production build sukses dan `same-origin-dist-verify: PASS`. Warning non-blocking `[MODULE_LEVEL_DIRECTIVE]` dari dependency React Query/React Router. Rincian: `web/evidence/stage-four-dist-latest.md`.

## Tahap lima (2026-11-18)

### Ditulis

- `web/src/app.tsx`: `/admin` kini mengarahkan ke `/admin/ringkasan`.
- `web/src/auth.tsx`: login admin tanpa `returnTo` (termasuk `returnTo` yang ditolak allowlist) mendarat di `/admin/ringkasan`; returnTo valid tetap dipulihkan.
- `web/src/not-found.tsx`, `web/src/messages.ts`: tautan kembali di halaman 404 admin sekarang menuju dan menyebut Ringkasan.
- `web/src/customer.tsx`, `web/src/guide.tsx`: membuka `/panduan` setelah profil pelanggan terkonfirmasi menyimpan status baca ke sessionStorage, dengan kunci per username yang sama seperti checklist; direct navigation kini menandai langkah panduan selesai. Tidak mencatat status sebelum data profil dimuat.
- `web/src/admin-vouchers.tsx`: helper dan label alasan promo dibedakan dari jenis “Promo”; pesan verifikasi pembayaran hanya tampil untuk kode Penjualan.
- `web/src/ui.tsx`, `web/src/messages.ts`, pemanggil receipt: receipt membedakan penukaran baru/replay, top-up, dan koreksi; koreksi negatif tidak lagi dilabeli saldo berhasil ditambah.
- Copy D.2 yang diterapkan mencakup penyebutan kredit token yang konsisten, klarifikasi estimasi/pemakaian, panduan Responses stateless dan pemilihan endpoint, status/uplink terminology, katalog dan kategori harga, bantuan promo, margin guard, preview, saldo replay, koreksi, request unresolved, overdraft, audit, kategori ledger, dan konflik idempotency.
- `web/scripts/local-browser-verify.mjs`: flow admin menguji tujuan login Ringkasan lalu navigasi eksplisit ke Pelanggan; klik detail mengikuti label baru “Buka rincian pelanggan”; assertion replay diselaraskan dengan pesan receipt.
- Test ditambah/diperbarui untuk `/admin`, login default dan returnTo tidak valid, halaman 404 admin, panduan yang dibuka langsung, promo, receipt koreksi, copy katalog/pemakaian, salin-secret, dan teks yang dikoreksi.

### Audit lengkap atas usulan D.2 antigravity-log.md

Diterapkan:

- `m.customerDetails`: “Buka rincian pelanggan” konsisten dengan `m.details` dan copy UX.
- `m.modelPriceLink`/`m.models`: kapitalisasi diselaraskan ke “Harga model”.
- `m.welcome`: menyebut saldo kredit token; `m.refundPolicy` kini menyebut “kredit token”.
- `m.suspended`: usulan memisahkan copy pelanggan/admin diterapkan; shell pelanggan memakai copy pelanggan lama, detail backoffice memakai kunci baru `m.adminSuspended`.
- Usulan status upstream `m.statusPending`/`m.statusEligible`, awalan filter `m.customerHelp`, dan makna `m.unbilledInput` sudah benar di source sebelum Tahap lima; diperiksa dan tidak diubah.
- Receipt memberi heading terpisah untuk penukaran, replay, top-up dan koreksi.
- `m.keySubtitle`, judul/peringatan/tombol buang secret menjelaskan API key dalam bahasa pelanggan.
- `m.limitHelp`, `m.noModels`, `m.modelScopeHelp` diperjelas tanpa mengklaim katalog tidak tersedia; batasannya adalah pemilihan model khusus pada form key.
- `m.noUsage`, `m.chargedUsage`, `m.estimated`, `m.notFinal` memakai pemakaian token dan konteks biaya yang lebih lengkap.
- `m.protocolHelp` menggunakan “Protokol” dan “didukung”. `m.createRoute` dihapus karena tidak memiliki pemanggil; pemanggil test yang masih memakai kunci itu dialihkan ke `m.addRoute`.
- `m.catalogueSubtitle`, `m.pricePerCategory`, `m.guideProtocolNote`, `m.responsesStateless`, `m.untestedToolVersions` diperjelas. Guide membedakan tool yang sudah diuji dari yang belum diuji lewat daftar nama/versi yang ada.
- `m.customerHelp` pada pohon kerja sudah menyebut awalan username, jadi tidak perlu perubahan.
- Kode Penjualan tidak lagi muncul sebagai enum mentah pada helper; label/reason PROMO terpisah dan ringkasan konfirmasi memakai label yang tepat.
- `m.modelHelp`, `m.previewHelp`, `m.receiptCurrent`, copy koreksi dan `kindText` adjustment, `m.unbilledInput`, copy unresolved/overdraft/noAudit, serta `errorText.idempotency_conflict` mengikuti makna aktual.

Usulan tidak diterapkan, dengan alasan:

- Mengubah `am.closeConsequenceBalance` untuk menyebut “kredit token”: berada pada blok `am` milik Antigravity yang dilarang disentuh oleh HERMES_TASK Tahap lima. Perubahan harus diajukan ke pemilik blok.
- Mengubah `am.manualKeyLabel`/`am.copyKey`: sama, blok `am` adalah milik Antigravity; mempertahankan pembedaan API key pelanggan dari kunci authenticator admin sampai pemiliknya mengubah.
- Menambah kunci admin baru untuk `m.suspended` tidak diperlukan setelah pemeriksaan caller: pemakaian lama di detail pelanggan diganti khusus, sedangkan shell pelanggan tetap memakai copy pelanggan yang tepat.
- Menghapus `m.untestedTools` tidak diperlukan: kunci itu tidak ada pada pesan aktif; guide memakai `m.untestedToolVersions` dan konstanta live `Hermes`, `ZCode`.

### Dijalankan dan lulus

- `npm run typecheck`: lulus.
- `npm test`: 5/5 lulus.
- `git diff --check`: lulus.
- `npm run test:e2e -- --workers=1 --reporter=line`: lulus 62/62 pada run terbaru. Run sebelumnya 59/62 memiliki tiga kegagalan assertion/copy usang yang diperbaiki atau diselaraskan: login keyboard kini memeriksa fokus textbox password sesudah Tab; test discard-secret memakai pesan/kunci API key aktif; usage test memeriksa teks pada parent row (charged region hanya ada saat usage tersedia). Tiga failure run lama tidak dianggap hasil final.
- `npm run test:local`: lulus (`local-browser-verify: PASS`) setelah verifier diselaraskan dengan tujuan admin baru, navigasi eksplisit ke daftar pelanggan, label rincian pelanggan, dan teks receipt replay.
- `npm run test:browser`: lulus; build produksi sukses dan `same-origin-dist-verify: PASS`. Warning `[MODULE_LEVEL_DIRECTIVE]` dari dependency React Query/React Router tidak menghentikan build.
- Tidak menjalankan Playwright bersamaan dengan Antigravity: sebelum run penuh terbaru tidak terlihat proses suite Antigravity; saat diminta, proses suite Antigravity yang aktif dihormati dan dist/browser dijalankan setelah ia selesai.

Bukti terbaru: `web/evidence/stage-five-local.log`, `web/evidence/stage-five-dist.log`. Full E2E hasil 62/62 berasal dari proses `proc_4432350dbb4b`; hasil run lama `proc_daa5e716734d` adalah 59/62 dan digantikan setelah memperbaiki assertion stale. Typecheck/unit dijalankan ulang setelah E2E dan lulus.

Status: Tahap lima dikerjakan berurutan dan diverifikasi. Build lokal siap dipasang dari sisi web; belum ada deployment atau perubahan ke server.

## Tahap tujuh (2026-11-18 malam)

### Ditulis

1. `web/src/admin-request-list.tsx`: daftar metadata bersama dipakai rekonsiliasi dan tab Request detail pelanggan. Username pada tab detail tetap dan dikirim untuk setiap cursor; cursor tab memakai `requestBefore`. Isi prompt/respons tidak ditampilkan.
2. `web/src/admin-customers.tsx`: tab Request ditambahkan mengikuti urutan, ARIA/keyboard tab, dan query string `tab=requests` yang sudah dipakai tab detail.
3. `web/src/admin-operations.tsx`: audit menyaring action prefix/custom, username pelaku, tipe target dan ID target. Filter/cursor tetap di URL; paging memakai `nextBefore`. Aksi yang diketahui diterjemahkan; aksi baru tetap menampilkan nama mentah. Pelaku memakai `actorUsername` atau label netral, tidak menggunakan UUID.
4. `web/src/messages.ts`: teks baru yang terlihat: tab “Request”; judul “Request pelanggan” dan keterangan metadata tanpa prompt/respons; label filter username, kelompok/awalan aksi, username pelaku, jenis/ID target; pilihan kelompok pengaturan, kode redeem, pelanggan, API key, request, keamanan admin, undangan, sesi, password, akun, paket, model, harga, ledger, upstream dan route; label 33 aksi audit yang telah ditemukan di `server/src`; fallback “Pelaku tidak diketahui”/“Target tidak tersedia”; empty no-match dan jumlah 50 baris. Tombol Search/Clear filters/First/Next memakai teks bersama yang sudah ada.
5. `web/test/e2e/admin-customers.spec.ts`: enam tab, urutan, keyboard, query, username tetap, cursor dan tampilan 360 px. `admin-operations.spec.ts`: filter, label known/raw-unknown, actor username tanpa UUID, target, paging server, loading, empty, no-match, error/retry serta 360 px.
6. Test penunjang: `admin-requests.spec.ts` kini menunggu query cursor async; fixture audit `return-to.spec.ts` diberi `actorUsername` dan `nextBefore` sesuai kontrak server. `RouteFocus`, `customer-tabs-focus.spec.ts`, teks panduan dan `docs/UI_REFERENCES.md` tidak diubah.
7. Referensi UI yang sudah tercatat di `docs/UI_REFERENCES.md`: UAR-019 untuk tab detail, UAR-024 untuk filter ber-URL dan UAR-025 untuk input pencarian/filter. Adaptasi memakai Field, select, Button dan DataList proyek yang sudah ada; tidak menambah dependency atau custom visual gap.

Tidak mengubah `server/`, `HERMES_TASK.md`, file Antigravity terlarang, atau dokumen lain. Tidak ada commit/deploy, upstream berbayar, email nyata atau dependency baru.

### Dijalankan dan lulus

- Tes tab sebelum implementasi RED karena tab belum ada; sesudahnya SCR-015 test lulus 2/2 dan enam-tab/URL/keyboard 1/1.
- `npm run typecheck`: exit 0; `npm test`: 5/5.
- Riwayat E2E dipisahkan menurut source dan run: `proc_866a735838ab` 69/73 ialah run awal sebelum koreksi cursor async dan fixture audit; `stage-seven-e2e-final.txt` 71/73 memperlihatkan Vite dynamic-import error; `stage-seven-e2e-rerun.txt` 72/73 memperlihatkan Vite dynamic-import error dan pesan sesi admin tak muncul. Tes login admin terkait lulus terisolasi 1/1. Setelahnya, full E2E pada source terkini lulus 73/73, exit 0; bukti per-test dan `EXIT_CODE=0` ada di `web/evidence/stage-seven-e2e-verified.txt`.
- Test audit filter/awalan khusus lulus 5/5 pengulangan serial. Tes Request/customer tabs, audit state/cursor, dan focus dijalankan serial; full E2E final mencakup semua 73 test.
- `npm run typecheck`: exit 0; `npm test`: 5/5; bukti final di `web/evidence/stage-seven-typecheck-final.log` dan `stage-seven-unit-final.log`.
- `npm run test:local`: exit 0, `local-browser-verify: PASS`; `web/evidence/stage-seven-local-final.log`. Ini memakai API lokal untuk flow yang tersedia, tidak mencakup backend request/audit baru.
- `npm run test:browser`: exit 0, build dan `same-origin-dist-verify: PASS`; `web/evidence/stage-seven-browser-final.log`.
- `hermes verify --json`: exit 0, unit 5/5/readiness HTTP 200; `web/evidence/stage-seven-hermes-verify-final.json`. `git diff --check` lulus; `web/evidence/stage-seven-diffcheck-final.log`.
- Perbandingan programatis action literal server: 33 nama, 33 label, tidak ada action yang belum dilokalkan.
- Suite awal 69/73 mengungkap assertion cursor async dan mock Audit yang tidak mengikuti kontrak baru; keduanya diperbaiki. Dua failure lain (direct route dan Vite dynamic import pada suite panjang) lulus saat terisolasi 2/2; full suite final pada source terkini lulus 73/73.
- Tidak menjalankan Playwright bersamaan dengan Antigravity; proses diperiksa dan full suite memakai satu worker.

Build memberi warning dependency bundler `[MODULE_LEVEL_DIRECTIVE]` untuk `use client`, tetapi build/dist PASS. `a11y-audit.mjs` tidak dijalankan karena menulis artifact bersama Antigravity dan meliputi seluruh layar; keyboard, fokus tab, 360 px dan full E2E telah diverifikasi, tetapi belum ada axe audit khusus layar audit. `web/evidence/stage-seven-summary.md` memuat rincian dan batas verifikasi.

## Tahap delapan (2026-11-19)

### Ditulis

1. `web/src/app.tsx` dan `web/src/customer.tsx`: banner menetap untuk `servicePaused=true` pada semua halaman portal pelanggan, tidak dipasang pada backoffice, dan field yang tidak ada/false dianggap berjalan. Beranda menampilkan panel status “Berjalan” atau “Dijeda”.
2. `web/src/admin-operations.tsx`: setiap event audit dengan `summary` berisi rincian `<details>` “Rincian”; label `reason`, `previousStatus`, `nextStatus`, dan `amountMicro` dilokalkan, nilai status umum ditampilkan dalam bahasa admin, nilai `*Micro` diformat sebagai kredit token, kunci tak dikenal tetap mentah, nilai bersarang ditampilkan sebagai JSON yang dipotong, dan summary kosong tidak menampilkan rincian.
3. `web/src/admin-operations.tsx` dan `web/src/admin-request-list.tsx`: halaman audit, daftar request rekonsiliasi dan tab Request pelanggan membedakan halaman lanjutan kosong dari daftar kosong dengan “Tidak ada data lagi” serta tombol “Halaman awal”.
4. `web/src/messages.ts`: teks baru yang terlihat: “Status layanan”, “Berjalan”, “Dijeda”, banner “Layanan sedang dijeda sementara. Request baru ditolak; saldo Anda tidak berubah.”, label rincian “Alasan”, “Status sebelumnya”, “Status berikutnya”, “Aktif”, “Ditangguhkan”, “Dipulihkan”, dan “Tidak ada data lagi”.
5. `web/src/styles.css`: rincian audit diberi susunan responsif, pembungkus teks dan gaya summary yang konsisten dengan kontrol rincian request.
6. Test E2E baru `web/test/e2e/service-paused.spec.ts`; test audit/rincian dan halaman lanjutan kosong ditambahkan ke `admin-operations.spec.ts`, `admin-requests.spec.ts` dan `admin-customers.spec.ts`.

### Dijalankan dan lulus

- RED → GREEN dijalankan per butir. RED layanan-dijeda (`proc_8fe0b1c1db5f`, exit 1) melaporkan dua assertion yang belum tersedia: banner layanan dan panel status Beranda. Percobaan typecheck pertama sesudah implementasi (`proc_eba1bdcdaed2`, exit 1) menemukan `TS2322` pada `servicePaused` (`unknown` bukan `ReactNode`); ekspresi dipersempit menjadi boolean. Percobaan `proc_958036088f6e` (exit 254) dijalankan dari root repo, bukan `web/`, sehingga `npm` tidak menemukan `package.json`; ini kesalahan direktori, bukan hasil test. Percobaan fokus berikutnya (`proc_05c602df003a`, exit 1) lulus typecheck dan test status 1/1, tetapi banner test gagal saat membuka halaman katalog karena mock API navigasi belum menyediakan respons `/api/models` (React mencatat error di `CataloguePage`). Percobaan berikutnya (`proc_c7b929c42e77`, exit 1) masih gagal di halaman Transaksi: mock `/api/ledger` belum ditambahkan, React melaporkan error pada `<Entries>` dan banner tidak ditemukan. Ditambahkan mock untuk models, requests, sessions, dan ledger; pengulangan fokus `proc_d24519b537b3` berakhir exit 0: typecheck lulus dan test layanan-dijeda lulus 2/2. Test rincian audit (`proc_c3bc28705bfb`, exit 1) awalnya gagal karena test memakai `getByRole('group')` dan locator tidak menemukan elemen; itu bukan bukti valid bahwa fitur rincian belum ada. Test diperbaiki memakai locator elemen semantik `details`; `proc_56dbe759d2dc` mengonfirmasi `npm run typecheck` lulus dan test rincian audit lulus 1/1. Karena RED pertama tidak memverifikasi perilaku fitur dengan locator yang benar, RED→GREEN untuk rincian audit tidak diklaim sebagai terbukti test-first. Tiga test halaman lanjutan kosong (`proc_314f5fd81e76`, exit 1) gagal sebelum implementasi, tetapi bukan RED yang sah: `m.noMoreData` belum didefinisikan saat test dibuat, sehingga locator heading tidak memiliki nama yang diharapkan (output rekonsiliasi menunjukkan strict-mode, dua heading). Setelah kunci teks ditambahkan dan perilaku dibuat, rerun `proc_292032ef2d5d` lulus 3/3. Maka RED→GREEN untuk butir 3 tidak diklaim sebagai terbukti test-first. Assertion yang awalnya merujuk role/locator/teks yang belum tersedia diselaraskan terhadap semantik DOM dan state baru, lalu diulang sampai lulus.
- `npm run typecheck`: exit 0.
- `npm test`: 6/6 unit lulus.
- `npm run test:e2e`: run awal 80/82 menemukan dua assertion audit yang masih mengharapkan state no-match pada cursor kosong; test diselaraskan ke state “Tidak ada data lagi”. Rerun serial pada source akhir: 82/82 lulus, exit 0 (`web/evidence/stage-eight-web-e2e-rerun.log`).
- `npm run test:local`: exit 0, `local-browser-verify: PASS` (`web/evidence/stage-eight-web-local.log`).
- `npm run test:browser`: exit 0; production build selesai dan `same-origin-dist-verify: PASS` (`web/evidence/stage-eight-web-browser.log`). Bundler memberi warning `[MODULE_LEVEL_DIRECTIVE]` dari dependency React Query/React Router, tidak memengaruhi build atau verifikasi.
- `hermes verify --json` dijalankan beberapa kali: run awal `proc_087737200847` exit 0, server typecheck dan 145/145 test lulus, `/readyz` HTTP 200. Run berikutnya `proc_ee7417791941` gagal pada test konkurensi gateway (144/145); rerun terakhir `proc_372d12783c43` exit 0 dengan 145/145 test dan `/readyz` HTTP 200 (`web/evidence/stage-eight-hermes-verify-rerun.log`). Ini verifikasi manifest server, terpisah dari suite web.
- `git diff --check`: exit 0. Tidak ada proses Playwright/Antigravity aktif saat pemeriksaan sebelum suite penuh; suite Playwright dijalankan serial.

Status: seluruh butir Tahap delapan dan rangkaian verifikasi yang diminta lulus. Build web siap dipasang; belum ada deployment/image, perubahan server, commit atau push.

## Tahap sembilan (2026-11-19)

### Ditulis

1. `web/src/app.tsx`: shell portal memperbarui `/api/me` pada perubahan path dan saat tab kembali terlihat; tanpa indikator muat ulang tambahan. Data profil/banner yang terakhir berhasil dibaca tetap dipakai saat refetch gagal; halaman galat shell hanya menggantikan layar bila belum ada data.
2. `web/src/admin-operations.tsx`: semua 35 kunci summary audit yang tertulis pada `server/src` kini memiliki label admin. Status tetap diterjemahkan hanya pada kunci status dan kunci tak dikenal tetap ditampilkan mentah.
3. `web/test/e2e/service-paused.spec.ts`: regresi untuk refetch status saat navigasi dan `visibilitychange`, mempertahankan identitas elemen banner, menyimpan status terakhir saat jaringan gagal, serta perubahan kembali ke status berjalan.
4. `web/test/unit/audit-actions.test.ts`: pemindaian source server memeriksa sekurangnya 35 nama kunci summary dan memastikan setiap kunci ada pada peta label rincian audit, termasuk ringkasan bercabang.
5. `web/test/e2e/admin-operations.spec.ts`: assertion `method` diperbarui agar memakai label baru.
6. `web/test/e2e/upstream.spec.ts`: penantian test menunggu request POST yang sebenarnya sebelum menguji hasil; sebelumnya test menggunakan teks “Tersimpan di” yang sudah tampak sebelum submit.
7. `web/src/messages.ts` menambah label yang terlihat: “ID entri”, “ID tenant”, “Versi”, “Versi sebelumnya”, “Metode”, “Nama”, “ID model”, “Upstream”, “Prioritas”, “Harga tampilan (Rp)”, “Dari”, “Ke”, “Promo”, “API key diganti”, “Terikat ke penerima”, “Responses”, “Urutan harga”, “Jumlah kredit token”, “Model upstream”, “Anthropic”, “Chat”, “Pengali”, dan “Base URL berubah”. Kunci `email` dan `username` memakai label bersama yang sudah ada; `kind` dan `protocol` memakai label bersama masing-masing.

Tidak mengubah berkas Antigravity atau `server/`. Tidak ada dependency baru, commit, deploy, permintaan upstream berbayar, atau email nyata.

### Dijalankan dan hasil

- Butir 1 RED: test baru gagal dengan assertion jumlah panggilan `/api/me` tidak bertambah setelah `visibilitychange` (`Expected > 2, Received 2`). GREEN sesudah listener `visibilitychange` dan refetch saat perubahan path: test fokus `service-paused.spec.ts` lulus 1/1. Test ini juga memeriksa status berubah, banner dipertahankan pada galat jaringan dan objek banner yang sama tetap terpasang.
- Butir 2 RED: test guard baru gagal dan melaporkan kunci summary tanpa label; sesudah label ditambahkan test lulus. Test guard memindai object summary dan cabang ternary di `server/src`, memverifikasi sedikitnya 35 kunci terhadap peta label di `admin-operations.tsx`.
- `npm run typecheck`: lulus.
- `npm test`: 7/7 lulus.
- `hermes verify --json --timeout 600 --ready-timeout 60`: exit 0; build dan typecheck lulus, unit 7/7, Vite readiness HTTP 200. Build mengeluarkan warning non-blocking `[MODULE_LEVEL_DIRECTIVE]` dari dependency React Query/React Router.
- `npm run test:local`: exit 0, `local-browser-verify: PASS`.
- `npm run test:browser`: exit 0; build sukses dan `same-origin-dist-verify: PASS`. Ada warning bundler dependency `[MODULE_LEVEL_DIRECTIVE]`.
- `git diff --check`: lulus.
- E2E penuh dijalankan serial, tidak bersamaan dengan Antigravity. Run awal `proc_e40fe54deaaf` berakhir exit 1: 77/83 lulus, 6 gagal (`admin-operations` label `method`, `catalogue`, `portal` kebijakan token, `return-to` direct routes, `upstreams` daftar model, `usage` heading); run itu terjadi sebelum assertion label admin diselaraskan dengan teks baru dan sebelum beberapa failure diisolasi. Run antara `proc_6425732b0f2b` berakhir exit 1: 82/83 lulus, satu gagal pada navigasi `/admin` di `admin-overview.spec.ts`; error context menunjukkan `ERR_NETWORK_CHANGED`, lalu tes yang sama lulus ketika diisolasi 1/1. Run `proc_8feff38dd2e2` juga berakhir exit 1: 82/83 lulus, satu gagal pada test query tunggal portal di `return-to.spec.ts`; test tersebut lulus 1/1 saat diisolasi. Batch selektif enam spec `proc_0824ed2c171d` dihentikan oleh `process.kill` (SIGTERM, exit -15) sebelum menghasilkan hasil test; bukan run gagal assertion dan tidak dihitung sebagai verifikasi. Sesudah perubahan test upstream untuk menunggu POST sebenarnya, run final `CI=1 npm run test:e2e -- --workers=1 --reporter=line` berakhir exit 0: 83/83 lulus, bukti proses `proc_fc13fbeaf8f9` (3,7 menit). Run antara `proc_8af238a5dfbf` berakhir exit 1: 80/83 lulus, gagal dua test `return-to.spec.ts` dan test upstream yang memeriksa `writes` sebelum request selesai. Run `proc_dd056973ed7c` 81/83 (gagal fokus Shell di `admin-requests.spec.ts` dan direct-route `return-to.spec.ts`; masing-masing lulus saat diisolasi), serta run 80/83 dan 82/83 lainnya. Beberapa run sempat mencatat error `Failed to fetch dynamically imported module: http://127.0.0.1:5173/src/main.tsx`; failure yang tersisa lulus saat diuji ulang/diisolasi.
- Verifikasi serial terisolasi juga lulus: `return-to.spec.ts` 12/12; `portal.spec.ts` 8/8; `admin-operations.spec.ts` 8/8; `admin-overview.spec.ts` dan `portal.spec.ts` 17/17; `upstream.spec.ts` 2/2. Test fokus login dan direct returnTo yang sempat gagal pada run panjang masing-masing lulus ketika dijalankan tersendiri.
- `web/test/e2e/upstream.spec.ts` diselaraskan untuk menunggu request POST yang sebenarnya sebelum mengecek hasil simpan, bukan teks key tersimpan yang memang tampak sebelum submit. `CI=1 npx playwright test test/e2e/upstream.spec.ts --workers=1 --reporter=line`: 2/2 lulus.
- Test regresi Tahap sembilan: `service-paused.spec.ts` fokus 1/1 lulus setelah perubahan; seluruh E2E final 83/83 juga mencakup tiga test terkait status layanan.

Status: semua acceptance Tahap sembilan diverifikasi lulus: typecheck, unit 7/7, E2E 83/83, `test:local` PASS, `test:browser` PASS, build/readiness `hermes verify` PASS. Tidak ada perubahan server, dependency, commit, deployment atau akses upstream.

## Tahap sepuluh (2026-11-21)

### Ditulis

- `docs/handoff/hermes-state-matrix.md`: 82 state pada 15 layar SCR-004–018, satu baris per state kerangka. Disimpan terpisah sesudah setiap layar, lalu diaudit terhadap source, e2e dan skrip integrasi. Validasi Python mencocokkan identitas/urutan seluruh state dengan `git show HEAD:docs/handoff/hermes-state-matrix.md`: 82/82 sama, empat kolom, nol sel kosong, 38 berkas referensi ada. Rekap: 35 teruji, 36 ada tanpa test, 2 belum, 9 butuh server. `Teruji` pada inventaris menyatakan ada assertion teks/role khusus, bukan klaim semua skrip integrasi dijalankan ulang.
- Dua state dilengkapi (di bawah batas delapan): submitting aktivasi SCR-005 dan submitting pemulihan akses SCR-006. `web/src/auth.tsx` menampilkan `Alert`/role status memakai `m.saving` di `TokenPage` dan `RequestResetPage`; hasil sukses tetap menunggu jawaban server. Tidak menambah endpoint, dependency, CSS, atau kontrak mock.
- `web/test/e2e/portal-state-matrix.spec.ts`: dua test dengan respons HTTP ditahan oleh gate; memeriksa teks status, aria-busy, belum ada sukses, hasil sesudah gate dilepas, keyboard Enter dan reflow 360 px.
- Pola tetap UAR-010 Alert, UAR-011 Button, UAR-034 aktivasi dan UAR-014 password (PATTERN_ADAPTATION); tidak ada komponen referensi baru. Teks yang kini terlihat pada tiga form: `Menunggu jawaban server…` (`m.saving`, pesan yang sudah ada). Tidak ada teks baru/berubah pada `messages.ts`.
- Source yang diverifikasi tetap base `48a60a3` + perubahan lokal. SHA-256: `auth.tsx` = `ab789be76789dc8ec74b487cf3d621ce460b313e05fc79f493f3f56cf37d1ffb`; test baru = `95947c032ecdcce8557e9498d188809313151385954cbceeecfe2b93fbaf3f1c`. Graph coverage best-effort tidak mencatat gap pada berkas yang dipakai; pembacaan source langsung tetap menjadi bukti.

### Dijalankan — TDD dan verifikasi

Semua perintah dari `web/` kecuali validator Python. Log berada di `/tmp/router-hermes-stage10/`; run terpisah tidak digabung menjadi satu hasil. Browser memakai `WEB_PORT=5197`, satu worker. Sebelum setiap run dilakukan pemeriksaan pemilik proses; proses Antigravity tidak dihentikan.

- Baseline `npm run typecheck`: exit 0 (`baseline-typecheck.log`). Baseline `npm test`: 7/7, exit 0 (`baseline-unit.log`).
- Aktivasi RED: `npm run test:e2e -- test/e2e/portal-state-matrix.spec.ts --grep 'aktivasi mengumumkan submitting' --workers=1`; PID 117494, sesi `proc_84adf4efca79`, exit 1, 0/1 lulus. Alasan valid: role status `Menunggu jawaban server…` belum ada (`activation-red.log`). Sesudah itu baru alert aktivasi diterapkan.
- Aktivasi GREEN percobaan pertama: PID 120950, sesi `proc_da668ead5a27`, guard exit 1 karena Antigravity PID 119527 aktif; nol test dimulai. Percobaan kedua PID 122503: perintah sama, 1/1 lulus, exit 0 (`activation-green-2.log`).
- Reset RED percobaan pertama: PID 124381, guard exit 1 karena Antigravity PID 123164 aktif; nol test. RED kedua: `npm run test:e2e -- test/e2e/portal-state-matrix.spec.ts --grep 'pemulihan akses mengumumkan submitting' --workers=1`; PID 126461, sesi `proc_f8a9320a1e66`, exit 1, 0/1 lulus. Alasan valid: role status submitting belum ada (`reset-red-2.log`). Alert permintaan dan penyelesaian reset baru diterapkan sesudah RED ini.
- Reset GREEN: perintah sama, PID 129446, sesi `proc_04e41894025c`, 1/1 lulus, exit 0 (`reset-green.log`).
- `npm run typecheck`: PID 130881 dan pengulangan PID 179862, keduanya exit 0 (`final-typecheck.log`, `final-typecheck-2.log`). `npm test`: PID 131662, 7/7, exit 0 (`final-unit.log`). `npm run build`: PID 131726, exit 0 (`final-build.log`); peringatan bundler `use client` pada dependency tetap ada, tidak dianggap error.
- Suite penuh standar `npm run test:e2e -- --workers=1`, PID 131201, sesi `proc_c3eba68edf47`: 84/85, exit 1 (`final-e2e.log`). `upstream.spec.ts` gagal pada heading karena halaman tidak terimpor; Vite mencatat `Failed to fetch dynamically imported module: .../src/main.tsx`. Pengulangan hanya `upstream.spec.ts`, PID 139894, sesi `proc_858f621399ab`: 2/2, exit 0 (`upstream-isolated.log`), tanpa perubahan source upstream.
- Suite standar kedua, PID 142062, sesi `proc_fa5faac14b1a`: 84/85, exit 1 (`final-e2e-2.log`); kegagalan berpindah ke test ringkasan memuat/gagal/nol dengan error impor modul yang sama. Pengulangan test itu saja, PID 151046, sesi `proc_315e1d544130`: 1/1, exit 0 (`overview-isolated.log`).
- Suite standar ketiga, PID 153639, sesi `proc_b6d18c96dc88`: 83/85, exit 1 (`final-e2e-3.log`); test `membuka langsung tiap rute portal dan admin saat sesi berakhir memulihkan returnTo rute asal` dan `loading, gagal dan kosong transaksi; reflow 360,768,1280 dan reduced motion` masing-masing gagal bersama error impor `main.tsx`. Tidak ada test/source diubah untuk menutupi kegagalan.
- Percobaan isolasi tanpa proxy PID 161480, sesi `proc_44d1daf0334c`, ditahan guard (false-positive shell build repo lain, bukan test gagal). Guard kemudian diperketat ke proses Node/Chrome pada cwd Router, bukan kecocokan teks wrapper shell. Percobaan kedua PID 162010, sesi `proc_c60e99726de0`: dua test tersebut lulus 2/2, exit 0 (`isolated-no-proxy-2.log`). Konfigurasi sementara hanya menambah Chrome `--no-proxy-server`, bukan retry/menghapus cache/menonaktifkan test.
- Percobaan suite penuh tanpa proxy PID 169369, sesi `proc_7413ddb7df27`, ditahan guard karena Antigravity sedang mengukur suite; nol test. Pengulangan menunggu semua proses suite Router lain selesai dan 10 detik tenang: wrapper PID 178043, sesi `proc_03b9674643c4`, child npm PID 180790; `WEB_PORT=5197 npm run test:e2e -- --config=.hermes-stage10-playwright.config.ts --workers=1` lulus 85/85, exit 0, skipped/flaky/unexpected 0 (`final-no-proxy-2.log`, `no-proxy-results.json`). Ini bukti suite final pada source final, bukan bukti penyebab jaringan/proxy sudah dipastikan.
- Readiness PostgreSQL test loopback: `select 1` lulus. `VERIFY_API_PORT=55517 VERIFY_WEB_PORT=5197 npm run test:local`, PID 188054, sesi `proc_7383d9b33d46`: `local-browser-verify: PASS`, exit 0 (`local-browser.log`). Skrip asli membuat schema privat acak, mailer sintetis, Fastify/PostgreSQL nyata; aktivasi, key sekali tampil/cabut, top-up step-up, paket/harga/kode, redeem replay dan ledger diuji. Respons 401 pada log merupakan tantangan step-up yang diharapkan, bukan disembunyikan.
- `VERIFY_DIST_PORT=55518 npm run test:browser`, PID 188778, sesi `proc_da97fb89aab6`: build exit 0 dan `same-origin-dist-verify: PASS`, keseluruhan exit 0 (`dist-browser.log`). Artefak build dilayani Fastify lokal dengan CSP; aktivasi, login, panduan, reflow dan pemisahan route API/static diverifikasi.
- Menanggapi arahan verifikasi workspace: `hermes verify --json`, wrapper PID 202370/sesi `proc_a7a10bf74c30`, child PID 208515, recipe `.hermes/environment.json`, hasil JSON `/tmp/router-hermes-stage10/hermes-verify.json`: `ok:true`; `npm --prefix server run typecheck` exit 0 (1.452 dtk); `npm --prefix server run test` 145/145 (161.109 dtk), exit 0; readiness server nyata `GET http://127.0.0.1:55480/readyz` HTTP 200 (7.066 dtk); runner melakukan teardown. Database target lokal telah diperiksa sebagai loopback `127.0.0.1:55432/router_test`; tidak ada target DB remote. Recipe tersebut hanya memverifikasi server; e2e UI 85/85 dan browser smoke di atas dijalankan terpisah.
- Pemeriksaan akhir sesudah recipe: port 55480 sudah tertutup, working tree tidak memiliki perubahan tambahan pada recipe atau output buatan. `git diff --check` exit 0; validator matriks kembali mengonfirmasi 82 state.

### Verifikasi ulang dan kelanjutan sesudah interupsi (2026-11-23)

Hasil awal di atas tetap bukti run tersendiri, bukan status terbaru seluruh suite server. Pengulangan sebelum interupsi menghasilkan:

- Preflight pertama salah memakai impor `./test/helpers.ts` dari root dan gagal `ERR_MODULE_NOT_FOUND`; setelah cwd diarahkan ke `server/`, target loopback `55432/router_test` terkonfirmasi. Ini galat perintah pemeriksaan, bukan RED test aplikasi.
- `hermes verify --json`, PID 221930, sesi `proc_6db6d1a16316`, exit 1: typecheck exit 0; server test 144/145, fail 1, tidak timeout. Kegagalan di `server/test/gateway-concurrency.test.ts:114`, assertion fallback `upstream_500`. Run ini tidak membuktikan readiness/teardown lulus. Path output saat itu `/tmp/router-hermes-stage10/hermes-verify-fresh.json`.
- Isolasi `node --test --test-concurrency=1 --test-timeout=30000 --test-name-pattern='gateway keeps ledger' test/gateway-concurrency.test.ts`, cwd `server/`, PID 228821: 1/1, exit 0 (`concurrency-isolated.json`).
- Pengulangan recipe PID 229234, sesi `proc_2e97996e43b5`, exit 1: typecheck exit 0; server 144/145, fail 1 pada test concurrency yang sama (`hermes-verify-fresh-2.json`). Lima pengulangan serial test terisolasi sesudahnya masing-masing 1/1 dan exit 0 (`concurrency-repeat-1.log` sampai `concurrency-repeat-5.log`). Hasil isolasi tidak menutup kegagalan suite penuh.
- Recipe ketiga PID 241561, sesi `proc_f8f6e7933ebd`, exit 1. Pembacaan `hermes-verify-fresh-3.json` timeout lalu sesi terputus; jumlah test dan assertion run ketiga tidak terverifikasi dan tidak diasumsikan sama dengan dua run sebelumnya.
- Koreksi diagnosis: pernyataan di percakapan bahwa test memakai label attempt lama adalah keliru. `server/src/gateway.ts:238` masih menulis `'upstream_' + up.status`, sehingga HTTP 500 tetap menjadi `upstream_500`, cocok dengan assertion baris 244–245. Penyebab tidak tercapainya assertion pada suite penuh belum dibuktikan. Tidak ada perubahan server atau pelonggaran assertion.
- Saat dilanjutkan, seluruh file `/tmp/router-hermes-stage10/` yang diperiksa sudah tidak tersedia. Hasil historis di atas berasal dari keluaran tool yang sudah diterima pada percakapan, bukan pembacaan ulang log atau file hasil yang dibuat-buat.
- HEAD saat kelanjutan menjadi `950b3b6` dan awal pemeriksaan sempat `7b12dc5`; commit tersebut muncul dari proses lain, bukan perintah commit Hermes. Source `auth.tsx` dan test baru masih memiliki SHA-256 yang sama dengan bukti Tahap sepuluh. Working tree bersih sebelum tambahan laporan ini. Matriks diverifikasi ulang: 82 state, 15 layar, 35 teruji, 36 ada tanpa test, 2 belum, 9 butuh server; urutan/identitas sama dengan kerangka `48a60a3` dan nol sel kosong.
- Claude sedang menjalankan `node scripts/verify-all.mjs --skip server-test` pada workspace yang sama (parent PID 7015, Playwright PID 7399 saat diperiksa). Tidak ada suite browser/DB baru dijalankan oleh Hermes selama proses itu; hasil proses Claude tidak diklaim sebagai hasil Hermes.

### Lulus — bukti run awal, dengan batas verifikasi ulang di atas

- Inventaris 82/82 state tanpa sel kosong, identitas dan urutan kerangka tetap.
- Dua siklus RED–GREEN; suite UI tanpa proxy 85/85, unit 7/7, typecheck dan build exit 0 pada run yang dicatat.
- Recipe server awal `hermes verify --json` lulus 145/145 dan readiness 200; dua pengulangan berikutnya gagal 144/145. Karena itu suite server belum dinyatakan stabil/lulus terbaru.
- Integrasi browser Fastify/PostgreSQL nyata `test:local` PASS dan build same-origin `test:browser` PASS. Keyboard Enter dan reflow 360 px ada pada test baru; suite lama memeriksa axe/reduced-motion. Tidak mengklaim audit visual baru menyeluruh untuk 82 state.

### Belum / batas bukti

- Tidak menjalankan ulang semua skrip integrasi milik Antigravity; tidak mengklaim seluruh state matriks telah diuji otomatis. Dua state data-usang tetap belum lengkap. Sembilan state tergantung kontrak executable dicatat pada Permintaan ke Claude.
- Tidak ada perubahan `server/`, berkas milik Antigravity, dependency/lockfile, commit atau deployment. Konfigurasi Playwright tanpa proxy dipindah keluar repo ke `/tmp/router-hermes-stage10/playwright-no-proxy.config.ts` setelah verifikasi.

## Permintaan ke Claude

### Tahap sepuluh — kontrak yang belum cukup untuk state UX

Ini permintaan kebutuhan, bukan kontrak baru yang sudah disetujui; tidak ada endpoint/field mock karangan yang diterapkan.

- Verifikasi server: periksa `server/test/gateway-concurrency.test.ts:114–245`. Recipe penuh `hermes verify --json` dua kali terkonfirmasi 144/145 pada assertion minimal satu attempt `upstream_500`; test terisolasi lulus 1/1 dan lima pengulangan serial masing-masing lulus. Label server masih cocok; penyebab belum terkonfirmasi. Hermes tidak mengubah scope server atau melonggarkan assertion. Run ketiga hanya terkonfirmasi exit 1, rincian tidak sempat terbaca sebelum interupsi.

- SCR-009 model-dijeda: `/api/models` (`pricing.catalogue`) hanya mengembalikan model yang mempunyai route aktif dan upstream eligible. Dibutuhkan cara resmi mengidentifikasi model yang dijeda, status dan alasan aman untuk pelanggan, serta aturan apakah model itu tetap dikirim dalam katalog.
- SCR-010 error grafik parsial: saat ini grafik dihitung dari daftar `/api/requests` yang sama. Dibutuhkan kontrak agregat periode dan failure boundary terpisah agar grafik gagal tidak mematikan daftar, atau keputusan revisi scope UX bila ringkasan per halaman tetap dipakai.
- SCR-011 tanpa-hasil-filter: `/api/ledger` hanya menerima cursor `before` dan `limit`. Dibutuhkan parameter filter yang disetujui (jenis/periode), semantic zona waktu dan rentang, serta cursor yang tetap sesuai filter.
- SCR-016 menguji dan hasil uji: API-035 menyebut uji koneksi tetapi implementasi belum menyediakan operasi itu. Dibutuhkan capability pengujian tanpa biaya per upstream/protokol dan hasil resmi sukses/gagal/tidak tersedia; pengambilan daftar model tidak dianggap bukti koneksi inference.
- SCR-016 cost-usang dan kurs-usang: dibutuhkan profil biaya dan currency, waktu acuan (`as-of`), versi, aturan kedaluwarsa dan kurs/arah konversi dari server; tidak membuat hitungan uang/kurs baru di browser.
- SCR-016 circuit-terbuka: dibutuhkan status breaker per route, waktu berubah/batas coba kembali dan alasan aman; payload route saat ini tidak memuatnya.
- SCR-017 replay penyelesaian: `resolveRequest` kini mengembalikan 409 `not_unresolved` untuk pengulangan, bukan receipt replay. Dibutuhkan semantic replay/hasil keputusan sebelumnya (ID request, debit final, waktu, penanda sudah diputuskan dan aturan konflik) sebelum UI boleh mengklaim pengulangan berhasil.

Catatan permintaan terdahulu: Tidak ada kebutuhan kontrak server baru untuk tahap sembilan. Untuk tahap dua: bila diinginkan integrasi backend browser SCR-017/018, siapkan seed request unresolved dengan hold konsisten di schema privat dan step-up test yang sesuai. Jangan memakai atau menghentikan container bersama `router-spike-pg`. Tahap tiga lanjutan belum dipasang ke layanan publik.

## 2026-11-23 — Tahap sebelas

### Ditulis

Base `main`/`34cef52`, working tree bersih sebelum pekerjaan. Membaca HERMES_TASK.md Tahap sebelas dan claude-log.md bagian 2026-11-23; kontrak executable tetap acuan. Tidak mengubah `server/`, berkas akun/ringkasan/skrip Antigravity, blok `am`/`ov`, dependency atau lockfile. Pada `web/playwright.config.ts` hanya menghapus entri `'**/guide.spec.ts'` sesuai izin.

1. `web/test/e2e/portal-state-matrix.spec.ts`: sepuluh test state yang sebelumnya ada tanpa test, seluruhnya memeriksa teks/role terlihat, bukan sekadar membuka halaman:
   - SCR-004: submitting (`m.saving` dan aria-busy), pembatasan dengan Retry-After 120 detik, server-error tanpa navigasi sukses.
   - SCR-005: username sudah dipakai (alert username_taken; isian tetap dan tidak ada pesan berhasil).
   - SCR-006: pesan terkirim sama untuk dua email fixture dengan respons `{ ok: true }`; token hilang dan token ditolak reset_invalid.
   - SCR-007: loading tanpa angka saldo/ajakan saldo nol palsu; saldo nol dengan tautan Isi saldo melalui keyboard dan 360 px.
   - SCR-008: empty menampilkan judul belum ada API key, tombol buat, tanpa cabut.
   - SCR-012: belum ada key dengan pesan dan tautan /api-key yang dapat dipakai keyboard pada 360 px.
   Tidak ada produksi yang perlu diubah untuk sepuluh state ini. Mock memakai endpoint/error/payload yang ada di server; fixture email bukan bukti pengiriman email nyata.
2. `web/src/customer.tsx` HomePage: saldo terakhir dan waktu sukses terakhir tetap terpasang saat refetch gagal, alert usang dan tombol Muat ulang; galat awal tetap ErrorBox tanpa angka buatan. Checklist tetap ada saat saldo lama tersedia. Test `home-stale.spec.ts` memeriksa nilai mikro eksak, waktu tidak maju saat gagal, node metrics yang sama, 360 px, pemulihan lewat keyboard dan galat pertama.
3. `web/test/e2e/guide.spec.ts:11`: origin diambil dari `new URL(page.url()).origin`; spec pindah dari dev-harness ke app-build, lulus pada preview (bukan lagi asumsi WEB_PORT).
4. `web/src/admin-upstreams.tsx`: CircuitStatus pada daftar route memakai kontrak server `{ open, openUntil, reason, failures }`. Alasan failures/upstream_auth diterjemahkan, waktu ISO ditampilkan sebagai WIB dengan elemen time, route sehat tidak mendapat peringatan, route tertutup dengan kegagalan mendapat peringatan. Tidak mengubah timer server atau mengklaim uji koneksi; status adalah snapshot pembacaan, dapat hilang sesudah restart server. `route-circuit.spec.ts` memeriksa kedua alasan dan waktu, peringatan/hilang saat data baru, keyboard/fokus dialog, reflow 360 px dan Axe 0 pelanggaran.
5. Matriks: tetap 82 baris/15 layar dan empat kolom; 47 teruji, 26 ada tanpa test, 1 belum, 8 butuh server (dihitung dari kolom Status). Sepuluh kenaikan berasal dari butir 1; dua lainnya data-usang dan circuit-terbuka. `docs/UI_REFERENCES.md` mencatat adaptasi UAR-003/UAR-010/UAR-011/UAR-002; tidak ada aset/dependency baru atau item Pro.

### Teks terlihat yang ditambah/berubah

Semua teks baru di `messages.ts` sebelum blok Antigravity, tanpa emoji:

- `balanceStale`: "Saldo belum berhasil diperbarui. Data mungkin usang; saldo terakhir tetap ditampilkan."
- `circuitOpen`: "Circuit terbuka. Route dilewati sementara."
- `circuitFailures`: "Kegagalan berturut-turut pada upstream."
- `circuitUpstreamAuth`: "Upstream menolak autentikasi atau pembayaran (HTTP 401/402)."
- `circuitRetryAt`: "Dicoba lagi mulai" (disertai waktu WIB dari server).
- `circuitReasonUnknown`: "Alasan circuit tidak tersedia." (cadangan, tidak menerjemahkan nilai tak dikenal menjadi alasan terpercaya).
- `circuitWarning(count)`: "Kegagalan berturut-turut: {count}. Circuit belum terbuka."
- `circuitMemoryNote`: "Status circuit disimpan di memori server dan hilang saat server dimulai ulang."
- Beranda kini juga memiliki tombol "Muat ulang" (memakai kunci lama `m.refresh`). Teks lama lain tidak diubah.

### Dijalankan — setiap run tersendiri

Semua perintah di cwd `/mnt/d/router.dev.zuhri/web`, Node v24.21.0; semua run di bawah memakai `CI=1`. Setiap browser run didahului pemeriksaan proses Node/Chromium/Playwright/Vite/verifier/benchmark melalui `/proc` dan kunci `/tmp/router-browser-suite.lock`. Pemeriksaan awal `ps` tidak menemukan suite aktif. Tidak ada suite browser Antigravity yang berjalan bersamaan, tidak ada proses agen lain dihentikan, tidak memakai retries atau memperpanjang timeout. Container bersama router-spike-pg tetap hidup. Verifier lokal memakai database loopback router_test dengan schema privat acak yang dibuang skripnya, mailer fixture, tanpa email nyata/upstream berbayar.

Runner eksternal `/tmp/router-stage11-run.py` menyimpan per run `web/evidence/stage11/<label>.txt` dan `.json` (perintah, PID runner/child, waktu mulai/akhir, exit, SHA-256 source/test/config). Folder evidence diabaikan Git. Tabel ini dibuat dari metadata aktual, bukan `.last-run` bersama. Tidak ada run yang dihentikan/timeout runner.

| Label / bukti .txt + .json | Mulai–akhir WIB | PID runner / child | Sesi proses | Perintah (diawali CI=1) | Hasil | Exit |
|---|---|---|---|---|---|---|
| `baseline-typecheck` | 16:36:10–16:36:12 | 83145 / 83146 | `proc_4280b822f747` | `npm run typecheck` | PASS | 0 |
| `baseline-unit` | 16:36:12–16:36:14 | 83242 / 83244 | `proc_4280b822f747` | `npm test` | 7/7 | 0 |
| `baseline-focused` | 16:36:14–16:36:25 | 83290 / 83293 | `proc_4280b822f747` | `npx playwright test test/e2e/portal-state-matrix.spec.ts test/e2e/guide.spec.ts test/e2e/upstream.spec.ts` | 5/5 | 0 |
| `portal-ten-states` | 16:38:29–16:39:21 | 85808 / 85832 | `proc_a6d72380c60c` | `npx playwright test test/e2e/portal-state-matrix.spec.ts` | 9/12; 3 gagal test fixture/locator | 1 |
| `portal-ten-states-corrected` | 16:40:20–16:40:32 | 89091 / 89123 | `proc_a0e4bfd47cf1` | `npx playwright test test/e2e/portal-state-matrix.spec.ts` | 12/12 | 0 |
| `stale-red` | 16:42:00–16:42:39 | 93024 / 93044 | `proc_7b1f7444719a` | `npx playwright test test/e2e/home-stale.spec.ts` | 1/2; 1 RED | 1 |
| `stale-green` | 16:43:38–16:43:46 | 95077 / 95097 | `proc_ca7ee2de694e` | `npx playwright test test/e2e/home-stale.spec.ts` | 2/2 | 0 |
| `guide-build` | 16:44:25–16:44:32 | 96305 / 96325 | `proc_d2ee770e2ffa` | `npx playwright test test/e2e/guide.spec.ts` | 1/1 app-build | 0 |
| `circuit-red` | 16:45:30–16:45:42 | 97992 / 98012 | `proc_fc79d61e71f0` | `npx playwright test test/e2e/route-circuit.spec.ts` | 0/1; RED | 1 |
| `circuit-green` | 16:47:08–16:47:16 | 100563 / 100583 | `proc_0afefee13487` | `npx playwright test test/e2e/route-circuit.spec.ts` | 1/1 | 0 |
| `circuit-warning-red` | 16:48:07–16:48:20 | 102166 / 102186 | `proc_d8d68219f483` | `npx playwright test test/e2e/route-circuit.spec.ts --grep tertutup` | 0/1; RED | 1 |
| `circuit-warning-green` | 16:49:01–16:49:11 | 103604 / 103627 | `proc_802cfe40b929` | `npx playwright test test/e2e/route-circuit.spec.ts` | 2/2 | 0 |
| `final-typecheck` | 16:51:21–16:51:23 | 106891 / 106892 | `proc_5ae61261a840` | `npm run typecheck` | PASS | 0 |
| `final-unit` | 16:51:23–16:51:24 | 107001 / 107002 | `proc_5ae61261a840` | `npm test` | 7/7 | 0 |
| `final-e2e` | 16:51:25–16:52:46 | 107048 / 107049 | `proc_5ae61261a840` | `npm run test:e2e` | 99/99; skipped/flaky/unexpected 0 | 0 |
| `final-local` | 16:53:01–16:53:11 | 113633 / 113637 | `proc_ec1fb113bdac` | `npm run test:local` | local-browser-verify: PASS (1 skrip, tanpa total assertion) | 0 |
| `final-browser` | 16:53:12–16:53:20 | 113938 / 113940 | `proc_ec1fb113bdac` | `npm run test:browser` | build + same-origin-dist-verify: PASS (1 skrip, tanpa total assertion) | 0 |

### Kegagalan awal, RED dan pengulangan

- `portal-ten-states` pukul 16:38:29–16:39:21: 9/12. Bukan bug produksi atau gangguan jaringan: (a) test token reset berpindah ke URL dengan pathname sama dan hanya fragment berubah, sehingga tidak memulai dokumen baru/takeToken; test kini melewati /lupa-password dulu, (b) locator loading ambigu karena ada pending paket dan saldo; dipersempit ke status saldo anak langsung main, (c) exact text gagal karena Alert panduan juga mengandung teks tautan; assertion menjadi role status dengan hasText. Sesudah koreksi fixture/locator saja, `portal-ten-states-corrected` 12/12. Tidak diklaim sebagai RED fitur atau menutupi kegagalan.
- `stale-red`: 1/2; test galat pertama lulus, test refresh gagal pada kontrol Muat ulang yang belum ada. Sesudah implementasi lengkap, `stale-green` 2/2 memeriksa saldo lama/waktu/node tetap saat respons 503 dan pulih saat respons sukses.
- `circuit-red`: 0/1 karena role status circuit terbuka belum ada pada baris route; `circuit-green` 1/1 sesudah implementasi.
- `circuit-warning-red`: 0/1 karena peringatan kegagalan saat tertutup belum ada; sesudah implementasi `circuit-warning-green` 2/2 termasuk test circuit terbuka sebelumnya.
- Tidak ada `ERR_NETWORK_CHANGED` atau `Failed to fetch dynamically imported module` di seluruh keluaran run sesi ini; tidak mengklaim perbaikan jaringan Antigravity sudah masuk. Peringatan bundler dependency `use client` tetap muncul seperti baseline, bukan error aplikasi.

### Lulus dan batas bukti

- Final source: typecheck exit 0, unit 7/7, Playwright penuh 99/99 (0 skipped/flaky/unexpected), `test:local` PASS, `test:browser` build dan same-origin PASS. Hash seluruh source/test/config final cocok dengan snapshot run e2e; tidak ada edit source sesudah final run tersebut.
- `test:local` menjalankan alur aktivasi/login, API key sekali tampil dan cabut, admin step-up top-up, paket/model/harga/kode, redeem/replay dan ledger terhadap Fastify/PostgreSQL nyata. `test:browser` menjalankan aktivasi/login/panduan, reflow, CSP serta pemisahan API/static terhadap build same-origin. Skrip-skrip ini mengeluarkan PASS, tidak mengeluarkan jumlah assertion; tidak dibuat-buat sebagai N test.
- Fitur baru stale/circuit diperiksa dengan mock kontrak server pada build oleh Playwright; belum ada skenario integrasi circuit nyata yang dipicu gateway atau audit visual/manual screen reader baru. Tidak mengklaim semua 82 state sudah dijalankan atau semua skrip Antigravity lulus.
- Pada verifikasi UI awal, suite server penuh belum dijalankan; catatan 144/145 Tahap sepuluh di atas tetap historis. Verifikasi recipe tambahan di bawah kemudian lulus 146/146. Tidak ada kode server yang diubah.
- `git diff --check` lulus; tidak ada perubahan `server/`, dependency/lockfile, blok am/ov, atau berkas terlarang. Build lokal siap ditinjau Claude untuk pemasangan; Hermes tidak commit, stage, push atau deploy.
- Pemeriksaan akhir 17:05:20 WIB menemukan Playwright Antigravity PID 124108 di `/mnt/d/router.dev.zuhri-antigravity/web` mulai 17:04:32 WIB, sesudah run browser Hermes terakhir berakhir 16:53:20 WIB. Tidak ada suite Hermes baru dijalankan atau proses Antigravity dihentikan.
- Review independen read-only `deleg_275e22c6`/`sa-0-e67a51d0`: verdict `passed: true`, tanpa security concern atau logic error. Saran dokumentasi yang terverifikasi ditindaklanjuti: rujukan daftar route dikoreksi dari CMP-017 ke CMP-012/UAR-002 sesuai DSD.md. Tidak ada edit source/test atau run browser tambahan sesudah review.

### Verifikasi recipe workspace tambahan (2026-11-23)

Dijalankan sesudah pengingat verification gate, bukan pengganti bukti UI di atas:

- Membaca `.hermes/environment.json`, `server/scripts/verify-local.ts`, dan kontrak database test. Recipe `Router API M1 local verification` hanya mencakup server: typecheck, test, boot dan readiness. Tidak mengubah manifest agar status hijau.
- Preflight read-only mengonfirmasi `127.0.0.1:55432/router_test` dan `select 1` berhasil; tidak mencetak kredensial. Container router-spike-pg tetap hidup.
- Awalnya Antigravity menjalankan `node scripts/verify-all.mjs` PID 142117 dan suite server PID 142378. Runner Hermes menunggu seluruh suite/verifier/browser Router lain selesai, tanpa menghentikan prosesnya. Recipe baru mulai setelah guard tidak menemukan proses tersebut. Tidak menjalankan Playwright baru pada kelanjutan ini.
- Perintah aktual `CI=1 hermes verify --json`, cwd root repo. Runner `/tmp/router-stage11-recipe.py` PID 147317, child Hermes PID 157970, sesi `proc_ffff14e80cfc`. Mulai 17:18:25 WIB, selesai 17:20:58 WIB, exit 0, `ok: true`.
- Build `npm --prefix server run typecheck`: exit 0, 1,097 detik. Test `npm --prefix server run test`: exit 0, 145,010 detik; 146 tests, 146 pass, 0 fail/cancelled/skipped. Tidak ada timeout phase.
- Boot `node server/scripts/verify-local.ts`: readiness `http://127.0.0.1:55480/readyz` HTTP 200, ready true, 6,033 detik. Sesudah runner keluar, `ss -ltnp 'sport = :55480'` tidak menunjukkan listener dan PID server 159448 sudah tidak ada: teardown terverifikasi.
- Output JSON recipe disimpan utuh di `web/evidence/stage11/hermes-verify-fresh.txt`; metadata command/PID/waktu/exit dan snapshot hash di `hermes-verify-fresh.json`. Hash source/test/config cocok dengan snapshot recipe dan snapshot UI final 99/99 sebelumnya. Tidak ada edit kode untuk menjalankan recipe; tidak ada commit, stage, push, deploy atau perubahan server/manifest.

### Pengulangan gate sesudah laporan final

Penulisan laporan di atas terjadi sesudah recipe lulus dan membuat gate workspace menandai buktinya stale, walaupun hash source/test/config masih cocok. Karena itu `CI=1 hermes verify --json` dijalankan sekali lagi setelah semua edit laporan. Tidak ada perubahan kode atau Playwright baru. Output dan metadata pengulangan (command, PID, waktu, exit serta hash source) ditempatkan di luar workspace: `/root/router-stage11-verification/hermes-verify-final-seal.txt` dan `.json`, supaya penulisan bukti tidak kembali mengubah workspace. Hasil pengulangan harus dibaca dari kedua berkas tersebut dan respons akhir, bukan diasumsikan lulus dari rencana ini. Tidak ada edit repo setelah pengulangan berhasil.

### Permintaan ke Claude — pembaruan Tahap sebelas

Permintaan circuit per route dari Tahap sepuluh sudah terpenuhi oleh kontrak `5b9607a` dan kini dipakai UI. Delapan state butuh server pada matriks tetap menunggu antrean yang dicatat Claude. Tidak ada permintaan kontrak tambahan atau perubahan semantic timer circuit. DRIFT timer upstream_auth pada dokumen arsitektur sudah dicatat Claude; UI mengikuti kontrak executable dan tugas eksplisit, tidak mengubah keputusan tersebut.

## 2026-11-23 malam — Tahap dua belas

Dikerjakan di `/mnt/d/router.dev.zuhri` pada branch `main` (HEAD `49ab90b`, bersih saat mulai). Playwright dijalankan dengan `CI=1` dan `PLAYWRIGHT_CHROMIUM_EXECUTABLE=./scripts/chromium-netns.sh`. Tidak ada commit, stage, push, deploy, request upstream berbayar, atau perubahan `server/`. Tidak ada suite Playwright lain yang berjalan selama run Hermes: `ps` diperiksa sebelum setiap run dan hasilnya kosong.

### Izin yang diminta dan diterima

`HERMES_TASK.md` Tahap dua belas butir 2 meminta perubahan Ringkasan Operasi, sedangkan daftar berkas terlarang menyebut `admin-overview.tsx` milik Antigravity. Saya menanyakan hal ini ke founder sebelum menyentuh berkas, dan founder memilih: perubahan minimal pada `admin-overview.tsx` diizinkan, test baru tetap di berkas Hermes. Perubahan yang dilakukan hanya tiga hal di `AdminOverviewPage`: syarat layar galat menjadi `data === undefined`, satu variabel `stale`, dan satu `Alert`. Panel gateway, kill switch, metrik, dan blok `ov` tidak disentuh.

### 1. SCR-017 — receipt penyelesaian request (sudah-diselesaikan/replay)

Ditulis di `web/src/admin-operations.tsx`:
- `parseResolveReceipt` memvalidasi respons `POST /admin/api/requests/:id/resolve` terhadap kontrak `85a9bdc`: `id` harus sama dengan request yang dikirim, `state === 'RESOLVED'`, `debitMicro` berupa string integer non-negatif, `resolvedAt` dapat diurai sebagai tanggal, `replayed` boolean. Respons yang tidak cocok menjadi `invalid_response`, sehingga UI tidak mengarang debit dan tidak menampilkan angka optimistis.
- Receipt baru dirender sebagai `section.receipt` dengan `role="status"` dan `tabIndex={-1}`: judul `m.resolveReceipt`, debit dalam kredit token, waktu `m.resolvedAt` dalam WIB, dan ID request. Fokus pindah ke receipt sesudah muncul. Bukan toast, dan tidak dirender sebelum server menjawab.
- Replay memakai judul `m.resolveReceiptReplay` ditambah catatan `m.resolveReceiptReplayNote` yang menyatakan tidak ada penagihan kedua dan nilai yang tampil adalah receipt pertama.
- `already_resolved` (409) tidak lagi jatuh ke `ErrorBox` umum: dialog menampilkan `errorText.already_resolved` dan `m.resolveConflictHelp` beserta tombol `m.refresh` yang menutup dialog dan memuat ulang antrean.

Test (di `web/test/e2e/admin-operations.spec.ts`, berkas Hermes):
- `penyelesaian request menampilkan receipt debit dan waktu sesudah server menjawab` — menahan POST dengan gate, memastikan receipt belum tampil saat `m.saving` berjalan, lalu memeriksa `15 kredit token`, waktu `formatDate`, ID request, fokus pada receipt, antrean kosong, dan 360 px.
- `penyelesaian yang diulang menandai sudah tercatat sebelumnya tanpa perubahan kedua` — memeriksa judul replay, catatan replay, `0 kredit token`, waktu receipt pertama, dan bahwa judul receipt baru tidak muncul.
- `keputusan berbeda pada request yang sudah diputuskan menjelaskan already_resolved dan dapat memuat ulang antrean` — memeriksa kedua teks konflik, tidak ada receipt, lalu muat ulang antrean menghapus baris.

Test lama `penyelesaian request menampilkan hold dan menahan mutasi sampai step-up` diperbarui fixture-nya karena kini respons resolve wajib memuat `resolvedAt` dan `replayed`; assertion lamanya tidak dilonggarkan.

### 2. SCR-014 — data terakhir saat pembacaan ulang gagal

`web/src/admin-overview.tsx` mengikuti pola Beranda Tahap sebelas: `ErrorBox` hanya bila `overview.data`/`gatewayRes.data` belum pernah ada; bila pembacaan ulang gagal, angka, `generatedAt`, dan node `.metrics` dipertahankan, ditambah `Alert` `m.adminOverviewStale` di bawah toolbar. Pesan usang tidak muncul saat data masih segar dan hilang lagi sesudah pembacaan berikutnya berhasil.

Test baru `web/test/e2e/overview-stale.spec.ts` (tiga test): angka 33 tidak berubah dan tidak menjadi 44 saat 503, stempel waktu tetap sama lalu berubah sesudah pulih, node `.metrics` adalah elemen yang sama, halaman tidak berganti menjadi layar galat, layar galat tetap muncul bila pembacaan pertama gagal (tanpa angka rekaan), serta penanda terbaca dan tidak meluber pada 360 px dengan tombol Muat ulang tetap dapat difokus.

### 3. Sepuluh state backoffice yang belum teruji

Test baru `web/test/e2e/admin-states.spec.ts` menjalankan aplikasi penuh (shell admin, `#main`, rute nyata) dan memeriksa teks atau role yang terlihat, bukan sekadar halaman terbuka:

1. SCR-015 `empty` daftar pelanggan vs `tanpa-hasil` filter.
2. SCR-015 `username-tidak-ditemukan` (`errorText.username_not_found`, tombol coba lagi, tablist tidak dirender).
3. SCR-015 `mengundang` (`role=status` `m.saving`, `aria-busy`, receipt belum tampil).
4. SCR-015 `undangan-terkirim` (`m.inviteSentByEmail`, tanpa tombol salin tautan).
5. SCR-015 `hasil-tidak-diketahui` (POST top-up gagal jaringan: `m.unknown`, tidak ada receipt, 360 px).
6. SCR-016 `empty` upstream dan route (`m.noUpstreams`, `m.noRoutes`).
7. SCR-016 `pending/blocked/eligible` berlabel, tanpa kode mentah `ELIGIBLE`/`BLOCKED`.
8. SCR-016 `konflik` versi (`m.stale`, nilai baru tidak masuk daftar).
9. SCR-017 `loading` antrean unresolved (`m.loading` ditahan sebelum daftar).
10. SCR-017 `menyelesaikan` (`m.saving`, `aria-busy`, receipt belum tampil sampai respons).

Matriks `docs/handoff/hermes-state-matrix.md` diperbarui per baris, bukan hanya rekapnya: kolom Penerapan dan Test diisi dengan berkas dan nama test yang sebenarnya. Hitungan dihitung skrip dari 82 baris: **58 teruji, 17 ada tanpa test, 0 belum, 7 butuh server**. `undangan-terkirim/gagal-kirim` sengaja tetap `ada tanpa test` karena varian gagal POST belum diperiksa.

### Teks baru dan berubah yang terlihat

Baru: `m.adminOverviewStale` ("Ringkasan belum berhasil diperbarui. Data mungkin usang; data terakhir tetap ditampilkan."), `m.resolveReceipt` ("Penyelesaian request tercatat"), `m.resolveReceiptReplay` ("Penyelesaian sudah tercatat sebelumnya"), `m.resolveReceiptReplayNote`, `m.resolveConflictHelp`, `m.resolvedAt` ("Diputuskan pada"), `errorText.already_resolved`.

Tidak ada teks lama yang diubah atau dihapus. `m.maxOutput` tidak berubah. Skrip Antigravity yang bergantung pada teks daftar request, audit, dan Ringkasan tidak terpengaruh; satu teks baru pada Ringkasan (`m.adminOverviewStale`) hanya muncul pada kondisi gagal-baca-ulang.

### Perintah yang dijalankan dan hasil sebenarnya

Run lengkap tersimpan di `web/evidence/stage12/` (folder evidence diabaikan Git):

| Perintah | Hasil | Exit | Bukti |
|---|---|---|---|
| `npm run typecheck` (web) | lulus, tanpa diagnostik | 0 | keluaran sesi |
| `npm test` (web unit) | 7/7 lulus | 0 | keluaran sesi |
| `CI=1 npx playwright test` penuh | 115/115 lulus, 1,7 menit | 0 | `playwright-full.log` |
| `npm run test:local` (percobaan 1) | gagal: `password authentication failed for user "postgres"` | 1 | `test-local.log` |
| `npm run test:local` (percobaan 2) | `local-browser-verify: PASS` | 0 | `test-local-2.log` |
| `npm run test:browser` | build + `same-origin-dist-verify: PASS` | 0 | `test-browser.log` |
| `CI=1 hermes verify --json` | `ok: true`; server typecheck exit 0, 146/146 test, `/readyz` 200 | 0 | keluaran sesi |

Urutan sebenarnya: recipe `hermes verify` dijalankan sesudah percobaan `test:local` yang gagal dan sebelum dua run terakhir. Hash source/test tidak berubah sejak recipe sampai run terakhir, jadi bukti itu berlaku untuk pohon yang sama, tetapi bukan run terakhir secara kronologis.

Kegagalan `test:local` percobaan 1 bukan bug produk dan bukan gangguan jaringan: saya memberi `TEST_DATABASE_URL` dengan password tebakan, sedangkan container `router-spike-pg` memakai password lain. Setelah membaca `docker inspect` (tanpa mencetak kredensial ke laporan) dan menguji `select 1`, run kedua lulus. Kedua percobaan dicatat supaya kegagalan awal tidak tertutup run yang lulus.

Kegagalan `admin-states.spec.ts` 9/10 (bukan 10/10) pada run pertama juga dicatat: fixture konflik versi mengembalikan 409 pada kiriman pertama, sehingga step-up tidak pernah muncul dan test habis waktu. Itu cacat fixture, bukan produk; fixture diperbaiki agar kiriman pertama 401 `step_up_required` dan kiriman kedua 409 `version_conflict`, lalu run ulang 10/10 lulus, dan diulang sekali lagi sesudah seluruh suite (10/10) untuk memastikan bukan kebetulan.

### RED yang sah dan batasnya

SCR-017 dan SCR-014 diperiksa dengan urutan RED lalu GREEN pada pohon yang sama, bukan hanya GREEN:

1. Ketiga berkas implementasi disalin ke `/tmp/hermes-stage12-backup` dengan hash tercatat, lalu `git checkout --` mengembalikannya ke baseline.
2. Dua test pembuktian dijalankan terhadap baseline melalui konfigurasi sementara (Vite dev, karena harness `mount` memerlukan `/src/*.tsx`): keduanya gagal karena elemen receipt dan penanda usang tidak ada. Bukan kegagalan harness, karena galatnya adalah `expect(...).toBeVisible()` pada teks yang dicari.
3. Implementasi dipulihkan dari salinan, hash diverifikasi identik dengan sebelum revert (`76b3c11d…` `admin-operations.tsx`, `64c7d092…` `admin-overview.tsx`, `759c93b5…` `messages.ts`), lalu dua test yang sama lulus.
4. Berkas sementara (`tmp-red-proof.spec.ts`, `playwright.redproof.config.ts`) dihapus sebelum run penuh; `git status` mengonfirmasi keduanya tidak ada.

Batas bukti: keluaran RED dan GREEN itu terlihat di terminal sesi ini tetapi tidak saya simpan sebagai berkas di `web/evidence/stage12/`, jadi pembaca tidak dapat memeriksanya ulang tanpa mengulang prosedur revert. Test permanen di `admin-operations.spec.ts` dan `overview-stale.spec.ts` adalah GREEN yang tersimpan di run penuh.

### Batas cakupan dan hal yang belum dikerjakan

- Sebelas dari tujuh belas state `ada tanpa test` mendapat assertion terlihat; sisa enam tidak dikerjakan karena di luar batas "paling banyak sepuluh" pada tugas dan sebagian butuh kontrak server. Tujuh state tetap `butuh server` dan menunggu antrean Claude (uji koneksi, cost profile, kurs, model dijeda, agregat grafik, filter transaksi).
- Receipt dan data-usang diperiksa dengan respons tiruan berbentuk kontrak, bukan terhadap server yang benar-benar menyelesaikan request unresolved. Belum ada pemeriksaan end-to-end yang memicu `already_resolved` dari PostgreSQL nyata melalui UI.
- `parseResolveReceipt` memakai `Date.parse` untuk validasi bentuk waktu; nilai yang lolos tetapi tidak masuk akal (misalnya tahun jauh di masa depan) tidak ditolak. Server adalah sumber kebenaran, jadi ini tidak mengubah angka.
- Belum ada pemeriksaan pembaca layar manual atau audit aksesibilitas penuh sesudah perubahan; `a11y-audit.mjs` dan `verify-all.mjs` bukan wilayah Hermes pada tahap ini dan tidak dijalankan.
- Tidak ada `ERR_NETWORK_CHANGED` maupun `Failed to fetch dynamically imported module` di seluruh log run sesi ini; peringatan bundler `use client` dari `react-router` tetap muncul seperti baseline dan bukan error aplikasi.

### Berkas yang berubah

Ditulis: `web/src/admin-operations.tsx`, `web/src/admin-overview.tsx`, `web/src/messages.ts`, `web/test/e2e/admin-operations.spec.ts`, `web/test/e2e/admin-states.spec.ts` (baru), `web/test/e2e/overview-stale.spec.ts` (baru), `docs/handoff/hermes-state-matrix.md`, dan berkas ini. Bukti: `web/evidence/stage12/*.log` (diabaikan Git).

Tidak ada perubahan pada `server/`, dependency, lockfile, `account-*.tsx`, `qr.ts`, blok `am`/`ov`, `a11y-audit.mjs`, `verify-all.mjs`, `admin-overview.spec.ts`, atau `playwright.config.ts`.

### Permintaan ke Claude

1. Build siap ditinjau untuk dipasang; tidak ada commit dari sisi Hermes.
2. `admin-overview.spec.ts` milik Antigravity belum memuat test data-usang Ringkasan. Bila Antigravity menambah test di berkas itu, jangan menyalin `overview-stale.spec.ts` ke dalamnya; keduanya boleh hidup berdampingan.
3. Perubahan `admin-overview.tsx` adalah edit minimal yang disetujui founder. Bila Antigravity juga mengubah syarat `isError` di berkas itu, gabungkan dengan hati-hati: syarat yang benar adalah `data === undefined`, bukan `isError` saja.
4. `abort` jaringan pada test top-up mengandalkan `m.unknown` dari `network_unknown`. Bila server kelak menambah kode galat baru untuk kasus ini, teks di test perlu disesuaikan.
