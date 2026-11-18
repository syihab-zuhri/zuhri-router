# AGENTS.md: Router AI Komersial

Version: 0.3.0
Status: Draft; kode M1 ada di `server/`
Updated: 2026-11-13, Asia/Jakarta

Instruksi untuk agen coding yang mengerjakan repo ini. Dokumen perencanaan ada di `docs/`. `PLANNING_v7.0.md` dan `STARTER_PROMPT_v7.0.md` di root adalah kontrak perencanaan milik founder: jangan diubah dan jangan dipakai sebagai instruksi coding.

## Status saat ini

Founder mengizinkan implementasi dimulai (2026-11-13). Tahap M1 (fondasi) sebagian sudah ada di `server/`. Kerjakan task sesuai urutan di `docs/TASKS.md`; task yang syarat siapnya belum terpenuhi (misalnya yang membutuhkan upstream berstatus eligible atau aset maskot) tidak dikerjakan dulu. `spike/` bukan kode produksi dan tidak dikembangkan.

## Urutan baca

1. `docs/PROJECT_MANIFEST.md`: status, lokasi tiap domain, keputusan yang masih terbuka.
2. `docs/TASKS.md`: task yang dikerjakan, syarat siap, test yang wajib.
3. Dokumen domain sesuai task, lihat tabel di bawah.

## Sumber otoritatif

| Hal | Dokumen |
|---|---|
| Scope, FR-006 sampai FR-019, NFR | `docs/PLANNING.md` |
| Unit saldo dan cara tagih | `docs/TOKEN_CREDIT.md` |
| Rumus harga, metering, voucher, redeem, FR-001 sampai FR-005 | `docs/BILLING_REDEEM.md` |
| State request, admission, data, operasi API, ADR, stack | `docs/ARCHITECTURE.md` |
| Semantic per upstream | `docs/ADAPTERS.md` |
| Peran, izin, threat, abuse, data | `docs/SECURITY.md` |
| Layar, alur, state, teks antarmuka | `docs/UX.md` |
| Token visual | `docs/DESIGN.md` |
| Perilaku komponen | `docs/DSD.md` |
| Referensi UIArc | `docs/UI_REFERENCES.md` |

Bila dua dokumen bertentangan, berhenti dan laporkan; jangan memilih sendiri. Bila kode harus menyimpang dari dokumen, catat sebagai DRIFT dan usulkan perubahan dokumen; jangan mengubah dokumen diam-diam agar test lulus.

## Invariant yang tidak boleh dilanggar

Uang:
- Saldo adalah kredit token, bukan Rupiah (`docs/TOKEN_CREDIT.md`, yang mengalahkan dokumen lain bila bertentangan soal unit). Semua nilai saldo adalah integer mikro-kredit (sepersejuta kredit token). Tidak ada floating point pada perhitungan, penyimpanan, atau pengiriman nilai saldo.
- Tagihan = token yang terbaca dikali pengali model. Request baru butuh saldo tersedia di atas nol; hold boleh menjangkau batas lebih-pakai (`system_setting.overdraft_micro`).
- Pembulatan satu kali per settlement, setelah semua kategori dijumlahkan.
- Entri ledger hanya ditambah, tidak pernah diubah atau dihapus. Koreksi adalah entri baru.
- Saldo tersimpan selalu sama dengan jumlah entri. Admission, pemeriksaan batas key dan pembuatan hold berada dalam satu transaksi.
- Setiap operasi keuangan idempotent: settlement per request, redeem per voucher, tambah saldo per kunci idempotency.
- Request menyimpan snapshot harga saat admission; perubahan harga tidak mengubah request berjalan.
- Usage nol input dan nol output: debit nol, hold dilepas. Usage hilang setelah konten diteruskan bukan usage nol.
- Kegagalan komponen ledger menolak request berbiaya; tidak pernah meloloskan.
- Semua akses database yang butuh transaksi lewat `withTx` di `server/src/db/pool.ts`; jangan mengambil koneksi dari pool secara manual. Test memeriksa koneksi bocor.

Tenant dan akses:
- Setiap query resource pelanggan difilter tenant di server. Respons untuk resource tenant lain sama dengan resource tidak ada.
- Default semua operasi adalah tolak. Setiap operasi baru memiliki uji negatif otorisasi.
- Operasi admin memerlukan faktor kedua; aksi keuangan admin memerlukan step-up.

Rahasia dan data:
- API key pelanggan, kode redeem, token undangan dan reset disimpan sebagai verifier, ditampilkan sekali, tidak pernah ditulis ke log, URL, audit, atau analitik.
- API key upstream hanya dapat ditulis atau diganti dari UI, tidak pernah dikirim balik ke klien.
- Isi prompt dan respons tidak disimpan dan tidak ditulis ke log atau trace.
- Tidak ada secret di repo. Konfigurasi lewat environment dengan nama yang didokumentasikan.

