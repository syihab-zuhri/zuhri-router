# Planning: Router AI Komersial

Version: 0.4.1
Status: Draft, basis blueprint; belum disetujui founder
Owner keputusan: founder
Updated: 2026-11-13, Asia/Jakarta
Kontrak: ../PLANNING_v7.0.md v7.0.0
Dependencies: DISCOVERY.md v0.2.0; BILLING_REDEEM.md v0.1.0
Evidence: E1 (rencana). Tidak ada kode, test aplikasi, atau deployment.

Dokumen ini sumber otoritatif untuk tujuan, scope rilis, FR/NFR dan AC di luar scope billing/redeem. FR-001 sampai FR-005 tetap kanonis di BILLING_REDEEM.md dan tidak didefinisikan ulang di sini.

## 1. Outcome dan batas

CONFIRMED (founder): menjual akses API token AI secara prabayar; top-up manual lewat kode redeem yang diterbitkan admin founder; biaya dihitung dari input, output dan cache; multiplier per model diatur admin; pembeli adalah pengguna tools AI. Ditambah lewat CR-003: upstream adalah API provider lain yang dijual kembali, admin memasukkan API key dan base URL upstream; tool target Hermes, OpenCode, ZCode, Codex, Claude Code dan sejenisnya; saldo Rupiah pada MVP, USD setelah sistem stabil. Ditambah lewat CR-004: sumber upstream lebih dari satu ("Dahono", DeepSeek, "API dari Codex" dan lainnya) dengan routing berdasarkan model yang dipanggil; implementasi dikerjakan agen coding; founder memantau usage tiap pelanggan dan dapat menambah saldo langsung lewat username pelanggan; pelanggan mencabut API key sendiri; request dengan nol token input dan output tidak dikenakan biaya. Ditambah lewat CR-006: Dahono adalah Dahono Router (dhn.ai.id); smart routing dengan fallback untuk stream; usage hilang mengikuti rekomendasi (debit estimasi); stack disetujui; arah visual bergaya anime editorial mengikuti gambar referensi founder, digabung dengan design system yang sudah direncanakan.

Outcome rilis pilot yang diusulkan (PROPOSED):
- Pelanggan undangan dapat mengaktifkan akun, menukar kode, membuat API key, memakai minimal satu model lewat tool yang didukung, dan melihat biaya tiap request.
- Founder dapat menetapkan harga, menerbitkan kode, melihat selisih proyeksi dan hasil rekonsiliasi, serta menghentikan penjualan dengan cepat ketika biaya tidak terkendali.
- Setiap rupiah/unit saldo dapat ditelusuri dari kode redeem sampai debit request.

Kriteria keberhasilan pilot belum bernilai angka. Definisi metrik ada di DISCOVERY.md section 3; nilai target ditetapkan bersama kapasitas pilot (OQ-003).

## 2. Scope rilis

P0 pada dokumen ini adalah rilis **pilot berbayar undangan**, bukan peluncuran publik terbuka. Rilis publik adalah scope terpisah yang memerlukan penilaian gate sendiri.

| Prioritas | Isi | Sumber requirement |
|---|---|---|
| P0 | Akun undangan dan sesi; autentikasi admin diperkuat; tenant boundary; API key; katalog model dan harga; tiga permukaan protokol gateway yang dirilis bertahap tanpa translasi antar-protokol; registry upstream dan routing terbatas; pricing/multiplier, metering, margin guard, voucher, redeem; tampilan saldo/usage/ledger; backoffice tenant; rekonsiliasi; audit; operasi dasar; panduan integrasi; kebijakan data | FR-001 sampai FR-019 |
| P1 | Saldo USD dan multi-currency, translasi antar-protokol, tim/RBAC, budget per proyek, export, notifikasi, protokol/provider tambahan, paket bulanan, voucher promo, BYOK, status page, registrasi terbuka | DISCOVERY.md section 5 |
| P2 | Reseller/white-label, SSO, dedicated pool, multi-region, modality lain | DISCOVERY.md section 5 |
| Out-of-scope | Payment gateway/checkout/webhook, playground, eksekusi tool pelanggan di server, hosting model sendiri, akun subscription bersama, dompet yang dapat ditransfer/dicairkan | DISCOVERY.md section 5; CR-001 |

