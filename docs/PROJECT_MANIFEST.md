# Project Manifest: Router AI Komersial

Version: 0.32.0
Status: Draft
Owner keputusan: founder
Updated: 2026-11-14, Asia/Jakarta
Contract: ../PLANNING_v7.0.md, v7.0.0
Companion: ../STARTER_PROMPT_v7.0.md
Mode: BLUEPRINT dan implementasi fondasi + backend TASK-010
Gate: B untuk scope pilot undangan, sebagai penilaian kesiapan dan bukan persetujuan founder. C dan D belum tercapai.
Evidence ceiling: E2 untuk inspeksi referensi; E3 untuk pemeriksaan dokumen historis dan test API M1 lokal yang cakupannya tercatat di ../server/README.md. Bukan bukti gateway, UI atau kesiapan rilis.

## Konfigurasi dan status informasi

```yaml
contract_version: "7.0.0"
project_name: null
documentation_profile: STANDARD
product_risk: HIGH
surfaces: [API, WEB]
has_ui: true
lifecycle: GREENFIELD
runtime_profiles: [SELF_HOSTED]
release_context: PUBLIC
team_shape: SOLO  # founder dengan agen coding (CR-004)
product_languages: []
locales: []
currencies: [IDR]  # hanya harga tampilan paket; saldo adalah kredit token (CR-013)
timezones: []
jurisdictions: []
existing_stack: null  # greenfield; stack target ADR-004 disetujui founder: TypeScript/Node.js, PostgreSQL, React
existing_design_system: null
design_reference_policy:
  primary_url: "https://uiarc.dev/components"
  policy: REQUIRED_WHEN_UI
  implementation_strategy: PATTERN_ADAPTATION
  access_status: PARTIAL_DOCS_VERIFIED
  paid_assets_authorized: false
execution_scope: IMPLEMENTATION  # diizinkan founder 2026-11-13 ("gas mulai"); deploy, request upstream berbayar dan pengiriman email nyata tetap butuh izin tersendiri
```

Nilai non-null untuk profile/risk/surface/lifecycle/runtime/release/strategy merupakan tailoring PROPOSED atau ASSUMED, bukan persetujuan final founder; label kanonis di DISCOVERY.md section 4. release_context PUBLIC adalah arah produk; rilis yang direncanakan pada paket ini adalah pilot undangan (PLANNING.md section 2). Currency IDR CONFIRMED founder untuk MVP (CR-003); USD DEFERRED. project_name dan locale belum ditetapkan; solo founder dengan agen coding dan stack TypeScript/Node.js, PostgreSQL, React telah dikonfirmasi. Nama pada judul hanya label kerja.

## Registry dan source of truth

