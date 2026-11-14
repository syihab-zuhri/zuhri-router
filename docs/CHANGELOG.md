# Changelog: Router AI Komersial

Version: 0.18.0
Status: Recorded changes, bukan persetujuan seluruh blueprint
Updated: 2026-11-14, Asia/Jakarta
Owner keputusan: founder

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

<!-- END ROUTER-CHANGELOG v0.18.0 -->
