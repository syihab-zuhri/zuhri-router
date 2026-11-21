# Changelog: Router AI Komersial

Version: 0.42.0
Status: Recorded changes, bukan persetujuan seluruh blueprint
Updated: 2026-11-21, Asia/Jakarta
Owner keputusan: founder

## 0.42.0: Status layanan selalu baru, label rincian audit lengkap, `DATABASE_POOL_MAX`; terpasang `r11210751`

Source: SCR-007 dan SCR-018 di `docs/UX.md`, dikerjakan Hermes (`HERMES_TASK.md` Tahap sembilan); verifikasi server nyata dan benchmark pool oleh Antigravity (Tugas sembilan); diperiksa dan dilengkapi Claude. Terpasang di zrouter.web.id sebagai `zrouter:r11210751` pada 2026-11-21.

- Portal pelanggan: status layanan (`/api/me`) dibaca ulang setiap kali halaman portal berpindah dan saat tab kembali terlihat, jadi banner jeda muncul dan hilang tanpa memuat ulang halaman. Bila pembacaan ulang gagal, data terakhir tetap dipakai.
- Audit: setiap kunci rincian yang ditulis server punya label admin (38 kunci); nilai ya/tidak tampil "Ya"/"Tidak". Test unit memindai `server/src` dan gagal bila ada kunci baru tanpa label atau summary yang tidak dapat dibaca.
- Server: ukuran pool koneksi database dapat diatur lewat `DATABASE_POOL_MAX` (bawaan 20, 1 sampai 90); produksi tetap 20.
- Skrip Antigravity: banner jeda diperiksa pada server nyata; kursor request diperiksa tanpa jeda buatan; benchmark ukuran pool.
- Bukti pemasangan: suite server 145/145; `verify-all.mjs` 12/14 pada jalan pertama, dua kegagalan dari jaringan laptop (lihat `docs/handoff/claude-log.md`) lulus saat diulang; `smoke-public.sh` 7/7 terhadap https://zrouter.web.id; bundle yang tayang memuat teks baru. Tanpa migrasi baru (14 migrasi); backup sebelum pemasangan `zrouter-20261121T005252Z.dump`.

## 0.41.0: Banner layanan dijeda, rincian audit, kursor request; terpasang `r11192221`

Source: SCR-007 keadaan layanan-dijeda dan SCR-018 rincian audit di `docs/UX.md`, dikerjakan Hermes (`HERMES_TASK.md` Tahap delapan); verifikasi server nyata dan benchmark oleh Antigravity (Tugas delapan); diperiksa dan dilengkapi Claude. Terpasang di zrouter.web.id sebagai `zrouter:r11192221` pada 2026-11-19.

- Portal pelanggan: selama layanan dijeda, setiap halaman menampilkan banner "Layanan sedang dijeda sementara. Request baru ditolak; saldo Anda tidak berubah."; Beranda punya bagian Status layanan ("Berjalan" atau "Dijeda").
- Audit: tiap event dengan ringkasan punya "Rincian" berisi kunci dan nilai dalam bahasa admin; nilai `*Micro` sebagai kredit token; kode status diterjemahkan hanya pada kunci status.
- Audit, Rekonsiliasi dan tab Request: halaman lanjutan yang kosong menampilkan "Tidak ada data lagi" dengan tombol ke halaman awal.
- Perbaikan: kursor `nextBefore` kedua daftar request kini waktu mikrodetik ditambah ID request; sebelumnya baris yang berbagi milidetik dengan akhir halaman terlewat (ditemukan Antigravity). Kursor lama tetap diterima.
- Gateway memeriksa API key satu kali di luar transaksi hold, bukan dua kali.
- Skrip baru Antigravity: `web/scripts/admin-requests-local-verify.mjs`; `bench-gateway.ts --tenants N` dengan rincian query per request.
- Bukti pemasangan: suite server 145/145; `verify-all.mjs` 14/14 (Playwright 82/82, tujuh skrip server nyata, audit aksesibilitas 0 temuan); `smoke-public.sh` 7/7 terhadap https://zrouter.web.id. Tanpa migrasi baru (14 migrasi); backup sebelum pemasangan `zrouter-20261119T152157Z.dump`.

## 0.40.0: Tab Request, filter audit, panel kill switch; terpasang `r11191901`

Source: SCR-015 (tab Request) dan SCR-018 (audit) di `docs/UX.md`, dikerjakan Hermes (`HERMES_TASK.md` Tahap tujuh); panel kill switch SCR-014 oleh Antigravity (Tugas tujuh D); diperiksa dan dilengkapi Claude. Terpasang di zrouter.web.id sebagai `zrouter:r11191901` pada 2026-11-19 bersama isi 0.39.0 (migrasi 014).

- Detail pelanggan mendapat tab Request di antara Pemakaian dan Transaksi, sesuai urutan di UX.md. Daftarnya komponen bersama dengan daftar lintas pelanggan di Rekonsiliasi (`web/src/admin-request-list.tsx`); di tab ini username tetap dan kursornya memakai parameter `requestBefore`.
- Layar Audit: filter kelompok atau awalan aksi (termasuk isian bebas), username pelaku, jenis dan ID target; nama pelaku menggantikan UUID; nama aksi dalam bahasa admin dengan nama mentah sebagai cadangan; paginasi memakai `nextBefore` dari server.
- Ringkasan Operasi: panel layanan gateway (berjalan atau dijeda, sejak kapan, oleh siapa, alasan); jeda dan lanjut lewat dialog konfirmasi (alasan wajib saat menjeda) dan step-up; status berubah hanya sesudah server menjawab.
- `GET /api/me` membawa `servicePaused` untuk keadaan layanan-dijeda di portal (tampilan menyusul, Hermes Tahap delapan).
- Test baru Antigravity: `server/test/gateway-concurrency.test.ts`; skrip `server/scripts/stress-gateway.ts` dan `server/scripts/bench-gateway.ts` (bukan bagian dari aplikasi).
- Bukti pemasangan: suite server 145/145; `verify-all.mjs` 13/13 (Playwright 76/76, enam skrip server nyata, audit aksesibilitas 0 temuan); `smoke-public.sh` 7/7 terhadap https://zrouter.web.id; `restore-drill.sh` PASS pada backup sesudah pemasangan (14 migrasi, tanpa pelanggaran invariant).
- `web/test/unit/audit-actions.test.ts` (baru) memindai `server/src` dan gagal bila ada aksi audit tanpa label atau tanpa kelompok filter, atau ada kelompok tanpa aksi.

## 0.39.0: Kill switch dan daftar request lintas pelanggan (server)

Source: SCR-014 (kill switch, TASK-018) dan SCR-017 (daftar request lintas tenant, API-037) di `docs/UX.md`; kontrak ditetapkan Claude di `ANTIGRAVITY_TASK.md` Tugas tujuh D dan `HERMES_TASK.md` Tahap enam 1. Terpasang 2026-11-19 (`r11191901`, lihat 0.40.0).

- Kill switch: `GET/POST /admin/api/settings/gateway`. Menjeda butuh step-up dan alasan; request baru ke tiga permukaan inference dijawab 503 `service_paused` dengan `Retry-After: 60` sesudah key diperiksa dan sebelum hold; `/v1/models` dan request yang sedang berjalan tidak terpengaruh. Audit dan pemberitahuan Telegram untuk jeda dan lanjut; `/admin/api/overview` memuat keadaannya.
- `GET /admin/api/requests`: metadata request semua pelanggan dengan filter username, state dan model, terbaru dulu dengan kursor. Filter state menerima juga `RESOLVED` (state sesudah admin memutuskan request unresolved), yang tidak ada di daftar kontrak awal.
- `GET /admin/api/audit` (SCR-018): filter awalan aksi, username pelaku, jenis dan ID target; tiap event kini membawa `actorUsername` dan respons membawa `nextBefore`. Test `server/test/audit.test.ts`; suite server 144/144.
- Migrasi 014: kolom `note` pada `system_setting`, baris `gateway_paused`, indeks `request (created_at desc, id)`.
- Bukti: `server/test/control.test.ts` (3 test) dan klasifikasi tiga rute baru di `route-matrix.test.ts`; suite server 143/143.

## 0.38.0: Dokumen disamakan dengan kode (DRIFT)

Source: matriks otorisasi dan uji alur penuh Antigravity (Tugas enam, `docs/handoff/antigravity-log.md`). Perilaku tidak berubah; hanya dokumen. Founder dapat meminta sebaliknya.

- `ARCHITECTURE.md` section 2: state `SETTLED_ESTIMATED` ditambahkan ke tabel. Kode menyelesaikan request yang kontennya sudah terkirim tanpa usage dari upstream (termasuk klien memutus di tengah stream) langsung dengan hitungan lokal yang ditandai estimasi, sesuai isi CR-006, tanpa singgah di `UNRESOLVED`.
- `SECURITY.md` section 2: melihat daftar voucher cukup sesi admin dengan faktor kedua; step-up tetap wajib untuk terbit dan cabut. Daftar hanya memuat kode tersamar.
- Bukti pendukung: `server/test/route-matrix.test.ts` memeriksa 71 rute (tanpa sesi, salah peran, tanpa CSRF, step-up kedaluwarsa tanpa perubahan data, key salah atau dicabut, isolasi tenant); tidak ada celah ditemukan.

## 0.37.0: Tidak ada pengembalian saldo

CR-035
Source: founder 2026-11-15, menjawab pertanyaan Antigravity tentang sisa saldo saat tutup akun: "tidak ada pengembalian saldo atau no refund, membeli = paham".

- Pembelian token final; saldo tidak dapat diuangkan; sisa saldo saat akun ditutup hangus. Dicatat di TOKEN_CREDIT.md section 2 beserta risiko UU 8/1999 Pasal 18 ayat (1) huruf c di section 3.
- Server tidak berubah: akun tertutup sudah tidak dapat masuk atau memakai key, dan saldonya sudah dipisahkan pada status. Tidak ada entri ledger penghapusan saldo; bila founder ingin saldo hangus dicatat sebagai entri tersendiri untuk pembukuan, itu perubahan terpisah.
- Teks antarmuka: Hermes menambahkan pernyataan sebelum pembelian/redeem; Antigravity mengganti teks dialog tutup akun.