| Artefak | Version/status | Domain otoritatif | Dependency |
|---|---|---|---|
| ../PLANNING_v7.0.md, ../STARTER_PROMPT_v7.0.md | v7.0.0, input milik user | Kontrak kerja | Jangan diubah |
| DISCOVERY.md | v0.3.0 Draft | Brief, tailoring, arah bisnis, register ASM-001 sampai 004, RSK-001 sampai 007, OQ-001 sampai 004, UAR-001 sampai 006 | Input dan evidence |
| BILLING_REDEEM.md | v0.2.0 Draft | Rumus harga/multiplier, metering, voucher, redeem; FR-001 sampai 005, AC/TASK/TEST-001 sampai 005; SCR-001 sampai 003; UAR-007 sampai 010 | DISCOVERY |
| PLANNING.md | v0.5.0 Draft | Tujuan, scope rilis, applicability P0, FR-006 sampai 019, AC-006 sampai 019, NFR, milestone, ASM-005 sampai 008, RSK-008 sampai 016, OQ-005 sampai 008, ASM-009 | DISCOVERY, BILLING_REDEEM |
| ARCHITECTURE.md | v0.7.0 Draft | Topologi, siklus hidup request, admission, kontrak data, operasi API-001 sampai 040, matriks protokol per tool, register upstream, ADR-001 sampai 005, operasi minimum | PLANNING, BILLING_REDEEM |
| SECURITY.md | v0.3.1 Draft | Peran dan izin, THR/CTL-001 sampai 018, ABU-001 sampai 008, kebijakan data, standar | PLANNING, ARCHITECTURE |
| UX.md | v0.5.0 Draft | IA, SCR-004 sampai 018, FLOW-001 sampai 008, state, copy | PLANNING, SECURITY, UI_REFERENCES |
| UI_REFERENCES.md | v0.3.0 Draft | Provenance UIArc: indeks UAR-001 sampai 010, definisi UAR-011 sampai 043, CUSTOM_GAP navigasi | UX, evidence |
| TASKS.md | v0.17.0 Draft | Status eksekusi, TASK-006 sampai 028, TEST-006 sampai 020, traceability P0 | Semua di atas |
| TOKEN_CREDIT.md | v0.3.0 Draft | Unit saldo kredit token dan cara tagih; mengalahkan dokumen lain soal unit | BILLING_REDEEM, ARCHITECTURE |
| CHANGELOG.md | v0.32.0 Recorded | Riwayat perubahan dan keputusan | – |
| PROJECT_MANIFEST.md | v0.32.0 Draft | Registry, kesiapan, resume pointer | – |
| DESIGN.md | v0.2.0 Draft | Makna dan nilai awal token visual, strategi UIArc, kontras terhitung, lapisan brand anime editorial dan analisis gambar referensi | UX, UI_REFERENCES |
| DSD.md | v0.3.0 Draft | Perilaku komponen CMP-001 sampai 037 | DESIGN, UX, UI_REFERENCES |
| ADAPTERS.md | v0.3.0 Draft | Semantic per upstream: DeepSeek dan Dahono Router, dari dokumentasi | ARCHITECTURE, BILLING_REDEEM |
| ../AGENTS.md | v0.3.0 Draft | Instruksi agen coding: urutan baca, invariant, aturan UI, Definition of Done | Semua dokumen |
| ../server/ | M1 sebagian, kode produksi | Skema, ledger, akun, sesi, admin, audit, API; README.md dan test-result.txt | ARCHITECTURE, SECURITY, BILLING_REDEEM |
| ../spike/ | Selesai, bukan produksi | Kode dan bukti spike TASK-006: README.md, test-result.txt, bench-result.json | ARCHITECTURE |
| Schema executable data/API, ENVIRONMENT, RUNBOOK | Migrasi SQL dan API M1 ada di ../server/; schema lengkap gateway, ENVIRONMENT dan RUNBOOK belum | – | ADR-002, ADR-004 |

Evidence:

| Lokasi | Isi |
|---|---|
| evidence/2026-11-13/ | Snapshot referensi awal, PROVENANCE.md, citations.json (ledger sitasi, append-only), SHA256SUMS.txt, doc-check.json (historis v0.1.0) |
| evidence/2026-11-13-redeem/ | Snapshot UIArc UAR-007 sampai 010, fetch-results.json, billing-example.json (aritmetika contoh sintetis) |
| evidence/2026-11-13-blueprint/ | Snapshot UIArc UAR-011 sampai 037, fetch-results.json, doc-check.json (pemeriksaan paket terkini; ditimpa tiap pemeriksaan) |
| ../Portrait Version.jpg | Gambar referensi gaya dari founder; memuat karakter karya pihak lain; acuan gaya saja, tidak dipakai di produk |
| evidence/2026-11-13-brand/ | Snapshot UIArc UAR-042 dan 043, fetch-results.json |
| evidence/2026-11-13-design/ | Snapshot UIArc UAR-039 sampai 041, fetch-results.json, contrast.json (rasio kontras terhitung dari nilai token) |
| evidence/2026-11-13-stack/ | Metadata `latest` registry npm untuk kandidat pustaka; fetch-results.json |
| evidence/2026-11-13-upstream/ | Snapshot dokumentasi API, integrasi tool dan ketentuan Open Platform DeepSeek; halaman beranda, docs, pricing, token-plan, reseller dan terms Dahono Router; fetch-results.json. Tidak ada snapshot untuk "API dari Codex" |
| evidence/2026-11-13-tools/ | Snapshot dokumentasi resmi Claude Code (gateway), Codex (config reference) dan OpenCode (providers) untuk ADR-002; fetch-results.json. Hermes dan ZCode tidak memiliki snapshot resmi |

