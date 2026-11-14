# Discovery: Router AI Komersial

Version: 0.2.3
Status: Draft, belum disetujui sebagai blueprint
Owner keputusan: founder
Tanggal: 2026-11-13, Asia/Jakarta
Kontrak: PLANNING_v7.0.md v7.0.0
Scope: discovery dan perencanaan saja, tanpa implementasi/deployment
Gate: A diperbarui dengan model usaha terkonfirmasi; Gate B belum ditetapkan

## 1. Hasil intake

CONFIRMED dari permintaan founder:
- Membuat proyek router seperti 9Router, tetapi akan digunakan untuk jualan.
- Perencanaan harus melihat lebih luas daripada meniru fitur 9Router.
- Baca STARTER_PROMPT_v7.0.md dan PLANNING_v7.0.md lebih dahulu.
- Klarifikasi founder: menjual akses API token AI, top-up manual dengan kode redeem dari admin founder, biaya mengikuti input/output/cache, target pengguna tools AI.
- Multiplier token per model wajib dapat diatur admin sebagai fitur P0 untuk pengendalian harga/margin. Spesifikasi kanonis detailnya: BILLING_REDEEM.md. Detail teknik yang belum disetujui tetap PROPOSED.

Kedua file telah dibaca sampai akhir. Canary kontrak yang ditemukan: `ANYAM-70-UIARC-K4N8`. Tidak ada bagian kontrak yang belum terbaca. File sumber dipertahankan.

Folder pada intake hanya berisi dua dokumen tersebut. Belum ada source aplikasi, stack proyek, maupun kontrak API proyek untuk diaudit. Karena itu, inspeksi struktur kode/index_repository belum berlaku. Pembacaan repo pembanding di bawah sebatas README/lisensi/dokumentasi, bukan audit kode atau uji runtime.

Belum CONFIRMED: sumber upstream/hak komersial, harga dan nominal kode, unit saldo/currency, daftar tool/protokol prioritas, nama produk, kapasitas awal, budget, tim, stack, dan target peluncuran. Jawaban kedua founder menjelaskan metering input/output/cache, bukan identitas sumber upstream.

## 2. Pergeseran dari router pribadi ke produk berbayar

README 9Router menjelaskan bahwa biaya pada dashboard bersifat estimasi/display, bukan tagihan nyata. Ini alasan penting untuk tidak menjadikan angka dashboard tersebut sebagai dasar langsung saldo pelanggan.[1]

PROPOSED: produk perlu mempunyai dua kemampuan yang sama-sama benar:
1. Mengantarkan request ke model yang sesuai kontrak.
2. Mengendalikan hak akses, biaya, pembayaran, dan pertanggungjawaban setiap request.

Fitur routing adalah fondasi teknis. Nilai jual yang perlu diuji dengan calon pembeli adalah kepastian biaya, kemudahan integrasi, transparansi pemakaian, dukungan ketika gagal, serta kontinuitas layanan. Tidak ada klaim demand atau keuntungan yang sudah terbukti.

### Pilihan bisnis yang perlu dibedakan

| Opsi | Yang dibeli pelanggan | Konsekuensi utama | Status |
|---|---|---|---|
| Managed API | Pemakaian model melalui API produk dengan saldo prabayar, top-up kode redeem dari admin | Kita menanggung risiko upstream, margin, tagihan, dispute, abuse | CONFIRMED model usaha dan top-up oleh founder |
| SaaS BYOK | Fitur routing, pengaturan dan observabilitas; provider ditagih ke pemilik key | Pisahkan biaya software dan penggunaan upstream; validasi syarat setiap provider | DEFERRED, bukan model utama saat ini |
| Lisensi/self-hosted | Software, instalasi, maintenance atau dukungan | Packaging, upgrade, support matrix, lisensi dan entitlement | DEFERRED, bukan model utama saat ini |
| Reseller/white-label | Kapasitas atau storefront untuk penjual lain | Nested budget, pemisahan tenant, transfer kredit, refund dan brand lebih kompleks | DEFERRED, bukan default P0 |

Keputusan founder: Managed API prabayar dengan top-up redeem manual. Tidak perlu payment gateway pada P0. Arsitektur dapat menyediakan batas modul untuk jalur lain tanpa membangunnya sekarang.

## 3. Target pasar dan pembuktian nilai

CONFIRMED target luas: pengguna tools AI. Developer individu/tim kecil tetap hipotesis subsegmen, bukan penyempitan yang sudah disetujui. Tool/protocol wajib dan workload pilot belum diketahui. Onboarding, konfigurasi tool dan transparansi pemakaian dirancang untuk target tersebut.

