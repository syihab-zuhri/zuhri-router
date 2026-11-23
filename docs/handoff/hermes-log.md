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