Registrasi terbuka dipindahkan ke P1 (PROPOSED) agar pilot tidak membutuhkan kontrol anti-abuse pendaftaran massal. Jika founder ingin pendaftaran terbuka sejak awal, itu change request yang mengaktifkan modul abuse registrasi di SECURITY.md section 4.

## 3. Tailoring dan applicability

Sumbu tailoring tidak berubah dari DISCOVERY.md section 4. Ledger berikut memperbarui status modul untuk P0; baris yang tidak tercantum mengikuti discovery.

| Modul | Status | Lokasi otoritatif / alasan |
|---|---|---|
| Requirement dan scope | APPLIES | Dokumen ini; BILLING_REDEEM.md untuk FR-001 sampai FR-005 |
| Arsitektur, data, interface | APPLIES | ARCHITECTURE.md |
| Permission, threat, abuse, privasi | APPLIES | SECURITY.md |
| UX, layar, copy | APPLIES | UX.md |
| Referensi UIArc | APPLIES | UI_REFERENCES.md; definisi UAR-001 sampai UAR-010 tetap di dokumen asalnya |
| Token visual dan spesifikasi komponen | APPLIES | DESIGN.md, DSD.md (draft; arah brand menunggu konfirmasi founder) |
| Semantic per upstream | APPLIES | ADAPTERS.md; baru DeepSeek |
| Instruksi agen coding | APPLIES | ../AGENTS.md (draft; perintah verifikasi belum ada) |
| Task, test specification, traceability | APPLIES | TASKS.md |
| Environment dan runbook | DEFERRED ke setelah ADR-001/ADR-004 | Bergantung stack dan host; kebutuhan minimum sudah di FR-017 |
| Fitur AI milik produk (eval model, prompt) | N/A | Produk meneruskan request; tidak menghasilkan konten sendiri. Uji kompatibilitas protokol tetap berlaku (FR-011) |
| Analytics produk | DEFERRED | Metrik pilot dihitung dari data operasional; instrumentasi klien pihak ketiga tidak direncanakan |
| Email transaksional | APPLIES, DELEGATED sebagian | Undangan dan reset memerlukan pengiriman email; provider belum dipilih (ASM-006) |
| Pajak, PSE/PDP, syarat usaha | UNKNOWN | Owner founder; tidak dinilai di paket ini |
| Hak komersial upstream | UNKNOWN; upstream berupa reseller (CR-003), ketentuannya belum dibaca | OQ-007; register di ARCHITECTURE.md section 6 |

## 4. Requirement fungsional P0 (di luar billing/redeem)

Semua rincian engineering berstatus PROPOSED kecuali disebut CONFIRMED. Aktor dan izin kanonis di SECURITY.md section 2; operasi di ARCHITECTURE.md section 5; layar di UX.md.

### FR-006: Akun pelanggan dan sesi

Pelanggan masuk hanya lewat undangan admin. Tautan undangan sekali pakai dan berbatas waktu; aktivasi menetapkan password. Setiap akun memiliki username unik yang dipilih saat aktivasi dan dipakai admin untuk menemukan pelanggan. Login memakai username atau email dan password; pemulihan lewat tautan reset sekali pakai. Sesi disimpan di server, dapat dicabut, dan berakhir setelah idle serta batas absolut. Pesan login dan reset tidak mengungkap apakah email terdaftar.

AC-006: Given undangan aktif, When pelanggan mengaktifkan, Then akun dan tenant terbentuk tepat sekali dan undangan tidak dapat dipakai ulang. Failure: undangan kedaluwarsa/terpakai ditolak dengan arahan menghubungi admin; reset untuk email tak dikenal memberi respons yang sama dengan email terdaftar; percobaan login berulang dibatasi tanpa mengunci akun secara global. Verification: TEST-006.

