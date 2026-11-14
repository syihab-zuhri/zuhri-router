# Kontrak awal: Top-up Redeem dan Multiplier Model

Version: 0.1.1
Status: Draft, specification saja; belum diimplementasikan
Owner keputusan bisnis/admin: founder
Updated: 2026-11-13, Asia/Jakarta
Dependencies: DISCOVERY.md; PROJECT_MANIFEST.md; ../PLANNING_v7.0.md
Evidence: E1 untuk spesifikasi; E2 untuk dokumentasi UIArc yang dikutip; bukan hasil test aplikasi

## 1. Keputusan founder dan batas interpretasi

CONFIRMED dari klarifikasi founder:
- Produk menjual akses API token AI.
- Top-up manual melalui kode redeem yang diterbitkan admin, yaitu founder.
- Perhitungan pengeluaran memperhatikan input token, output token dan cache.
- Pembeli adalah pengguna tools AI. Nama tool/protocol yang wajib belum disebutkan.
- Admin wajib dapat mengatur multiplier token per model yang tersedia untuk menjaga bisnis dari kerugian. Requirement ini P0, bukan backlog.

PROPOSED detail engineering di bawah memenuhi arah tersebut. Angka tarif, currency, nominal voucher dan nilai multiplier final belum diberikan. Klarifikasi biaya per token bukan konfirmasi tentang sumber upstream atau izin komersialnya.

Default desain yang diusulkan: saldo kredit berdenominasi uang dengan currency dan scale eksplisit, bukan satu kumpulan raw token yang menganggap semua model sama mahal. IDR merupakan kandidat tampilan, belum keputusan bisnis final. Jika founder memilih kredit internal, konversi uang per kredit harus tunggal, versioned, ditampilkan, dan tidak dicampur dengan raw token model.

Token aktual, estimasi biaya upstream, biaya aktual upstream dan debit pelanggan adalah empat data berbeda. Multiplier mengubah tarif/debit pelanggan, bukan merekayasa jumlah token aktual yang dilaporkan di API. Field usage protocol tetap sesuai semantic protokol. UI dapat menampilkan weighted usage sebagai rincian tambahan berlabel, bukan mengganti raw usage.

## 2. Model hitung

### 2.1 Usage yang dinormalisasi

Kelompok biaya harus saling eksklusif sebelum dijumlahkan:
- `input_uncached_tokens`: input baru yang tidak termasuk cache read/write yang ditagih terpisah.
- `output_tokens`: output yang ditagih, termasuk reasoning bila upstream sudah memasukkannya ke output. Jangan menambahkan reasoning kembali sebagai biaya kedua.
- `cache_read_tokens`: token input yang dibaca dari prompt cache dan mempunyai tarif tersendiri.
- `cache_write_tokens[bucket]`: token pembentukan cache pada kelompok TTL/jenis yang ditagih terpisah, bila provider mendukung.

Setiap adapter wajib mendokumentasikan apakah raw input sudah mencakup cache. Bila total input termasuk cache read, kurangi bagian itu dari input reguler sebelum menghitung; bila input reguler sudah terpisah, jangan kurangi lagi. Simpan raw usage aman beserta normalizer version dan sumber pengukurannya untuk rekonsiliasi. Jangan menganggap payload provider berbeda mempunyai semantic identik.

Cache pada kontrak ini berarti usage/cache pricing upstream. Tidak mewajibkan membangun response cache gateway sendiri. `unsupported` berbeda dari `unknown`: kategori yang memang tidak ada dapat bernilai nol dengan reason; field yang diharapkan tetapi hilang tidak diam-diam diisi nol. Model dengan biaya tersembunyi/tidak terwakili dalam empat kategori tidak diaktifkan sampai ada aturan harga/penolakan yang eksplisit.

### 2.2 Tarif dasar, multiplier dan debit

Untuk setiap model publik admin mengatur price version yang berisi:
- Tarif dasar input baru, output, cache read, dan setiap cache write bucket.
- Currency dan unit tarif, diusulkan per 1.000.000 token agar mudah dibandingkan.
- `model_multiplier`: satu faktor positif per model yang mengalikan total biaya referensi request.
- Tanggal efektif, provenance/as-of tarif, rounding rule dan status draft/published/retired.

Rumus normatif yang diusulkan, dengan `q = 1.000.000`:

    biaya_referensi = sum(token_kategori * tarif_dasar_kategori / q)
    debit_pelanggan = round_once(biaya_referensi * model_multiplier)