Hipotesis yang perlu divalidasi:
- Pembeli membutuhkan penyatuan akses dan dukungan, bukan hanya harga termurah.
- Pembeli bersedia melakukan top-up tanpa janji penggunaan tidak terbatas.
- Kompatibilitas tool yang benar-benar mereka pakai lebih bernilai daripada daftar provider panjang.
- Pengguna tim membutuhkan budget per proyek/key, bukan sekadar satu saldo akun.

Validasi sebelum memperbesar scope: wawancara calon pembeli, catat tool/model/workload nyata yang dibutuhkan tanpa meminta credential, lalu jalankan pilot terbatas setelah implementasi dan gate rilis terpenuhi. Jumlah peserta dan kriteria keberhasilan pilot ditentukan bersama target kapasitas, tidak dikarang sebagai komitmen sekarang.

Metrik yang perlu dirancang: signup ke request pertama berhasil, top-up ke pemakaian, repeat purchase, biaya akuisisi/support, tingkat keberhasilan request, refund/dispute, margin kontribusi, serta selisih rekonsiliasi. Definisi denominator wajib jelas; request yang ditolak sebelum upstream tidak sama dengan kegagalan provider.

## 4. Tailoring dan applicability awal

| Sumbu | Nilai | Dasar/status |
|---|---|---|
| Mode | DISCOVERY diperbarui | Model bisnis/redeem/metering terkonfirmasi; supply, protokol dan kapasitas belum |
| Documentation profile | STANDARD, PROPOSED | Produk berkelanjutan; tidak perlu paket enterprise otomatis |
| Risk | HIGH, PROPOSED | Potensi multi-tenant, secret upstream, transaksi dan biaya AI |
| Surface | API + WEB, PROPOSED | Endpoint pelanggan, portal pelanggan dan backoffice |
| Lifecycle | GREENFIELD, ASSUMED | Folder intake belum berisi aplikasi |
| Runtime | SELF_HOSTED, PROPOSED | Bukan keputusan host/deployment |
| Release context | PUBLIC berbayar, PROPOSED | Arah jualan; pilot privat sebelum public |
| Team | UNKNOWN | Jangan mengarang kapasitas atau reviewer independen |
| Bahasa dokumen | Indonesia, CONFIRMED | Bahasa permintaan dan kontrak |
| Bahasa produk/negara/currency | TBD | Kandidat Indonesia/IDR; API DX mungkin perlu English |
| Brand | Navy/Blue/Gold, PROPOSED | Preferensi existing founder; token final belum dibuat |
| Execution | PLANNING_ONLY | Tidak mengotorisasi implementasi, deploy atau pembelian |

| Modul | Applicability | Owner/follow-up |
|---|---|---|
| Auth, authorization, tenant boundary | APPLIES pada calon produk SaaS | Arsitek/security; finalisasi setelah model bisnis |
| Ledger/billing/redeem/refund | APPLIES | Top-up manual dan multiplier per model P0 terkonfirmasi; detail BILLING_REDEEM.md |
| Provider entitlement/resale permission | UNKNOWN per provider | Founder; pemeriksaan sebelum provider dijual |
| AI proxy eval dan compatibility | APPLIES | Engineering; tidak membangun agent/tool execution sendiri |
| Data pribadi, prompt dan secret | APPLIES | Privacy/security; retention dan vendor flow harus ditetapkan |
| Anti-abuse dan cost caps | APPLIES | Engineering/operations |
| UIArc | APPLIES untuk calon WEB | Map awal di section 10; belum lengkap untuk Gate C |
| Payment gateway/kartu/webhook | N/A untuk P0 | Pembayaran diverifikasi manual founder; aplikasi issue/redeem kredit, tidak memproses kartu |
| Pajak, PSE/PDP, syarat usaha/yurisdiksi | UNKNOWN | Founder dan penasihat terkait; perlu sumber resmi sesuai scope, bukan klaim compliance |
| HA multi-region, native mobile | DEFERRED | Aktifkan jika kebutuhan pelanggan/SLO membenarkan |
| Eksekusi tools pelanggan oleh server | N/A pada arah awal | Proxy tool-call payload bukan menjalankan shell/tool pelanggan |
| Hosting inference model lokal | N/A pada arah awal | Produk gateway, bukan melatih/menjalankan model sendiri |

## 5. Cakupan rilis yang diusulkan

Bagian ini kandidat scope pendukung Managed API yang terkonfirmasi, bukan SRS final. Top-up redeem manual, metering input/output/cache dan multiplier per model adalah P0 dari founder. FR/AC/TASK/TEST awal untuk scope itu kanonis di BILLING_REDEEM.md; sisa produk belum dirinci.

### P0: pilot berbayar dengan risiko terkendali