### FR-007: Autentikasi admin

Akun admin tidak dapat dibuat lewat alur publik. Faktor kedua TOTP wajib. Aksi keuangan (terbit/cabut kode, publish harga, adjustment saldo, mengubah kill switch, mengubah upstream) meminta verifikasi ulang bila sesi melewati umur tertentu. Sesi admin lebih pendek daripada sesi pelanggan.

AC-007: Given admin tanpa faktor kedua yang lolos, When memanggil operasi admin, Then ditolak. Given sesi admin lebih tua dari ambang step-up, When menerbitkan kode, Then diminta verifikasi ulang dan tidak ada voucher yang terbentuk sebelum lolos. Failure: kode TOTP salah berulang dibatasi; kehilangan perangkat memakai recovery code sekali pakai. Verification: TEST-007.

### FR-008: Batas tenant

Setiap resource pelanggan (key, request, usage, ledger, redemption, sesi) memiliki tenant pemilik. Semua pembacaan dan perubahan difilter berdasarkan tenant dari sesi atau key di server. P0: satu owner per tenant; struktur keanggotaan disiapkan tanpa UI tim.

AC-008: Given tenant A dan B, When A meminta resource B dengan ID yang benar, Then respons sama dengan resource tidak ada dan tidak memuat data B. Verification: TEST-008.

### FR-009: API key

Pelanggan membuat key bernama dengan batas opsional: daftar model, batas belanja, tanggal berakhir. Secret ditampilkan sekali; server menyimpan verifier dan prefix tersamar. Revoke langsung menolak request baru. Request yang sudah admitted saat revoke boleh selesai dan di-settle normal. Waktu pemakaian terakhir dicatat secara kasar.

AC-009: Given key baru, When daftar key dibuka kembali, Then secret tidak dapat diambil. Given key dicabut, When request baru memakai key itu, Then ditolak dengan error autentikasi terstruktur; request yang sedang berjalan tetap berakhir dengan settlement tunggal. Batas belanja key tidak terlampaui oleh request paralel. Verification: TEST-009.

### FR-010: Katalog model dan harga

Pelanggan melihat model yang dijual, tarif jual efektif per kategori token, kemampuan dan batas yang sudah diperiksa. Model tampil hanya bila memiliki price version published dan minimal satu route eligible. Biaya modal dan faktor internal admin tidak ditampilkan.

AC-010: Given model tanpa harga published atau tanpa route eligible, When katalog diminta lewat portal atau endpoint daftar model, Then model tidak muncul dan request ke model itu ditolak sebelum dispatch. Tarif yang tampil sama dengan tarif pada snapshot request baru. Verification: TEST-010.

### FR-011: Endpoint inference gateway

Tool target membutuhkan tiga permukaan protokol (ADR-002): OpenAI-compatible Chat Completions, Anthropic Messages, dan OpenAI Responses. Ketiganya P0 dan dirilis bertahap; sebuah tool baru dinyatakan didukung setelah fixture-nya lulus. Request pada satu permukaan hanya diteruskan ke endpoint upstream yang berbicara protokol yang sama; gateway tidak menerjemahkan antar-protokol pada P0. Header dan field yang diwajibkan tool diteruskan apa adanya sesuai kontrak adapter. Endpoint mengautentikasi API key, memvalidasi request, menjalankan admission (FR-002), meneruskan ke upstream, dan mengembalikan respons streaming maupun non-streaming. Setiap respons membawa request ID. Batas ukuran body, output maksimum, durasi dan konkurensi diberlakukan di server. Error memakai bentuk protokol permukaan yang dipanggil ditambah kode stabil milik produk. Kredensial diterima pada header yang dipakai tiap tool (Authorization Bearer atau x-api-key).