Tarif dasar bisa berbeda antara input, output dan cache; faktor model tetap satu kontrol utama. Override multiplier per kategori bukan kewajiban P0 karena kebutuhan saat ini per model. Tidak ada faktor global tersembunyi atau perkalian dua kali. Preview menampilkan tarif jual efektif tiap kategori = tarif dasar kategori * model_multiplier.

Semua hitung memakai integer/fixed-precision decimal, bukan binary float. Proposed precision: internal IDR mikro-unit (satu per sejuta IDR) bila currency IDR dipilih; tampilan rupiah tidak mengurangi presisi ledger. Simpan nominal fractional sebelum rounding sebagai exact decimal/rational, jumlahkan semua kategori lalu ROUND_HALF_UP sekali ke unit ledger. Kredit nominal bulat tetap memakai unit internal yang sama. Pembulatan per kategori/per chunk stream dilarang. Jika currency lain dipilih, scale/version harus didefinisikan sebelum coding.

Biaya referensi merupakan basis penetapan tarif, bukan otomatis biaya invoice aktual. `actual_upstream_cost` dicatat per attempt memakai price contract upstream yang relevan; bila masih estimasi tandai estimated, dan rekonsiliasi dengan bukti aktual. Model fixed-price/subscription tidak memiliki biaya marginal token terverifikasi secara otomatis; metode alokasi biaya perlu disepakati sebelum dianggap modal aktual.

### 2.3 Contoh sintetis, bukan harga provider atau harga produk

Fixture hipotetis berdenominasi IDR:

| Kategori | Token | Tarif dasar per satu juta token | Biaya referensi |
|---|---:|---:|---:|
| Input baru | 2.000 | Rp10.000 | Rp20 |
| Output | 1.000 | Rp40.000 | Rp40 |
| Cache read | 8.000 | Rp1.000 | Rp8 |
| Cache write | 0 | Rp12.500 | Rp0 |

Total biaya referensi Rp68. Dengan multiplier 1,5x, debit pelanggan Rp102. Selisih terhadap biaya referensi Rp34. Ini belum laba bersih karena biaya referensi belum tentu sama dengan biaya aktual dan belum memasukkan infrastruktur, retry, promo, biaya penjualan, refund atau support.

Jika raw total input pada fixture adalah 10.000 token dan sudah termasuk 8.000 cache read, input baru yang ditagih Rp10.000 per juta hanya 2.000, bukan 10.000.

Multiplier 2x berarti markup 100% atas basis biaya, bukan margin 100%; selisih terhadap basis sebagai persentase harga jual adalah 50%. Jangan menyebut faktor harga sebagai jaminan tidak rugi.

## 3. Kontrol admin dan pencegahan kerugian

### FR-001: Pricing dan multiplier per model (P0)

Source: kewajiban multiplier per model dari founder; rincian kontrol PROPOSED.
Actor: admin founder, tidak tersedia untuk pelanggan.
Boundary: public model ID -> immutable published price version -> route eligibility.

- Semua model yang ditemukan masuk katalog draft/disabled untuk penjualan sampai tarif setiap kategori yang berlaku dan multiplier telah dikonfirmasi. Faktor kosong tidak diam-diam menjadi 1x.
- Admin memilih model dari daftar searchable, mengisi tarif dasar, faktor model, dan melihat preview tarif jual serta contoh pemakaian sebelum publish.
- Faktor harus finite, decimal positif dan dalam batas konfigurasi. Zero/negative/NaN/infinity atau overflow ditolak. Diskon di bawah modal tidak boleh terbuka diam-diam; promo terpisah dengan budget dan otorisasi yang eksplisit, deferred dari pilot.
- Publish memakai optimistic concurrency/version check, reason dan audit before/after. Konflik edit mengembalikan conflict, bukan overwrite tanpa diketahui.
- Request menyimpan snapshot price version, multiplier, unit/currency dan aturan rounding saat admission. Request berjalan dan reservasinya tidak berubah karena admin mengedit harga; perubahan berlaku untuk request baru.
- Tidak ada bulk publish diam-diam saat discovery upstream; tiap public model yang bisa dijual harus mempunyai konfigurasi yang berlaku. Model baru/resurrected tidak mewarisi harga model lain secara otomatis.
- Pelanggan dapat melihat tarif jual efektif dan riwayat tagihannya; biaya modal dan target margin admin tidak dipublikasikan. Menampilkan angka faktor mentah kepada pelanggan opsional, tetapi tarif/charge tidak boleh tersembunyi.

