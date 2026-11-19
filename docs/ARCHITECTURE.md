# Architecture, Data dan Interface: Router AI Komersial

Version: 0.8.2
Status: Draft; stack disetujui, API M1 lokal diimplementasikan; gateway dan UI belum
Owner keputusan: founder
Updated: 2026-11-19, Asia/Jakarta
Dependencies: PLANNING.md; BILLING_REDEEM.md; SECURITY.md
Evidence: E3 untuk test API M1 dan spike yang cakupannya tercatat di README masing-masing; kontrak fitur lain tetap rencana.

> **Berlaku sejak 2026-11-14 (CR-027).** ADR-005 (saldo Rupiah, mikro-IDR) digantikan TOKEN_CREDIT.md: unit internal adalah mikro-kredit token. Kata "uang" pada section 3 dan 4 dibaca sebagai kredit token. Bound input untuk hold adalah jumlah byte request (CR-016) dan input yang ditagih dibatasi nilai itu (CR-018). Section 5 mendaftar operasi yang direncanakan; rute yang benar-benar ada tercatat di ../server/src/http/app.ts dan handoff/claude-log.md. Bila isi di bawah bertentangan dengan TOKEN_CREDIT.md, TOKEN_CREDIT.md yang berlaku.

Sumber otoritatif untuk topologi, siklus hidup request, kontrak data, daftar operasi interface, register upstream dan ADR. Rumus harga dan aturan voucher tetap di BILLING_REDEEM.md. Izin tiap operasi dirujuk ke SECURITY.md section 2.

## 1. Topologi logis

Satu aplikasi (modular monolith) dengan tiga jalur dan satu database:

| Bagian | Tanggung jawab | Catatan |
|---|---|---|
| Data path (gateway) | Autentikasi API key, admission, routing, adapter upstream, relay stream, pencatatan usage | Tidak bergantung pada query dashboard; tidak menulis body request |
| Control path (portal dan backoffice) | Akun, tenant, key, katalog, harga, voucher, upstream, laporan, audit | Web UI dan operasi JSON di belakang sesi |
| Worker | Settlement tertunda, pemulihan hold, rekonsiliasi, job retensi, invariant check | Proses terpisah secara logis; boleh satu binary |
| Database | Ledger, hold, voucher, harga, request, audit, idempotency | PostgreSQL diusulkan (ADR-003) |

Pembatas laju membutuhkan penyimpanan bersama bila gateway berjalan lebih dari satu instance. Pilot satu instance boleh memakai database yang sama; cache terpisah ditambahkan hanya bila pengukuran menunjukkan kebutuhan. Cache tidak pernah menjadi sumber saldo.

Pemisahan data/control adalah batas modul. Keduanya boleh berada pada satu proses saat pilot selama query laporan tidak mengunci tabel yang dipakai admission.

## 2. Siklus hidup request

| State | Arti | Transisi berikutnya |
|---|---|---|
| RECEIVED | Request diterima, belum diautentikasi penuh | REJECTED, ADMITTED |
| REJECTED | Ditolak sebelum dispatch; tidak ada hold | Terminal |
| ADMITTED | Snapshot harga diambil dan hold dibuat secara atomik | DISPATCHED, FAILED |
| DISPATCHED | Minimal satu attempt dikirim ke upstream | STREAMING, COMPLETED, FAILED, CANCELLED |
| STREAMING | Byte pertama sudah dikirim ke klien | COMPLETED, FAILED, CANCELLED |
| COMPLETED | Upstream selesai normal | SETTLED, SETTLED_ESTIMATED, UNRESOLVED |
| FAILED | Gagal; sebagian output mungkin sudah terkirim | SETTLED, SETTLED_ESTIMATED, UNRESOLVED |
| CANCELLED | Klien memutus atau pembatalan diminta | SETTLED, SETTLED_ESTIMATED, UNRESOLVED |
| SETTLED | Usage final dicatat, debit dibuat, sisa hold dilepas | Terminal |
| SETTLED_ESTIMATED | Konten sudah diteruskan tetapi usage dari upstream tidak ada; debit dari hitungan lokal gateway, ditandai estimasi, sisa hold dilepas | Terminal; koreksi lewat adjustment admin |
| UNRESOLVED | Usage tidak lengkap atau tidak diketahui; hold dipertahankan | SETTLED lewat rekonsiliasi |

Aturan:
- Hold tidak dilepas oleh TTL semata. Worker memeriksa pemilik dan state attempt sebelum bertindak.
- Settlement dikunci oleh request ID; pemanggilan ulang tidak menambah entri.
- Usage nol (CONFIRMED founder, CR-004): bila usage final nol token input dan nol token output, settlement bernilai nol, hold dilepas seluruhnya, dan alasan dicatat. Berlaku untuk upstream yang melaporkan nol dan untuk request yang gagal sebelum ada byte konten diteruskan ke klien.
- Usage hilang (CONFIRMED founder mengikuti rekomendasi, CR-006): bila konten sudah diteruskan ke klien tetapi upstream tidak melaporkan usage, request di-settle dari hitungan lokal gateway atas konten yang diteruskan dan input yang diterima, ditandai estimasi dan dapat dikoreksi admin. Implementasi menyelesaikannya langsung ke SETTLED_ESTIMATED (alasan `usage_missing`, atau `cancelled_mid_stream` bila klien memutus) tanpa singgah di UNRESOLVED; UNRESOLVED dipakai bila settlement itu sendiri gagal, dan hold tetap terbuka sampai rekonsiliasi. Request seperti ini tidak diperlakukan sebagai usage nol.
- Biaya upstream untuk request yang tidak didebit tetap dicatat pada attempt sebagai biaya usaha dan masuk laporan selisih.
- Retry antar-route hanya dari DISPATCHED sebelum STREAMING, paling banyak sejumlah batas konfigurasi.