AC-011: Given saldo cukup dan model enabled, When request valid dikirim, Then respons mengikuti semantic protokol dan usage yang dilaporkan adalah raw usage. Given klien memutus koneksi, Then upstream dibatalkan sebisa didukung dan request berakhir pada state yang tercatat. Failure: saldo kurang, model tidak dijual, batas terlampaui dan upstream gagal masing-masing memberi error berbeda tanpa membocorkan credential atau detail upstream. Fixture kompatibilitas per permukaan mencakup stream chunk, event keep-alive, tool-call, usage termasuk cache, finish reason, Unicode dan pembatalan. Model yang upstream-nya tidak menyediakan protokol suatu permukaan ditolak di permukaan itu dengan `model_not_available`. Verification: TEST-011.

### FR-012: Registry upstream dan routing

Admin mendaftarkan upstream lewat form backoffice: nama penyedia, base URL per protokol yang disediakan upstream, API key (disimpan sebagai secret, tidak dapat dibaca ulang, dapat diganti), pemetaan model publik ke model upstream, cost profile berversi beserta currency dan kurs, serta status eligibility (eligible/blocked/pending). Base URL divalidasi di server (CTL-017). Tersedia uji koneksi yang tidak menimbulkan biaya bila upstream menyediakan endpoint semacam itu; bila tidak, uji koneksi ditandai tidak tersedia dan bukan dianggap lulus. Beberapa upstream aktif bersamaan pada P0. Routing ditentukan oleh model yang dipanggil: setiap model publik dipetakan admin ke satu atau lebih route (upstream, model upstream, protokol), dan gateway memilih route milik model itu yang berprotokol sama dengan permukaan yang dipanggil, eligible, sehat, dan berprioritas tertinggi. Pelanggan cukup menyebut nama model; ia tidak memilih upstream. Routing berdasarkan isi prompt atau penilaian kualitas tidak termasuk P0. Hanya route eligible dengan cost profile lengkap dan lolos floor (FR-003) yang dipakai. Route cadangan hanya untuk model yang sama dan harganya memakai snapshot yang sama. Fallback (CONFIRMED kebutuhan founder, rincian PROPOSED di ARCHITECTURE.md section 10): bila route terpilih gagal sebelum byte pertama dikirim ke klien, gateway mencoba route berikutnya untuk model itu sampai batas percobaan dan tenggat total; pelanggan didebit sekali. Setelah stream dimulai tidak ada fallback. Retry dibatasi dan hanya terjadi sebelum byte pertama dikirim ke klien. Model tidak pernah diganti diam-diam. Circuit breaker menghentikan route yang gagal berulang.

AC-012: Given route pending atau blocked, When request masuk, Then route tidak dipakai. Given base URL mengarah ke alamat internal atau bukan HTTPS, When disimpan, Then ditolak. API key upstream tidak pernah muncul pada respons, log, audit, atau pesan error uji koneksi. Given semua route gagal sebelum byte pertama, Then klien menerima satu error terstruktur dan tidak didebit. Given kegagalan setelah stream dimulai, Then tidak ada retry atau sambungan model lain. Verification: TEST-012.

### FR-013: Saldo, pemakaian dan riwayat transaksi pelanggan

Portal menampilkan saldo tersedia dan terreservasi, daftar request (waktu, model, key, state, token per kategori, debit), rincian perhitungan per request, dan riwayat ledger. Prompt dan respons tidak disimpan maupun ditampilkan. Filter periode, key, model dan state dijalankan di server.

AC-013: Given request selesai, When rincian dibuka, Then token per kategori, tarif snapshot dan debit cocok dengan entri ledger. Jumlah entri ledger sama dengan saldo yang tampil. Request unresolved tampil sebagai belum final, bukan gratis atau gagal. Verification: TEST-013.

### FR-014: Backoffice tenant