## 0.36.0: Agen ketiga; layar akun; tombol arsip di web; pemasangan

CR-034
Source: founder menambah agen Antigravity (2026-11-15) dan meminta hasilnya diperiksa.

- Pembagian kerja tiga agen: Antigravity bekerja di salinan terpisah `D:\router.dev.zuhri-antigravity` (cabang `antigravity/akun`, port dan database uji sendiri) agar tidak menimpa Hermes; Claude memeriksa dan menggabungkan. Tugas di `ANTIGRAVITY_TASK.md`; `HERMES_TASK.md` tahap tiga dibagi (Hermes nomor 1, 2, 5).
- `web/` masuk Git (sebelumnya hanya di disk). Hasil build, test dan evidence tetap di luar Git.
- Antigravity menulis `/akun` (ganti password, sesi, tutup akun) dan `/admin/akun` (ganti password, ganti autentikator dengan kunci manual dan kode QR yang dibuat di browser). Temuan pemeriksaan: kode QR tidak terbaca untuk versi 7 ke atas, padahal tautan autentikator selalu versi 7 atau 8 (pembaca independen jsQR: 2 dari 303 terbaca). Diperbaiki Claude dengan unit test yang gagal pada kode lama; sesudahnya 303/303 terbaca.
- Hermes menyelesaikan daftar model upstream dan tombol arsip.
- Hasil gabungan: typecheck, 5 unit test, 33/33 test browser, `test:local`, `test:browser`, verifikasi akun terhadap server nyata, semuanya lulus.
- Dipasang di VPS sebagai `zrouter:r11151123` setelah backup (`zrouter-20261115T042530Z.dump`, terunggah ke Drive). Server tidak berubah; hanya web. Image sebelumnya `zrouter:r11141615` tetap ada untuk kembali.
- Belum: undang pelanggan dari web, tangguhkan/koreksi saldo, judul ZRouter dan ikon (Hermes, tahap tiga). Pertanyaan terbuka dari Antigravity: nasib sisa saldo positif saat pelanggan menutup akun belum diputuskan founder.

## 0.35.0: Daftar model dari upstream; arsip model dan upstream

CR-033
Source: pertanyaan founder saat mengisi route di server produksi (2026-11-14): dari mana ID model tiap upstream diambil, dan mengapa daftar model publik memuat sisa uji yang tidak dapat disingkirkan.

- `GET /admin/api/upstreams/:id/models?protocol=`: server menanyakan daftar model ke upstream memakai key tersimpan (`/models`, atau `/v1/models` pada permukaan Anthropic), dengan pemeriksa alamat yang sama, tanpa mengikuti redirect, batas waktu 15 detik. Hanya ID yang berbentuk sah yang dikembalikan, tanpa duplikat; isi jawaban upstream lainnya tidak diteruskan. Bila upstream tidak menyediakan daftar: 502 `upstream_models_unavailable`, dan ID tetap dapat diketik manual.
- Arsip (migrasi 013): `POST /admin/api/models/archive` dan `POST /admin/api/upstreams/:id/archive`, dengan step-up dan audit. Model yang harganya masih terbit tidak dapat diarsipkan sebelum harganya ditarik. Mengarsipkan mematikan route terkait; upstream yang diarsipkan menjadi BLOCKED dan tetap BLOCKED saat dipulihkan. Daftar admin menyembunyikan yang diarsipkan kecuali `includeArchived=1`; gateway dan katalog pelanggan tidak pernah memakainya. Riwayat request, ledger dan audit tidak berubah.
- Catatan operasi: uji alur pada CR-029 meninggalkan satu model dan satu upstream uji di server produksi; arsip dibuat antara lain untuk menyingkirkannya dari daftar pilihan.

Verification: 1 test baru; suite server 133/133; typecheck exit 0.

## 0.34.0: Backup ke Google Drive

CR-032
Source: founder login Google lewat tautan otorisasi dan meminta backup ke Drive (2026-11-14).

- Otorisasi rclone untuk Google Drive dibuat dengan cakupan `drive.file` (hanya berkas yang dibuat rclone sendiri), di mesin founder, lalu dipindahkan ke `~/zrouter/rclone.conf` (600) di VPS. Salinan di mesin founder dihapus setelah unggahan dari VPS terbukti.
- `deploy/backup-cron.sh`: pembungkus cron yang mengirim peringatan Telegram bila backup gagal (kode 1) atau unggah gagal (kode 2). Cron tiap jam di VPS kini mengunggah ke `gdrive:zrouter-backups`; berkas Drive berumur lebih dari 30 hari dihapus skrip.
- Diuji: satu backup dibuat dan diunggah dari VPS; berkas diunduh kembali dari Drive dan checksum-nya sama dengan berkas di server; remote yang sengaja salah menghasilkan kode 2 dan peringatan Telegram.
- Kesalahan agen pada percobaan pertama: langkah pembersihan lokal tetap berjalan setelah pemindahan ke VPS gagal (folder `~/.config` di VPS milik root), sehingga otorisasi pertama terhapus sebelum sampai ke VPS dan founder harus mengotorisasi ulang. Tidak ada data yang terdampak. Perbaikan cara kerja: pembersihan hanya dijalankan setelah hasil di tujuan diverifikasi.
- Risiko terbuka: rclone memperingatkan bahwa client ID Google bawaannya dihentikan selama 2026, sehingga unggahan dapat berhenti kapan saja. Kegagalan akan terlihat lewat peringatan Telegram. Perbaikan permanen: client ID Google milik founder sendiri.

## 0.33.0: Ganti password dan autentikator admin; pembaruan pertama di VPS

CR-031
Source: founder menempelkan URI autentikator admin di percakapan dan meminta lanjut (2026-11-14). Kunci itu dianggap terpapar dan diganti.

- Migrasi 012 dan rute admin baru, semuanya dengan step-up: `POST /admin/api/account/password` (password saat ini wajib; sesi admin lain dicabut) dan penggantian autentikator dua langkah, `.../authenticator/start` lalu `.../authenticator/confirm`. Kunci baru hanya menggantikan yang lama setelah satu kode darinya terverifikasi; kode pemulihan lama dibuang dan delapan yang baru diterbitkan sekali; sesi lain dicabut.
- `/status` bot kini memisahkan saldo akun tertutup dari total saldo pelanggan; bot juga mengabarkan ganti password dan ganti autentikator.
- `server/scripts/admin-rotate-authenticator.ts`: pembantu operator yang menjalankan penggantian lewat API dan menulis rincian baru ke berkas privat.
- Pembaruan di VPS: backup dibuat lebih dulu, image lama ditandai `zrouter:prev`, image baru dimuat dan dipakai lewat `APP_IMAGE`, migrasi 012 diterapkan saat start, `/readyz` sehat dari dalam dan publik, invariant ledger bersih. Jalur upgrade yang sama diuji lebih dulu secara lokal pada database berisi data.
- Autentikator admin di server produksi diganti lewat skrip; rincian baru ditulis ke folder rahasia founder, berkas lama dihapus, dan kode dari kunci lama dipastikan ditolak server (401). Password admin tidak diubah.
- rclone dipasang di VPS; belum ada remote, menunggu login Google founder.

Verification: 2 test baru dan 1 penegasan baru; suite server 132/132; typecheck exit 0.

## 0.32.0: Bot Telegram aktif; rahasia disalin keluar VPS

CR-030
Source: founder menyediakan folder rahasia di luar proyek dan berkas token bot (2026-11-14).

- Berkas login admin pertama dan berkas pengaturan VPS (kunci enkripsi, kata sandi database) disalin ke folder rahasia milik founder di luar repo, diverifikasi dengan checksum; berkas login admin di VPS dihapus sesudahnya. Isi tidak pernah ditampilkan.
- Token dan chat ID bot dimasukkan ke pengaturan VPS (pengaturan lama dicadangkan di VPS), aplikasi dinyalakan ulang, `/readyz` sehat dari dalam dan lewat alamat publik.
- Kiriman pertama gagal "chat not found" karena founder belum memulai chat dengan bot. Sesudah founder menekan Start, perintah `/status` dijawab bot dengan ringkasan server (E4: diamati founder di Telegram), dan satu pesan uji terkirim.
- Catatan: total saldo pada `/status` ikut menghitung akun uji yang sudah ditutup (1.999.516 token). Perbaikan agar akun tertutup tidak dihitung belum dipasang.

## 0.31.0: Terbuka di https://zrouter.web.id

CR-029
Source: founder meminta agen web menambahkan hostname publik di Cloudflare lalu meminta lanjut (2026-11-14). Decision owner: founder.

- Publikasi (dikerjakan Hermes, lihat handoff/hermes-log.md): `zrouter.web.id` ditambahkan sebagai public hostname pada tunnel `lighthouse-9router-go` menuju `http://localhost:18080`; hostname lama dilaporkan tidak berubah.
- Uji alur lewat alamat publik (Claude): `e2e-container.ts` terhadap `https://zrouter.web.id` lulus 31 dari 31 langkah, termasuk stream lewat Cloudflare dan satu request nyata per permukaan. Kredensial admin dibaca skrip dari berkas di VPS tanpa ditampilkan; salinan sementaranya dihapus.
- Skrip mendapat mode `E2E_CLEANUP=1`: sesudah uji, harga model uji ditarik, upstream uji diblokir, paket uji disembunyikan, akun uji ditutup. Baris ledger dan audit dari uji tetap ada (append-only): satu akun tertutup dengan sisa 1.999.516 token, satu kode ditukar, tiga request. Tidak ada data yang dihapus.
- Alamat klien di log aplikasi adalah alamat publik pemanggil, bukan proxy; `TRUST_PROXY=1` benar untuk susunan ini. Entri `127.0.0.1` di log berasal dari healthcheck container.
- Backup: `deploy/backup.sh` kini dapat dipakai untuk susunan tunnel (`COMPOSE_FILE`, `COMPOSE_PROJECT`, `DOCKER`). Di VPS terpasang cron tiap jam ke `~/zrouter-backups` (700), satu backup dibuat dan dipulihkan ke database sementara di server yang sama: jumlah entri ledger dan total saldo sama; database sementara dihapus. Unggah ke Google Drive belum: rclone belum terpasang dan memerlukan login Google founder.
- Temuan saat memasang cron: perintah gabungan dengan `set -e` memasang crontab kosong karena `grep -v` tanpa hasil dianggap gagal; diperbaiki dan dipastikan terpasang.
- Belum ada: email, bot Telegram, unggah backup keluar server, pemantau uptime eksternal, penggantian kata sandi admin lewat aplikasi. Berkas `ADMIN_LOGIN_PERTAMA.txt` masih di VPS menunggu diambil founder.