Koreksi catatan: manifest v0.2.0 merujuk evidence/2026-11-13-redeem/doc-check.json dan billing-example.json "setelah dijalankan", tetapi kedua file tidak pernah dibuat dan checksum citations.json tidak diperbarui. Pemeriksaan revisi itu baru dijalankan pada sesi v0.3.0; hasilnya di evidence/2026-11-13-blueprint/doc-check.json dan billing-example.json dibuat pada sesi yang sama.

## UI policy

- Lokasi map: UI_REFERENCES.md (indeks seluruh UAR; definisi UAR-011 sampai 038). Definisi UAR-001 sampai 006 di DISCOVERY.md section 10; UAR-007 sampai 010 di BILLING_REDEEM.md section 5.
- Strategi: PATTERN_ADAPTATION sementara; ditinjau ulang setelah ADR-004.
- Sumber: 42 halaman dokumentasi Free dibaca pada bagian yang disebut di UI_REFERENCES.md section 1. Tidak ada source registry, preview, atau dependency yang diperiksa atau dipasang.
- Akses: Free saja; paid_assets_authorized=false.
- Gap: UAR-038 navigasi aplikasi CUSTOM_GAP (NO_MATCH pada tier Free). Pending: source registry dan lisensi dependency belum diperiksa; pemetaan nama token UIArc belum dibuat.
- Artefak desain turunan: tidak ada, sehingga tidak ada yang STALE.

## Kesiapan

Scope yang dinilai: pilot berbayar undangan (PLANNING.md section 2).

- Gate A: tercapai.
- Gate B: tercapai sebagai penilaian. P0 dan batasnya, applicability, arah solusi, asumsi dan risiko tertulis. Tiga keputusan founder masih terbuka dan ditandai, tidak disajikan sebagai keputusan.
- Gate C: belum untuk keseluruhan pilot. Penghalang: upstream masih pending, kontrak adapter belum dibuktikan runtime, pustaka UI/source registry belum diperiksa, aset maskot/font display belum ada, schema/fixture gateway dan keputusan retensi belum lengkap. ADR-004 disetujui, DESIGN/DSD sudah draft dan OQ-006 sudah dijawab; bukan penghalang fondasi lokal.
- Gate D: belum dinilai; implementasi baru mencakup fondasi M1 dan belum ada rilis.

Artefak ditulis: 13 dokumen proyek termasuk ../AGENTS.md. Implementasi produk: fondasi M1 di ../server/, 69 test integrasi dijalankan dan lulus pada revisi M1 lanjutan terhadap PostgreSQL lokal (E3 untuk cakupan yang tertulis di ../server/README.md; belum ada gateway, UI, atau deploy). Kode spike: 14 test lulus terhadap upstream tiruan.

P0 traceability: 19 dari 19 FR memiliki AC, task dan test specification (TASKS.md section 4). Kompatibilitas tool: belum ada tool yang diuji; kebutuhan protokol Claude Code, Codex dan OpenCode dari dokumentasi resmi (E2), Hermes dan ZCode dari sumber pihak ketiga (E0). Status aktual mengikuti TASKS.md: API fondasi M1 dijalankan; task lain masih memiliki gap/syarat siap.

Pemeriksaan lintas dokumen (penilaian manual kecuali disebut deterministik):