Admin melihat daftar dan detail tenant, mencari pelanggan lewat username atau email, mengirim undangan, menangguhkan dan memulihkan tenant. Admin memantau pemakaian tiap pelanggan: saldo, belanja per periode, per model dan per key, serta daftar request (metadata). Admin dapat menambah saldo langsung ke pelanggan lewat username tanpa kode redeem: nominal, referensi penjualan atau alasan, konfirmasi yang menampilkan username dan nominal, step-up, kunci idempotency; hasilnya entri ledger top-up tersendiri. Koreksi memakai adjustment berupa entri baru dengan alasan. Admin dapat mencabut API key pelanggan saat terjadi penyalahgunaan; pelanggan tetap dapat mencabut key miliknya sendiri (FR-009). Tenant yang ditangguhkan tidak dapat membuat request baru; saldo dan riwayat tetap ada. Admin tidak memiliki akses ke isi prompt.

AC-014: Given tenant ditangguhkan, When key miliknya dipakai, Then request baru ditolak dengan kode khusus. Adjustment tidak mengubah atau menghapus entri lama dan selalu tercatat pelaku serta alasannya. Given top-up langsung dikirim ulang dengan kunci yang sama, Then saldo bertambah tepat sekali. Given username tidak ditemukan, Then tidak ada entri yang terbentuk. Angka pemakaian per pelanggan pada backoffice sama dengan yang dilihat pelanggan itu di portalnya. Verification: TEST-014.

### FR-015: Rekonsiliasi

Admin melihat antrean request unresolved, voucher yang belum ditukar sebagai kewajiban, serta laporan selisih proyeksi dan hasil rekonsiliasi per model. Penyelesaian kasus unresolved memerlukan sumber bukti dan menghasilkan settlement atau pelepasan hold yang idempotent.

AC-015: Given request unresolved, When admin menyelesaikan dengan bukti usage, Then tepat satu settlement terbentuk dan hold dilepas. Laporan tidak menjumlahkan biaya berstatus unknown sebagai nol. Verification: TEST-015.

### FR-016: Audit log

Aksi admin, perubahan harga, siklus hidup voucher, perubahan upstream, adjustment, suspend, login admin dan peristiwa keamanan dicatat append-only dengan pelaku, waktu, target dan ringkasan sebelum/sesudah. Log tidak memuat secret, kode redeem, atau isi prompt.

AC-016: Given aksi admin apa pun pada daftar di atas, Then tepat satu audit event tersedia dan tidak dapat diubah lewat aplikasi. Pemindaian fixture membuktikan tidak ada secret pada audit. Verification: TEST-016.

### FR-017: Operasi dasar

Tersedia health dan readiness check, kill switch global dan per model, batas belanja global, alert untuk kegagalan ledger/lonjakan biaya/antrean unresolved, backup dengan uji restore, serta runbook insiden. Kegagalan komponen ledger menolak request berbiaya baru.

AC-017: Given kill switch global aktif, When request baru masuk, Then ditolak sebelum dispatch dan request berjalan diselesaikan. Given restore dari backup, Then invariant ledger, keunikan redemption dan idempotency tetap terpenuhi. Verification: TEST-017.

### FR-018: Panduan integrasi

Portal menyediakan base URL, cara autentikasi, contoh konfigurasi untuk tool prioritas, dan daftar kode error beserta tindakan. Tool target: Hermes, OpenCode, ZCode, Codex, Claude Code. Contoh hanya diterbitkan untuk tool yang lolos fixture kompatibilitas pada versi yang disebut.

AC-018: Setiap contoh konfigurasi yang diterbitkan memiliki bukti uji pada tool dan versi yang disebut. Contoh tidak memuat key nyata. Verification: TEST-018.

### FR-019: Kebijakan data dan retensi

Default hanya metadata request yang disimpan. Isi prompt/respons tidak ditulis ke log, penyimpanan, atau alat observabilitas. Retensi metadata, audit dan ledger ditetapkan terpisah. Penutupan akun menghapus atau menganonimkan data identitas sesuai kebijakan sambil mempertahankan bukti keuangan yang diwajibkan.

AC-019: Given request dengan penanda unik di body, When log aplikasi, database dan trace diperiksa setelah request selesai dan setelah request gagal, Then penanda tidak ditemukan. Nilai retensi tercatat dan dijalankan oleh job yang dapat diuji. Verification: TEST-019.