## 0.30.0: Terpasang di VPS, belum dibuka ke publik

CR-028
Source: founder menunjuk kunci SSH yang sudah ada di mesinnya dan meminta lanjut memasang (2026-11-14). Lingkup yang disetujui: memasang dan menyalakan pada port dalam saja; membuka ke publik menunggu izin tersendiri.

- VPS diperiksa lebih dulu secara baca-saja: Ubuntu 24.04, 2 CPU, 3,7 GB RAM, Docker terpasang, layanan founder yang sudah ada (cliproxyapi, 9router-go, tiga tunnel Cloudflare) hanya mendengarkan di dalam mesin; port 80 dan 443 tidak dipakai.
- Diubah di VPS: paket `docker-compose-v2` dipasang; image `zrouter:local` dimuat; folder `~/zrouter` (hak akses 700) berisi `deploy/compose.tunnel.yml`, `deploy/.env` (600; kata sandi database dan kunci enkripsi dibuat di VPS dan tidak pernah ditampilkan) dan `ADMIN_LOGIN_PERTAMA.txt` (600). Layanan lain tidak disentuh; keduanya diperiksa tetap aktif sesudahnya.
- `deploy/compose.tunnel.yml`: varian tanpa Caddy; aplikasi hanya pada `127.0.0.1:18080`, cocok dengan pola tunnel Cloudflare yang sudah dipakai founder. Image dimuat, tidak dibangun di server.
- Uji di VPS: tumpukan sementara pada port lain dan database terpisah dijalankan, uji alur lengkap lewat terowongan SSH lulus 29/29 dengan request nyata dari VPS ke upstream, lalu tumpukan sementara dihapus beserta datanya.
- Tumpukan sungguhan menyala: `/readyz` 200, web tersaji, database kosong dan konsisten, satu akun admin dibuat. Tidak ada port publik baru (hanya 22 seperti sebelumnya).
- Belum dilakukan: tunnel Cloudflare dan DNS untuk zrouter.web.id (memerlukan akun Cloudflare founder), email, bot Telegram, backup terjadwal. Docker pada VPS dijalankan lewat sudo; user `ubuntu` tidak dimasukkan ke grup docker.
- Admin belum dapat mengganti kata sandinya sendiri lewat aplikasi; rute itu belum ada.

## 0.29.0: Uji alur lengkap lewat container; penanda dokumen lama

CR-027
Source: founder menyetujui urutan pekerjaan tanpa menunggu agen web (2026-11-14).

- `server/scripts/e2e-container.ts`: memeriksa deployment yang sedang berjalan lewat HTTP saja. Dijalankan terhadap image yang dibangun ulang dari kode terkini, pada database kosong: 29 dari 29 langkah lulus. Cakupan: bootstrap admin di dalam container, login dan faktor kedua, undangan dengan tautan manual, aktivasi, paket, kode redeem dan replay, API key, pendaftaran upstream nyata, harga x2, route tiga permukaan, satu request nyata per permukaan (semua SETTLED, tanpa estimasi), saldo sama dengan redeem dikurangi tagihan, pemakaian admin cocok, ledger, audit tanpa secret, dan web tersaji dengan CSP. Pemeriksa invariant di dalam container bersih.
- Belum tercakup oleh uji ini: Caddy dan TLS, email nyata, bot Telegram di dalam container, interaksi browser.
- Dokumen lama diberi penanda di bagian atas yang menyebut apa saja di dalamnya yang digantikan TOKEN_CREDIT.md dan keputusan sesudahnya: BILLING_REDEEM, PLANNING, ARCHITECTURE, UX, DSD, DISCOVERY, ADAPTERS. Isi lama tidak ditulis ulang; penanda menyatakan mana yang berlaku. CHK-40 tetap PENDING sampai FR-003 (margin) dirancang ulang untuk kredit token.

## 0.28.0: Uji dengan tool sungguhan

CR-026
Source: founder menyetujui uji tool memakai key upstream yang sama (2026-11-14).

Susunan: gateway lokal (`server/scripts/tool-lab.ts`) dengan satu model publik yang dipetakan ke router milik founder pada tiga permukaan; tiap tool dijalankan dengan folder konfigurasi terpisah sehingga konfigurasi dan login milik founder tidak tersentuh. Folder sementara itu dihapus sesudahnya.

| Tool | Versi | Permukaan | Hasil |
|---|---|---|---|
| Codex CLI | 0.165.0 | `/v1/responses` | Menjawab; tugas bertahap (baca berkas, tulis berkas) selesai dengan isi yang benar. 4 request, semua SETTLED |
| Claude Code | 2.1.325 | `/v1/messages` | Menjawab; tugas dengan tool Read mengembalikan isi yang benar. 3 request, semua SETTLED |
| OpenCode | 2.3.0 | `/v1/chat/completions` | Menjawab. 2 request, semua SETTLED |

- Sembilan request, tidak ada yang ditagih sebagai estimasi, tidak ada pelanggaran hold, tidak ada dana tertahan sesudahnya, invariant ledger bersih. Jumlah token yang dilaporkan Codex untuk dirinya sendiri (11.591 dan 36.047) sama persis dengan yang ditagih gateway.
- Kekhawatiran pada CR-020 tidak terjadi: Codex berjalan dalam mode stateless tanpa mengirim `previous_response_id`.
- Satu request tool memakai sekitar 12.000 sampai 16.000 token input hanya untuk instruksi bawaan tool; total uji sekitar 107.000 token di upstream.
- Upstream ini tidak melaporkan token cache, jadi tidak ada keringanan cache yang diteruskan.
- Peringatan dari tool, bukan kegagalan: Codex dan Claude Code tidak mengenali nama model kustom dan memakai asumsi bawaan untuk ukuran konteks.
- Belum diuji: Hermes (sedang dipakai sebagai agen pada proyek ini, tidak dikonfigurasi ulang) dan ZCode (tidak terpasang); sesi panjang, gambar, pembatalan dari dalam tool, dan gateway di balik HTTPS.

Batas bukti: E3 untuk versi tool, satu upstream dan satu waktu di atas. Versi tool berubah cepat.

## 0.27.0: Pemakaian per pelanggan dan tautan aktivasi manual

CR-025
Source: founder meminta lanjut (2026-11-14). Kedua butir berasal dari kebutuhan yang sudah dinyatakan founder: memantau usage tiap pelanggan (CR-004) dan jalur undangan saat email tidak terkirim (pertanyaan terbuka pada HANDOFF).

- `GET /admin/api/customers/:username/usage?days=` (API-040): total per hari, per model dan per API key (request, gagal, estimasi, token input dan output yang ditagih, tagihan, input tidak ditagih) serta 50 request terakhir. Hanya metadata. Test memastikan jumlah tagihan sama dengan yang dilihat pelanggan itu sendiri.
- Undangan: bila email tidak terkirim (penyedia mati atau `MAILER=none`), jawaban kepada admin memuat `activationLink` satu kali untuk diteruskan lewat kanal lain. Token tetap tidak disimpan dan tidak masuk audit. Bila email terkirim, tautan tidak dikembalikan. Dengan ini pilot dapat berjalan tanpa penyedia email.

Verification: 2 test baru; suite server 130/130 dua kali; typecheck exit 0.

## 0.26.0: Bot Telegram dan backup ke Google Drive

CR-024
Source: founder meminta backup memakai Google Drive dan bot Telegram untuk memantau server (2026-11-14). Decision owner: founder.