- Identitas pelanggan, verifikasi/recovery yang proporsional, sesi aman; pengamanan admin lebih kuat. Registrasi dapat invitation-only selama pilot.
- Workspace/tenant sebagai boundary. Founder dapat memulai dengan satu owner per tenant; team invitation belum wajib.
- API key per proyek: scope model, budget/limit, expiry opsional, revoke/rotate; secret ditampilkan sekali dan tidak tersimpan plaintext untuk credential yang hanya diverifikasi.
- Katalog model eksplisit: ID publik stabil, provider, harga versioned, kemampuan, status, batas konteks dan syarat penggunaan yang sudah diperiksa. Setiap model mempunyai pengaturan multiplier admin; model belum berharga/unknown cost tidak otomatis bisa dijual.
- Satu protokol utama dahulu. Pilihan OpenAI-compatible Chat Completions, Responses, Anthropic Messages atau lainnya mengikuti tool pembeli; tidak menjanjikan semua format sejak awal.
- Streaming dan non-streaming yang ditetapkan, pembatalan/disconnect, batas ukuran/durasi/konkurensi, error terstruktur, request ID, dan observabilitas request aktif maupun selesai.
- Routing pada upstream yang memenuhi hak akses; retry/fallback terbatas sebelum batas aman. Tidak mengganti model/region diam-diam.
- Pencatatan usage dan ledger uang yang tahan concurrency, idempotent, dapat direkonsiliasi; pisahkan saldo tersedia, reservasi, debit final dan adjustment.
- Top-up manual: founder memverifikasi pembayaran di luar aplikasi, issue kode nominal kredit, pelanggan redeem; single-use grant atomik/idempotent, revoke unused, receipt, audit dan pencatatan sale/reference. Tidak ada checkout/payment webhook P0.
- Metering input baru/output/cache read/cache write yang relevan; faktor model mengubah debit kredit, bukan raw usage API. Preview tarif efektif, price snapshot dan margin guard admin masuk P0. Detail kanonis: BILLING_REDEEM.md.
- Portal pelanggan: onboarding, model/harga, key, saldo/usage/riwayat transaksi, informasi kegagalan dan bantuan. Jangan membuat playground wajib jika bukan kebutuhan pilot.
- Backoffice: tenant, upstream, harga/policy version, ledger/payment, incident, tindakan suspend/restore yang diaudit; tidak memberi support akses default ke prompt pelanggan.
- Readiness operasi: health, alert, backup dan restore teruji, rollback, kapasitas pilot, runbook insiden, syarat layanan/privacy/refund yang sesuai produk.

### P1: setelah pilot membuktikan fondasi

- Team membership/RBAC, budget per project, laporan/export dan notification preferences.
- Protokol/provider tambahan berdasar compatibility matrix dan permintaan pelanggan.
- Paket bulanan dengan kredit/quota terbatas dan voucher promo/diskon dengan antifraud/budget. Kode redeem untuk top-up manual biasa sudah P0, bukan ditunda sebagai promo.
- BYOK yang didukung ketentuan provider, reporting biaya yang memisahkan platform fee dan upstream cost.
- Status page, customer incident communication, peningkatan dokumentasi SDK/tool serta dukungan operasional.
- Prompt/response caching opt-in hanya jika privacy, semantic correctness dan tenant isolation terbukti. Jangan cross-tenant cache default.

### P2: dibuka oleh kebutuhan bisnis yang terbukti

- Reseller/white-label, custom domain, quota delegation dan billing hierarchy.
- Dedicated upstream pool, enterprise SSO, data region/retention contract dan SLA berbayar.
- HA/multi-region dan advanced routing berbasis evaluasi kualitas/latency/cost dengan policy yang dijelaskan.
- Image/audio/batch/embedding hanya bersama kemampuan, unit billing dan test kontraknya masing-masing.

### Out-of-scope awal

- Janji unlimited, jaminan zero downtime, atau klaim identitas model yang tidak dapat dibuktikan.
- Marketplace akun subscription bersama atau menjual credential provider kepada pelanggan.
- Browser-cookie harvesting, mengambil session token, atau rotasi akun untuk mengelak quota/provider controls.
- Custom wallet yang bisa ditransfer antarpengguna/dicairkan sebagai produk keuangan tanpa penilaian khusus.
- Menulis ulang seluruh fitur 9Router, microservices/Kubernetes, atau dashboard animasi sebagai syarat pilot.

## 6. Bagian yang menentukan kelayakan jualan

Aturan engineering berikut PROPOSED kecuali arah bisnis yang dinyatakan founder. Scope redeem/metering/multiplier mempunyai detail kanonis di BILLING_REDEEM.md; section ini ringkasan dan tidak boleh diedit sebagai harga/rumus kedua. Belum ada implementasi atau test aplikasi.