## 5. Requirement non-fungsional

Angka di bawah PROPOSED atau TBD. TBD material memiliki owner dan pemicu.

| ID | Kebutuhan | Target dan kondisi | Metode | Owner / status |
|---|---|---|---|---|
| NFR-001 | Kebenaran uang | Nol selisih tak terjelaskan antara saldo tersimpan dan jumlah entri ledger; nol debit ganda pada uji replay dan konkurensi | Invariant check terjadwal dan uji TEST-002/005/013/017 | Engineering / PROPOSED |
| NFR-002 | Overhead gateway | Tambahan latensi sebelum byte pertama di luar waktu upstream. Spike mengukur sekitar 8 sampai 10 ms berurutan dan p95 423 ms pada 20 request bersamaan di satu akun (kode belum dioptimalkan, satu mesin). Target PROPOSED: p95 di bawah 50 ms pada beban pilot dengan banyak tenant | Benchmark terhadap upstream tiruan pada hardware pilot, banyak tenant | Engineering / PROPOSED; diukur ulang pada kode produksi |
| NFR-003 | Kapasitas pilot | Jumlah stream bersamaan dan request per menit untuk pilot | Load test dengan upstream tiruan | Founder / TBD, skala pilot belum disebutkan (OQ-003) |
| NFR-004 | Ketersediaan | Tanpa SLA berbayar pada pilot; sasaran internal ditetapkan sebelum publik | Pengukuran uptime endpoint dan keberhasilan request | Founder / TBD sebelum rilis publik |
| NFR-005 | Pemulihan | RPO 5 menit dan RTO 4 jam untuk database ledger pada pilot | Uji restore terjadwal | Founder-ops / PROPOSED |
| NFR-006 | Aksesibilitas | WCAG 2.2 AA untuk portal dan backoffice pada layar P0 | Pemeriksaan otomatis ditambah walkthrough keyboard dan screen reader pada alur redeem, key, harga | Engineering / PROPOSED; kriteria rinci diverifikasi ke sumber W3C saat menulis DSD |
| NFR-007 | Kedalaman verifikasi keamanan | Mengikuti SECURITY.md section 6 untuk risk HIGH | Uji negatif otorisasi, abuse, secret scanning | Engineering / PROPOSED |
| NFR-008 | Privasi log | Nol isi prompt/respons/credential pada log dan trace | TEST-019 | Engineering / PROPOSED |
| NFR-009 | Dukungan perangkat | Portal dan backoffice berfungsi pada lebar 360 px ke atas dan dua versi terakhir browser utama | Uji manual responsive pada layar P0 | Engineering / PROPOSED |
| NFR-010 | Biaya infrastruktur | Batas biaya bulanan pilot | Review tagihan | Founder / TBD |

## 6. Keputusan arsitektur

Detail opsi, trade-off dan revisit trigger ada di ARCHITECTURE.md section 7. Ringkasan status:

| ADR | Keputusan | Status |
|---|---|---|
| ADR-001 | Membangun produk sendiri sebagai modular monolith dengan adapter upstream sempit; bukan fork gateway | PROPOSED, divalidasi spike TASK-006 |
| ADR-002 | Tiga permukaan protokol tanpa translasi: Chat Completions, Anthropic Messages, Responses; dirilis bertahap | PROPOSED; urutan dan kelayakan bergantung format yang disediakan upstream (OQ-007) |
| ADR-003 | PostgreSQL sebagai satu-satunya penyimpanan durable untuk ledger, voucher, harga dan state request | PROPOSED |
| ADR-004 | TypeScript pada Node.js, PostgreSQL, React untuk portal dan backoffice | CONFIRMED founder (CR-006); pustaka spesifik ditetapkan lewat TASK-020 dan spike |
| ADR-005 | Saldo Rupiah pada MVP (CONFIRMED founder); unit internal mikro-IDR (PROPOSED); USD DEFERRED | Sebagian CONFIRMED |