Gateway:
- Pass-through sejenis: request hanya diteruskan ke endpoint upstream berprotokol sama. Tidak ada translasi antar-protokol.
- Routing ditentukan model yang dipanggil. Model tidak pernah diganti diam-diam. Fallback hanya ke route lain untuk model yang sama, hanya sebelum byte pertama, dengan satu debit (`docs/ARCHITECTURE.md` section 10).
- Hanya upstream berautentikasi API key berbayar. Jangan membuat jalur login, OAuth, atau kredensial langganan untuk upstream.
- Retry hanya sebelum byte pertama dikirim ke klien.
- Field usage pada respons ke pelanggan adalah usage mentah; multiplier hanya memengaruhi debit.
- Base URL upstream: hanya HTTPS, bukan alamat internal, redirect tidak diikuti.

## Aturan UI

Sebelum membuat atau mengubah UI, baca `docs/UX.md`, `docs/DESIGN.md`, `docs/DSD.md` dan `docs/UI_REFERENCES.md` pada scope task.
UIArc (https://uiarc.dev/components) wajib menjadi referensi utama. Gunakan UAR yang telah diperiksa, atau periksa kandidat baru dan perbarui `docs/UI_REFERENCES.md`.
Petakan layar dan tipe komponen ke referensi spesifik; catat adaptasi atau CUSTOM_GAP.
Strategi: PATTERN_ADAPTATION sebagai default; DIRECT_ADOPTION hanya untuk item Free yang source registry, lisensi dependency dan kompatibilitasnya sudah diperiksa dan dicatat.
Jangan mengarang props, memasang dependency yang tidak kompatibel, memakai atau merekonstruksi item Pro, atau memperlakukan demo sebagai backend nyata.
Nilai visual hanya dari token. Implementasikan state yang berlaku, aksesibilitas, responsive dan reduced motion. Hasil aksi keuangan tidak ditampilkan secara optimistis dan tidak lewat toast.
Arah visual: anime editorial digabung dengan design system (`docs/DESIGN.md` section 11). Hanya aset ilustrasi yang tercatat pada daftar aset dengan hak pakai yang jelas yang boleh masuk repo. Jangan memakai, mengunduh, atau membuat tiruan karakter dari anime, game, atau karya pihak lain; `Portrait Version.jpg` di root hanya acuan gaya dan tidak ikut dibangun. Bila aset belum ada, pakai placeholder geometris.
Laporkan bukti verifikasi dan sisa gap.
Skill `modern-web-guidance` (Google Chrome, lisensi Apache-2.0, salinan di `.claude/skills/`, `.agents/skills/` dan `.hermes/skills/`, commit sumber terkunci di `skills-lock.json`) boleh dipakai sebagai referensi tambahan untuk API web modern dan aksesibilitas. Bila isinya bertentangan dengan dokumen proyek atau UIArc, dokumen proyek yang berlaku; skill ini bukan izin menambah dependency atau polyfill. Jalankan perintahnya dengan `DISABLE_TELEMETRY=1` dan jangan memasukkan nama produk, rute atau data proyek ke kueri pencarian.

## Stack

Disetujui founder: TypeScript pada Node.js, PostgreSQL, React. Pustaka server yang dipakai tercatat di `docs/ARCHITECTURE.md` section 9; pustaka UI belum dipilih. Node menjalankan TypeScript langsung: hanya sintaks yang dapat dihapus (tanpa enum dan parameter property), dan impor memakai akhiran `.ts`. Jangan menambah dependency di luar daftar yang sudah disetujui tanpa mencatat alasan, lisensi dan sumbernya. Gunakan lockfile; jangan memperbarui lockfile secara massal.

## Perintah verifikasi

Sudah dijalankan dan terbukti bekerja pada 2026-11-13 (Node v24.21.0, PostgreSQL 18 di Docker), dari folder `server/`:

    npm run typecheck
    npm test

`npm test` membutuhkan PostgreSQL lokal; cara menyiapkannya ada di `server/README.md`. Test menghapus dan membuat ulang skema pada database test, jadi jangan arahkan `TEST_DATABASE_URL` ke database lain. Belum ada perintah lint, build, atau test UI.

## Definition of Done

- AC pada task terpenuhi dan test yang disebut di `docs/TASKS.md` dijalankan; keluaran disimpan sebagai bukti.
- Operasi baru memiliki uji negatif otorisasi; operasi keuangan memiliki uji replay dan konkurensi.
- Tidak ada secret atau isi prompt pada log yang dihasilkan test.
- Untuk UI: keyboard, state yang berlaku, 360 px, dan kesesuaian UAR diperiksa.
- Tidak ada stub tersembunyi, test yang dinonaktifkan, atau kontrol yang dimatikan agar hijau.
- Status task dan dokumen yang terdampak diperbarui. Bedakan "ditulis", "dijalankan", dan "lulus".

## Yang memerlukan izin founder lebih dulu

Deploy ke lingkungan apa pun yang dapat diakses publik; request ke upstream berbayar; pembelian atau langganan; pengiriman email ke alamat nyata; penghapusan data; perubahan scope di luar task; penambahan upstream berstatus eligible.

<!-- END ROUTER-AGENTS v0.3.0 -->