### 6.1 Harga, uang dan margin

- Jangan mencampur estimasi harga pasar, biaya upstream aktual, dan harga jual pelanggan.
- Simpan uang dengan integer unit eksplisit atau fixed-precision decimal; tentukan currency, scale, rounding serta aturan FX. Hindari floating point biner untuk ledger.
- Bekukan versi harga dan aturan billing pada request masuk. Perubahan tarif tidak boleh mengubah tagihan request lama.
- Catat komponen token input/output/cache/reasoning sesuai definisi provider; jangan menjumlahkan kategori yang sebenarnya subset sehingga double-charge. Tarif dasar input/output/cache terpisah, dikalikan satu model multiplier admin; formula, normalisasi, precision dan contoh sintetis ada di BILLING_REDEEM.md section 2.
- Margin kontribusi harus mengurangkan biaya upstream, payment fee, FX, refund/dispute, kredit promo, biaya infrastruktur yang dialokasikan, dan support variabel. Angka margin target belum ditentukan.
- Kredit prabayar bukan otomatis laba: bedakan kas masuk, saldo kewajiban layanan, pemakaian dan pendapatan menurut kebijakan akuntansi yang ditetapkan.
- Pantau pula upstream prepaid balance dan settlement delay. Saldo pelanggan tidak memastikan upstream cukup dana.

### 6.2 Reservasi dan settlement

Alur kandidat: admission -> reserve budget -> dispatch attempt -> stream/response -> finalize usage -> settle/release -> reconciliation.

- Admission harus atomik terhadap budget dan request paralel. Kegagalan ledger kritis menolak request baru yang berbiaya, bukan melewati kontrol.
- Perhitungan reservasi membutuhkan batas output dan upper bound biaya yang dapat dipertanggungjawabkan. Bila upper bound belum tersedia, model tidak boleh dijual dengan cap yang seolah dijamin.
- Request bisa memiliki banyak upstream attempts tetapi hanya satu settlement pelanggan sesuai aturan final. Biaya retry upstream internal tetap dicatat sebagai biaya usaha, tidak disembunyikan.
- Unique key per operasi keuangan mencegah debit/kredit ganda; retry redeem/settlement worker tidak boleh mengubah saldo dua kali.
- Usage yang hilang atau koneksi putus masuk status unresolved/provisional dengan metode rekonsiliasi yang ditentukan. Jangan mengarang usage, menandai sukses, atau otomatis membebankan maksimum sebagai final tanpa kebijakan yang jelas.
- Reservasi tidak dilepas hanya karena TTL berlalu bila request upstream masih berjalan/tidak diketahui. Recovery worker harus mengetahui ownership/state dan tindakan cancel/reconcile.
- Pelanggan mempunyai mekanisme dispute berdasarkan request ID, bukan harus mengirim prompt sensitif.

### 6.3 Streaming, compatibility dan fallback

- Tetapkan arti timeout: connect, first byte/token, idle stream dan total duration. Jangan menganggap satu angka timeout menyelesaikan semuanya.
- Setelah konten response/tool-call mulai dikirim, jangan menyambung jawaban model lain sebagai stream yang sama atau retry transparan dari awal.
- Disconnect pelanggan harus memicu cancel sebisa didukung upstream; upstream bisa tetap menagih. Kebijakan partial usage wajib ditulis.
- Fallback harus menghormati model, tools, structured output, context, region, privacy dan batas harga. Model pengganti perlu policy opt-in, bukan hanya sama-sama menghasilkan teks.
- Pisahkan transport/auth error dari provider/model error; jangan membocorkan upstream key atau stack trace.
- Key idempotency request generasi membutuhkan kontrak sendiri: scope tenant, payload hash, replay, in-progress, expiry dan batas penyimpanan. Retry SDK bukan bukti provider tidak menjalankan request pertama.
- Compatibility matrix harus menguji tool-call IDs dan chunks, usage, finish reason, Unicode, structured output, cancellation dan error. Lulus teks sederhana tidak membuktikan kompatibel dengan seluruh coding agent.

### 6.4 Top-up redeem manual dan antifraud

- Founder memverifikasi pembayaran di luar aplikasi; issue kode bukan bukti otomatis kas masuk. Catat sale/reference dan nilai kredit terpisah dari kas jika berbeda.
- Kontrak status kode, verifier secret, one-time reveal, expiry/revoke, recovery, rate limit dan race redemption: BILLING_REDEEM.md section 4.
- Grant kredit wajib satu transaksi dengan redemption; retry dan penukaran bersamaan tidak boleh menggandakan saldo.
- Adjustment/refund memakai entri koreksi bertaut dengan actor/reason, bukan menghapus ledger atau membatalkan voucher redeemed secara tersembunyi.
- Checkout otomatis, gateway dan webhook bukan kebutuhan rilis ini. Penambahan kelak memerlukan perubahan kontrak, bukan asumsi P0.