| CHK | Status | Catatan |
|---|---|---|
| CHK-01, 02, 04 | PASS dokumen | Keterhubungan FR, AC, alur, task, test diperiksa deterministik di doc-check.json |
| CHK-03 | PASS dokumen | Setiap operasi API memiliki principal di ARCHITECTURE.md section 5 dan izin di SECURITY.md section 2 |
| CHK-05, 16, 39 | PASS | Asumsi dan proposal berlabel; tidak ada klaim test atau approval |
| CHK-06, 07, 08 | PASS manual | Entity, peran dan istilah status konsisten antar dokumen; belum ada schema untuk diuji |
| CHK-09 | PENDING | Pola timeout/retry ditetapkan; nilai menunggu upstream |
| CHK-10, 12 | PENDING | NFR-002, 003, 004, 010 TBD dengan owner |
| CHK-11 | N/A | Analytics produk DEFERRED |
| CHK-13 | PASS | ADR-001 sampai 005 memuat opsi, alasan dan revisit trigger; ADR-004 TBD |
| CHK-14 | PASS | Tidak ada secret atau klaim compliance; pemindaian pola sederhana di doc-check.json |
| CHK-15 | PASS | Item DEFERRED memiliki pemicu |
| CHK-17, 18 | PENDING | Standar terdaftar VERIFICATION_REQUIRED; belum ada pemetaan kontrol |
| CHK-19, 20 | PASS dokumen | ABU dan THR per boundary tertulis; nilai ambang belum final |
| CHK-21 | PENDING | TASK-020 sebagian: metadata registry dibaca, advisory dan transitif belum |
| CHK-22 | PENDING | Host dan edge belum dipilih |
| CHK-23 | N/A | Tidak ada fitur AI milik produk |
| CHK-24, 27, 28 | PASS dokumen | State, pemulihan dan copy tertulis di UX.md |
| CHK-25, 26, 33 | PASS dokumen | DESIGN.md dan DSD.md draft; satu sumber token ditetapkan; belum ada UI untuk diuji |
| CHK-29, 30 | PASS untuk ../server/ | Tidak ada stub tersembunyi; spike berlabel bukan produksi; struktur per tanggung jawab |
| CHK-31 | PENDING | Provider email dan host belum dipilih |
| CHK-32 | PASS | Kontras dinyatakan sebagai hitungan atas nilai token; nilai dari gambar referensi berlabel ESTIMATED |
| CHK-34 | PASS deterministik | Marker akhir, resolusi ID dan file evidence; lihat doc-check.json dan batasnya |
| CHK-35 | PASS dokumen | Semua layar dan CMP memiliki UAR atau CUSTOM_GAP |
| CHK-36, 37 | PASS | URL, status akses dan strategi tercatat; tidak ada dependency paksa |
| CHK-38 | PASS | Tabel registry di atas |
| CHK-40 | PENDING | CR-001 sampai CR-013 tercatat; BILLING_REDEEM, ARCHITECTURE, PLANNING, UX dan SECURITY masih memuat istilah Rupiah yang digantikan TOKEN_CREDIT.md dan perlu ditulis ulang |

## Resume pointer