## 3. Admission dan upper bound

Hold dihitung dari snapshot harga:

    hold = batas_input_token * tarif_input_efektif + batas_output_token * tarif_output_efektif

- `batas_output_token` berasal dari parameter request; bila kosong memakai batas default model atau key. Request tanpa batas yang dapat ditentukan ditolak.
- `batas_input_token` adalah estimasi konservatif dari ukuran body; metode estimasi per adapter didokumentasikan dan diuji terhadap fixture. Cache write yang tarifnya lebih tinggi daripada input reguler memakai tarif tertinggi yang berlaku untuk bound.
- Bila usage final melebihi hold, selisih tetap didebit dan peristiwa dicatat sebagai pelanggaran bound untuk ditindaklanjuti (RSK-009). Saldo negatif menolak request baru. Spike membuktikan estimasi "ukuran body dibagi dua" tidak cukup; produksi memakai penghitungan token lokal atau batas konteks model sebagai bound, ditetapkan per adapter.
- Admission, pemeriksaan batas key, dan pembuatan hold berada dalam satu transaksi dengan penguncian baris akun saldo.

## 4. Kontrak data

Tipe dan nama kolom final mengikuti stack. Invariant di bawah mengikat.

| Entity | Pemilik / isi utama | Invariant |
|---|---|---|
| user | Identitas login: username, email, verifier password, status | Username unik tanpa membedakan huruf besar-kecil, himpunan karakter terbatas, tidak dipakai ulang setelah akun ditutup; email unik setelah normalisasi huruf kecil; tanpa normalisasi local-part khusus provider |
| admin_credential | Faktor kedua dan recovery code admin | Secret TOTP terenkripsi; recovery code disimpan sebagai verifier |
| tenant | Batas kepemilikan; status ACTIVE/SUSPENDED/CLOSED | Semua resource pelanggan merujuk tenant |
| membership | user ke tenant, role | P0: tepat satu OWNER per tenant |
| invite | Undangan admin: verifier token, email tujuan, expiry, status | Sekali pakai; aktivasi dan pembuatan tenant satu transaksi |
| session | Sesi server-side | Dapat dicabut; menyimpan waktu autentikasi terakhir untuk step-up |
| api_key | tenant, nama, prefix, verifier, model scope, spend limit, expiry, status | Secret tidak tersimpan; prefix tidak cukup untuk autentikasi |
| public_model | ID publik stabil, nama tampilan, kemampuan, batas, status penjualan | ID tidak dipakai ulang untuk model berbeda |
| price_version | BILLING_REDEEM.md section 2.2 | Immutable setelah published |
| upstream | Penyedia, base URL per protokol, referensi API key, status eligibility, catatan syarat | API key di secret store atau terenkripsi dengan kunci di luar database, bukan plaintext; base URL lolos validasi CTL-017; penggantian key diaudit tanpa nilai |
| route | public_model ke model upstream, protokol, prioritas, status | Hanya dipakai bila upstream eligible, cost profile berlaku, dan protokol route sama dengan permukaan yang dipanggil |
| cost_profile_version | Biaya upstream per kategori, currency biaya, kurs ke IDR beserta as-of, status | Immutable; stale ditentukan dari as-of biaya dan as-of kurs terhadap ambang freshness |
| request | tenant, key, model, state, snapshot harga, batas, waktu, kode hasil | Tanpa body; state mengikuti section 2 |
| attempt | request, route, urutan, hasil, waktu, biaya upstream estimasi/aktual | Banyak per request |
| usage_record | request, raw usage aman, usage ternormalisasi, versi normalizer, sumber | Satu final per request; raw tidak diubah |
| ledger_account | tenant, currency, scale, saldo posted, total hold | Saldo posted sama dengan jumlah entri; diperbarui dalam transaksi yang sama |
| ledger_entry | account, jenis, nilai bertanda, kunci idempotency, rujukan sumber, waktu | Append-only; kunci idempotency unik per jenis dan sumber |
| hold | account, request, nilai, status ACTIVE/CAPTURED/RELEASED | Satu hold aktif per request |
| voucher, redemption | BILLING_REDEEM.md section 4 | Satu redemption per voucher |
| reconciliation_case | request atau periode, status, bukti, pelaku, hasil | Penyelesaian idempotent |
| audit_event | pelaku, aksi, target, ringkasan, waktu | Append-only; tanpa secret |
| idempotency_record | scope, kunci, hash payload, hasil, expiry | Kunci sama dengan payload berbeda ditolak |
| system_flag | Kill switch global/per model, batas belanja global | Perubahan diaudit |

Jenis ledger_entry: GRANT_REDEEM, GRANT_ADMIN_TOPUP, DEBIT_USAGE, ADJUSTMENT_CREDIT, ADJUSTMENT_DEBIT. GRANT_ADMIN_TOPUP membawa referensi penjualan atau alasan, pelaku dan kunci idempotency; dilaporkan terpisah dari redeem dan dari koreksi. Hold bukan entri ledger; saldo tersedia = saldo posted dikurangi total hold aktif.

Waktu disimpan sebagai instant dengan offset tidak ambigu. Tampilan memakai zona waktu pengguna; batas periode laporan memakai zona yang dinyatakan pada layar. Uang memakai integer unit internal sesuai ADR-005; tidak ada floating point.

Klasifikasi data: credential upstream dan verifier (rahasia); email dan metadata request (pribadi); ledger dan audit (bukti keuangan); body request (tidak disimpan).

## 5. Kontrak interface

Daftar operasi dan batas izinnya. Bentuk schema executable ditulis setelah ADR-002 dan ADR-004; saat itu schema menjadi otoritatif untuk bentuk data dan tabel ini untuk izin dan semantic.

### 5.1 Data plane (principal: API key)

