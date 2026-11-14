# Tasks, Test Specification dan Traceability: Router AI Komersial

Version: 0.16.0
Status: Draft; backend TASK-010 selesai untuk API key/admission lokal, UI/gateway belum
Owner keputusan: founder
Updated: 2026-11-14, Asia/Jakarta
Dependencies: PLANNING.md; BILLING_REDEEM.md; ARCHITECTURE.md; SECURITY.md; UX.md; UI_REFERENCES.md
Evidence: E3 untuk API fondasi + TASK-010 dan TASK-001 backend yang dijalankan pada PostgreSQL lokal; 78 test lulus. UI/gateway inference belum ada. Spesifikasi fitur lain tetap rencana, bukan hasil test.

Status PLANNED berarti belum dikerjakan; DRAFT DITULIS dan SEBAGIAN berarti dokumen ada tetapi syarat selesainya belum terpenuhi. Kode produksi M1 ada di ../server/ (69 test lulus); spike TASK-006 di ../spike/ bukan kode produksi.

Sumber otoritatif untuk status eksekusi dan spesifikasi test. TASK-001 sampai TASK-005 dan TEST-001 sampai TEST-005 didefinisikan di BILLING_REDEEM.md section 6; statusnya dilacak di sini. Batas modul dan perintah verifikasi M1 ada di ../server/README.md; stack TypeScript/Node.js, PostgreSQL, React disetujui (ADR-004).

## 1. Urutan dan dependency

| Tahap | Task | Syarat |
|---|---|---|
| M0 | TASK-006, TASK-020, TASK-022, TASK-024, TASK-027, TASK-028 | Jawaban OQ-007 untuk sumber terkait |
| M1 | TASK-009, TASK-007, TASK-008, TASK-017, TASK-002 (bagian ledger) | ADR-001/003/004/005 ditetapkan |
| M2 | TASK-013, TASK-001, TASK-003, TASK-012, TASK-002 (bagian settlement), TASK-010, TASK-011, lalu TASK-025 dan TASK-026 | Minimal satu upstream eligible; kontrak adapter dari TASK-024 untuk tiap permukaan |
| M3 | TASK-023, TASK-004, TASK-005, TASK-014, TASK-015, TASK-016, TASK-019 | TASK-022 selesai |
| M4 | TASK-018, TASK-021 dan eksekusi penuh seluruh TEST | Fitur M1 sampai M3 lengkap |

## 2. Daftar task

Definition of Done umum: AC terkait terpenuhi; test pada spesifikasi dijalankan dan hasilnya disimpan; operasi baru memiliki uji negatif otorisasi; tidak ada secret pada log; kontrak yang berubah disinkronkan; untuk UI ditambah pemeriksaan keyboard, state yang berlaku dan kesesuaian UAR.

