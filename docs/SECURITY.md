# Security, Permission dan Anti-abuse: Router AI Komersial

Version: 0.3.1
Status: Draft, PROPOSED; rencana kontrol, bukan hasil audit atau klaim compliance
Owner keputusan: founder
Updated: 2026-11-13, Asia/Jakarta
Dependencies: PLANNING.md; ARCHITECTURE.md; BILLING_REDEEM.md
Evidence: E1. Tidak ada pengujian keamanan yang dijalankan.

Sumber otoritatif untuk peran dan izin, threat/control, abuse surface dan kebijakan data.

## 1. Penilaian risiko

Risk HIGH (PROPOSED): saldo bernilai uang, credential upstream yang dapat dipakai untuk menimbulkan biaya, multi-tenant, endpoint publik. Bukan CRITICAL: tidak ada risiko keselamatan dan saldo tidak dapat dicairkan. Belum diketahui: yurisdiksi dan kewajiban hukum, volume, sensitivitas isi prompt pelanggan. Isi prompt diperlakukan sebagai data sensitif milik pelanggan.

## 2. Peran dan matriks izin

| Principal | Cara autentikasi | Lingkup |
|---|---|---|
| ANON | – | Aktivasi undangan, login, reset; halaman publik |
| OWNER | Sesi pelanggan | Resource tenant miliknya |
| KEY | API key | Data plane untuk tenant pemilik key, dalam scope key |
| ADMIN | Sesi admin dengan TOTP | Backoffice; founder saja pada pilot |
| SYSTEM | Identitas proses internal | Settlement, pemulihan, job terjadwal |

Peran support dan anggota tim: DEFERRED ke P1. Default seluruh operasi adalah tolak.

| Resource / aksi | ANON | OWNER | KEY | ADMIN | SYSTEM |
|---|---|---|---|---|---|
| Aktivasi undangan, login, reset | Ya | – | – | – | – |
| Profil, sesi, password sendiri | – | Ya | – | Miliknya | – |
| API key tenant: buat, lihat tersamar, cabut | – | Ya, mandiri | – | Lihat tersamar, cabut | – |
| Secret API key setelah dibuat | – | Sekali saat dibuat | – | Tidak | – |
| Inference dan daftar model | – | – | Ya, dalam scope | – | – |
| Katalog harga jual | – | Ya | Daftar model | Ya | – |
| Biaya modal, multiplier mentah, cost profile | – | Tidak | Tidak | Ya | Baca |
| Saldo, request, ledger tenant sendiri | – | Baca | – | Baca semua tenant | Tulis lewat settlement |
| Redeem kode | – | Ya | – | Tidak | – |
| Terbit, cabut, daftar voucher | – | Tidak | – | Ya, step-up | – |
| Adjustment saldo; top-up langsung lewat username | – | Tidak | – | Ya, step-up | – |
| Pemakaian per pelanggan (metadata, tanpa isi prompt) | – | Miliknya | – | Ya, semua tenant | – |
| Tenant: undang, suspend, restore | – | Tidak | – | Ya | – |
| Upstream, route, eligibility | – | Tidak | – | Ya, step-up | Baca |
| API key upstream (nilai) | – | Tidak | – | Tulis dan ganti saja, step-up | Baca saat dispatch |
| Base URL upstream | – | Tidak | – | Baca dan ubah, step-up | Baca |
| Kill switch, batas global | – | Tidak | – | Ya, step-up | Baca |
| Audit log | – | Tidak | – | Baca | Tulis |
| Isi prompt/respons | – | – | Milik request sendiri saat transit | Tidak | Transit saja |

Admin tidak dapat menukar kode redeem dan tidak dapat membaca kembali credential upstream setelah disimpan. OWNER dari tenant lain diperlakukan sebagai tidak berizin; respons tidak membedakan "bukan milik Anda" dari "tidak ada".

## 3. Trust boundary, threat dan kontrol

Boundary: TB1 internet ke data plane; TB2 browser ke portal; TB3 browser ke backoffice; TB4 gateway ke upstream; TB5 aplikasi ke database dan secret store; TB6 aplikasi ke penyedia email.