| ID | Operasi | Izin | Catatan |
|---|---|---|---|
| API-001 | Chat Completions (OpenAI-compatible) | Key aktif, tenant aktif, model dalam scope | FR-011; streaming dan non-streaming; tahap A |
| API-002 | Daftar model yang dijual | Key aktif | Hanya model enabled dalam scope key; bentuk respons mengikuti permukaan |
| API-003 | Anthropic Messages | Sama dengan API-001 | FR-011; tahap B; header `anthropic-version` dan `anthropic-beta` diteruskan apa adanya |
| API-004 | Hitung token Anthropic Messages | Key aktif | Opsional; diteruskan bila upstream menyediakannya, tanpa debit dan tanpa hold; dibatasi laju |
| API-005 | OpenAI Responses | Sama dengan API-001 | FR-011; tahap C; hanya mode stateless yang diteruskan sampai penyimpanan respons di upstream dinilai |

Header respons memuat request ID. Penolakan karena batas memuat Retry-After bila berlaku. Kode error stabil milik produk: `auth_invalid`, `key_revoked`, `tenant_suspended`, `model_not_available`, `insufficient_balance`, `limit_exceeded`, `request_too_large`, `upstream_unavailable`, `service_paused`, `internal_error`. Setiap permukaan memakai bentuk error protokolnya sendiri; kode produk dibawa pada field yang tersedia di bentuk itu. Kredensial diterima dari `Authorization: Bearer` dan, pada permukaan Anthropic, juga `x-api-key`.

Idempotency request inference tidak dijanjikan pada P0. Retry oleh klien adalah request baru dengan debit sendiri; hal ini dinyatakan di panduan integrasi.

### 5.2 Portal pelanggan (principal: sesi owner tenant)

| ID | Operasi | FR |
|---|---|---|
| API-010 | Aktivasi undangan | FR-006 |
| API-011 | Login, logout, daftar dan pencabutan sesi | FR-006 |
| API-012 | Permintaan dan penyelesaian reset password | FR-006 |
| API-013 | Ringkasan saldo dan pemakaian | FR-013 |
| API-014 | Redeem kode; ambil receipt | FR-005 |
| API-015 | Buat, daftar, ubah batas, cabut API key | FR-009 |
| API-016 | Katalog model dan tarif | FR-010 |
| API-017 | Daftar dan rincian request | FR-013 |
| API-018 | Riwayat ledger | FR-013 |
| API-019 | Ubah password; tutup akun | FR-006, FR-019 |

API-010 dan API-012 publik tanpa sesi dan dilindungi token sekali pakai serta pembatas laju. Operasi lain memerlukan sesi dan selalu ter-scope tenant.

### 5.3 Backoffice (principal: sesi admin dengan faktor kedua)

| ID | Operasi | FR | Step-up |
|---|---|---|---|
| API-030 | Login admin, verifikasi TOTP, recovery | FR-007 | – |
| API-031 | Daftar/detail tenant, cari lewat username atau email, undang, suspend, restore, cabut API key pelanggan | FR-014 | Suspend/restore/cabut |
| API-032 | Top-up langsung lewat username; adjustment saldo | FR-014 | Ya |
| API-040 | Pemakaian per pelanggan: ringkasan per periode, model dan key; daftar request (metadata) | FR-014 | – |
| API-033 | Kelola model dan price version: draft, preview, publish, retire | FR-001 | Publish/retire |
| API-034 | Terbit, daftar, cabut, ganti voucher | FR-004 | Terbit/cabut |
| API-035 | Kelola upstream (base URL, API key tulis-saja, uji koneksi), route, cost profile, eligibility | FR-012, FR-003 | Ya |
| API-036 | Ringkasan operasi, belanja, selisih | FR-003, FR-015 | – |
| API-037 | Daftar request lintas tenant (metadata), antrean unresolved, penyelesaian kasus | FR-015 | Penyelesaian |
| API-038 | Audit log (baca saja) | FR-016 | – |
| API-039 | Kill switch dan batas belanja global | FR-017 | Ya |

Semua operasi yang mengubah state menerima kunci idempotency atau version check sesuai jenisnya. Daftar memakai pagination server-side dengan urutan stabil.

### 5.4 Integrasi keluar

| Integrasi | Timeout dan retry | Failure behavior |
|---|---|---|
| Upstream model | Timeout terpisah: connect, byte pertama, idle stream, total. Retry terbatas sebelum byte pertama dengan backoff dan jitter | Circuit breaker per route; error terstruktur; biaya attempt dicatat |
| Email transaksional | Timeout pendek; retry lewat antrean dengan batas | Undangan/reset tetap tercatat; admin dapat mengirim ulang; tautan tidak ditampilkan di log |

Nilai timeout ditetapkan saat adapter pertama ditulis berdasarkan dokumentasi upstream yang dipilih.

### 5.5 API lifecycle M1 yang sudah diimplementasikan

Bentuk executable ada di ../server/src/http/app.ts dan migrasi 002. Semua mutasi memerlukan header x-router-csrf: 1; cookie sesi tetap HttpOnly/SameSite=Strict.

| Endpoint | Principal / input | Hasil dan konflik |
|---|---|---|
| GET /api/me | Owner | username, tenantStatus, version sebagai string; `servicePaused` boolean (section 5.7) |
| GET /admin/api/customers/:username | Admin + MFA | Saldo/ledger, tenantStatus, version; tidak memerlukan step-up untuk baca |
| POST /admin/api/customers/:username/suspend atau /restore | Admin + MFA + step-up; expectedVersion string positif, reason 3..500 karakter setelah trim | Status/versi baru, 200; versi usang, no-op dan CLOSED: 409; alasan/versi tidak valid: 400; satu audit event per perubahan |
| POST /admin/api/adjustments | Admin + MFA + step-up; username, amountMicro integer string bertanda nonnol, reason, idempotencyKey | Receipt 201, replay identik 200, payload berubah untuk kunci sama 409; tidak memakai floating point |
| POST /api/account/close | Owner saja; currentPassword, confirmUsername sama persis, expectedVersion | 200 + cookie dihapus; konfirmasi salah 400; password salah 401, 5 kegagalan/15 menit lalu 429; versi usang 409; sesi sudah dicabut 401 |