AC-001: Admin publish faktor baru; request baru memakai versi baru, request yang sudah admitted tetap memakai versi lama. Pelanggan biasa tidak dapat membaca/mengubah cost/pricing admin. Konflik versi gagal tanpa side effect. Input invalid ditolak di server.
Verification spec: TEST-001; task perencanaan TASK-001.

### FR-002: Metering dan settlement token/cache (P0)

Source: perhitungan input/output/cache dari founder.
Actor: gateway/settlement worker, owner pelanggan melihat rincian miliknya.

- Admission mereservasi upper bound debit pelanggan dengan price snapshot dan batas output; saldo paralel dikendalikan atomik.
- Settle idempotent terhadap request, bukan per chunk. Route attempts dicatat terpisah. Retry internal tidak otomatis menjadi debit pelanggan tambahan.
- Usage lengkap dinormalisasi per adapter. Cost/debit menyimpan versi normalizer dan kategori yang dipakai.
- Bila usage belum lengkap, status unresolved dan dana terkait diproses menurut recovery policy; jangan mengira nol atau mendebit maksimum sebagai final. Stream partial/failure policy masih perlu kontrak per provider sebelum provider itu aktif.
- CONFIRMED founder (CR-004): request yang usage finalnya nol token input dan nol token output tidak dikenakan biaya apa pun; debit nol dan hold dilepas seluruhnya. PROPOSED batas tafsir: "nol" berarti upstream melaporkan nol, atau request gagal sebelum ada byte konten yang diteruskan ke klien. Bila konten sudah diteruskan tetapi usage tidak dilaporkan, itu usage hilang, bukan usage nol; penanganannya di ARCHITECTURE.md section 2. Verification tambahan: TEST-020 di TASKS.md.
- Saldo, reservasi, batas per key, debit dan pengembalian hold memakai unit yang sama. Callback settlement ulang tidak menduplikasi entri.

AC-002: Fixture cache-inclusive dan cache-exclusive yang ekuivalen menghasilkan debit sama, tanpa double-count; raw token tidak berubah akibat faktor. Dua request bersaing untuk saldo terbatas tidak melewati admission cap. Replay settle memberi satu debit. Missing usage terdeteksi unresolved, bukan settled-zero.
Verification spec: TEST-002; TASK-002.

### FR-003: Margin guard dan keterbukaan biaya (P0)

Source: tujuan founder menghindari boncos; detail guard PROPOSED.
Actor: admin/route selector.

- Pisahkan expected spread, margin aktual yang direkonsiliasi, dan biaya yang masih unknown. Tidak menampilkan unknown sebagai untung.
- Setiap candidate route harus memiliki cost profile versioned dan currency/FX snapshot yang dapat dibandingkan dengan tarif jual. Tanpa cost profile yang lengkap route tidak eligible untuk pilot berbayar.
- Pilot default memakai satu cost profile yang telah diperiksa per public model; multi-upstream fallback hanya diaktifkan setelah guard berlaku untuk seluruh candidate.
- Floor per kategori diusulkan, bukan hanya contoh workload rata-rata: effective sell rate harus menutup conservative route-cost bound dan buffer yang disetujui. Retry allowance juga harus dibudgetkan. Tidak mengandalkan rata-rata penggunaan cache untuk menutupi output yang rugi.
- Biaya tetap bulanan, biaya manual distribusi, promo/refund dan support masuk reporting/budget. Floor per token saja tidak menjamin total bisnis untung pada volume kecil.
- Cost naik/FX berubah/harga stale men-trigger review dan alert; route yang melanggar floor tidak dipakai untuk request baru. Jangan otomatis menaikkan tagihan request yang sudah diterima.
- Admin memiliki global spend cap, model/key/customer caps, concurrency dan kill switch. Nominal threshold, cost freshness SLA dan buffer final TBD milik founder sebelum model enabled.
- Skenario upstream cost tak pasti, lost usage, partial stream dan retry memiliki budget/risk cap. Jangan mengklaim multiplier meniadakan semua risiko tersebut.

AC-003: Route yang biayanya di atas floor konfigurasi ditolak/di-skip sebelum dispatch, termasuk fallback. Unknown/stale cost tidak dianggap nol. Perubahan cost tidak mengubah price snapshot request berjalan. Dashboard membedakan projected dan reconciled spread; non-admin tidak mendapat modal provider.
Verification spec: TEST-003; TASK-003. Nilai floor/caps material harus selesai sebelum task ini Ready.

