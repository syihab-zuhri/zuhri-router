# HANDOFF: lanjutan pekerjaan untuk agen berikutnya

Ditulis 2026-11-13 oleh agen sebelumnya atas permintaan founder. Baca berkas ini dulu, lalu `AGENTS.md`, lalu `docs/PROJECT_MANIFEST.md`.

## Aturan yang mengikat

`AGENTS.md` di root adalah aturan kerja: invariant uang, tenant, rahasia, aturan UI, Definition of Done, dan daftar hal yang butuh izin founder. Ikuti itu. `PLANNING_v7.0.md` dan `STARTER_PROMPT_v7.0.md` milik founder; jangan diubah.

Founder berbahasa Indonesia dan menjawab singkat. Laporkan hasil dengan jujur: bedakan "ditulis", "dijalankan", dan "lulus".

## Keadaan sekarang

| Bagian | Status |
|---|---|
| Rencana (`docs/`) | Lengkap sebagai draft, v0.9.0. 13 dokumen. Pemeriksaan konsistensi dokumen lulus |
| `server/` | Kode produksi tahap M1, 26 test integrasi lulus, typecheck bersih |
| `spike/` | Selesai. Bukan kode produksi; jangan dikembangkan. Berguna sebagai acuan relay stream, fallback, dan settlement |
| UI | Belum ada sama sekali |
| Gateway | Belum ada di `server/` |
| Maskot | Belum ada. Berkas Figma kosong sudah dibuat: https://www.figma.com/design/cdt227OEW9aNzddzCoHofT |
| Upstream | Dahono Router dan DeepSeek diperiksa dari dokumentasi; keduanya berstatus pending, belum eligible |

## Menjalankan yang sudah ada

    docker start router-spike-pg        # PostgreSQL 18 lokal di 127.0.0.1:55432; cara membuat ulang ada di server/README.md
    cd server
    npm install
    npm run typecheck
    npm test                            # harus 95 lulus

Test menghapus dan membuat ulang skema pada database `router_test`. Jangan arahkan `TEST_DATABASE_URL` ke database lain.

## Pekerjaan berikutnya, berurutan

Status CR-014: paket token dan kode redeem (backend) selesai; founder memfinalkan Dahono dan DeepSeek sebagai upstream. Lanjut butir 4 (registry upstream), lalu butir 5 (gateway).

PENTING (CR-013, 2026-11-14): saldo adalah kredit token, bukan Rupiah. Baca `docs/TOKEN_CREDIT.md` lebih dulu; ia mengalahkan dokumen billing lain soal unit. Voucher dan redeem (butir 6) bernilai token dan perlu tabel paket token.

Status 2026-11-14: butir 1 dan 2 selesai oleh Hermes, butir 3 (backend) selesai; lihat `docs/CHANGELOG.md` CR-009 sampai CR-011. Suite sekarang 78 test. Lanjut dari butir 4. Butir 6 (margin guard) juga harus menambah pemeriksaan floor ke `pricing.publish`.

Setiap butir: baca kontraknya di `docs/`, tulis migrasi baru (jangan mengedit `001_foundation.sql`), tulis test dulu atau bersamaan, jalankan seluruh suite, perbarui status di `docs/TASKS.md` dan catat di `docs/CHANGELOG.md`.

1. **Sisa M1** (`docs/PLANNING.md` FR-014, FR-019): API suspend dan restore tenant, adjustment saldo lewat API (fungsi `ledger.adjust` sudah ada), penutupan akun. Tenant SUSPENDED harus menolak request gateway kelak; siapkan pemeriksaannya.
2. **TASK-010 API key** (FR-009): buat, daftar tersamar, batas model dan belanja, cabut. Secret tampil sekali, simpan verifier (`tokenHash` di `src/crypto.ts` cocok untuk token acak berentropi tinggi). Admin juga dapat mencabut.
3. **TASK-001 harga dan multiplier** (`docs/BILLING_REDEEM.md` FR-001): model publik, price version immutable setelah terbit, publish dengan pemeriksaan versi, audit. Tarif dan multiplier sebagai integer (lihat `src/money.ts`).
4. **TASK-013 registry upstream** (FR-012; `docs/SECURITY.md` THR-017): base URL per protokol, API key upstream tulis-saja dan terenkripsi (`seal`/`unseal` di `src/crypto.ts`), validasi base URL (HTTPS, bukan alamat internal, tanpa redirect), route per model dan protokol, cost profile dengan kurs.
5. **TASK-012 inti gateway** terhadap upstream tiruan (FR-011; `docs/ARCHITECTURE.md` section 2, 3, 10): pindahkan pola dari `spike/src/gateway.ts` ke `server/` di atas `ledger.placeHold` dan `ledger.settleHold`. Permukaan pertama Chat Completions, lalu Anthropic Messages (TASK-025). Perbaiki dua temuan spike: estimasi token input yang lebih kuat daripada ukuran body dibagi dua, dan kurangi round trip database per request.
6. **TASK-003 margin guard**, lalu **TASK-004 dan TASK-005** voucher dan redeem (`docs/BILLING_REDEEM.md` section 3 dan 4).
7. **UI** (M3): baru setelah pustaka UI dipilih dan sumber UIArc diperiksa (`docs/UI_REFERENCES.md`, `docs/DESIGN.md`, `docs/DSD.md`).