### 6.5 Data dan operasi

- Metadata log default tanpa prompt/response/Authorization; full payload capture hanya jika dibutuhkan, dibatasi, diotorisasi dan memiliki expiry/access audit.
- Console log, request metadata, audit keamanan, dan ledger keuangan mempunyai fungsi serta retention berbeda. Tombol hapus log bukan menghapus billing evidence.
- Tampilkan state accepted/admitted/in-flight/completed/failed/cancelled/unresolved secara jujur. Log selesai saja tidak membuktikan tidak ada request yang sedang menunggu.
- Trace request -> attempt -> usage -> ledger -> payment/reconciliation; dashboard bisnis tidak boleh membebani jalur streaming melalui polling payload besar atau lock bersama.
- Terapkan pembatasan tenant/key/model/konkurensi/budget, ditambah IP bila sesuai. IP bukan satu-satunya identitas karena jaringan bersama.
- Provider outage mempunyai circuit breaker, batas retry dan alert. Pisahkan health proses dari kemampuan model benar-benar menjawab.
- Host, edge/CDN/tunnel dan reverse proxy harus diuji dengan long-running stream/non-stream. Pilihan host baru belum ditetapkan; layanan existing tidak disentuh.

## 7. Sumber upstream dan lisensi

CONFIRMED dari sumber yang diperiksa: Anthropic Commercial Terms mengizinkan penggunaan layanan untuk produk bagi end user, tetapi juga membatasi resale kecuali secara eksplisit disetujui. API resmi saja bukan bukti otomatis bahwa model usaha bare API resale diizinkan.[3]

Dokumentasi Claude Code juga membedakan API authentication dan subscription OAuth, serta menyatakan pembatasan routing atas nama pengguna memakai credential paket konsumen. Itu sumber spesifik Anthropic, tidak boleh digeneralisasi sebagai aturan semua provider.[4]

PROPOSED provider eligibility register sebelum peluncuran:
- Provider, badan hukum/pemilik account, kontrak dan versi/tanggal syarat.
- Authentication path yang didukung, model/capabilities, quota, billing unit.
- Izin model usaha spesifik, hak end-user access/resale/BYOK, bukti persetujuan bila perlu.
- Region, data retention/training, subprocessors, deletion, incident contact.
- Cost/FX, availability, supply concentration, credential rotation/revocation, offboarding.
- Status per provider: eligible / blocked / pending review. Pending tidak dihitung siap dijual.

Lisensi software terpisah dari hak memakai/menjual layanan upstream. Untuk jalur fork/reuse, pin commit dan periksa LICENSE/NOTICE/dependency yang tepat. README New API menyatakan AGPLv3 beserta additional terms; fork tidak boleh diasumsikan cocok untuk produk proprietary tanpa menelaah kewajibannya.[2]

Tidak ada provider, fork maupun lisensi komersial yang telah disetujui untuk proyek ini.

## 8. Arah arsitektur, belum keputusan stack

### Dua jalur realistis

| Jalur | Kelebihan yang diharapkan | Biaya/risiko yang harus diperiksa | Pembuktian berikutnya |
|---|---|---|---|
| Reuse/fork gateway existing + control/billing plane sendiri | Memanfaatkan adapter/protocol yang sudah ada | Boundary auth tenant, hooks usage/settlement, lisensi, perubahan upstream dan attack surface | Source audit + spike terisolasi pada commit terpilih |
| Produk sendiri dengan adapter upstream sempit | Kontrol kontrak komersial, data dan deploy | Waktu implementasi protocol/streaming, regression dan maintenance | Spike satu protocol/model dengan adversarial fixtures dan billing concurrency |

PROPOSED: pilih melalui spike kecil dan due diligence, bukan klaim performa README. Jangan langsung memilih rewrite atau fork hanya karena bahasa tertentu populer.

Batas logis kandidat:
- Data path: API authentication -> entitlement/budget admission -> routing -> upstream adapter -> stream -> usage evidence/settlement.
- Control path: akun/workspace, catalog/pricing, key policy, pembayaran, audit, support dan reporting.
- Durable state untuk ledger/payment/price/policy; PostgreSQL merupakan kandidat, belum dependency terpasang atau keputusan final.
- Redis/queue/search/ClickHouse/microservices hanya ditambah bila kebutuhan concurrency/topology/retention terbukti. Cache bukan sumber saldo final.