| Task | Outcome | FR / AC | Rujukan kontrak | Definition of Ready | Status |
|---|---|---|---|---|---|
| TASK-001 | Katalog harga dan multiplier berversi | FR-001 / AC-001 | BILLING_REDEEM.md section 3; API-033; SCR-003 | Lihat BILLING_REDEEM.md section 6 | BACKEND SELESAI 2026-11-14: katalog model, draft, preview, publish, retire dan snapshot admission di ../server/ (TEST-001 lulus untuk API). Pemeriksaan margin saat publish menunggu TASK-003; UI SCR-003 belum |
| TASK-002 | Normalizer, ledger, hold dan settlement | FR-002 / AC-002 | BILLING_REDEEM.md section 2; ARCHITECTURE.md section 2 sampai 4 | Sda; ditambah OQ-006 | SEBAGIAN: ledger, hold dan settlement di ../server/ dengan test; normalizer dan gateway belum |
| TASK-003 | Margin guard, batas belanja, pelaporan selisih | FR-003 / AC-003 | BILLING_REDEEM.md section 3; API-035, API-036 | Sda | PLANNED |
| TASK-004 | Terbit, cabut dan ganti voucher | FR-004 / AC-004 | BILLING_REDEEM.md section 4; API-034; SCR-002 | Sda | BACKEND SELESAI 2026-11-14: terbit, daftar, cabut kode bernilai token; paket token; di ../server/ (TEST-004 lulus untuk API). Batas nominal terbit per periode dan alert belum; UI SCR-002 belum |
| TASK-005 | Redeem dan grant ledger | FR-005 / AC-005 | BILLING_REDEEM.md section 4; API-014; SCR-001 | Sda | BACKEND SELESAI 2026-11-14: redeem atomik dengan receipt, replay pemilik, pembatas laju (TEST-005 lulus untuk API). UI SCR-001 belum |
| TASK-006 | Spike: relay stream dengan pembatalan, admission dan settlement terhadap upstream tiruan pada minimal dua permukaan protokol; laporan temuan dan angka overhead | NFR-002; ADR-001, ADR-004 | ARCHITECTURE.md section 2, 3, 7 | Kandidat stack disepakati untuk dicoba; kode spike dibuang atau ditandai bukan produksi | SELESAI 2026-11-13: ../spike/, 14 dari 14 test lulus tiga kali; temuan di ../spike/README.md. Tidak mencakup non-stream, Responses, upstream nyata, banyak tenant |
| TASK-007 | Undangan, aktivasi dengan username, login, reset, sesi pelanggan | FR-006 / AC-006 | API-010 sampai API-012, API-019; SCR-004, 005, 006, 013; ABU-001, ABU-002 | ADR-004; provider email dipilih atau kanal manual disepakati (ASM-006) | API SELESAI di ../server/ (TEST-006 lulus untuk API); UI dan pengiriman email nyata belum |
| TASK-008 | Login admin, TOTP, recovery code, step-up | FR-007 / AC-007 | API-030; UAR-035; ABU-006 | ADR-004; ambang umur sesi untuk step-up ditetapkan | API SELESAI di ../server/ (TEST-007 lulus) |
| TASK-009 | Skema dasar dan penegakan tenant pada lapisan data | FR-008 / AC-008 | ARCHITECTURE.md section 4; SECURITY.md section 2 | ADR-003, ADR-004 | SELESAI untuk skema M1 dan operasi yang ada (TEST-008 lulus untuk cakupan itu); tabel M2 menyusul lewat migrasi baru |
| TASK-010 | API key: buat, verifier, batas, cabut | FR-009 / AC-009 | API-015; SCR-008; CTL-006; ABU-005 | TASK-009; format rtr_ + 32 byte acak base64url, verifier SHA-256 dipilih | BACKEND API/ADMISSION DITULIS, DIJALANKAN DAN LULUS 2026-11-14: 69/69 suite, typecheck dan readiness 200; tanpa deploy. UI SCR-008 dan gateway end-to-end belum. |
| TASK-011 | Katalog model untuk portal dan endpoint daftar model | FR-010 / AC-010 | API-002, API-016; SCR-009 | TASK-001, TASK-013 | BACKEND SELESAI 2026-11-14: `GET /api/models` (katalog pelanggan) dan `GET /v1/models`; hanya model berharga terbit dengan route pada upstream eligible. UI SCR-009 ditugaskan ke Hermes |
| TASK-012 | Inti gateway dan permukaan tahap A (Chat Completions): validasi, admission, relay, pembatalan, error | FR-011 / AC-011 | API-001, API-002; ARCHITECTURE.md section 2, 3, 5.1; ABU-004 | Upstream menyediakan format ini (OQ-007); kontrak adapter dari TASK-024; batas ukuran/durasi/konkurensi ditetapkan | INTI SELESAI terhadap upstream tiruan 2026-11-14: Chat Completions dan Anthropic Messages, stream dan non-stream, admission, fallback, settlement, daftar model, riwayat request; di ../server/src/gateway.ts (13 test). Belum: upstream nyata, kesehatan route lintas proses, batas konkurensi per route, worker pemulihan hold, batas laju per key |
| TASK-013 | Registry upstream dengan input base URL dan API key, validasi CTL-017, uji koneksi, route per protokol, cost profile dengan kurs, retry terbatas, circuit breaker | FR-012 / AC-012 | API-035; ARCHITECTURE.md section 5.4, 6; SCR-016 | Minimal satu entri eligibility (OQ-002); penyimpanan secret dipilih | REGISTRY SELESAI 2026-11-14: upstream (base URL per protokol, API key tulis-saja, eligibility), validasi CTL-017, route per model dan protokol, pemilihan kandidat; di ../server/. Cost profile, uji koneksi, retry dan circuit breaker belum (ikut TASK-003 dan TASK-012) |
| TASK-014 | Tampilan saldo, pemakaian, rincian request, riwayat ledger | FR-013 / AC-013 | API-013, 017, 018; SCR-007, 010, 011 | TASK-002, TASK-022 | PLANNED |
| TASK-015 | Backoffice pelanggan: cari lewat username, pemakaian per pelanggan, tambah saldo langsung, undang, suspend, restore, adjustment, cabut key | FR-014 / AC-014 | API-031, API-032, API-040; SCR-015; FLOW-008; ABU-008 | TASK-007, TASK-008, TASK-022 | BACKEND SELESAI 2026-11-14: daftar dan detail pelanggan, undang (dengan tautan manual bila email gagal), suspend/restore, tambah saldo lewat username, adjustment, cabut key, pemakaian per pelanggan (API-040). UI sebagian oleh Hermes |
| TASK-016 | Antrean unresolved, penyelesaian kasus, laporan kewajiban voucher dan selisih | FR-015 / AC-015 | API-036, API-037; SCR-014, SCR-017 | TASK-002; OQ-006 diputuskan | PLANNED |
| TASK-017 | Audit event append-only dan layar audit | FR-016 / AC-016 | API-038; SCR-018; CTL-013 | TASK-009 | SEBAGIAN: pencatatan dan API baca audit; layar belum |
| TASK-018 | Health/readiness, kill switch, batas global, alert, backup dan uji restore, runbook | FR-017 / AC-017 | API-039; ARCHITECTURE.md section 8; SCR-014 | Host dipilih; kanal alert dipilih | PLANNED |
| TASK-019 | Panduan integrasi dan referensi error | FR-018 / AC-018 | SCR-012; ARCHITECTURE.md section 5.1 | Tool target per ADR-002; permukaan terkait (TASK-012, 025, 026) lolos fixture untuk tool itu | PLANNED |
| TASK-020 | Pemilihan dan vetting pustaka untuk stack ADR-004 serta sumber registry yang akan dipakai, termasuk lisensi dependency UIArc bila DIRECT_ADOPTION | CTL-016; CHK-21 | SECURITY.md section 3; UI_REFERENCES.md section 1 | ADR-004 | SEBAGIAN: pustaka server dipilih dan dipasang (fastify 5.12.8, @fastify/cookie 11.1.5, pg 8.23.1; npm audit 0 kerentanan pada 2026-11-13); pustaka UI dan sumber UIArc belum |
| TASK-021 | Penegakan metadata-only, job retensi, penutupan akun | FR-019 / AC-019 | SECURITY.md section 5 | Nilai retensi diputuskan founder untuk job retensi; penutupan akun M1 diizinkan pada handoff | SEBAGIAN: API penutupan akun, pseudonimisasi dan pencabutan akses lulus; durasi/job retensi, kebijakan bukti audit dan pemeriksaan body gateway belum |
| TASK-022 | DESIGN.md (token, tipografi, warna semantic dari arah Navy/Blue/Gold) dan DSD.md (spesifikasi komponen dengan UAR), termasuk tiga tipe komponen pending | NFR-006; CHK-25, 26, 33, 35 | UX.md; UI_REFERENCES.md | Konfirmasi arah brand dan bahasa antarmuka; pemetaan token setelah ADR-004 atau ditulis netral-stack | DRAFT DITULIS: DESIGN.md dan DSD.md v0.1.0; menunggu konfirmasi brand dan pemetaan token UIArc |
| TASK-023 | Shell aplikasi dan komponen bersama (navigasi UAR-038, dialog step-up, tabel, form) | FR-006 sampai FR-016 pada sisi UI | UI_REFERENCES.md section 3, 4 | TASK-022 | SEBAGIAN oleh Hermes 2026-11-14: SPA portal dan backoffice di ../web/ untuk rute yang tersedia; lihat handoff/hermes-log.md. Layar pemakaian, model/harga pelanggan, upstream dan route belum |
| TASK-024 | Entri provider eligibility pertama (upstream reseller) dan kontrak adapter per protokol: semantic usage dan cache, pembatalan, error, partial, timeout, header yang diteruskan | FR-012, FR-002 | ARCHITECTURE.md section 6, ADR-002; BILLING_REDEEM.md section 2.1 | OQ-007 dijawab; dokumentasi dan ketentuan upstream dibaca | SEBAGIAN: kontrak DeepSeek di ADAPTERS.md dari dokumentasi; belum ada pengamatan runtime; sumber lain belum teridentifikasi |
| TASK-025 | Permukaan tahap B (Anthropic Messages) termasuk hitung token opsional dan penerusan header | FR-011 / AC-011 | API-003, API-004; ADR-002 | TASK-012; upstream menyediakan format ini | Tercakup di TASK-012 (permukaan /v1/messages; hitung token belum) |
| TASK-026 | Permukaan tahap C (Responses) mode stateless | FR-011 / AC-011 | API-005; ADR-002 | TASK-012; upstream menyediakan format ini; perilaku penyimpanan respons di upstream dinilai | SELESAI untuk gateway 2026-11-14: POST /v1/responses stateless, stream dan non-stream; diuji pada upstream tiruan dan satu upstream nyata. Belum diuji dengan Codex sendiri |
| TASK-027 | AGENTS.md dan context pack untuk agen coding: urutan baca, sumber otoritatif, invariant uang dan tenant, aturan UIArc, perintah verifikasi yang sudah diperiksa, Definition of Done, larangan deploy/biaya tanpa otorisasi | Handoff; CHK-38 | Seluruh dokumen; kontrak section 12.7 | ADR-004 divalidasi; TASK-020 dan TASK-022 selesai | DRAFT DITULIS: ../AGENTS.md v0.3.0 dengan perintah terverifikasi; vetting UI dan kesiapan rilis tetap terpisah |
| TASK-028 | Aset brand: daftar aset dengan hak pakai, maskot orisinal untuk enam adegan minimum, pemilihan font display beserta lisensinya, pengukuran nilai coral dan cream dari berkas sumber | CHK-33; ASM-009 | DESIGN.md section 11; DSD.md CMP-036, CMP-037 | OQ-008 dijawab | PLANNED |