Suspend bukan penghapusan akun: portal saldo/riwayat tetap bisa dibaca. Guard admission mengunci baris tenant sebelum akun ledger; suspend/close menunggu admission yang lebih dahulu memperoleh lock. Settlement hold yang sudah admitted tetap diizinkan sesudah suspend/close.

Penutupan akun mempseudonimkan profil dan alamat undangan, mencabut sesi/reset dan mereservasi verifier username lama. Tombstone CLOSED memakai closed_ + UUID lengkap tanpa tanda hubung, di luar namespace username aktif 3..24 karakter. Ledger, hold dan audit historis tidak diubah; tidak ada refund otomatis. Nilai/job retensi terpisah dan belum diputuskan; lihat SECURITY.md section 5 dan README. TASK-010 sudah mengintegrasikan pemeriksaan CLOSED dan pencabutan seluruh key aktif secara atomik saat closure; hold lama tetap diselesaikan.

### 5.6 TASK-010: API key pelanggan

| Endpoint | Principal / input | Hasil |
|---|---|---|
| POST /api/keys | Owner; name, idempotencyKey; allowedModels/spendLimitMicro/expiresAt opsional | 201 berisi key tersamar dan secret sekali; retry creation key yang sama 409 key_already_created, tidak pernah menampilkan secret lagi |
| GET /api/keys | Owner; after UUID dan limit 1..100 opsional | keys tanpa verifier/secret, nextAfter; urutan UUID stabil, tenant difilter server |
| GET /api/keys/:id | Owner | Satu key tersamar; ID tenant lain sama dengan tidak ada (404) |
| POST /api/keys/:id/limits | Owner; expectedVersion dan policy pengganti lengkap | 200; stale/revoked/expired 409; cap di bawah spent+held 409 |
| POST /api/keys/:id/revoke | Owner; expectedVersion | 200 sekali, stale/replay 409; tidak ada restore |
| GET /admin/api/customers/:username/keys | Admin + MFA | Daftar tersamar saja, pagination sama |
| POST /admin/api/customers/:username/keys/:id/revoke | Admin + MFA + step-up; expectedVersion | 200; sesi dan faktor kedua diperiksa ulang dalam transaksi; admin tidak membuat/menampilkan secret |

Format secret: rtr_ + 32 byte acak base64url, disimpan sebagai SHA-256 verifier beserta prefix 12 karakter. Nilai asli tidak disimpan pada idempotency record, audit atau log. Kehilangan respons create berarti secret hilang; cabut key dari daftar dan buat yang baru, bukan mengambil ulang.

Policy awal implementasi: maksimum 10 key aktif belum kedaluwarsa per tenant, 100 model per scope. allowedModels=null berarti tanpa pembatasan tambahan oleh key; [] menolak semua model. Scope hanya ID publik dan tidak menjamin model dijual: katalog/harga/route eligible tetap diverifikasi gateway mendatang. spendLimitMicro adalah batas kumulatif sepanjang umur key, bukan limit harian/bulanan; null tanpa batas tambahan, string "0" menolak biaya baru. expiresAt memakai ISO UTC YYYY-MM-DDTHH:mm:ss.sssZ atau null; key expired tidak diaktifkan ulang. Update adalah penggantian policy lengkap, bukan PATCH: field opsional yang dihilangkan kembali null. Nilai uang selalu integer string mikro-IDR, tidak memakai float.

Primitif ledger.placeKeyHold dipanggil dengan withTx. Autentikasi awal bukan admission: status tenant dan key, scope, expiry, spent+held+hold baru dicek ulang di bawah lock tenant -> ledger account -> key. Counter key dan akun, last-used kasar (maksimum sekali per menit), serta hold dikomit atomik. ledger.settleHold mengurangi held dan menambah spent dari usage final tepat sekali walaupun key sudah dicabut/akun ditutup. Debit yang melampaui hold tetap dicatat dan boundExceeded=true sesuai section 3; cap admission bukan jaminan tagihan final bila estimator kelak melanggar bound. Pemeriksa invariant mencocokkan held/spent per key dengan hold/settlement; composite foreign key mencegah link tenant silang.

Data plane HTTP belum dibuat. TEST-009 memverifikasi autentikasi/admission/settlement lokal dan API kontrol; kompatibilitas protokol/header inference menjadi TASK-012/025/026. Tidak ada request upstream nyata atau klaim gateway siap.

### 5.7 TASK-018 dan SCR-017: kill switch dan daftar request lintas pelanggan (API-039, API-037)

Kode di ../server/src/control.ts, migrasi 014; test di ../server/test/control.test.ts.

