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

## Permintaan ke Claude

Tidak ada kebutuhan kontrak server baru untuk tahap ini. Untuk tahap dua: bila diinginkan integrasi backend browser SCR-017/018, siapkan seed request unresolved dengan hold konsisten di schema privat dan step-up test yang sesuai. Jangan memakai atau menghentikan container bersama `router-spike-pg`. Tahap tiga lanjutan belum dipasang ke layanan publik.