Terakhir selesai (2026-11-14): CR-029: produk terbuka di https://zrouter.web.id, uji alur publik 31/31, backup lokal tiap jam di VPS. Belum ada pelanggan nyata; backup keluar server, bot Telegram dan email belum. Sebelumnya: CR-028: terpasang dan menyala di VPS pada port dalam; belum dibuka ke publik (menunggu tunnel Cloudflare dan izin founder). Sebelumnya: CR-027: alur lengkap lewat container 29/29; dokumen lama diberi penanda kredit token. Sebelumnya: CR-026: Codex, Claude Code dan OpenCode terbukti berjalan lewat gateway lokal ke upstream nyata. Sebelumnya: CR-024: bot Telegram pemantau dan unggah backup ke Google Drive; 128 test lulus. Sebelumnya: CR-022: persiapan deploy (image dan compose di deploy/, diuji lokal); 124 test lulus. Deploy menunggu info server dan izin founder. Sebelumnya: CR-020: permukaan Responses; 119 test lulus. Berikutnya persiapan deploy (menunggu info server dari founder) dan margin guard. Sebelumnya: CR-019: batas laju gateway dan pemulihan request terputus; 118 test lulus. Berikutnya permukaan Responses, lalu persiapan deploy. Sebelumnya: CR-018: input yang ditagih dibatasi ukuran request; 116 test lulus. Sebelumnya: CR-017: uji asap upstream nyata lewat gateway lokal berhasil; temuan token input tambahan dari upstream pada non-stream menunggu keputusan founder. Sebelumnya: CR-016: inti gateway terhadap upstream tiruan (115 test lulus), repo di-push. Berikutnya: uji asap terhadap upstream nyata dengan izin founder, margin guard, permukaan Responses. Sebelumnya: CR-015: registry upstream di server (102 test lulus), web oleh Hermes di ../web/, Git lokal. Berikutnya inti gateway (TASK-012) terhadap upstream tiruan. Sebelumnya: CR-014: upstream Dahono dan DeepSeek difinalkan founder; paket token dan kode redeem di backend (95 test lulus). Berikutnya TASK-013 registry upstream, lalu inti gateway. Sebelumnya: CR-013 saldo kredit token (86 test lulus); baca TOKEN_CREDIT.md sebelum dokumen billing lain. Sebelumnya: pengirim email SMTP dan pencatatan CR-012 (domain zrouter.web.id, Gmail SMTP, promo sebagai OQ-009); 81 test lulus. Sebelumnya: backend TASK-001 harga dan multiplier; 78 test lulus; berikutnya TASK-013 registry upstream. Sebelumnya: sisa API M1 di ../server/ (suspend/restore, guard admission, adjustment, penutupan akun); 69 test lulus. Backend TASK-010 API key juga selesai; berikutnya TASK-001 harga dan multiplier sesuai ../HANDOFF.md. Job retensi masih menunggu keputusan founder; tidak ada upstream eligible atau UI.

Keputusan dan tindakan founder yang dibutuhkan, urut dampak:
1. Hak menjual kembali: mendaftar program reseller Dahono atau meminta konfirmasi tertulis bahwa gateway sendiri diperbolehkan; DeepSeek Terms of Use perlu dibaca.
2. Penyedia email untuk undangan dan reset (ASM-006), atau keputusan memakai kanal manual pada pilot.
3. OQ-008: sumber maskot dan ilustrasi orisinal, serta nama produk.
Berikutnya: nama penyedia API berbayar untuk model OpenAI bila diinginkan, skala pilot, nilai retensi, bahasa antarmuka.

Sudah dijawab founder dan tidak perlu ditanyakan lagi: model usaha, top-up redeem dan tambah saldo langsung lewat username, upstream Dahono Router dan DeepSeek, routing per model dengan fallback, daftar tool target, Rupiah untuk MVP, implementasi oleh agen coding, usage nol tanpa biaya, usage hilang didebit estimasi, stack TypeScript/PostgreSQL/React, arah visual anime editorial digabung design system, pantau usage per pelanggan.

Keputusan desain yang bukan permintaan founder dan perlu ia ketahui: akses upstream dari akun langganan tidak dirancang (RSK-016); karakter pada gambar referensi tidak dipakai (ASM-009).

Yang dapat dikerjakan secara lokal: TASK-001 dan urutan handoff sesuai syarat siap, vetting TASK-020, pembacaan source registry UIArc dan pemetaan token, serta pembacaan ketentuan upstream. Implementasi sudah diizinkan (CR-008); founder menegaskan izin menyelaraskan status usang dan melanjutkan M1 (CR-009).

Baca untuk melanjutkan: ../HANDOFF.md, ../AGENTS.md, manifest ini, TASKS.md dan kontrak domain. execution_scope=IMPLEMENTATION untuk pekerjaan lokal yang diizinkan. Deploy publik, upstream nyata, email nyata, pembelian dan eligibility tetap memerlukan izin tersendiri.

Tidak ada layanan, credential, DNS, atau sumber upstream milik user yang disentuh. Tidak ada komitmen harga, kapasitas, jadwal, pembelian, atau rilis.

<!-- END ROUTER-MANIFEST v0.32.0 -->