| Endpoint | Principal / input | Hasil |
|---|---|---|
| GET /admin/api/settings/gateway | Admin + MFA | `{ paused, reason, changedAt, changedBy }`; `changedAt`/`changedBy` null bila belum pernah diubah; `changedBy` adalah username admin |
| POST /admin/api/settings/gateway | Admin + MFA + step-up + CSRF; `{ paused: true, reason }` (alasan 1..200 karakter sesudah trim) atau `{ paused: false }` | 200 dengan bentuk yang sama; body lain 400 `invalid_request`; keadaan sama (dan alasan sama) tidak menulis audit kedua; audit `setting.gateway_pause` (alasan) atau `setting.gateway_resume` (alasan sebelumnya); bot Telegram mengirim keduanya dan `/status` menyebut keadaan layanan |
| GET /admin/api/overview | Admin + MFA | Field tambahan `gateway: { paused, reason, changedAt }` |
| GET /api/me | Owner | Field `servicePaused` untuk keadaan layanan-dijeda di portal (SCR-007). Alasan jeda tidak dikirim ke pelanggan; setelan yang hilang terbaca dijeda, sama dengan gateway |
| GET /admin/api/requests | Admin + MFA; `username`, `state`, `model` (persis), `before` (kursor `nextBefore`: waktu mikrodetik UTC `~` ID request; kursor lama tanpa ID tetap diterima, kursor tak terbaca dibaca sebagai halaman pertama), `limit` 1..100 bawaan 50 | `{ requests: [{ id, username, keyName, model, protocol, stream, state, outcome, final, heldMicro, debitMicro, estimated, usage, createdAt }], nextBefore }`, terbaru dulu, metadata saja; username tidak dikenal menghasilkan daftar kosong; `state` di luar `ADMITTED, STREAMING, COMPLETED, FAILED, CANCELLED, SETTLED, SETTLED_ESTIMATED, UNRESOLVED, RESOLVED, REJECTED` atau filter berulang 400 |
| GET /admin/api/audit | Admin + MFA; `action` (awalan nama aksi, mis. `setting.`), `actor` (username persis), `targetType`, `targetId` (persis), `before` (id event) | `{ events: [{ id, actorUser, actorUsername, actorKind, action, targetType, targetId, summary, createdAt }], nextBefore }`, terbaru dulu, 50 per halaman; parameter berulang atau terlalu panjang 400. Kode di ../server/src/audit.ts (SCR-018) |

Selama dijeda, `/v1/chat/completions`, `/v1/messages` dan `/v1/responses` memeriksa key lebih dulu (key salah tetap 401, jadi orang luar tidak tahu layanan dijeda), lalu menjawab 503 `service_paused` dengan `Retry-After: 60` dalam bentuk error permukaannya, sebelum hold dibuat. `/v1/models` tidak terpengaruh. Request yang sudah admitted berjalan dan di-settle seperti biasa. Flag dibaca dari database pada setiap request; bila barisnya hilang, gateway menolak (`internal_error`), tidak meloloskan.

## 6. Provider eligibility register

Field mengikuti DISCOVERY.md section 7. Kategori sumber sudah diketahui (CR-003): upstream adalah provider lain yang API-nya dijual kembali, dihubungkan lewat base URL dan API key yang dimasukkan admin. Belum ada entri karena nama provider, format API dan ketentuannya belum diberikan (OQ-007). Untuk upstream berjenis reseller, entri wajib menambah: apakah ketentuannya mengizinkan penjualan kembali, pihak yang berada di belakangnya bila dinyatakan, kebijakan penyimpanan data, cara mengetahui saldo upstream, dan format API yang disediakan. Tidak ada provider berstatus eligible; M2 tidak dapat dimulai tanpa minimal satu entri eligible berikut cost profile dan kontrak adapter (semantic usage, cache, pembatalan, error, partial).

Keputusan founder 2026-11-14 (CR-014): Dahono Router dan DeepSeek dinyatakan disetujui dan final sebagai upstream, dengan risiko yang tercatat diterima founder. Status keduanya: eligible atas keputusan founder. Agen tidak memverifikasi izin penjualan kembali dari penyedia; kolom "yang masih dibutuhkan" di bawah tetap berlaku sebagai risiko terbuka, bukan penghalang. Sumber berbasis langganan tetap tidak dirancang.

Sumber yang disebut founder pada CR-004 (status awal pending):

| Sumber | Yang diketahui | Bukti | Yang masih dibutuhkan |
|---|---|---|---|
| DeepSeek | API resmi berautentikasi API key. Base URL format OpenAI `https://api.deepseek.com`; format Anthropic `https://api.deepseek.com/anthropic`; halaman harga mencantumkan dukungan Responses API. Pada format Anthropic, header `anthropic-version` diabaikan dan `anthropic-beta` diabaikan untuk `/messages`. Usage memuat `prompt_cache_hit_tokens` dan `prompt_cache_miss_tokens`. Harga dalam USD dengan tarif peak dan off-peak yang berbeda. Ketentuan Open Platform (berlaku 29 April 2026) menyebut integrasi ke sistem hilir untuk end user internal dan eksternal, mewajibkan perjanjian dengan end user dan pengungkapan bahwa output dihasilkan AI, serta melarang membagikan API key | E2, diambil 2026-11-13; evidence/2026-11-13-upstream/ | Pencarian kata kunci pada ketentuan Open Platform tidak menemukan klausul tentang penjualan kembali; DeepSeek Terms of Use yang menjadi induknya belum dibaca. Ini bukan kesimpulan hukum. Cost profile harus memakai tarif peak sebagai batas konservatif, atau dua profil berjadwal |
| Dahono Router (dhn.ai.id) | Gateway berautentikasi API key. Base URL `https://gateway.dahono.com/v1`, dinyatakan kompatibel OpenAI dan Anthropic; Responses API tidak disebut pada halaman yang dibaca. Harga dalam Rupiah per sejuta token dan Token Plan berbasis kuota; kuota dihitung (input + output) kali pengali model, dan token ter-cache dihitung sama dengan input. Kuota habis menghasilkan HTTP 402. Ada program reseller resmi yang mencakup paket token AI model dengan REST API untuk membuat key per klien, rotasi key dan pemakaian. Ketentuan terakhir diperbarui 8 November 2026 | E2, diambil 2026-11-13; evidence/2026-11-13-upstream/dhn-*.html | Apakah penjualan kembali lewat gateway sendiri dengan API key biasa diperbolehkan, atau harus lewat program reseller: belum disimpulkan; founder mendaftar program reseller atau meminta konfirmasi tertulis. Field usage dan cache pada respons, batas laju, dan perilaku pembatalan belum dibaca |
| "API dari Codex" | Founder: sebagian API berbayar, sebagian dari langganan | E0 | Bagian API berbayar: nama penyedia dan dokumentasinya. Bagian langganan tidak dirancang dan tidak akan ditandai eligible (PLANNING.md RSK-016) |