| THR | Boundary / aset | Skenario | Kontrol | Verifikasi | Residual |
|---|---|---|---|---|---|
| THR-001 | TB1, saldo | Request paralel melampaui saldo atau batas key | CTL-001 admission atomik dengan kunci baris dan hold | TEST-002, TEST-009 | Pelanggaran bound estimasi input (RSK-009) |
| THR-002 | TB2, voucher | Tebak atau brute-force kode redeem | CTL-002 entropi 128-bit, verifier, pembatas laju per akun dan IP | TEST-005 | Kode bocor di kanal pengiriman di luar aplikasi |
| THR-003 | TB2, voucher | Penukaran ganda lewat race atau retry | CTL-003 transaksi tunggal dan constraint unik | TEST-005 | – |
| THR-004 | TB3, voucher dan harga | Pengambilalihan akun admin | CTL-004 TOTP, step-up, sesi pendek, alert tiap penerbitan, batas nominal terbit per periode | TEST-007, TEST-004 | Admin tunggal tanpa approval kedua (RSK-008) |
| THR-005 | TB2/TB3, data tenant | Akses objek tenant lain lewat ID | CTL-005 filter tenant di lapisan data, respons seragam | TEST-008 | – |
| THR-006 | TB1, API key | Key bocor dipakai pihak lain | CTL-006 verifier tanpa plaintext, batas belanja dan model per key, revoke, last-used | TEST-009 | Kerugian sampai batas key sebelum terdeteksi |
| THR-007 | TB4/TB5, credential upstream | Credential terbaca dari log, error, database atau respons | CTL-007 secret store, redaksi log, error generik, tulis-saja dari UI | TEST-012, TEST-019 | Akses host oleh operator |
| THR-008 | TB1/TB5, isi prompt | Isi prompt tersimpan atau terlihat staf | CTL-008 metadata-only, larangan body pada log dan trace, tanpa fitur lihat-prompt | TEST-019 | Upstream menyimpan data sesuai ketentuannya sendiri |
| THR-009 | TB4, biaya | Route mahal atau biaya naik menyebabkan rugi | CTL-009 margin guard, cost freshness, batas belanja global, kill switch | TEST-003, TEST-017 | Biaya tetap dan retry di luar floor per token |
| THR-010 | TB1, layanan | Banjir request atau stream menghabiskan koneksi | CTL-010 batas konkurensi dan laju per key/tenant, batas ukuran dan durasi, penolakan sebelum pekerjaan mahal | TEST-011 | Serangan volumetrik jaringan ditangani di edge yang belum dipilih |
| THR-011 | TB2/TB3, sesi | Pencurian atau pemalsuan sesi, CSRF, XSS | CTL-011 cookie aman, proteksi CSRF, output encoding, kebijakan konten, validasi input di server | TEST-006, TEST-007 | – |
| THR-012 | TB2, akun | Enumerasi email dan credential stuffing | CTL-012 respons seragam, pembatas laju per akun dan IP, hash password adaptif | TEST-006 | Password lemah yang dipakai ulang pelanggan |
| THR-013 | TB5, ledger | Perubahan atau penghapusan entri keuangan dan audit | CTL-013 append-only di aplikasi, hak database minimum, invariant check, backup | TEST-016, TEST-017 | Operator database dengan hak penuh |
| THR-014 | TB4, respons upstream | Respons upstream cacat merusak settlement atau menyisipkan konten ke kanal kontrol | CTL-014 parser ketat, usage divalidasi rentang, konten diteruskan sebagai data dan tidak ditafsirkan | TEST-002, TEST-011 | – |
| THR-015 | TB6, undangan dan reset | Tautan dicegat atau dipakai ulang | CTL-015 token sekali pakai berumur pendek disimpan sebagai verifier; tidak dicatat di log | TEST-006 | Kotak masuk pelanggan yang sudah dikuasai pihak lain |
| THR-016 | Rantai pasok | Dependency atau kode registry berbahaya | CTL-016 vetting dependency, lockfile, pin versi, tinjauan kode hasil salin | TASK-020 | Bergantung kedalaman tinjauan |
| THR-017 | TB3/TB4, jaringan internal dan API key upstream | Base URL upstream diarahkan ke alamat internal, metadata host, atau server pihak lain sehingga gateway mengirim request dan API key ke sana | CTL-017 hanya HTTPS; resolusi nama diperiksa saat simpan dan saat koneksi terhadap alamat loopback, privat, link-local dan metadata; redirect tidak diikuti; perubahan base URL memerlukan step-up, memasukkan ulang API key dan diaudit | TEST-012 | Admin yang sah memasukkan upstream yang tidak tepercaya |
| THR-018 | TB4, isi prompt dan biaya | Upstream reseller menyimpan isi request, mengganti model, atau menagih berbeda dari usage yang dilaporkan | CTL-018 ketentuan dan retensi upstream dicatat di register eligibility dan diungkap di kebijakan privasi; rekonsiliasi usage terhadap tagihan upstream; tidak ada klaim identitas model yang tidak dapat dibuktikan | TEST-015, tinjauan register | Perilaku upstream di luar kendali produk |

## 4. Abuse surface