## 3. Test specification

Cakupan M1 yang sudah dijalankan: 69 test di ../server/test/; lihat ../server/README.md dan test-result.txt. Tabel di bawah tetap spesifikasi minimum seluruh produk, bukan klaim semuanya lulus. Lingkungan: database uji terisolasi; data sintetis.

| Test | Jenis | Kasus minimum | Hasil yang diharapkan |
|---|---|---|---|
| TEST-001 sampai TEST-005 | Lihat BILLING_REDEEM.md section 6 | | |
| TEST-006 | Integration, abuse | Aktivasi tepat sekali; undangan kedaluwarsa/terpakai; respons reset seragam untuk email terdaftar dan tidak; pembatasan login tanpa lockout global; token tidak muncul di log; sesi dicabut tidak dapat dipakai | Sesuai AC-006 |
| TEST-007 | Integration | Operasi admin tanpa TOTP ditolak; step-up pada sesi tua; pembatasan kode salah; recovery code sekali pakai; alur publik tidak dapat membuat admin | Sesuai AC-007 |
| TEST-008 | Integration, negatif otorisasi | Untuk setiap operasi API-013 sampai API-019: akses resource tenant lain dengan ID benar | Respons identik dengan tidak-ada; tanpa data tenant lain |
| TEST-009 | Integration, konkurensi | Secret tidak dapat diambil ulang; revoke menolak request baru; request berjalan saat revoke di-settle sekali; request paralel tidak melampaui batas belanja key | Sesuai AC-009 |
| TEST-010 | Integration | Model tanpa harga published atau tanpa route eligible tidak tampil dan ditolak; tarif tampil sama dengan snapshot request baru; biaya modal tidak ada di respons pelanggan | Sesuai AC-010 |
| TEST-011 | Contract, end-to-end | Dijalankan per permukaan (API-001, API-003, API-005) dan per tool target pada versi yang dicatat. Fixture protokol: non-stream, stream, keep-alive, tool-call, usage termasuk cache, finish reason, Unicode, pembatalan; penerusan header Anthropic; model tanpa route berprotokol sama ditolak; setiap kode error produk; batas body/output/konkurensi; putus koneksi klien | Respons sesuai protokol; state request tercatat; tanpa kebocoran detail upstream |
| TEST-012 | Integration | Route pending/blocked tidak dipakai; semua route gagal sebelum byte pertama menghasilkan satu error tanpa debit; kegagalan setelah stream mulai tidak di-retry; circuit breaker terbuka dan pulih; fallback: gagal sebelum byte pertama berpindah ke route berikutnya untuk model yang sama dengan satu debit dan satu snapshot harga, batas attempt dipatuhi, 400 dan 422 tidak memicu fallback, status 401 dan 402 membuka circuit sampai ditindak, kandidat di bawah floor dilewati; base URL bukan HTTPS, beralamat internal, atau me-redirect ditolak; API key upstream tidak muncul di respons, log, audit, atau hasil uji koneksi | Sesuai AC-012 |
| TEST-013 | Integration | Rincian request cocok dengan ledger; jumlah entri sama dengan saldo; request unresolved tampil belum final; filter dan pagination server konsisten | Sesuai AC-013 |
| TEST-014 | Integration | Tenant ditangguhkan menolak request baru; adjustment membuat entri baru beserta audit; entri lama tidak berubah; top-up langsung: replay kunci sama menambah sekali, username tidak ditemukan tanpa entri, tanpa step-up ditolak; angka pemakaian backoffice sama dengan portal pelanggan; admin mencabut key pelanggan | Sesuai AC-014 |
| TEST-020 | Integration | Usage dilaporkan nol input dan nol output: debit nol dan hold dilepas; gagal sebelum byte konten: debit nol; konten diteruskan lalu klien memutus sebelum usage: tidak diperlakukan nol, masuk UNRESOLVED dan settlement estimasi; routing memilih upstream sesuai model yang dipanggil dan protokol permukaan; ambang ABU-008 memicu pembatasan | Sesuai aturan usage nol di BILLING_REDEEM.md FR-002 dan ARCHITECTURE.md section 2 |
| TEST-015 | Integration | Penyelesaian kasus menghasilkan satu settlement; replay tidak menambah entri; laporan menandai biaya unknown | Sesuai AC-015 |
| TEST-016 | Integration | Setiap aksi pada daftar FR-016 menghasilkan tepat satu event; tidak ada operasi ubah/hapus; pemindaian secret pada isi audit | Sesuai AC-016 |
| TEST-017 | Operasional | Kill switch menolak request baru dan membiarkan yang berjalan selesai; kegagalan database menolak request berbiaya; restore lalu invariant check | Sesuai AC-017; RPO/RTO terukur dibanding NFR-005 |
| TEST-018 | Manual dengan bukti | Setiap contoh konfigurasi dijalankan pada tool dan versi yang disebut | Request berhasil dan tercatat |
| TEST-019 | Integration | Penanda unik di body pada request sukses dan gagal; periksa log, database, trace | Penanda tidak ditemukan |