Data/control separation adalah batas tanggung jawab, tidak otomatis dua server atau puluhan service. Modular monolith dengan worker terbatas merupakan kandidat awal yang harus dibandingkan dengan komposisi gateway existing.

## 9. Failure cases untuk menjadi acceptance/test P0

Ini test specification awal (E1), bukan hasil pengujian.

| Kasus | Hasil yang harus dikontrakkan sebelum coding |
|---|---|
| Dua request bersaing untuk saldo terakhir | Admission/reservasi atomik, tidak melampaui batas yang dijanjikan |
| Worker mati setelah debit, sebelum acknowledgement | Replay tidak men-debit kedua kali; state dapat dipulihkan |
| Kode redeem yang sama diklaim bersamaan/di-retry | Tepat satu grant; owner dapat receipt sama, tenant lain tidak mendapat identitas/receipt |
| TTL reservasi habis saat model masih berpikir | Tidak melepas dana secara buta; reconcile/cancel sesuai state |
| Stream putus setelah sebagian output | Tidak fake-complete; capture status/usage dan kebijakan partial billing |
| Upstream selesai tetapi usage tidak tersedia | Status unresolved dan langkah rekonsiliasi; bukan tagihan tebakan tersembunyi |
| Harga/multiplier berubah saat request berjalan | Settlement memakai price version dan multiplier awal |
| Model baru belum diberi multiplier/tarif atau biaya route tidak diketahui | Disabled untuk jualan, bukan faktor default tersembunyi atau biaya nol |
| Cache input merupakan subset total input | Normalisasi menghindari double-count dan tidak mengubah raw usage |
| Fallback lebih mahal atau berbeda kemampuan/region | Hanya sesuai policy yang disetujui; jika tidak, gagal terstruktur |
| Tenant A meminta log/key/payment milik B | Ditolak server-side tanpa data atau secret B |
| Key dicabut saat ada request aktif | Semantik request baru dan aktif ditentukan serta diuji |
| Support membuka record sensitif | Permission terbatas, redaction, akses diaudit; tidak otomatis mendapat prompt |
| Restore backup | Uang, reservation, idempotency, credential dan reconciliation tidak terduplikasi/hilang tanpa terdeteksi |

Target numeric NFR harus menyebut workload, ukuran input/output, stream concurrency, durasi, hardware/edge, periode serta metode. Belum ada benchmark, SLO, RPO/RTO atau janji kapasitas yang ditetapkan.

## 10. UIArc Reference Map awal

Tanggal pemeriksaan sumber: 2026-11-13. Evidence tersimpan di `evidence/2026-11-13/uiarc/`, relatif terhadap folder dokumen ini. Status VERIFIED di bawah hanya isi dokumentasi yang dibaca, bukan source code, preview, integrasi, lisensi dependency lengkap, atau hasil a11y aplikasi.

UIArc adalah referensi utama UI, bukan kewajiban memakai React/Next.js. PROPOSED default: PATTERN_ADAPTATION sampai stack dipilih; DIRECT_ADOPTION hanya setelah kompatibilitas dan source/registry dilihat. Free source mempunyai ketentuan MIT dengan kewajiban mempertahankan notice; tidak ada otorisasi pembelian Pro.[11]

| ID | Target calon layar/komponen | URL yang dibaca / sumber | Status/access | Prinsip dan adaptasi | Verification dan dependency impact |
|---|---|---|---|---|---|
| UAR-001 | Portal usage/budget; quota meter | https://uiarc.dev/components/usage-meter/markdown [5] | VERIFIED docs; Free | Tampilkan quota terhadap batas yang nyata, label/status non-warna; pisahkan saldo uang dari token/quota dan tunjukkan waktu freshness | Uji keyboard/announcement, limit/overage, responsive; NONE sekarang, motion/lucide kandidat bila direct |
| UAR-002 | Usage/payment/admin lists; record table | https://uiarc.dev/components/sortable-data-table/markdown [6] | VERIFIED docs; Free | Caption, sortable headers, selection dan contained overflow; sorting bawaan client-side, jadi perlu kontrak pagination/sort server-side agar seluruh dataset benar | Uji sort lintas page, tenant filtering, keyboard dan mobile; NONE sekarang |
| UAR-003 | Ringkasan pelanggan/operasi; metric summary | https://uiarc.dev/components/metric-card/markdown [7] | VERIFIED docs; Free | Label, nilai, konteks periode/freshness; jangan memakai number float UI sebagai sumber ledger. Sumber tidak announce update otomatis; tentukan live-region yang tidak bising | Uji format/localization, stale/error dan screen-reader; NONE sekarang |
| UAR-004 | Key sekali tampil, base URL/config; copy action | https://uiarc.dev/components/copy-button/markdown [8] | VERIFIED docs; Free | Nama aksesibel, hasil copy nyata dan failure state; key hanya ada di reveal flow yang diotorisasi, bukan dapat diambil ulang dari daftar | Uji clipboard denied/secure context/keyboard, no secret in telemetry; NONE sekarang |
| UAR-005 | Penawaran/paket; plan comparison | https://uiarc.dev/components/blocks/plan-comparison/markdown [9] | VERIFIED docs; Free | Matrix fitur yang relevan dan responsive; belum menetapkan paket bulanan. Jika PAYG dipilih, utamakan tabel tarif model, jangan memaksakan monthly/yearly | Harga dari catalog versioned dan callback backend nyata; sample UI bukan pembayaran; NONE sekarang |
| UAR-006 | Auth; centered credential flow | https://uiarc.dev/components/blocks/login-centered/markdown [10] | VERIFIED docs, variant Centered; Free | Hierarki satu aksi dan state error/pending; auth method belum dipilih. Dokumentasi berisi beberapa variant dan tidak semuanya Free | Uji session/recovery/abuse dan keyboard; simulated sign-in tidak boleh digunakan sebagai auth; NONE sekarang |