- `src/monitor.ts`: bot Telegram hanya-baca untuk satu chat yang dikonfigurasi (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`). Peringatan dari audit log (kode redeem, tambah saldo, koreksi, admin masuk, upstream, harga, batas lebih-pakai, request terputus dan keputusannya), dari gateway (rute dijeda termasuk 401 dan 402 dari upstream, semua rute gagal untuk sebuah model), dan dari pemeriksaan berkala (saldo tidak cocok dengan ledger, request menunggu keputusan). Peringatan sejenis dibatasi sekali per jendela waktu. Perintah `/status` melaporkan request, tagihan, dana tertahan, pelanggan, saldo, kewajiban kode dan status upstream. Kegagalan Telegram tidak pernah mengganggu server.
- Tidak ada perintah yang mengubah keadaan, dan pesan tidak memuat API key, kode redeem, token bot, atau isi percakapan; keduanya diuji.
- Batas: bot berjalan di dalam proses server, jadi tidak dapat memberi tahu saat server itu sendiri mati; perlu pemeriksa uptime eksternal. Riwayat sebelum bot menyala tidak dikirim ulang.
- `deploy/backup.sh`: unggah opsional ke remote rclone (`RCLONE_REMOTE=gdrive:...`) dan penghapusan berkas Drive berumur lebih dari 30 hari. Penyiapan remote memakai akun Google founder di server lewat `rclone config`.
- Belum dijalankan terhadap layanan nyata: tidak ada pesan Telegram sungguhan dan tidak ada unggahan ke Drive; keduanya memerlukan token dan akun founder.

Verification: 4 test baru terhadap API Telegram tiruan (satu test awalnya bergantung waktu dan gagal sekali; dibuat deterministik, lalu 6 kali berturut-turut lulus); suite server 128/128 dua kali berturut-turut; typecheck exit 0.

## 0.25.0: Backup dan pemulihan

CR-023
Source: founder menunda pembahasan server dan domain; pekerjaan yang tidak bergantung pada itu dilanjutkan (2026-11-14).

- `deploy/backup.sh` (dump berformat custom, retensi 14 hari, menolak hasil kosong) dan `deploy/restore.sh` (wajib `CONFIRM=restore`, menghentikan aplikasi lebih dulu).
- `server/scripts/check-invariants.ts`: pemeriksaan saldo terhadap entri ledger dan hold; keluar dengan kode 1 bila ada pelanggaran. Ikut dalam image.
- Diuji lokal: dump database uji asap (8 entri ledger, 8 request) dipulihkan ke database kosong; jumlah baris dan total saldo sama persis, tidak ada pelanggaran invariant, trigger append-only tetap menolak perubahan entri ledger, dan migrasi melaporkan tidak ada yang tertunda. Ini memenuhi sebagian TEST-017; RPO/RTO belum diukur dan skrip compose belum dijalankan di server.
- Deploy tetap menunggu pembahasan server dan domain dengan founder.

## 0.24.0: Persiapan deploy

CR-022
Source: founder meminta lanjut (2026-11-14). Tidak ada deploy yang dilakukan; server tujuan belum diketahui.

- `src/http/static.ts`: web hasil build disajikan dari origin yang sama (`WEB_DIST`). Berkas didaftar sekali saat start dan dicari dengan path persis, sehingga tidak ada jalan keluar dari folder. Fallback SPA untuk rute klien; path API tetap menjawab JSON 404; CSP, X-Frame-Options, Referrer-Policy pada halaman; HSTS pada deployment aman.
- `TRUST_PROXY`: jumlah proxy di depan aplikasi yang dipercaya untuk alamat klien. Test menangkap bahwa memberi angka langsung ke Fastify tidak berlaku pada versi ini (semua klien terbaca sebagai alamat proxy, sehingga batas per alamat menimpa semua orang); diganti fungsi hop eksplisit.
- `deploy/`: Dockerfile dua tahap (build web, lalu server; berjalan sebagai user non-root; migrasi saat start), compose (Caddy untuk TLS, aplikasi, PostgreSQL), Caddyfile tanpa buffering untuk stream, `.env.example`, dan README berisi langkah serta daftar yang wajib ada sebelum pelanggan nyata (backup, kunci, pemantauan, email).
- Diuji lokal: image terbangun (356 MB); container berjalan terhadap database kosong, migrasi 001 sampai 011 diterapkan, `/readyz` 200, halaman web dan aset tersaji, API menjawab 401 JSON, header keamanan ada, proses berjalan sebagai `node`. Build pertama gagal karena koneksi terputus saat mengunduh paket; lulus setelah percobaan ulang dengan opsi retry.
- Belum diuji: compose lengkap dengan Caddy dan sertifikat (butuh domain dan server publik), backup dan pemulihan, perilaku di belakang proxy nyata, dan apakah UI Hermes berjalan penuh di bawah CSP ini (hanya pemuatan halaman dan aset yang diperiksa, bukan interaksi di browser).

Verification: 4 test baru; suite server 124/124 dua kali berturut-turut; typecheck exit 0.

## 0.23.0: Katalog model pelanggan dan tugas tahap dua Hermes

CR-021
Source: founder meneruskan laporan Hermes (12/12 test browser lulus) dan bertanya pekerjaan berikutnya (2026-11-14).

- `GET /api/models`: model yang dapat dipanggil saat ini, pengali, protokol yang tersedia, dan biaya per token dalam kredit per kategori sebagai string desimal eksak. Tanpa nama atau biaya upstream.
- HERMES_TASK.md ditambah "Tahap dua": layar pemakaian, model dan harga, panduan integrasi, upstream dan route, daftar pelanggan, request menunggu keputusan, pengaturan lebih-pakai, audit, dan build produksi yang dapat disajikan dari origin yang sama.
- Laporan Hermes dicatat sebagaimana disampaikan; Claude tidak menjalankan ulang suite web.

Verification: 1 test baru; suite server 120/120; typecheck exit 0.

## 0.22.0: Permukaan Responses

CR-020
Source: founder meminta lanjut (2026-11-14).

- `POST /v1/responses` (migrasi 011): pass-through ke endpoint `/responses` upstream berprotokol sama. Hanya mode stateless: `previous_response_id`, `conversation` dan `background` ditolak 400, dan `store: false` dipaksakan ke upstream, sehingga isi tidak disimpan di upstream atas nama pelanggan. Batas output lewat `max_output_tokens`.
- Usage dibaca dari objek respons pada event akhir (`response.completed`, `.incomplete`, `.failed`) atau dari body non-stream; `input_tokens` dianggap sudah mencakup token cache yang dirinci di `input_tokens_details.cached_tokens`. Bentuk itu mengikuti API Responses OpenAI; rincian cache belum terlihat pada upstream nyata yang diuji (ia hanya mengirim input, output, total).
- Uji nyata pada router milik founder: non-stream dan stream menjawab 200, usage terbaca, ditagih tanpa estimasi, tidak ada hold tersisa. Dua request kecil.
- Ketiga permukaan untuk tool target kini ada di gateway. Belum ada tool (Codex, Claude Code, OpenCode, Hermes, ZCode) yang diuji langsung terhadap gateway; itu memerlukan gateway yang dapat dijangkau tool tersebut.

Verification: 1 test baru; suite 119/119 dua kali berturut-turut; typecheck exit 0.

## 0.21.0: Batas laju gateway dan pemulihan request yang terputus

CR-019
Source: founder menyetujui urutan lanjutan (2026-11-14).

- Batas di gateway (ABU-004), di memori proses, ditolak sebelum menyentuh database: 120 request per menit per API key, 20 request berjalan bersamaan per tenant, 30 kegagalan autentikasi per menit per alamat; semuanya 429 `limit_exceeded` dengan Retry-After dan tanpa hold. Nilai awal dipilih agen dan dapat diubah lewat konfigurasi aplikasi.
- Durasi total satu stream dibatasi 30 menit.
- `recoverStuck` berjalan tiap 5 menit dari proses server: request yang terbuka lebih dari 45 menit dan belum mengirim byte apa pun dilepas hold-nya; yang sudah mulai stream menjadi UNRESOLVED dengan hold dipertahankan (migrasi 010). Aman dijalankan berulang.
- Admin: `GET /admin/api/requests/unresolved` dan `POST /admin/api/requests/:id/resolve` dengan jumlah token yang ditagih (0 melepas), alasan, step-up, tepat sekali, diaudit; tagihan tidak boleh melebihi dana yang ditahan.
- Batas: limiter dan kesehatan route hanya berlaku per proses; lebih dari satu instance gateway memerlukan penyimpanan bersama. Belum ada alert saat request menjadi UNRESOLVED.

Verification: 2 test baru (test pemulihan mensimulasikan proses mati dengan mengembalikan state hold ke kondisi sesudah admission); suite 118/118 dua kali berturut-turut pada database terpisah; typecheck exit 0.

## 0.20.0: Batas tagihan input

CR-018
Source: founder menerima usulan pada CR-017 (2026-11-14) dan menyatakan upstream yang diuji adalah router miliknya sendiri, supaya key dapat dicabut tanpa masuk ke platform lain. Decision owner: founder.

- Aturan baru: pelanggan tidak pernah ditagih input melebihi ukuran request yang ia kirim (dalam byte, batas yang sama dengan hold). Kelebihan yang dilaporkan upstream dipotong dari input biasa, lalu cache write, lalu cache read, dicatat pada `request.unbilled_input_tokens` (migrasi 009) dan ditanggung usaha. Usage mentah upstream tetap disimpan untuk rekonsiliasi; usage yang dilihat pelanggan pada respons tetap angka asli upstream.
- Batas ini longgar: satu byte dihitung paling banyak satu token, padahal umumnya satu token beberapa byte. Jadi sebagian token tambahan upstream masih dapat tertagih sampai sebesar ukuran request. Batas yang lebih ketat memerlukan penghitung token lokal.
- Uji nyata diulang: request non-stream yang sebelumnya ditagih 4.060 kredit kini 102; 3.958 token tercatat tidak ditagih; tidak ada lagi pelanggaran hold.
- Upstream yang diuji dicatat sebagai router milik founder; RSK-016 tetap sebagai risiko yang diterima founder dan tidak dibahas ulang.
- Temuan proses: suite server gagal acak (1 lalu 18 test) saat berjalan bersamaan dengan verifikasi agen lain yang memakai database `router_test` yang sama; pada database terpisah `router_test_claude` lulus 116/116 dua kali. Agen menjalankan test dengan `TEST_DATABASE_URL` masing-masing.

Verification: 1 test baru untuk batas input, test lebih-pakai disesuaikan; suite 116/116 dua kali berturut-turut pada database terpisah; typecheck exit 0; uji asap nyata sekitar 6 request kecil.

## 0.19.0: Uji asap terhadap upstream nyata

CR-017
Source: founder menyerahkan berkas kredensial upstream untuk uji coba key (2026-11-14). Berkas dibaca oleh skrip tanpa menampilkan key; berkas dikecualikan dari Git.

- `server/scripts/smoke-upstream.ts`: mendaftarkan upstream lewat API admin dengan pemeriksa base URL dan DNS sungguhan, lalu mengirim beberapa request kecil lewat gateway lokal pada database terpisah `router_smoke`. Dua kali dijalankan, sekitar 12 request kecil seluruhnya ditambah satu probe langsung.
- Hasil (E3, satu upstream, satu model, satu waktu): registrasi lolos; stream Chat lengkap dengan usage dan `[DONE]`, byte pertama sekitar 0,6 detik, ditagih dari usage upstream; non-stream Chat dan pemanggilan tool berjalan; permukaan Anthropic pada host yang sama menjawab dengan bentuk yang benar; pembatalan klien menghasilkan settlement estimasi tunggal; key upstream salah menghasilkan 503 tanpa debit dan tanpa membocorkan host; tidak ada hold tersisa dan invariant ledger bersih.
- Bug ditemukan dan diperbaiki: gateway tidak mengirim `stream` bila klien menghilangkannya, dan upstream ini membalas dengan SSE secara default sehingga jawaban non-stream tidak terbaca dan ditagih sebagai estimasi. Gateway kini selalu mengirim `stream` secara eksplisit; test regresi ditambahkan.
- Temuan upstream (bukan bug gateway): pada request non-stream upstream ini melaporkan sekitar 4.060 token input untuk prompt enam kata, sedangkan pada stream sekitar 60. Upstream tampaknya menambahkan konteksnya sendiri pada jalur non-stream. Akibat: pelanggan tertagih token yang tidak ia kirim, dan hold terlampaui (`bound_exceeded`). Perlu keputusan founder; opsi teknis: tambahan batas input per route, atau tidak menagih input di atas batas body.
- Upstream yang diuji bukan Dahono maupun DeepSeek; identitas dan sumber di belakangnya tidak diperiksa. Bila di belakangnya akun langganan, RSK-016 berlaku.

Verification: suite server 115/115 lulus setelah perbaikan; typecheck exit 0. Laporan mentah uji asap disimpan lokal di evidence/2026-11-14-smoke/result.json (tidak masuk repo).

## 0.18.0: Inti gateway terhadap upstream tiruan

CR-016
Source: founder meminta lanjut; menyatakan repo boleh publik untuk sementara; menawarkan kredensial upstream berjangka untuk pengujian. Decision owner: founder.

- Migrasi 008: `request` dan `attempt` (metadata saja; tidak ada isi prompt atau respons).
- `src/gateway.ts`: `POST /v1/chat/completions`, `POST /v1/messages`, `GET /v1/models`, autentikasi API key lewat Authorization Bearer atau x-api-key. Admission dalam satu transaksi (key, scope, snapshot harga, hold); routing hanya ke route berprotokol sama pada upstream ELIGIBLE; fallback sampai 3 attempt hanya sebelum byte pertama; setelah itu tidak ada perpindahan. Settlement tepat sekali dalam kredit token; usage nol gratis; usage hilang setelah konten terkirim ditagih sebagai estimasi; klien memutus membatalkan upstream.
- Aturan lebih-pakai: bila output yang diminta tidak muat dalam saldo ditambah batas lebih-pakai, batas output yang dikirim ke upstream diperkecil sampai muat; inilah bentuk "dihentikan paksa". Request berikutnya ditolak saat saldo tidak lagi di atas nol.
- Batas input untuk hold memakai jumlah byte body (satu token tidak pernah lebih pendek dari satu byte), menggantikan estimasi lemah pada spike (RSK-009). Bila usage upstream tetap melebihi hold, selisih ditagih dan ditandai `bound_exceeded`.
- Pada permukaan Chat, gateway menambahkan `stream_options.include_usage` ke request upstream agar usage selalu tersedia untuk penagihan; ini satu-satunya field yang ditambahkan selain penggantian nama model dan batas output. Dicatat sebagai penyimpangan kecil dari pass-through murni.
- Alamat upstream diperiksa ulang saat koneksi; redirect tidak diikuti. Kesehatan route disimpan di memori proses: terbuka 30 detik setelah 3 kegagalan, 5 menit setelah 401/402.
- `GET /api/requests` untuk riwayat request pelanggan (metadata).
- Pemeriksaan CSRF dilewati untuk `/v1/` karena permukaan itu tidak membaca cookie.

Belum dicakup: upstream nyata; permukaan Responses (Codex); hitung token Anthropic; margin guard; batas laju dan konkurensi per key/route; kesehatan route lintas proses dan alert; worker yang memulihkan hold bila proses mati di antara stream dan settlement (hold seperti itu saat ini tetap terbuka sampai ditangani manual); pengukuran overhead pada kode ini.

Git: commit lokal ditulis ulang tanpa gambar referensi dan salinan dokumentasi pihak ketiga (`docs/evidence/`), lalu di-push ke repo publik atas konfirmasi founder. Berkas kredensial tetap dikecualikan.

Verification: 13 test gateway baru terhadap upstream tiruan lokal; suite 115/115 lulus dua kali berturut-turut; typecheck exit 0. Tidak ada request ke upstream nyata, deploy, atau email nyata.

## 0.17.0: Registry upstream, Git, dan penggabungan pekerjaan web Hermes

CR-015
Source: founder meminta kerja paralel dengan Hermes, memberi alamat repo GitHub, dan meminta lanjut. Decision owner: founder.

Server (Claude):
- Migrasi 007: `upstream` dan `route`. `src/netguard.ts`: base URL wajib HTTPS, port 443, nama host publik, tanpa kredensial/query, dan semua alamat hasil resolusi harus publik (loopback, privat, link-local, metadata dan IPv4-mapped ditolak). `src/upstreams.ts` dan rute admin: buat/ubah upstream, API key disegel AES-GCM dan tidak pernah dikembalikan, ubah base URL wajib memasukkan ulang key, status eligibility dengan alasan, route per model dan protokol, `candidatesFor` untuk gateway (hanya protokol sama, upstream ELIGIBLE, urut prioritas).
- Bug ditemukan test: subnet IPv4-mapped pada BlockList ikut mencocokkan IPv4 biasa sehingga semua alamat publik ditolak; diperbaiki.
- Permintaan Hermes dipenuhi: `entryId` pada receipt redeem (baru dan replay); `createdAt` pada receipt tambah saldo; `GET /admin/api/customers` berhalaman dengan filter awalan.
- Belum: cost profile dan margin guard (TASK-003), uji koneksi, pemeriksaan ulang alamat saat koneksi, circuit breaker, gateway (TASK-012).

Web (Hermes, digabung dari handoff/hermes-log.md; tidak diverifikasi ulang oleh Claude): SPA React di ../web/ untuk portal dan backoffice pada rute yang tersedia; Hermes melaporkan typecheck, build, unit test, 12 test browser, integrasi browser lokal dan `npm audit` lulus.

Git: repo diinisialisasi. Hanya README yang di-push ke GitHub karena repo itu publik; sisa proyek di-commit lokal dan belum di-push, menunggu keputusan founder soal visibilitas. `.gitignore` mengecualikan node_modules, .env dan berkas kredensial.

Temuan yang perlu tindakan founder: ada berkas kredensial OAuth Codex (akun langganan gratis milik alamat email pihak lain) di root proyek. Berkas itu tidak dibaca nilainya, tidak dipakai, dan dikecualikan dari Git. Rancangan tidak memakai kredensial langganan (RSK-016).

Catatan operasi: container database lokal sempat dihentikan proses lain di tengah suite (29 test gagal ECONNREFUSED); setelah dinyalakan lagi suite lulus. Agen jangan menghentikan `router-spike-pg` saat agen lain bekerja.

Verification: suite server 102/102 lulus; typecheck exit 0. Tidak ada dependency baru di server, deploy, upstream atau email nyata.

## 0.16.0: Upstream difinalkan founder; paket token dan kode redeem

CR-014
Source: founder 2026-11-14: lanjutkan dengan data dan risiko yang ada; API upstream difinalkan dan disetujui. Decision owner: founder.

Keputusan founder:
- Dahono Router dan DeepSeek final sebagai upstream; status eligible atas keputusan founder (ARCHITECTURE.md section 6). Ini keputusan dan penerimaan risiko oleh founder, bukan hasil verifikasi agen atas ketentuan penyedia. RSK-001 dan RSK-011 tetap terbuka sebagai risiko yang diterima.
- Risiko pada TOKEN_CREDIT.md section 3 (bobot output sama dengan input, utang lebih-pakai) diterima untuk sementara; default tetap bobot seragam sampai founder mengubahnya.
- Tidak berubah: upstream berbasis akun langganan tidak dirancang (RSK-016); request ke upstream nyata dan deploy tetap memerlukan izin tersendiri saat waktunya.

Ditulis dan dijalankan:
- Migrasi 006: `token_pack`, `voucher`, `redemption`; nilai dan syarat kode immutable, state akhir terminal, redemption append-only.
- `src/vouchers.ts` dan rute: paket token (admin buat/ubah, pelanggan lihat yang aktif); terbit kode sekali pakai dari paket atau jumlah token, jenis SALE atau PROMO, penerima dan kedaluwarsa opsional; cabut; daftar tersamar dengan total kewajiban token yang belum ditukar; redeem pelanggan.
- Kode: awalan ZR, 26 simbol dari alfabet 30 simbol tanpa karakter yang mudah tertukar (sekitar 127 bit), dari CSPRNG; hanya hash yang disimpan; tampil sekali. Normalisasi hanya huruf besar serta penghapusan spasi dan tanda hubung.
- Redeem: status kode, catatan penukaran dan kredit ledger dalam satu transaksi; kode salah, dicabut, kedaluwarsa, terikat ke pelanggan lain, atau sudah dipakai orang lain memberi jawaban yang sama; pemilik yang mengulang mendapat receipt yang sama. Batas 5 gagal per akun dan 30 per IP tiap 15 menit; batas tidak mengonsumsi kode.
- Promo: paket bertanda promo dan kode jenis PROMO, sesuai TOKEN_CREDIT.md section 3. OQ-009 dianggap terjawab dengan bentuk ini sampai founder meminta bentuk lain.

Penyimpangan dari BILLING_REDEEM.md FR-004 yang disengaja dan dicatat: tidak ada status DRAFT (kode langsung ACTIVE saat terbit); penggantian kode dilakukan dengan cabut lalu terbit baru pada referensi penjualan yang sama, tanpa tautan eksplisit ke kode lama selain referensi itu.

Verification: 9 test baru; suite 95/95 lulus dua kali berturut-turut; typecheck exit 0. Bukti ../server/test-result.txt. Tidak ada dependency baru, deploy, upstream atau email nyata.

## 0.15.0: Saldo menjadi kredit token

CR-013
Source: koreksi founder 2026-11-14 ("pelanggan belinya ... 10000 dapat 100000000 token") beserta diagram mxGraph. Decision owner: founder. Ini membatalkan tafsir agen pada CR-012 bahwa harga diisi sebagai tarif Rupiah per kategori, dan menggantikan ADR-005 (saldo Rupiah).

- TOKEN_CREDIT.md baru dan otoritatif untuk unit saldo: saldo kredit token, tagihan token dikali pengali model, Rupiah hanya harga tampilan paket, kode redeem bernilai token, lebih-pakai sampai 500.000 token. Dokumen lama yang menyebut Rupiah belum ditulis ulang; TOKEN_CREDIT.md menyatakan mana yang menang.
- Migrasi 005: label saldo dan harga menjadi TOKEN (nilai tidak diubah; belum ada data pelanggan nyata), tabel `system_setting` dengan batas lebih-pakai.
- Kode: `creditsToMicro`; top-up memakai `amountTokens`; harga model dapat diisi dengan pengali saja (tiap kategori default 1 kredit per token); aturan admission baru (saldo tersedia di atas nol, hold boleh menjangkau batas lebih-pakai) pada `placeHold` dan `placeKeyHold`; API admin untuk membaca dan mengubah batas lebih-pakai dengan step-up dan audit.
- Perubahan API yang tidak kompatibel: field `amountIdr` pada top-up diganti `amountTokens`. Belum ada klien selain test.
- Suite lama dijalankan dengan batas lebih-pakai nol agar pemeriksaan batas saldo ketatnya tetap bermakna; `test/overdraft.test.ts` menguji nilai default.

Belum ada: paket token, kode redeem, henti paksa di tengah stream, margin guard versi kredit. Akibat bisnis yang perlu diputuskan founder dicatat di TOKEN_CREDIT.md section 3.

Verification: 5 test baru; suite 86/86 lulus satu kali penuh setelah perubahan terakhir; typecheck exit 0. Upgrade dari database berisi data ke migrasi 005 tidak diuji terpisah. Tidak ada dependency baru, deploy, upstream atau email nyata.

## 0.14.0: Email SMTP, domain, promo, dan penegasan harga jual

CR-012
Source: jawaban founder 2026-11-14. Decision owner: founder.

CONFIRMED:
- Email: lewat email routing atau langsung Gmail (akun bisnis milik founder). ASM-006 terjawab sebagian.
- Domain layanan: zrouter.web.id.
- Founder menetapkan sendiri harga per model per sejuta token; pelanggan hanya melihat harga jual yang keluar dari router, bukan modal atau faktor. Ini sudah sesuai FR-001 dan FR-010; tidak ada perubahan kontrak.
- Founder ingin diskon promosi sejak awal. Ini mengubah scope: voucher promo/diskon sebelumnya P1 (PLANNING.md section 2). Bentuk promo belum dipilih, sehingga belum ada spesifikasi maupun kode; dicatat sebagai OQ-009.
- Founder tidak menyerahkan kredensial Dahono kepada agen dan akan mengurus program reseller sendiri (halaman pendaftaran reseller ada di dashboard Dahono). Sesuai rancangan: API key upstream dimasukkan founder lewat form admin, tidak pernah lewat agen. Status eligibility tetap pending sampai founder menyatakan pendaftaran selesai.

Ditulis dan dijalankan:
- `server/src/mailer.ts`: pengirim email SMTP generik, dipakai untuk undangan dan reset password. Aktif dengan MAILER=smtp dan variabel SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM, PUBLIC_BASE_URL, PRODUCT_NAME. Token sekali pakai diletakkan di fragment URL sehingga tidak ikut terkirim ke server atau tercatat di log akses.
- Dependency baru: nodemailer 10.5.0, lisensi MIT-0, tanpa dependency turunan dan tanpa install script, dari registry npm; alasan: klien SMTP dengan TLS dan autentikasi tidak layak ditulis sendiri. `npm audit` 0 kerentanan.
- Catatan: layanan email routing umumnya hanya meneruskan email masuk dan tidak mengirim; pengiriman memerlukan SMTP. Untuk Gmail itu berarti app password yang dibuat founder sendiri dan disetel sebagai SMTP_PASS di server.

Verification: 3 test baru terhadap server SMTP tiruan lokal; suite 81/81 lulus; typecheck exit 0. Tidak ada email nyata terkirim, tidak ada kredensial yang diminta atau dipakai, tidak ada deploy; domain belum dihubungkan ke apa pun.

OQ-009 OPEN: bentuk promo awal. Kandidat: (a) bonus saldo saat top-up, (b) diskon persen per model dengan tanggal berakhir, (c) saldo gratis untuk pelanggan baru. Owner founder.

## 0.13.0: Backend TASK-001 harga dan multiplier

CR-011
Source: founder meminta melanjutkan setelah pekerjaan Hermes (CR-009, CR-010). Scope lokal, tanpa gateway atau UI.

- Baseline diverifikasi lebih dulu: 69/69 test dan typecheck lulus pada pekerjaan Hermes, tanpa perubahan.
- Migrasi 004: `public_model` dan `price_version`; satu draft dan satu harga terbit per model; trigger membuat harga terbit immutable (hanya boleh ditarik) dan tidak dapat dihapus.
- `src/pricing.ts` dan rute admin: buat model, simpan draft, preview, publish, retire. Tarif berupa string integer mikro-IDR per sejuta token; faktor berupa string desimal maksimal 4 angka pecahan, dibatasi 0,1 sampai 100. Faktor kosong, nol, negatif, NaN, Infinity atau notasi eksponen ditolak; tidak ada default 1x.
- Publish dan retire memerlukan step-up, alasan dan pemeriksaan versi; publish paralel menghasilkan tepat satu harga terbit dan satu audit event berisi ringkasan sebelum/sesudah.
- `snapshotForAdmission` disiapkan untuk gateway: mengembalikan harga terbit atau null bila model tidak dijual. Harga lama tetap tersimpan sebagai RETIRED untuk settlement dan sengketa.
- ID model dapat memuat garis miring, sehingga dikirim lewat query string atau body, bukan path.

Belum dicakup dan bukan bagian klaim ini: pemeriksaan margin terhadap biaya upstream saat publish (TASK-003, menunggu cost profile dari TASK-013), katalog untuk pelanggan (TASK-011), UI SCR-003. Sampai TASK-003 ada, sistem tidak mencegah harga di bawah modal.

Verification: 9 test baru (TEST-001 untuk API); seluruh suite 78/78 lulus dua kali berturut-turut; typecheck exit 0. Bukti ../server/test-result.txt. Tidak ada dependency baru, deploy, upstream atau email nyata.

## 0.12.0: Backend TASK-010 API key

CR-010
Source: founder meminta "kerjakan nomor 1" pada daftar lanjutan, yaitu TASK-010 API key. Scope lokal saja, tanpa gateway inference atau UI.

- Migrasi 003 menambah key/verifier, policy/version, counter spent/held dan kaitan hold composite tenant-account-key; migrasi 001/002 tidak diubah.
- API buat, daftar/detail tersamar, ganti batas dan cabut oleh owner. Admin hanya daftar tersamar dan revoke dengan MFA/step-up. Secret rtr_ berentropi 256 bit tampil sekali; retry creation key tidak membuka secret lagi.
- Batas awal teknis 10 key aktif, scope maksimum 100 ID model, belanja lifetime key. Null dan [] berbeda untuk scope; cap "0" menolak biaya. Policy update replacement lengkap; key expired tidak diperpanjang. Ini bukan harga/cap bisnis pilot.
- Admission lokal mengunci tenant/account/key, memeriksa ulang scope/expiry/revoke, cap dan saldo sebelum membuat hold. Settlement lama otomatis memperbarui counter key sekali, termasuk setelah revoke/closure dan usage nol. Over-bound tetap dibukukan dan ditandai sesuai kontrak ledger, bukan disembunyikan.
- Closure mencabut seluruh key aktif dalam transaksi yang sama; stale session/principal ditolak pada mutasi key. Pemeriksa invariant mendeteksi counter key rusak. Audit gagal menyebabkan rollback mutasi.
- Test mencakup tenant negatif, CSRF, MFA/step-up, parallel quota/create/revoke/admission, race revoke/expiry/close setelah preflight, rollback audit, scan log HTTP nyata, no secret pada database/audit/daftar. Review statis independen selesai tanpa temuan tersisa setelah perbaikan parent.

Verification dijalankan: baseline 49/49 dan typecheck lulus; RED/GREEN dicatat per perubahan; suite sekarang 69/69 lulus dan typecheck exit 0. Hermes verify penuh dari root juga lulus: readiness HTTP 200 dan teardown. Upgrade populated 001+002 ke 003 lulus, financial/audit/legacy hold tidak berubah. Output suite berakhir dengan 69 test, 69 pass dan 0 fail. Bukti ../server/test-result.txt dan /root/router-task010-rcHSJCJh/; backup sebelum perubahan di direktori yang sama. Tidak ada deploy, email/upstream nyata, dependency baru atau commit.

Backend TASK-010 selesai untuk API/primitif lokal; UI SCR-008 dan gateway end-to-end tetap belum. Berikutnya TASK-001 harga dan multiplier; eligibility upstream tetap pending.

## 0.10.0: Serah terima dan sisa API M1

CR-009
Source: founder meminta melanjutkan HANDOFF.md dari butir pertama, menjalankan seluruh test sebelum/sesudah perubahan, lalu menyetujui penyelarasan status perencanaan usang dengan izin implementasi lokal. Tidak mencakup deploy, upstream/email nyata atau keputusan durasi retensi.

Ditulis dan dijalankan:
- Migrasi 002 baru; 001 tidak diubah. Versi tenant, pseudonim identitas tertutup, verifier username pensiun, larangan membuka ulang akun/tenant.
- API suspend/restore dengan step-up, alasan, version check dan satu audit event per perubahan. Admission memeriksa status tenant dengan lock dalam transaksi yang sama dengan hold. Portal saldo/riwayat tetap dapat dibuka saat suspend; hold lama tetap dapat di-settle sekali.
- API adjustment saldo sebagai string integer mikro-IDR bertanda; step-up, alasan, replay dan konkurensi memakai ledger.adjust; entri lama tidak berubah.
- API tutup akun hanya untuk owner terautentikasi, konfirmasi username, password saat ini dan expectedVersion. Identitas profil/undangan disamarkan; semua sesi/reset dicabut; username lama tidak dapat dipakai ulang. Bukti ledger dan audit append-only tetap utuh; saldo/hold tidak dihapus dan tidak ada refund otomatis.
- Review independen menemukan urutan lock aktivasi/closure terbalik; regresi menangkapnya dan urutannya disamakan (email sebelum username dan invite, termasuk createInvite agar tidak membuat undangan lama sesudah aktivasi). Review pertama gagal memberikan hasil relevan dan tidak dihitung sebagai persetujuan.
- Race dengan login, permintaan/penyelesaian reset dan ganti password diuji memakai gerbang query nyata. Status/hash identitas diperiksa ulang di bawah lock; urutan user sebelum session/reset konsisten. Limit password salah saat closure terserialisasi, termasuk request paralel.
- Manifest/TASKS/README diselaraskan. Penutupan akun adalah subset TASK-021, bukan pemenuhan seluruh FR-019: durasi/job retensi dan pemeriksaan body inference menunggu pekerjaan berikutnya. Audit historis masih membawa email/username dari event onboarding lama dan tidak ditulis ulang; batas ini diungkap di README.

Verification: baseline 26/26 lulus; RED fitur/race/limiter/urutan-lock direkam, lalu 49/49 test dan typecheck lulus terhadap router_test lokal. Bukti di ../server/test-result.txt dan /root/router-handoff-baseline-z7tKxkG8/. Uji upgrade 001 ke 002 dengan ledger/audit/balance yang sudah berisi fixture juga lulus tanpa perubahan bukti lama atau kebocoran koneksi. Tidak ada Git metadata sehingga tidak ada diff/commit. Tidak ada dependency baru, deploy, upstream nyata, email nyata, pembelian atau perubahan eligibility.

## 0.9.0: Implementasi M1 dimulai

CR-008
Source: founder mengizinkan memulai kode produksi ("gas mulai"). Decision owner: founder.

- ../server/ dibuat: migrasi skema dasar, modul uang, ledger, identitas, admin, audit, pembatas laju, API HTTP, skrip bootstrap admin. 26 test integrasi lulus tiga kali berturut-turut; `tsc --noEmit` bersih; `npm audit` 0 kerentanan.
- Pustaka server dipilih (ARCHITECTURE.md section 9). Argon2id memakai bawaan Node; TOTP diimplementasikan sendiri dan dicocokkan dengan vektor RFC 6238.
- Nilai yang diserahkan kontrak ke implementasi (masa berlaku undangan dan sesi, ambang pembatas laju, panjang password, parameter Argon2id) ditetapkan dan didaftar di ../server/README.md sebagai nilai awal.
- Penyimpangan dari teks rencana yang ditemukan saat implementasi: SECURITY.md ABU-001 menyebut batas login "per akun dan per IP". Batas per akun saja memungkinkan penyerang mengunci pemilik akun, sehingga implementasi memakai tiga lapis (per pasangan akun dan IP, per IP, per akun lintas IP). SECURITY.md v0.3.1 disesuaikan dengan implementasi.
- Email: belum ada penyedia. Server menolak start kecuali operator menyetel MAILER=none secara eksplisit, dan pada mode itu undangan tercatat tetapi tidak terkirim.
- AGENTS.md diperbarui: implementasi diizinkan, perintah verifikasi diisi dengan yang sudah dijalankan.

- Maskot (TASK-028): masih belum dibuat. Layanan Figma merespons sebagian: satu berkas kosong "Maskot produk - eksplorasi" berhasil dibuat di draft founder (https://www.figma.com/design/cdt227OEW9aNzddzCoHofT), tetapi dua panggilan pembuatan gambar gagal dengan error layanan sebelum ada gambar atau kredit yang terpakai. Rancangan maskot yang dipakai pada percobaan: karakter orisinal, potongan rambut bob biru navy dengan jepit bintang emas, jaket bomber coral, latar cream, gaya anime bergaris bersih dengan pewarnaan datar; sengaja tidak menyerupai karakter pada gambar referensi.

Lingkungan yang disentuh: database `router_test` dibuat pada container lokal `router-spike-pg`; paket npm dipasang di ../server/. Tidak ada deploy, tidak ada request ke upstream, tidak ada email terkirim.

## 0.8.0: Spike TASK-006

CR-007
Source: founder mengizinkan memulai spike ("silahkan mulai"), meminta maskot dibuat lewat alat yang tersedia, dan menyatakan upstream dilanjutkan selama diperbolehkan. Decision owner: founder.

- Spike ditulis dan dijalankan di ../spike/: gateway percobaan, upstream tiruan dua protokol, 14 test lulus tiga kali berturut-turut, benchmark overhead. Laporan dan batasnya di ../spike/README.md.
- Temuan yang masuk dokumen: RSK-009 terbukti dapat terjadi (estimasi input dari ukuran body tidak cukup); RSK-017 baru (penguncian per akun membuat request satu tenant bergiliran); NFR-002 diberi angka terukur dan target PROPOSED; ADR-004 mencatat hasil spike.
- Bug kebocoran koneksi database pada jalur penolakan ditemukan oleh test dan diperbaiki di kode spike.
- Status upstream tidak berubah: tetap pending. Pernyataan founder bahwa ia hanya ingin yang diperbolehkan dicatat sebagai arah; itu bukan bukti izin dari penyedia.
- Maskot: belum dibuat. Satu-satunya alat pembuat gambar yang tersedia pada sesi ini adalah Figma, dan empat panggilan ke layanannya gagal (timeout dan internal server error) sebelum ada berkas atau kredit yang terpakai. Gambar dari Pinterest tidak diambil karena merupakan karya pihak lain tanpa hak pakai (ASM-009). TASK-028 tetap PLANNED.

Lingkungan yang disentuh: container Docker lokal `router-spike-pg` (PostgreSQL 18, terikat ke 127.0.0.1:55432) dibuat untuk spike; satu paket npm (`pg`) dipasang di ../spike/. Tidak ada request ke upstream nyata dan tidak ada deploy.

## 0.7.0: Dahono Router, fallback, keputusan stack dan arah visual anime

CR-006
Source: jawaban founder atas pertanyaan pada akhir v0.6.0, beserta gambar referensi `Portrait Version.jpg`. Decision owner: founder.

CONFIRMED:
- "Dahono" adalah Dahono Router, https://dhn.ai.id/.
- "API dari Codex" mencakup API berbayar dan akses dari langganan.
- Smart routing dengan fallback untuk stream.
- Usage hilang: mengikuti rekomendasi, yaitu debit estimasi (OQ-006 CLOSED).
- Stack TypeScript/Node.js, PostgreSQL, React disetujui (ADR-004).
- Arah visual: gaya anime mengikuti gambar referensi, digabung dengan design system yang sudah direncanakan.

Dampak:
- Register upstream dan ADAPTERS.md section 3 diisi untuk Dahono Router dari halaman yang diambil pada sesi ini: kompatibel OpenAI dan Anthropic, harga Rupiah, kuota Token Plan, token ter-cache dihitung sebagai input, HTTP 402 saat kuota habis, dan program reseller resmi untuk paket token AI.
- ARCHITECTURE.md section 10 baru: pemilihan route, fallback sebelum byte pertama dengan satu debit, circuit breaker, aturan stream. FR-012 dan TEST-012 diperbarui.
- DESIGN.md v0.2.0: dua lapisan (sistem Navy/Blue/Gold dan brand anime editorial), analisis gambar referensi dengan nilai ESTIMATED, token brand, aturan gabungan, aturan aset. Warna danger digelapkan agar berbeda dari coral. UX.md section 7 menetapkan tingkat pemakaian per layar. CMP-036, CMP-037, UAR-042, UAR-043 dan TASK-028 ditambahkan.

Keputusan desain yang berbeda dari yang disebut founder, dicatat agar terlihat:
- Akses upstream dari akun langganan tidak dirancang dan tidak akan ditandai eligible (RSK-016). Hanya upstream berautentikasi API key berbayar yang didukung.
- Karakter pada gambar referensi berasal dari karya pihak lain dan tidak dipakai atau ditiru; maskot harus karya orisinal dengan hak pakai yang jelas (ASM-009, OQ-008).

Compatibility/migration: tidak ada kode atau data. ID existing tidak dinomori ulang. Penomoran section UX.md bergeser: "Keputusan yang belum selesai" menjadi section 8.

Verification: pemeriksaan dokumen deterministik dijalankan ulang. Tidak ada pendaftaran, pembelian, request ke upstream, atau kode aplikasi.

## 0.6.0: Design, komponen, adapter DeepSeek, instruksi agen

CR-005
Source: instruksi founder untuk melanjutkan; pekerjaan yang pada manifest v0.5.0 tercatat dapat dikerjakan tanpa jawaban. Tiga pertanyaan pada akhir v0.5.0 belum dijawab dan tetap terbuka.

Ditambahkan:
- DESIGN.md: token warna, tipografi, spasi, gerak dari arah Navy/Blue/Gold yang masih PROPOSED; rasio kontras dihitung dari nilai hex dan disimpan di evidence/2026-11-13-design/contrast.json. Itu hitungan atas nilai token, bukan pengujian UI.
- DSD.md: CMP-001 sampai CMP-035 dengan UAR, dan spesifikasi rinci untuk shell, field uang dan desimal, tabel, dialog konfirmasi dan step-up, tampilan secret, receipt.
- ADAPTERS.md: kontrak adapter DeepSeek dari dokumentasinya (endpoint tiga protokol, pemetaan usage termasuk cache, batas output, error, konkurensi per akun, isolasi per pengguna) dan daftar hal yang belum diketahui. Tidak ada request yang dikirim.
- ../AGENTS.md: instruksi agen coding. Menyatakan implementasi belum boleh dimulai dan bagian perintah verifikasi sengaja kosong.
- ARCHITECTURE.md section 9: kandidat pustaka dengan versi dan lisensi dari metadata registry npm. Pilihan akhir belum dibuat.
- UAR-039 sampai UAR-041 (checkbox, textarea, progress).

Status task: TASK-022 dan TASK-027 draft ditulis; TASK-020 dan TASK-024 sebagian. Tidak ada task implementasi yang dimulai.

Verification: pemeriksaan dokumen deterministik dijalankan ulang. Tidak ada dependency dipasang, tidak ada kode aplikasi.

## 0.5.0: Multi-upstream, username, tambah saldo langsung, usage nol

CR-004
Source: jawaban founder atas pertanyaan pada akhir v0.4.0. Decision owner: founder.

CONFIRMED:
- Sumber upstream lebih dari satu: "Dahono" (ejaan founder), DeepSeek, "API dari Codex" dan lainnya. Gateway memilih upstream berdasarkan model yang dipanggil.
- Implementasi oleh agen coding.
- Founder memantau usage tiap pelanggan dan dapat menambah saldo langsung lewat username pelanggan. Pelanggan mencabut API key sendiri.
- Request dengan nol token input dan nol token output tidak dikenakan biaya.

Dampak:
- FR-012: beberapa upstream aktif pada P0, routing per model dan protokol; routing berdasarkan isi prompt tidak termasuk.
- FR-006: username unik per akun. FR-014: pencarian lewat username, pemakaian per pelanggan (API-040), tambah saldo langsung (jenis ledger GRANT_ADMIN_TOPUP), cabut key oleh admin. FLOW-008 ditambahkan.
- BILLING_REDEEM.md v0.1.1: aturan usage nol pada FR-002. ARCHITECTURE.md section 2 membedakan usage nol dari usage hilang; yang kedua masih PROPOSED (OQ-006 PARTIAL). TEST-020 dan ABU-008 ditambahkan; RSK-014 mencatat celah penyalahgunaan.
- ADR-004 dari TBD menjadi PROPOSED: TypeScript pada Node.js, PostgreSQL, React. Pustaka spesifik belum dipilih. OQ-005 CLOSED. TASK-027 (AGENTS.md) ditambahkan. RSK-015 mencatat ketiadaan reviewer manusia kedua.
- Register upstream diisi tiga entri berstatus pending. DeepSeek diperiksa dari dokumentasi dan ketentuan Open Platform yang diambil pada sesi ini: menyediakan format OpenAI, Anthropic dan Responses; harga USD dengan tarif peak dan off-peak. "Dahono" dan "API dari Codex" belum teridentifikasi (E0). RSK-016 mencatat bahwa sumber berbasis akun langganan tidak didukung.

Compatibility/migration: tidak ada kode atau data. ID existing tidak dinomori ulang.

Verification: pemeriksaan dokumen deterministik dijalankan ulang. Tidak ada request ke upstream mana pun, tidak ada API key yang diminta atau dipakai.

## 0.4.0: Upstream reseller, tool target dan Rupiah

CR-003
Source: jawaban founder atas tiga pertanyaan pada akhir v0.3.0. Decision owner: founder.

CONFIRMED:
- Upstream adalah API provider lain yang dijual kembali. Backoffice menyediakan input API key dan base URL upstream.
- Tool target: Hermes, OpenCode, ZCode, Codex, Claude Code dan sejenisnya.
- Saldo Rupiah pada MVP; USD setelah sistem stabil.

Dampak:
- OQ-002 dan OQ-003 PARTIAL, OQ-004 CLOSED untuk currency (DISCOVERY.md v0.2.1). OQ-007 baru: nama provider, format API yang disediakan, izin penjualan kembali.
- ADR-002 diganti: dari asumsi satu protokol menjadi tiga permukaan (Chat Completions, Anthropic Messages, Responses) tanpa translasi, dirilis bertahap. Dasar: dokumentasi resmi Claude Code, Codex dan OpenCode yang diambil pada sesi ini; Hermes dan ZCode hanya dari sumber pihak ketiga dan ditandai E0.
- ADR-001 ditinjau karena revisit trigger terpenuhi; opsi bangun sendiri dipertahankan dengan syarat spike mencakup dua permukaan.
- ADR-005: IDR CONFIRMED; USD DEFERRED dengan jalur penambahan tanpa konversi saldo otomatis.
- FR-011, FR-012, FR-018 dan AC terkait diperbarui; API-003 sampai API-005 ditambahkan; entity upstream, route dan cost profile memuat base URL, protokol dan kurs.
- THR-017 (base URL mengarah ke alamat internal atau pihak lain) dan THR-018 (perilaku upstream reseller) beserta kontrolnya ditambahkan. RSK-011 sampai RSK-013 ditambahkan.
- SCR-016 memuat form base URL, API key dan uji koneksi; copy terkait ditambahkan. TASK-025 dan TASK-026 ditambahkan; TEST-011 dan TEST-012 diperluas.

Compatibility/migration: tidak ada kode atau data. ID existing tidak dinomori ulang. BILLING_REDEEM.md tidak diubah; kandidat IDR di dalamnya kini terkonfirmasi sebagai currency MVP, sedangkan presisi mikro-unit tetap usulan.

Belum terjawab oleh CR-003: izin penjualan kembali dari provider upstream. Masukan API key dan base URL membuat koneksi mungkin secara teknis; itu bukan bukti hak komersial, dan upstream tetap berstatus pending sampai ketentuannya dibaca.

Verification: pemeriksaan dokumen deterministik dijalankan ulang; hasil di evidence/2026-11-13-blueprint/doc-check.json. Tidak ada tool yang diuji dan tidak ada request ke upstream.

## 0.3.0: Paket blueprint pilot

CR-002
Source: instruksi founder untuk membaca state dan melanjutkan; next action pada manifest v0.2.0.

Ditambahkan:
- PLANNING.md: scope pilot undangan, FR-006 sampai FR-019 dengan AC, NFR-001 sampai NFR-010, milestone, ASM-005 sampai 008, RSK-008 sampai 010, OQ-005 dan OQ-006.
- ARCHITECTURE.md: topologi, state request, admission, kontrak data, API-001 sampai API-039, ADR-001 sampai ADR-005.
- SECURITY.md: peran dan matriks izin, THR/CTL-001 sampai 016, ABU-001 sampai 007, kebijakan data.
- UX.md: SCR-004 sampai SCR-018, FLOW-001 sampai FLOW-007, state dan draft copy.
- UI_REFERENCES.md: UAR-011 sampai UAR-037 dari 28 halaman dokumentasi UIArc Free yang diambil pada sesi ini (27 halaman unik; halaman Login and sign up sama dengan snapshot awal), dan UAR-038 CUSTOM_GAP navigasi.
- TASKS.md: TASK-006 sampai TASK-024, TEST-006 sampai TEST-019, traceability 19 FR.

Keputusan yang diusulkan pada versi ini, semuanya PROPOSED atau ASSUMED dan belum disetujui founder: pilot bersifat undangan dengan registrasi terbuka dipindah ke P1; bangun sendiri sebagai modular monolith (ADR-001); default protokol perencanaan OpenAI-compatible Chat Completions (ADR-002, confidence rendah); PostgreSQL (ADR-003); email dan password untuk pelanggan, TOTP dan step-up untuk admin; idempotency inference tidak dijanjikan pada P0.

Tidak diubah: DISCOVERY.md, BILLING_REDEEM.md, snapshot evidence lama, kedua file input.

Koreksi: catatan v0.2.0 menyatakan inventaris checksum diperbarui dan hasil pemeriksaan revisi tersimpan di evidence/2026-11-13-redeem/. Saat sesi ini dimulai, SHA256SUMS.txt masih memuat digest citations.json yang lama dan doc-check.json serta billing-example.json di folder itu tidak ada. Checksum dibuat ulang, billing-example.json dibuat, dan pemeriksaan dijalankan pada sesi ini; hasil di evidence/2026-11-13-blueprint/doc-check.json.

Verification: pemeriksaan dokumen deterministik saja (hash input, marker akhir, resolusi ID, traceability, kecocokan kutipan dengan snapshot, digest snapshot, aritmetika contoh). Bukan test aplikasi. Tidak ada request berbiaya, pembelian, instalasi dependency, atau perubahan layanan.

## 0.2.0: Klarifikasi model usaha, redeem manual dan multiplier

CR-001
Source: jawaban founder pada sesi planning setelah discovery awal.

CONFIRMED:
- Menjual akses API token AI.
- Top-up manual menggunakan kode redeem dari admin, yaitu founder.
- Perhitungan pemakaian/biaya input, output dan cache.
- Target pengguna tools AI, tanpa daftar tool/protokol prioritas yang sudah ditetapkan.
- Fitur admin pengaturan multiplier token per model adalah P0, dengan tujuan pengendalian risiko rugi.

Perubahan scope:
- OQ-001 closed, OQ-003 partial. OQ-002 sumber upstream tetap open karena jawaban metering tidak mengidentifikasi supply.
- Payment gateway, checkout otomatis, webhook bank dan pemrosesan kartu dikeluarkan dari P0. Kode top-up biasa bukan lagi backlog promo.
- Menambah BILLING_REDEEM.md sebagai sumber kanonis awal FR-001 sampai FR-005, AC-001 sampai AC-005, TASK-001 sampai TASK-005 dan TEST-001 sampai TEST-005 untuk scope terbatas pricing/metering/redeem. Status seluruh task PLANNED, bukan completed/Ready.
- Mencatat proposed saldo bernilai uang, normalisasi cache eksklusif, model multiplier positif, price snapshot, margin/route-cost guard, voucher single-use dan atomic redeem. Detail tersebut proposal engineering, bukan angka harga atau kebijakan akhir yang sudah disetujui.
- UAR-007 sampai UAR-010 dan calon SCR-001 sampai SCR-003 ditambahkan pada BILLING_REDEEM.md, melengkapi map awal tanpa mengklaim coverage UI penuh.
- Menambahkan OQ-004 unit/currency saldo dan tarif/nominal; tidak mengarang angka komersial.

Compatibility/migration:
- Tidak ada kode atau data aplikasi; tidak ada migrasi produksi.
- DISCOVERY v0.1.0 direvisi menjadi v0.2.0, demikian pula manifest. Input STARTER_PROMPT_v7.0.md dan PLANNING_v7.0.md dipertahankan.
- Citation ledger pada evidence/2026-11-13/citations.json diperluas secara append-only untuk source IDs baru. Inventaris checksum diperbarui sesuai byte ledger terkini; snapshot source lama tidak diedit. doc-check.json lama adalah bukti pemeriksaan awal v0.1.0, bukan pemeriksaan revisi ini.

Verification:
- Pemeriksaan revisi dan simulasi arithmetic tersimpan pada evidence/2026-11-13-redeem/doc-check.json dan billing-example.json setelah eksekusi.
- Snapshot dokumentasi tambahan pada evidence/2026-11-13-redeem/uiarc/. Fetch extractor 403; fetch alternatif read-only HTTPS berhasil, status/digest tersimpan di fetch-results.json.
- Rencana concurrency/authorization/margin/redeem belum diuji pada software aplikasi. Tidak ada kode redeem nyata, transaksi, atau request upstream berbiaya.

## 0.1.0: Intake dan discovery awal

- Membaca seluruh starter dan kontrak v7.0.0; canary aktual dicocokkan.
- Menulis discovery, manifest dan snapshot referensi.
- Model usaha/supply/customer masih usulan saat versi ini dibuat.
- Gate A saja; tidak ada implementasi atau deploy.

<!-- END ROUTER-CHANGELOG v0.37.0 -->