| ABU | Surface | Batas server-side (PROPOSED) | Failure mode dan pemulihan |
|---|---|---|---|
| ABU-001 | Login pelanggan dan admin | Tiga lapis dalam window: per pasangan akun dan IP (ketat), per IP, dan per akun lintas IP (longgar). Nilai awal di ../server/README.md | Pemilik akun tetap dapat masuk dari jaringan lain saat satu jaringan dibatasi; sesi yang sudah ada tidak terpengaruh; pesan seragam; Retry-After |
| ABU-002 | Reset password dan aktivasi | Per email tujuan dan per IP; satu token aktif per akun | Permintaan berlebih diabaikan diam-diam dengan respons seragam |
| ABU-003 | Redeem | BILLING_REDEEM.md FR-005: 5 gagal per akun dan 30 per IP tiap 15 menit | Cooldown terlihat; kode tidak terkonsumsi |
| ABU-004 | Inference | Konkurensi dan laju per key dan tenant; batas ukuran body dan output | `limit_exceeded` dengan Retry-After; tidak ada hold |
| ABU-005 | Pembuatan API key | Jumlah key aktif per tenant | Pesan batas dengan arahan mencabut key lama |
| ABU-006 | Login dan TOTP admin | Per akun; alert pada kegagalan berulang | Recovery code sekali pakai |
| ABU-007 | Pengiriman email | Anggaran harian global dan per tujuan | Antrean ditahan dan admin diberi alert |
| ABU-008 | Aturan usage nol dan usage hilang | Hitungan per tenant dan per key atas request tanpa debit dan request ber-settlement estimasi dalam window; ambang memicu alert dan pembatasan laju | Pelanggan diberi tahu lewat `limit_exceeded`; admin meninjau lewat SCR-015; tidak ada pemblokiran permanen otomatis |

Bila pembatas laju tidak dapat membaca penyimpanannya, operasi berbiaya atau sensitif ditolak, bukan dilewatkan. Nilai ambang ditetapkan saat implementasi dan diuji terhadap jaringan bersama. CAPTCHA, fingerprint perangkat dan pemblokiran email sekali pakai tidak direncanakan untuk pilot undangan.

Bila registrasi terbuka diaktifkan kelak (P1), tambahkan surface pendaftaran, verifikasi email dan pencegahan pembuatan tenant massal sebelum rilis.

## 5. Kebijakan data

| Data | Disimpan | Retensi (PROPOSED, perlu keputusan founder) | Akses |
|---|---|---|---|
| Isi prompt dan respons | Tidak | – | Transit saja |
| Metadata request dan usage | Ya | Selama akun aktif ditambah periode sengketa | OWNER miliknya; ADMIN |
| Ledger, voucher, redemption | Ya | Mengikuti kewajiban pencatatan keuangan yang berlaku; nilai TBD | OWNER miliknya; ADMIN |
| Audit event | Ya | TBD; lebih panjang dari metadata request | ADMIN baca |
| Email dan profil | Ya | Sampai akun ditutup; dianonimkan sesudahnya | OWNER; ADMIN |
| Log aplikasi | Ya, tanpa body dan secret | Pendek; nilai TBD | Operator |
| Credential upstream | Secret store | Sampai dirotasi atau dicabut | SYSTEM saat dispatch |

Aliran ke pihak ketiga: isi request ke upstream reseller yang dipilih dan, lewat dia, ke penyedia model di belakangnya; alamat email ke penyedia email. Keduanya dinyatakan pada kebijakan privasi produk sebelum pilot. Ketentuan retensi dan pelatihan tiap upstream dicatat di register eligibility. Kewajiban hukum perlindungan data belum dinilai (UNKNOWN, owner founder).

## 6. Standar dan kedalaman verifikasi

| Standar | Applicability | Status |
|---|---|---|
| OWASP ASVS | Portal, backoffice, data plane | VERIFICATION_REQUIRED: edisi, level target dan daftar requirement diambil dari sumber resmi saat menyusun test rinci |
| OWASP API Security Top 10 | Data plane dan operasi JSON | VERIFICATION_REQUIRED: edisi berlaku |
| WCAG 2.2 AA | Portal dan backoffice | Target default kontrak; kriteria rinci diverifikasi ke W3C saat DSD |

Tidak ada ID kontrol standar yang dipetakan pada dokumen ini; pemetaan dibuat setelah sumber resminya dibaca. Verifikasi minimum sebelum pilot: uji negatif otorisasi untuk setiap operasi di ARCHITECTURE.md section 5, uji konkurensi uang, uji pembatas laju, pemindaian secret pada log dan repo, dan tinjauan konfigurasi header/cookie. Tinjauan oleh pihak selain penulis kode disarankan untuk modul ledger dan autentikasi; ketersediaannya bergantung OQ-005.

## 7. Friction keamanan dan copy

Step-up admin, cooldown redeem dan penolakan batas memiliki pesan yang menyebut apa yang terjadi dan kapan dapat dicoba lagi. Teks kanonis ada di UX.md section 5. Tidak ada pesan yang mengungkap keberadaan akun, pemilik kode, atau detail upstream.

<!-- END ROUTER-SECURITY v0.3.1 -->