Tarif peak/off-peak berarti biaya modal bergantung waktu request. Margin guard (FR-003) memakai tarif tertinggi yang berlaku kecuali cost profile berjadwal diimplementasikan dan diuji.

## 7. Architecture decision records

### ADR-001: Bangun sendiri dengan adapter sempit

Status: PROPOSED.
Context: produk membutuhkan ledger atomik, snapshot harga, margin guard dan batas tenant yang menyatu dengan jalur request.
Opsi:
1. Produk sendiri, modular monolith, adapter untuk satu protokol dan satu sampai dua upstream.
2. Fork gateway existing lalu menambah billing dan tenant.
3. Gateway existing tanpa modifikasi di belakang control plane sendiri.

| Kriteria | Opsi 1 | Opsi 2 | Opsi 3 |
|---|---|---|---|
| Kontrol admission dan settlement | Penuh | Bergantung titik kait di kode fork | Terbatas pada yang diekspos gateway |
| Waktu sampai request pertama | Paling lama | Sedang | Paling cepat |
| Beban lisensi dan sinkronisasi upstream proyek | Tidak ada | Perlu telaah; New API menyatakan AGPLv3 dengan ketentuan tambahan (DISCOVERY.md section 7) | Perlu telaah lisensi dan cara distribusi |
| Permukaan serangan dan fitur tak terpakai | Minimal | Besar | Sedang |
| Cakupan protokol/provider | Sempit | Luas | Luas |

Keputusan sementara: opsi 1, karena kebenaran uang adalah risiko utama. Revisit trigger "banyak protokol sejak pilot" terpenuhi oleh CR-003 dan sudah ditinjau: tiga permukaan tanpa translasi tetap berupa relay sejenis dengan parser usage per protokol, sehingga opsi 1 dipertahankan dengan syarat spike TASK-006 mencakup minimal dua permukaan. Bila upstream hanya menyediakan satu format sementara tool menuntut format lain, translasi menjadi kebutuhan dan opsi 2 atau 3 harus dinilai ulang lewat audit source. Belum ada audit source proyek pembanding; penilaian opsi 2 dan 3 berdasar README, bukan kode.
Konsekuensi: implementasi streaming dan kompatibilitas tool menjadi tanggungan sendiri dan harus dibuktikan lewat fixture.
Revisit trigger: spike TASK-006 menunjukkan relay stream atau kompatibilitas tool memakan usaha jauh di atas perkiraan, atau OQ-003 menuntut banyak protokol sejak pilot.

### ADR-002: Permukaan protokol P0

Status: PROPOSED (menggantikan asumsi satu protokol pada v0.1.0).
Context: founder menyebut tool target Hermes, OpenCode, ZCode, Codex dan Claude Code. Kebutuhan protokol tiap tool, diperiksa 2026-11-13:

| Tool | Protokol yang dibutuhkan | Bukti |
|---|---|---|
| Claude Code | Anthropic Messages: `/v1/messages`, dan `/v1/messages/count_tokens` opsional, lewat `ANTHROPIC_BASE_URL`. Header `anthropic-version` dan `anthropic-beta` diteruskan tanpa disaring; event SSE `ping` tidak boleh dibuang atau ditahan; body error upstream diteruskan utuh | E2, dokumentasi resmi; evidence/2026-11-13-tools/claude-code-llm-gateway-protocol.md dan -connect.md |
| Codex | Responses API. Referensi konfigurasi menyatakan `responses` satu-satunya nilai `wire_api` yang didukung | E2, dokumentasi resmi; evidence/2026-11-13-tools/codex-config-reference.html |
| OpenCode | Provider kustom dengan `baseURL`; paket runtime openai-compatible, openai chat, openai responses; provider Anthropic dapat diarahkan ke base URL lain | E2, dokumentasi resmi; evidence/2026-11-13-tools/opencode-providers.html |
| Hermes | Endpoint kustom OpenAI-compatible dengan base URL | E0: hanya dari panduan pihak ketiga hasil pencarian; dokumentasi resmi belum dibaca |
| ZCode | Format Chat Completions atau Anthropic dengan base URL kustom | E0: hanya dari panduan pihak ketiga hasil pencarian; dokumentasi resmi belum ditemukan |

Opsi:
1. Tiga permukaan (Chat Completions, Anthropic Messages, Responses) dengan pass-through sejenis: request hanya diteruskan ke endpoint upstream berprotokol sama.
2. Satu permukaan dan translasi ke protokol lain di gateway.
3. Satu permukaan saja; tool lain tidak didukung pada pilot.

Keputusan sementara: opsi 1, dirilis bertahap. Tahap A Chat Completions (OpenCode, Hermes, ZCode), tahap B Anthropic Messages (Claude Code), tahap C Responses (Codex). Urutan dapat ditukar sesuai prioritas founder dan format yang disediakan upstream.
Alasan: translasi antar-protokol adalah sumber utama ketidakcocokan tool-call, cache dan usage; pass-through menjaga semantic dan membuat usage upstream dapat dipakai langsung untuk settlement. Opsi 3 tidak memenuhi daftar tool founder.
Konsekuensi: tiap permukaan memiliki parser usage, pemetaan error, fixture dan estimasi bound sendiri. Sebuah model hanya tersedia pada permukaan yang disediakan upstream-nya; Claude Code hanya dapat memakai model yang upstream-nya menyediakan format Anthropic, Codex hanya yang menyediakan Responses. Kontrak ledger tidak berubah.
Batas bukti: belum ada tool yang diuji terhadap gateway. Versi tool berubah cepat; kebutuhan protokol diperiksa ulang saat fixture ditulis.
Revisit trigger: jawaban OQ-007 menunjukkan upstream tidak menyediakan format yang dibutuhkan suatu tool; atau dokumentasi resmi Hermes/ZCode berbeda dari catatan di atas.

