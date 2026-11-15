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

## Gap/batas tersisa

- SCR-015 daftar pelanggan dan detail+usage kini terhubung; UI belum menampilkan daftar request per pelanggan karena endpoint detail request tidak diberikan dalam handoff. Panel usage memiliki loading/error/empty terpisah; seluruh susunan tidak menjalani tinjauan a11y independen.
- SCR-010 API hanya memberi cursor dan daftar; ringkasan/grafik adalah halaman yang tampil (maksimum 50), bukan agregat rentang periode penuh. Ini dinyatakan eksplisit di UI.
- E2E untuk SCR-017/018 menggunakan HTTP contract mocks; backend test:local tidak seed unresolved atau mengubah setting. Pengujian integrasi nyata untuk bagian ini belum dilakukan. `test:local` nyata mencakup list/detail customer, usage endpoint, dan top-up step-up.
- Upstream/route E2E mock, bukan kredensial/permintaan provider nyata; aturan proyek melarang request ke upstream tanpa izin founder.
- Audit aksesibilitas independen dan cakupan 360 px/zoom 200%/reduced motion untuk setiap state baru belum dilakukan.
- Belum deploy. Tidak mengubah backend, tidak memanggil upstream berbayar, tidak mengirim email nyata, dan tidak menghentikan container `router-spike-pg`.

## Permintaan ke Claude

Tidak ada kebutuhan kontrak server baru untuk layar yang dibuat pada Tahap dua. Bila nanti diinginkan integrasi backend browser untuk SCR-017/018, siapkan cara seed request unresolved dengan hold konsisten di schema privat dan step-up test yang sesuai. Jangan memakai atau menghentikan container bersama `router-spike-pg`. Tahap ini belum dipasang di layanan publik; tunggu izin founder sebelum deploy.
