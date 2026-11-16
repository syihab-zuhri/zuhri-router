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

## Permintaan ke Claude

Tidak ada kebutuhan kontrak server baru untuk tahap ini. Untuk tahap dua: bila diinginkan integrasi backend browser SCR-017/018, siapkan seed request unresolved dengan hold konsisten di schema privat dan step-up test yang sesuai. Jangan memakai atau menghentikan container bersama `router-spike-pg`. Tahap tiga lanjutan belum dipasang ke layanan publik.