### ADR-003: PostgreSQL sebagai penyimpanan durable tunggal

Status: PROPOSED.
Opsi: PostgreSQL; SQLite; kombinasi database dan cache untuk saldo.
Alasan: transaksi dengan penguncian baris dan constraint unik memenuhi kebutuhan admission, redeem dan idempotency dalam satu tempat. SQLite menyulitkan proses gateway dan worker yang menulis bersamaan. Saldo di cache menambah mode kegagalan uang.
Revisit trigger: pengukuran menunjukkan admission menjadi bottleneck pada kapasitas pilot.

### ADR-004: Stack implementasi

Status: CONFIRMED founder (CR-006) untuk TypeScript pada Node.js, PostgreSQL dan React. Pustaka spesifik masih PROPOSED (section 9). Founder menyatakan implementasi dikerjakan agen coding (CR-004).
Opsi:
1. TypeScript pada Node.js untuk gateway, control path dan worker; React untuk portal dan backoffice; PostgreSQL.
2. Go untuk gateway dan worker; React untuk UI; PostgreSQL.
3. Python untuk seluruh backend; React untuk UI; PostgreSQL.

Keputusan sementara: opsi 1.
Alasan: satu bahasa untuk backend dan UI mengurangi beban konteks agen dan duplikasi tipe kontrak; stream HTTP berdurasi panjang dan pembatalan didukung runtime; integer besar bawaan memenuhi kebutuhan unit mikro tanpa floating point; UI React membuka strategi DIRECT_ADOPTION untuk item UIArc Free setelah vetting. Opsi 2 lebih hemat sumber daya per koneksi tetapi memisahkan bahasa backend dan UI. Opsi 3 paling lemah untuk banyak stream bersamaan pada satu proses.
Belum ditetapkan dan tidak dikarang di sini: versi runtime, framework HTTP, pustaka akses database, pustaka autentikasi, framework UI di atas React, dan alat test. Semuanya dipilih dan diperiksa lewat TASK-020 lalu dicatat sebelum M1.
Konsekuensi: strategi UIArc ditinjau ulang per item dari PATTERN_ADAPTATION ke DIRECT_ADOPTION setelah source registry dan lisensi dependency diperiksa.
Hasil spike TASK-006 (2026-11-13): relay stream dengan backpressure, pembatalan sampai ke upstream, dan transaksi PostgreSQL berjalan pada Node v24 tanpa framework; tidak ada alasan meninggalkan opsi ini. Bukti: ../spike/README.md.
Revisit trigger: pengukuran pada kode produksi tidak dapat memenuhi NFR-002, atau founder menyatakan preferensi lain.

### ADR-005: Unit saldo

Status: currency CONFIRMED founder (CR-003): Rupiah pada MVP. Unit internal PROPOSED.
Keputusan: satu currency per ledger_account, IDR. Unit internal satu per sejuta Rupiah; pembulatan sekali per settlement (BILLING_REDEEM.md section 2.2). Biaya upstream yang berdenominasi lain dikonversi memakai kurs berversi pada cost profile; kurs dimasukkan admin pada MVP dan memiliki batas usia.
USD: DEFERRED sampai sistem stabil. Karena akun ledger sudah membawa currency dan scale, penambahan USD berupa akun ber-currency baru, price version per currency dan voucher per currency. Saldo tidak dikonversi otomatis antar-currency; migrasi atau konversi saldo memerlukan change request tersendiri.
Revisit trigger: founder mengaktifkan USD, atau upstream menagih dalam currency selain yang dapat dikonversi dengan kurs manual.

## 8. Operasi minimum

Kebutuhan yang mengikat sebelum pilot; cara pelaksanaan ditulis di runbook setelah ADR-004 dan pemilihan host.

- Build/start/stop yang dapat diulang; konfigurasi lewat environment dengan nama secret terdokumentasi, tanpa nilai di repo.
- Health (proses hidup) dipisah dari readiness (database dan minimal satu route sehat).
- Deploy tidak memutus stream aktif tanpa batas waktu tunggu.
- Backup berkelanjutan sesuai NFR-005 dan uji restore sebelum uang nyata masuk.
- Alert: kegagalan transaksi ledger, pelanggaran invariant, lonjakan belanja, antrean unresolved, route terbuka circuit-nya, penerbitan voucher.
- Reverse proxy dan edge diuji dengan stream panjang dan pembatalan sebelum dipakai.

## 9. Kandidat pustaka untuk ADR-004

Dipilih dan dipasang untuk server pada M1 (2026-11-13): fastify 5.12.8, @fastify/cookie 11.1.5, pg 8.23.1; dev: typescript 7.0.2, @types/node, @types/pg. `npm audit` melaporkan 0 kerentanan pada tanggal itu. Tidak dipakai: pustaka query (SQL ditulis langsung dengan pembungkus transaksi), pustaka validasi, argon2 dan otplib, karena Node 24 menyediakan Argon2id di `node:crypto` dan TOTP diimplementasikan di atas HMAC bawaan dengan vektor uji RFC 6238. Tabel di bawah tetap sebagai catatan kandidat; pustaka UI belum dipilih.

PROPOSED, bagian dari TASK-020 yang belum selesai. Versi, lisensi, jumlah dependency langsung dan install script dibaca dari metadata `latest` registry npm pada 2026-11-13 (evidence/2026-11-13-stack/). Yang belum diperiksa: advisory keamanan, dependency transitif, kondisi maintenance, dan kematangan rilis mayor yang baru. Tidak ada yang dipasang.