## 4. Manual top-up melalui redeem

Payment gateway, webhook bank, upload bukti bayar dan checkout otomatis bukan kebutuhan P0. Pembayaran/verifikasi dilakukan founder di luar sistem. Aplikasi tidak mengklaim uang sudah diterima hanya karena admin menerbitkan kode.

### FR-004: Penerbitan dan pengelolaan kode admin (P0)

Source: top-up manual via kode redeem dari admin founder.
Actor: admin founder saja.

Flow: founder memverifikasi transaksi manual -> mencatat sale/reference atau alasan nonpenjualan -> menentukan nominal kredit/currency -> menerbitkan kode -> mengirim kode ke pembeli melalui kanal pilihannya di luar aplikasi.

- Proposed nominal berupa kredit tetap, bukan kuota raw token suatu model. Nilai kredit dan nilai kas yang diterima dicatat terpisah bila berbeda, misalnya promo; tanpa kas jangan mengakui pendapatan tunai.
- Setiap kode single-use, punya voucher ID, nilai immutable, created/issued actor/time, optional recipient binding, expiry opsional yang terlihat, dan reason/sale reference. Batch creation opsional, bukan syarat P0.
- Code secret dibuat CSPRNG dengan minimal 128-bit entropy. Raw code ditampilkan sekali setelah issue, tidak muncul pada URL, analytics, logs atau list admin. Simpan verifier/hash/HMAC yang aman dan key version jika HMAC digunakan; daftar hanya masked prefix/ID, bukan secret yang dapat diretrieve ulang.
- Secret kode yang hilang tidak dipulihkan plaintext; revoke yang belum dipakai lalu issue pengganti dengan reference ke voucher lama dan audit. Snapshot kode yang bocor harus bisa dicabut selama belum diredeem.
- Issue operation mempunyai idempotency key per admin dan payload hash; network retry mengembalikan voucher ID/state yang sama, bukan membuat voucher kedua. Jika raw code one-time reveal hilang akibat timeout, admin menjalankan recovery revoke/reissue terkontrol, bukan duplicate issue.
- Sale reference lokal yang telah mempunyai active/redeemed issuance dicegah di-issue dua kali tanpa koreksi eksplisit; referensi external tidak otomatis dianggap unik tanpa namespace/metode pencatatannya.
- Status: DRAFT -> ACTIVE -> REDEEMED. ACTIVE dapat menjadi REVOKED atau EXPIRED. DRAFT tidak bisa diredeem. State terminal tidak bisa diaktifkan ulang; koreksi melalui record baru yang terkait.
- Nilai/recipient/expiry immutable setelah ACTIVE. Perubahan perlu revoke dan replacement; REDEEMED tidak bisa direvoke untuk membalik saldo secara tersembunyi.

AC-004: Pelanggan tidak dapat issue/read raw code admin; issue replay tidak menciptakan tambahan liability; revoke kode unused memblokir redeem; tidak ada raw code pada log/list/export default. Duplicate sale reference ditolak sesuai namespace yang dikontrakkan.
Verification spec: TEST-004; TASK-004.

### FR-005: Redeem pelanggan dan grant ledger atomik (P0)

Source: top-up lewat redeem; rincian anti-double-credit PROPOSED.
Actor: pelanggan login, tenant tujuan adalah tenant aktif yang memang dimiliki; recipient-bound bila admin menetapkannya.

Flow: buka Isi Saldo -> masukkan kode -> redeem -> server melakukan authorization, validation dan transaksi -> tampilkan nominal kredit, saldo terbaru, redemption ID dan waktu.