## 7. Milestone

Urutan dependency, tanpa tanggal. Estimasi durasi tidak diberikan karena tim, stack dan kapasitas belum diketahui; spike M0 menjadi dasar estimasi pertama.

| Milestone | Isi | Syarat masuk |
|---|---|---|
| M0 | Identitas dan ketentuan upstream (OQ-002, OQ-007), spike arsitektur, DESIGN/DSD, pemilihan stack | Paket ini ditinjau founder |
| M1 | Fondasi: skema data, ledger, auth, tenant, audit | ADR-001/003/004/005 ditetapkan |
| M2 | Gateway satu model pada permukaan pertama, lalu permukaan kedua dan ketiga: admission, adapter, streaming, settlement, margin guard | Minimal satu upstream berstatus eligible |
| M3 | Portal dan backoffice P0 | DESIGN/DSD dan peta UIArc lengkap untuk layar terkait |
| M4 | Hardening, uji restore, uji abuse, rekonsiliasi; penilaian Gate D untuk pilot | Seluruh TEST P0 dijalankan |

## 8. Asumsi, risiko dan pertanyaan terbuka

Register ASM-001 sampai ASM-004, RSK-001 sampai RSK-007 dan OQ-001 sampai OQ-004 kanonis di DISCOVERY.md section 11. Tambahan dari tahap ini:

| ID | Pernyataan | Alasan / confidence | Dampak bila salah / owner / pemicu |
|---|---|---|---|
| ASM-005 | Pilot bersifat undangan; registrasi terbuka P1 | Membatasi abuse dan beban dukungan; medium | Modul anti-abuse pendaftaran menjadi P0 / founder / sebelum M1 |
| ASM-006 | Email transaksional tersedia lewat provider yang akan dipilih | Undangan dan reset memerlukannya; medium | Aktivasi harus lewat kanal manual admin / founder / sebelum M1 |
| ASM-007 | Founder adalah satu-satunya admin pada pilot | Sesuai klarifikasi top-up; high | Perlu pemisahan peran admin dan approval ganda / founder / sebelum menambah admin |
| ASM-009 | Maskot dan ilustrasi bergaya anime akan berupa karya orisinal yang hak pakainya dimiliki founder; karakter pada gambar referensi tidak dipakai | Gambar referensi memuat karakter dari karya pihak lain; high | Layar brand tampil tanpa ilustrasi sampai aset tersedia / founder / sebelum M3 |
| ASM-008 | Implementasi dikerjakan agen coding di bawah arahan founder (CONFIRMED CR-004); tidak ada reviewer manusia kedua | Jawaban founder; high | Pembagian task dan review berubah / founder / sebelum M0 selesai |