Semua entri di atas menggunakan PATTERN_ADAPTATION sebagai strategi sementara. Kandidat tampilan: Navy/Blue/Gold, kontrol ringkas, tanpa emoji; nilai token, density, contrast dan target mobile belum dikunci.

Ekstensi untuk SCR-001 Isi Saldo, SCR-002 Kode Redeem Admin dan SCR-003 Harga/Multiplier serta UAR-007 sampai UAR-010 kanonis di BILLING_REDEEM.md section 5. Referensi lama di tabel ini tetap stabil.

PENDING sebelum Gate C: screen inventory final, pemetaan seluruh tipe komponen termasuk primitive input/dialog/filter/navigation, model picker serta route editor, empty/error/permission/session-expired states, token semantic, keyboard/focus, responsive dan verification specs. Belum ada CUSTOM_GAP yang dinyatakan selesai ditinjau. Billing overview Pro telah teridentifikasi dalam bukti tetapi tidak dipilih atau disalin; kebutuhan billing dapat dibangun dengan primitive Free setelah mapping memadai.

## 11. Asumsi, risiko dan keputusan yang dibutuhkan

| ID | Pernyataan/status | Alasan/confidence | Dampak bila salah / owner / pemicu |
|---|---|---|---|
| ASM-001 | GREENFIELD, ASSUMED | Folder intake hanya dua dokumen; medium, mungkin source berada di tempat lain | Arsitektur perlu menilai aset existing / founder / sebelum memilih reuse |
| ASM-002 | Portal pelanggan + admin dan API, PROPOSED supporting UI | Model usaha Managed API/redeem sudah confirmed; bentuk UI belum final / medium | Scope UI/auth/billing berubah / founder / sebelum screen spec final |
| ASM-003 | Indonesia/IDR sebagai kandidat, PROPOSED | Bahasa founder, bukan bukti target pasar / low | Payment, locale dan legal scope berubah / founder / sebelum payment contract |
| ASM-004 | Pilot sempit sebelum public, PROPOSED | Membatasi exposure biaya/operasi / medium | Perlu kapasitas dan kontrol lebih awal bila langsung public / founder / release scope |

| ID | Risiko | Mitigasi yang diusulkan / owner / trigger |
|---|---|---|
| RSK-001 | Upstream teknis berfungsi tetapi hak penawaran komersial belum jelas | Eligibility register, contractual review dan supply alternatif / founder / sebelum menjual provider |
| RSK-002 | Overspend, double-charge atau hilang usage | Atomic reservation, idempotent ledger, reconciliation dan crash tests / engineering / sebelum uang nyata |
| RSK-003 | Margin tampak positif karena biaya retry/fee/FX/support tak dihitung | Unit-economics per model + stress scenario tanpa fabricated numbers / founder-finance / sebelum harga final |
| RSK-004 | Credential/prompt pelanggan bocor atau tenant silang | Secret lifecycle, redaction, authorization dan negative tests / security / sebelum pilot |
| RSK-005 | Compatibility luas dijanjikan dari tes teks sederhana | Matrix per protocol/tool dan fixture stream/tool-call / engineering / sebelum klaim pemasaran |
| RSK-006 | Operasi bergantung satu provider/akun/operator | Batas kapasitas, incident plan, backup/restore, supply review / founder-ops / sebelum public |
| RSK-007 | Fork mengikat lisensi atau maintenance tak sesuai bisnis | Pin commit, telaah notice/dependency dan adapter boundary / founder-engineering / sebelum reuse code |