- Update status voucher, redemption record dan ledger grant ada dalam satu transaksi atomik. Voucher ID unik pada redemption dan idempotency key grant mencegah satu kode dikreditkan ke lebih dari satu tenant.
- Race redeem/redeem serta revoke/redeem diserialisasi/compare-and-set dengan outcome tunggal. DB transaction rollback tidak meninggalkan voucher spent tanpa saldo.
- Jika request sukses tetapi response hilang, retry oleh tenant pemilik redemption mengembalikan receipt yang sama, tidak menambah kredit. Actor lain tidak mendapat receipt/identitas pemilik.
- Kode salah/expired/revoked/sudah dipakai pihak lain menampilkan kegagalan yang dapat ditindaklanjuti tanpa membocorkan identitas pembeli lain. Kode tidak dikirim ke helpdesk otomatis.
- Proposed code alphabet/canonicalization ditetapkan server sebelum implementasi; UI tidak melakukan fuzzy matching atau memperbaiki karakter ambigu diam-diam. Trim/format handling harus sama di UI dan server.
- Rate limit memakai akun/tenant ditambah IP/subnet sebagai lapisan sekunder. Proposed pilot baseline: 5 percobaan invalid per akun per 15 menit dan 30 per IP per 15 menit, shared limiter; threshold perlu diuji dampak NAT dan workload. Beri cooldown/Retry-After, jangan mengunci login global akun hanya karena kegagalan redeem.
- Error layanan/timeout bukan bukti kode invalid. Disable double-submit di UI bukan pengganti transaksi server. Rate limits tidak mengkonsumsi atau mengungkap kode.
- Saldo kredit dan liability voucher unused dipantau; penerbitan belum sama dengan penukaran dan bukan pemakaian model.

AC-005: Concurrent redeem oleh tenant berbeda menghasilkan tepat satu grant/owner; retry owner mengembalikan receipt sama; expiry boundary dan revoke race konsisten dengan waktu server dan state lock. Redeem saat DB gagal tidak mengubah voucher maupun saldo secara parsial. Invalid-code flood dibatasi tanpa membocorkan kode/status pihak lain.
Verification spec: TEST-005; TASK-005.

## 5. Layar dan referensi UI yang bertambah

Strategi seluruh kandidat: PATTERN_ADAPTATION; belum mengunci framework. UIArc tetap primer dan Free-only sebagai default. Tidak ada dependency dipasang, registry source disalin, prototype atau hasil a11y aplikasi.

| Screen | Tujuan dan data/permission | State dan recovery | UAR |
|---|---|---|---|
| SCR-001 Isi Saldo | Pelanggan memasukkan kode dan melihat receipt milik sendiri; nominal/currency serta saldo tersedia/terreservasi jelas | Idle, submitting, credited, invalid/unavailable, cooldown, server-error/unknown-result, session-expired. Cek receipt sebelum retry; jangan menampilkan sukses dari state lokal saja | UAR-003/007/010 |
| SCR-002 Kode Redeem Admin | Founder menerbitkan nominal dengan sale reference dan recipient opsional, one-time reveal, daftar status dan revoke unused | Empty, creating, one-time secret, issued, conflict, expired/revoked/redeemed, forbidden, failed/unknown-result; revoke/reissue jelas | UAR-002/004/007/008/010 |
| SCR-003 Harga dan Multiplier Model | Founder memilih model tersedia, mengatur tarif kategori dan faktor model, preview, publish version | Unpriced-disabled, draft, valid-preview, invalid, margin-blocked/unknown-cost, stale-cost, conflict, published, forbidden; tidak publish optimistis seolah sukses | UAR-002/003/007/008/009/010 |

Untuk UAR-002/003/004 lihat DISCOVERY.md section 10. Ekstensi map berikut hanya memverifikasi isi dokumentasi yang telah dibaca pada 2026-11-13, bukan source code atau a11y hasil implementasi.

| ID | Target/type | Item/URL, evidence | Access/status | Prinsip/adaptasi | Verification/dependency |
|---|---|---|---|---|---|
| UAR-007 | SCR-001/002, form kode/reference | https://uiarc.dev/components/input/markdown [12]; evidence/2026-11-13-redeem/uiarc/input.md | VERIFIED docs; Free; lisensi Free pada map awal | Label/helper/error association, invalid state; no echo raw code dalam error. Input faktor numerik perlu pemeriksaan number-field terpisah, bukan mengklaim text input cukup | Keyboard/error association/mobile input; NONE terpasang, motion hanya kandidat bila direct |
| UAR-008 | SCR-002 revoke; SCR-003 publish price, confirmation | https://uiarc.dev/components/dialog/markdown [13]; evidence/2026-11-13-redeem/uiarc/dialog.md | VERIFIED docs; Free | Dialog untuk keputusan singkat, focus trap/restore; tampilkan nominal/versi dampak dan jangan pakai dialog panjang sebagai seluruh editor | Escape/Tab/restore focus, pending/error; NONE terpasang, Radix/motion/lucide kandidat bila direct |
| UAR-009 | SCR-003 model picker | https://uiarc.dev/components/combobox/markdown [14]; evidence/2026-11-13-redeem/uiarc/combobox.md | VERIFIED docs; Free | Pilih public model ID stabil, label/capability/disabled reason; daftar panjang prefilter server, tidak mengasumsikan virtualisasi | Arrows/Enter/Escape, loading/no-results/stale options, label-ID; NONE terpasang |
| UAR-010 | SCR-001/002/003 feedback permanen | https://uiarc.dev/components/alert/markdown [15]; evidence/2026-11-13-redeem/uiarc/alert.md | VERIFIED docs; Free | Pesan in-flow untuk gagal redeem, harga stale/di bawah floor, hasil unknown; tone bukan satu-satunya penanda dan jangan dismiss blocker tanpa solusi | role status/alert sesuai severity, no secret, wrapping/reduced motion; NONE terpasang |