Journey end-to-end yang wajib sebelum penilaian Gate D pilot: FLOW-001, FLOW-002, FLOW-003 dan FLOW-005 pada lingkungan mirip produksi, ditambah walkthrough keyboard dan screen reader pada SCR-001, SCR-002, SCR-003 dan SCR-008.

## 4. Traceability P0

| FR | AC | Kontrak / alur | Task | Test |
|---|---|---|---|---|
| FR-001 | AC-001 | BILLING_REDEEM.md section 3; API-033; SCR-003; FLOW-003 | TASK-001 | TEST-001 |
| FR-002 | AC-002 | BILLING_REDEEM.md section 2; ARCHITECTURE.md section 2, 3 | TASK-002 | TEST-002 |
| FR-003 | AC-003 | BILLING_REDEEM.md section 3; API-035, 036; SCR-003, 014 | TASK-003 | TEST-003 |
| FR-004 | AC-004 | BILLING_REDEEM.md section 4; API-034; SCR-002; FLOW-002 | TASK-004 | TEST-004 |
| FR-005 | AC-005 | BILLING_REDEEM.md section 4; API-014; SCR-001; FLOW-001 | TASK-005 | TEST-005 |
| FR-006 | AC-006 | API-010, 011, 012, 019; SCR-004, 005, 006, 013; FLOW-001 | TASK-007 | TEST-006 |
| FR-007 | AC-007 | API-030; SECURITY.md section 2 | TASK-008 | TEST-007 |
| FR-008 | AC-008 | ARCHITECTURE.md section 4; SECURITY.md section 2 | TASK-009 | TEST-008 |
| FR-009 | AC-009 | API-015; SCR-008; FLOW-007 | TASK-010 | TEST-009 |
| FR-010 | AC-010 | API-002, 016; SCR-009 | TASK-011 | TEST-010 |
| FR-011 | AC-011 | API-001, 003, 004, 005; ARCHITECTURE.md section 2, 3, 5.1, ADR-002 | TASK-012, TASK-025, TASK-026 | TEST-011 |
| FR-012 | AC-012 | API-035; ARCHITECTURE.md section 5.4, 6; SCR-016 | TASK-013, TASK-024 | TEST-012 |
| FR-013 | AC-013 | API-013, 017, 018; SCR-007, 010, 011; FLOW-004 | TASK-014 | TEST-013 |
| FR-014 | AC-014 | API-031, 032; SCR-015 | TASK-015 | TEST-014 |
| FR-015 | AC-015 | API-036, 037; SCR-014, 017; FLOW-006 | TASK-016 | TEST-015 |
| FR-016 | AC-016 | API-038; SCR-018 | TASK-017 | TEST-016 |
| FR-017 | AC-017 | API-039; ARCHITECTURE.md section 8; SCR-014; FLOW-005 | TASK-018 | TEST-017 |
| FR-018 | AC-018 | SCR-012 | TASK-019 | TEST-018 |
| FR-019 | AC-019 | SECURITY.md section 5 | TASK-021 | TEST-019 |

Cakupan: 19 dari 19 FR P0 memiliki AC, task dan test specification. Cakupan ini menyatakan keterhubungan dokumen, bukan kesiapan rilis. Fondasi lokal diizinkan founder (CR-008, CR-009); fitur upstream nyata dan UI tetap mengikuti syarat siap masing-masing. TASK-010 dan TASK-001 backend selesai; berikutnya TASK-013 registry upstream sesuai ../HANDOFF.md. Gateway dan UI tetap belum dinyatakan selesai.

<!-- END ROUTER-TASKS v0.16.0 -->