## Jangan lakukan tanpa izin founder

- Deploy ke mana pun yang dapat diakses publik.
- Request ke upstream nyata (Dahono, DeepSeek, atau lainnya) dan pemakaian API key nyata.
- Mengirim email ke alamat nyata, membeli apa pun, mendaftar layanan.
- Menandai upstream sebagai eligible.

## Keputusan desain yang sudah diambil dan alasannya

- **Hanya upstream ber-API-key berbayar.** Founder menyebut sebagian akses Codex berasal dari langganan. Jalur login, OAuth, atau kredensial langganan untuk upstream tidak dibuat: risikonya akun diblokir penyedia dan semua pelanggan putus sekaligus (`docs/PLANNING.md` RSK-016).
- **Karakter pada `Portrait Version.jpg` tidak dipakai.** Itu karya pihak lain; hanya gayanya yang menjadi acuan. Maskot harus orisinal. Jangan mengambil gambar dari Pinterest atau sumber serupa. Rancangan maskot yang sudah dicoba: rambut bob biru navy dengan jepit bintang emas, jaket bomber koral, latar krem, gaya anime bergaris bersih.
- **Tanpa translasi antar-protokol.** Request Chat Completions hanya ke upstream berformat sama, dan seterusnya.
- **Fallback hanya sebelum byte pertama**, ke rute lain untuk model yang sama, dengan satu debit.
- **Usage nol gratis; usage hilang setelah konten diterima didebit dari estimasi.**
- **Batas login tiga lapis** (per akun dan IP, per IP, per akun lintas IP); lihat `server/README.md`.

## Yang masih menunggu jawaban founder

1. (Terjawab CR-012: SMTP Gmail, pengirim sudah ada di `server/src/mailer.ts`; app password disetel founder.) Semula: Email: penyedia mana, atau tautan undangan dikirim manual oleh founder pada pilot. Saat ini server hanya mau jalan dengan `MAILER=none`, dan pada mode itu undangan tidak terkirim. Bila founder memilih manual, tambahkan cara menampilkan tautan undangan sekali kepada admin.
2. Maskot: dibuat lewat Figma (memakai kredit AI Figma founder) atau disiapkan founder.
3. Hak menjual kembali: pendaftaran program reseller Dahono atau konfirmasi tertulis; DeepSeek Terms of Use belum dibaca.
4. Nama produk, bahasa antarmuka, skala pilot.

## Catatan teknis yang mudah terlewat

- Node menjalankan TypeScript langsung. Hanya sintaks yang dapat dihapus: tanpa enum, tanpa parameter property. Impor memakai akhiran `.ts`.
- Semua transaksi lewat `withTx` di `server/src/db/pool.ts`. Mengambil koneksi pool secara manual pernah menyebabkan kebocoran koneksi di spike.
- Uang selalu BigInt mikro-IDR. Nilai uang dikirim lewat JSON sebagai string.
- `session_user` adalah kata tercadang PostgreSQL; hindari sebagai nama objek.
- `make_interval(hours => ...)` hanya menerima bilangan bulat; pakai `secs`.
- Kode TOTP diterima sekali per langkah 30 detik. Test memakai langkah -1, 0, +1 secara berurutan (`test/helpers.ts`).
- `DEBUG_ERRORS=1` menampilkan error tak tertangani saat test.
- Pemeriksa konsistensi dokumen yang dipakai agen sebelumnya ada di folder sementara dan tidak ikut diserahkan. Aturan yang dijaganya: setiap ID yang dirujuk punya definisi, setiap FR punya AC, task dan test, dan baris terakhir tiap dokumen adalah penanda akhir yang memuat nomor versinya.