Map belum lengkap. Button, number/currency field, status badge, pagination, empty/loading serta keseluruhan design/component spec perlu ditinjau sebelum task UI Ready. Tidak ada klaim seluruh layar telah memenuhi Gate C.

## 6. Traceability dan task specification awal

Task di tabel masih PLANNED, tidak ada implementation task berstatus Ready/completed. Kode sumber/file boundary dan command verifikasi belum ada karena stack belum dipilih.

| Requirement -> AC | Task outcome | Test specification, belum executed | Dependency / DoR | DoD nantinya |
|---|---|---|---|---|
| FR-001 -> AC-001 | TASK-001 price catalog/admin multiplier versioned | TEST-001 invalid factor, authz, publish conflict, request snapshot invariant | Currency/scale, model identity, draft/publish contract, SCR-003/component map lengkap | Perubahan server/UI bekerja, audit dan test bukti nyata; UAR/tokens/a11y diperiksa |
| FR-002 -> AC-002 | TASK-002 normalizer/ledger reserve-settle | TEST-002 synthetic examples, cache overlap, missing usage, concurrency, duplicate settle, rounding tiny cost | Adapter usage semantic, output bound, precision/partial policy, schema transaksi | Integration/crash-recovery tests; receipt cocok ledger dan raw usage tidak berubah |
| FR-003 -> AC-003 | TASK-003 cost floor/spend policy/reporting | TEST-003 high-cost fallback blocked, stale/unknown cost, retry cap, visibility | Cost profiles, approved buffer/caps/freshness, SCR-003 | Semua eligible route dicek sebelum dispatch; data projected vs actual tidak tertukar |
| FR-004 -> AC-004 | TASK-004 issue/revoke/replacement | TEST-004 non-admin denied, issue replay, lost reveal recovery, duplicate sale, no secrets | Code format/verifier, immutable states, SCR-002 | Audit/transaksi dan recovery bekerja; secret scanning/log capture membuktikan tidak bocor |
| FR-005 -> AC-005 | TASK-005 redeem/grant receipt | TEST-005 concurrent claim, replay owner/other, expiry/revoke races, DB rollback, rate limit | Auth tenant, ledger transaction, limiter topology, SCR-001 | Tepat satu grant, permission dan error recovery, keyboard/mobile checks dengan bukti |

Rollout: synthetic fixture dan database test terisolasi dahulu; tidak issue kode bernilai uang atau mengubah saldo produksi dari dokumen ini. Published prices/voucher records kelak tidak diedit untuk rollback; price rollback membuat versi baru, refund/adjustment membuat entri koreksi yang ditautkan. Backup/restore harus mempertahankan unique constraints, redemption ownership dan ledger idempotency.

## 7. Pending dan batas kesiapan

- Currency/unit saldo, nilai jual kode, tarif nyata, model_multiplier per model, source upstream dan cost profiles belum diberikan. Contoh sintetis bukan default bisnis.
- Tool/protocol prioritas, pilot load/budget, stack dan kapabilitas tim belum dipilih.
- Detailed schema/API/permission, threat mapping, FX/retention/rounding untuk currency final, bound admission dan unknown/partial billing policy masih perlu dilengkapi. Belum Gate C.
- Tidak memerlukan gateway/payment callback untuk top-up manual P0. Otomasi gateway hanya future change request bila founder memintanya.
- Referensi dan perhitungan contoh dapat diperiksa, tetapi correctness/concurrency/security dari software baru hanya dibuktikan setelah implementasi dan test nyata.

<!-- END BILLING-REDEEM v0.1.1 -->