| Kebutuhan | Kandidat | Versi / lisensi terbaca | Catatan |
|---|---|---|---|
| Runtime | Node.js jalur LTS | v26 dan v24 tercatat LTS pada indeks rilis nodejs.org | Pilih satu jalur LTS; beberapa kandidat di bawah mensyaratkan Node 22 ke atas |
| Bahasa | typescript | 7.0.2 / Apache-2.0 | Rilis mayor baru; kompatibilitas alat lain diperiksa pada spike |
| HTTP server | fastify | 5.12.8 / MIT, 15 dependency langsung | Alternatif: hono 4.13.18 / MIT tanpa dependency langsung, memerlukan adaptor server Node yang belum diperiksa. Dipilih lewat spike relay stream |
| Klien ke upstream | fetch bawaan Node | – | Tanpa dependency; perilaku pembatalan dan stream diuji pada spike |
| Driver PostgreSQL | pg | 8.23.1 / MIT | Alternatif: postgres 4.1.1 / Unlicense |
| Query dan transaksi | kysely | 0.29.9 / MIT, tanpa dependency langsung; Node 22 ke atas | Transaksi eksplisit dan SQL bertipe. Alternatif: drizzle-orm 0.45.4 / Apache-2.0 |
| Validasi skema | zod | 4.6.7 / MIT | Satu definisi untuk validasi server dan tipe klien |
| Hash password | argon2 | 0.45.2 / MIT; memiliki install script (build native) | Install script perlu ditinjau. Alternatif tanpa dependency: fungsi kripto bawaan Node; ketersediaan Argon2 bawaan pada jalur LTS terpilih perlu diverifikasi |
| TOTP | otplib | 13.6.0 / MIT, 6 dependency langsung | Alternatif: implementasi kecil di atas HMAC bawaan dengan vektor uji standar |
| Test | vitest | 5.1.0 / MIT | Mensyaratkan Node 22.12, 24 atau 26 ke atas |
| UI | react | 19.3.1 / MIT | – |
| Build UI | vite | 8.3.8 / MIT | – |
| Routing UI | react-router | 8.5.1 / MIT; Node 22.22 ke atas | – |
| Data server di UI | @tanstack/react-query | 5.107.1 / MIT | – |
| Hanya bila DIRECT_ADOPTION UIArc | motion 14.13.0 / MIT; lucide-react 1.72.0 / ISC | Paket Radix per komponen belum dibaca | Ditambahkan per komponen yang diadopsi, bukan sekaligus |

Framework CSS tidak dipilih: token berupa variabel CSS (DESIGN.md). Bila UIArc diadopsi langsung dan sumbernya mensyaratkan alat tertentu, itu diputuskan saat registry dibaca.

## 10. Smart routing dan fallback

Kebutuhan CONFIRMED founder (CR-004, CR-006); rincian PROPOSED. Angka adalah nilai awal konfigurasi, bukan hasil pengukuran.

Pemilihan route untuk satu request:
1. Ambil route milik model publik yang dipanggil.
2. Saring: protokol sama dengan permukaan yang dipanggil; upstream eligible; cost profile berlaku dan lolos floor terhadap snapshot harga; circuit tertutup atau setengah terbuka; konkurensi route di bawah batasnya.
3. Urutkan menurut prioritas yang ditetapkan admin; bila sama, biaya modal lebih rendah lebih dulu.
4. Bila tidak ada kandidat, tolak dengan `model_not_available` atau `upstream_unavailable` sebelum hold dibuat.

Fallback:
- Pemicu: gagal tersambung, tidak ada byte pertama sampai batas waktu, atau status upstream 401, 402, 429, 500, 503. Error validasi request (400, 422) tidak memicu fallback dan diteruskan ke pelanggan.
- Hanya sebelum byte pertama dikirim ke klien. Setelah stream dimulai, kegagalan diakhiri sesuai protokol dan di-settle menurut section 2; tidak ada sambungan dari route lain.
- Paling banyak 3 attempt per request dan satu tenggat total; nilai dapat diatur.
- Hold dan snapshot harga dibuat sekali. Pelanggan didebit sekali dengan harga model yang sama, route mana pun yang berhasil. Biaya attempt yang gagal dicatat sebagai biaya usaha.
- Floor margin dihitung terhadap kandidat termahal yang mungkin dipakai, agar fallback tidak menjual di bawah modal.

Kesehatan route:
- Circuit breaker pasif per route dari hasil request nyata: terbuka setelah serangkaian kegagalan dalam window, setengah terbuka setelah jeda dengan sedikit request percobaan, tertutup kembali setelah berhasil.
- Status 401 dan 402 dari upstream membuka circuit sampai admin menindak, karena tidak pulih sendiri.
- Tidak ada probe berbayar otomatis. Uji koneksi manual hanya memakai endpoint tanpa biaya bila ada.

Khusus stream:
- Batas waktu byte pertama terpisah dari batas diam (idle) dan batas total. Event keep-alive upstream diteruskan dan menghitung sebagai aktivitas.
- Pemutusan oleh klien membatalkan request ke upstream.

Kesetaraan model lintas upstream: dua route untuk satu model publik (misalnya model yang sama lewat DeepSeek langsung dan lewat Dahono) dinyatakan setara oleh admin saat memetakan. Perbedaan perilaku yang diketahui dicatat di ADAPTERS.md; perbedaan akuntansi cache antar-upstream memengaruhi biaya modal, bukan debit pelanggan.

Di luar P0: mengganti ke model lain saat model yang diminta gagal; routing berdasarkan isi prompt; pembobotan berdasarkan latensi terukur. Model alias yang secara terbuka dinyatakan dapat dilayani beberapa model (seperti alias otomatis) adalah kandidat P1 dan hanya dengan persetujuan eksplisit pelanggan lewat pemilihan alias itu.

<!-- END ROUTER-ARCHITECTURE v0.7.0 -->