| ID | Risiko | Mitigasi / owner / trigger |
|---|---|---|
| RSK-008 | Akun admin tunggal diambil alih sehingga kode redeem dapat diterbitkan bebas | MFA, step-up, batas nominal terbit per periode, alert setiap penerbitan / founder-security / sebelum pilot |
| RSK-009 | Estimasi upper bound admission terlalu rendah sehingga saldo bisa negatif. Terbukti dapat terjadi pada spike TASK-006 dengan estimasi berbasis ukuran body | Batas output wajib, estimasi input konservatif, uji fixture, kebijakan saldo negatif eksplisit / engineering / sebelum M2 |
| RSK-017 | Admission dan settlement satu tenant berjalan bergiliran karena penguncian baris akun; pelanggan dengan banyak request bersamaan mengalami latensi tambahan (terukur pada spike) | Kurangi round trip database per request, ukur dengan banyak tenant, pertimbangkan batas konkurensi per tenant / engineering / M2 |
| RSK-010 | Deliverability email menghambat aktivasi dan reset | Kanal cadangan manual yang diaudit / founder-ops / sebelum pilot |
| RSK-011 | Upstream reseller: ketentuannya melarang penjualan kembali, layanan berhenti mendadak, harga berubah, atau model yang dilayani tidak sesuai yang diiklankan | Baca ketentuan sebelum eligible; saldo upstream dan kesehatan dipantau; cost freshness; tidak mengklaim identitas model yang tidak dapat dibuktikan; siapkan upstream kedua / founder / sebelum pilot |
| RSK-012 | Biaya upstream dalam USD sementara saldo pelanggan Rupiah; kurs bergerak | Kurs berversi pada cost profile dengan batas usia, buffer kurs pada floor, review saat kurs melewati ambang / founder-finance / sebelum harga terbit |
| RSK-014 | Aturan usage nol dimanfaatkan: klien memutus stream sebelum usage dilaporkan untuk mendapat output tanpa biaya, sementara upstream tetap menagih | Usage hilang tidak disamakan dengan usage nol; hitungan lokal atas konten yang diteruskan; pemantauan dan batas per pelanggan (ABU-008) / engineering / sebelum M2 |
| RSK-015 | Kode ledger dan autentikasi ditulis agen tanpa tinjauan manusia kedua | Test wajib dijalankan dan disimpan sebagai bukti, invariant check, tinjauan oleh sesi terpisah yang dinyatakan sebagai tinjauan model, pilot kecil sebelum uang besar / founder / M1 |
| RSK-016 | Founder menyebut sebagian akses Codex berasal dari langganan. Merutekan kredensial langganan untuk pelanggan berbayar berisiko pemblokiran akun oleh penyedia dan memutus layanan semua pelanggan sekaligus; dokumentasi Anthropic yang dibaca melarang praktik sejenis untuk paketnya, ketentuan OpenAI belum dibaca | Rancangan hanya mendukung upstream berautentikasi API key berbayar. Jalur login atau langganan tidak dibuat dan tidak ditandai eligible. Model OpenAI dijual lewat API key berbayar atau lewat Dahono bila tersedia di sana / founder / keputusan desain CR-006 |
| RSK-013 | Tiga permukaan protokol memperbesar pekerjaan kompatibilitas dan memperlambat pilot | Rilis bertahap per permukaan, tanpa translasi, fixture per tool; spike TASK-006 mengukur usaha / engineering / M0 |

Pertanyaan terbuka tambahan:
- OQ-005 CLOSED (CR-004): implementasi oleh agen coding. Preferensi stack tidak disebutkan; ADR-004 diusulkan atas dasar itu.
- OQ-007 PARTIAL (CR-006): Dahono Router teridentifikasi dan dokumentasinya dibaca (ARCHITECTURE.md section 6, ADAPTERS.md section 3). Founder menyatakan "API dari Codex" mencakup API berbayar dan akses dari langganan. Bagian API berbayar didukung bila nama penyedia dan dokumentasinya diberikan; bagian langganan tidak dirancang (RSK-016). Masih dibutuhkan: pendaftaran program reseller Dahono atau konfirmasi tertulis darinya; pembacaan DeepSeek Terms of Use; nama penyedia API berbayar untuk model OpenAI. Owner founder.
- OQ-008 OPEN: sumber aset maskot dan ilustrasi (dibuat sendiri, dipesan dari ilustrator, atau lisensi) dan nama produk. Owner founder; sebelum M3.
- OQ-006 CLOSED (CR-006): usage nol tidak dikenakan biaya; usage hilang setelah konten diterima didebit dari hitungan lokal, ditandai estimasi dan dapat dikoreksi admin (founder mengikuti rekomendasi).

## 9. Batas kesiapan

Paket ini menaikkan dasar perencanaan ke arah Gate B untuk scope pilot. Gate C belum tercapai: OQ-007 belum lengkap, ADR-004 belum divalidasi spike, DESIGN/DSD belum ditulis, dan kontrak adapter per provider belum bisa ditulis sebelum upstream diketahui. Penilaian rinci ada di PROJECT_MANIFEST.md.

<!-- END ROUTER-PLANNING v0.4.1 -->