Register keputusan:
- OQ-001 CLOSED: Founder memilih penjualan akses API token AI prabayar melalui kode redeem dari admin founder. Tidak ada payment gateway P0.
- OQ-002 PARTIAL (2026-11-13, CR-003): founder menyatakan menjual kembali API dari provider lain (upstream berupa reseller/agregator) dan meminta input admin untuk API key serta base URL upstream. CR-004 menambah: sumber yang disebut founder adalah "Dahono" (ejaan dari founder; belum teridentifikasi), DeepSeek, dan "API dari Codex" serta lainnya; routing harus memilih upstream berdasarkan model yang dipanggil. Status tiap sumber di ARCHITECTURE.md section 6. CR-006: "Dahono" adalah Dahono Router (https://dhn.ai.id/). Owner founder; sebelum tiap upstream ditandai eligible.
- OQ-003 PARTIAL (2026-11-13, CR-003): tool target Hermes, OpenCode, ZCode, Codex, Claude Code dan sejenisnya. Konsekuensi protokol di ARCHITECTURE.md ADR-002. Skala pilot belum disebutkan. Owner founder; sebelum kriteria kapasitas.
- OQ-004 CLOSED untuk currency (2026-11-13, CR-003): saldo Rupiah (IDR) pada MVP; USD menyusul setelah sistem stabil (DEFERRED). Tarif, nominal kode dan nilai multiplier nyata tetap diisi founder lewat backoffice dan bukan bagian kontrak.

Detail keputusan, scope dan perubahan dicatat pada CHANGELOG.md. Bagian independen perencanaan tetap dapat dilanjutkan tanpa menganggap pertanyaan terbuka telah terjawab.

Budget, tim dan timeline tetap TBD sesudah tiga keputusan itu. Tidak ada estimasi tanggal presisi atau komitmen harga pada tahap ini.

## 12. Artefak berikutnya dan batas kesiapan

Sudah dibuat: discovery diperbarui, manifest, BILLING_REDEEM.md (kontrak awal dengan traceability terbatas), CHANGELOG.md dan snapshot referensi. Tidak dibuat: source aplikasi, kontrak OpenAPI, schema database, UI, atau deployment.

Urutan berikut yang disarankan:
1. Gunakan OQ-001 yang sudah closed, lengkapi supply (OQ-002), tool/pilot (OQ-003) dan unit saldo/harga (OQ-004) pada domain yang membutuhkan; jangan bertanya ulang model bisnis.
2. Susun PLANNING dengan scope P0/P1/P2 yang disepakati dan applicability final; tetapkan opsi architecture/reuse beserta spike.
3. Buat kontrak behavior/billing/permission/provider compatibility, data/interface/security, UX/UIArc/tokens, testing/task dan operasi secara proporsional. Manifest menentukan section/file otoritatif, bukan memaksakan satu dokumen per topik.
4. Audit konsistensi dan traceability FR -> AC -> kontrak -> TASK -> TEST; baru nilai Gate C untuk scope yang benar-benar lengkap.

Dokumen ini tidak dinilai implementation-ready. FR/AC/task/test awal hanya mencakup redeem/metering/multiplier dalam BILLING_REDEEM.md, belum seluruh P0. Model bisnis sudah confirmed tetapi supply, keputusan teknis material dan UIArc map belum lengkap. Gate D tidak relevan karena implementasi serta uji produk belum ada. Pemeriksaan dokumen hanya membuktikan isi/file/rujukan, bukan behavior router atau kelayakan usaha.

## Sources

[1] https://raw.githubusercontent.com/decolua/9router/HEAD/README.md — 9Router README
[2] https://raw.githubusercontent.com/QuantumNous/new-api/HEAD/README.en.md — New API README
[3] https://www.anthropic.com/legal/commercial-terms — Anthropic Commercial Terms
[4] https://code.claude.com/docs/en/legal-and-compliance.md — Claude Code legal and compliance
[5] https://uiarc.dev/components/usage-meter/markdown — UIArc Usage meter
[6] https://uiarc.dev/components/sortable-data-table/markdown — UIArc Sortable data table
[7] https://uiarc.dev/components/metric-card/markdown — UIArc Metric card
[8] https://uiarc.dev/components/copy-button/markdown — UIArc Copy button
[9] https://uiarc.dev/components/blocks/plan-comparison/markdown — UIArc Plan comparison
[10] https://uiarc.dev/components/blocks/login-centered/markdown — UIArc Login centered
[11] https://uiarc.dev/license — UIArc license

<!-- END ROUTER-DISCOVERY v0.2.3 -->
