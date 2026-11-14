# UX: Router AI Komersial

Version: 0.4.0
Status: Draft, PROPOSED; spesifikasi alur dan layar, belum ada desain visual atau prototipe
Owner keputusan: founder
Updated: 2026-11-13, Asia/Jakarta
Dependencies: PLANNING.md; SECURITY.md; ARCHITECTURE.md; UI_REFERENCES.md; BILLING_REDEEM.md section 5
Evidence: E1.

Sumber otoritatif untuk information architecture, alur, inventaris layar, state dan copy. SCR-001 sampai SCR-003 didefinisikan di BILLING_REDEEM.md section 5 dan tidak diulang; dokumen ini menambah SCR-004 sampai SCR-018. Nilai visual ada di DESIGN.md dan perilaku komponen di DSD.md.

## 1. Pengguna dan konteks

| Aktor | Tujuan utama | Konteks |
|---|---|---|
| Pelanggan (owner tenant) | Mengisi saldo, mendapat key, menyambungkan tool, memantau biaya | Pengguna tools AI; terutama desktop saat konfigurasi, ponsel saat memeriksa saldo atau menukar kode. Literasi teknis bervariasi (belum divalidasi) |
| Admin (founder) | Menetapkan harga, menerbitkan kode, mengawasi biaya, menangani masalah | Desktop; kadang ponsel untuk menerbitkan kode atau mengaktifkan kill switch |

Bahasa antarmuka: kandidat Bahasa Indonesia (ASM-003, belum dikonfirmasi). Istilah teknis API (API key, token, model, base URL) dipertahankan. Dokumentasi integrasi mungkin memerlukan versi Inggris; belum diputuskan.

## 2. Information architecture

Dua area dengan shell terpisah dan login terpisah.

Portal pelanggan: Beranda, Isi Saldo, API Key, Model dan Harga, Pemakaian, Transaksi, Panduan, Akun.

Backoffice: Ringkasan, Pelanggan, Kode Redeem, Harga dan Model, Upstream, Request dan Rekonsiliasi, Audit.

Navigasi utama adalah CUSTOM_GAP (UAR-038). Saldo tersedia tampil tetap di shell portal dan menjadi tautan ke Isi Saldo.

## 3. Inventaris layar

Kolom state memuat state yang berlaku selain default. `forbidden` dan `session-expired` berlaku di semua layar bersesi dan tidak diulang: sesi habis mengarahkan ke login lalu kembali ke halaman asal tanpa mengirim ulang aksi yang mengubah data.

| ID | Layar | Tujuan dan aksi utama | Data / izin | State dan pemulihan | UAR | FR |
|---|---|---|---|---|---|---|
| SCR-001 | Isi Saldo | Lihat BILLING_REDEEM.md section 5 | | | 003, 007, 010, 011 | FR-005 |
| SCR-002 | Kode Redeem Admin | Lihat BILLING_REDEEM.md section 5 | | | 002, 004, 007, 008, 010, 011, 013, 015, 016, 025, 029 | FR-004 |
| SCR-003 | Harga dan Multiplier Model | Lihat BILLING_REDEEM.md section 5 | | | 002, 003, 007, 008, 009, 010, 011, 012, 013, 015, 019, 036 | FR-001, FR-003 |
| SCR-004 | Masuk | Login pelanggan dengan username atau email; tautan lupa password | ANON | submitting, kredensial-salah (pesan seragam), dibatasi dengan waktu tunggu, server-error | 006, 007, 010, 011, 014, 042 | FR-006 |
| SCR-005 | Aktivasi Undangan | Memilih username dan menetapkan password dari tautan undangan | ANON dengan token | token-valid, username-sudah-dipakai, username-tidak-valid, token-kedaluwarsa/terpakai (arahan hubungi admin), submitting, password-lemah, berhasil lalu masuk | 007, 010, 011, 014, 034 | FR-006 |
| SCR-006 | Pemulihan Akses | Minta tautan reset; tetapkan password baru | ANON | terkirim (pesan sama untuk semua email), token-tidak-valid, submitting, berhasil | 007, 010, 011, 014 | FR-006 |
| SCR-007 | Beranda | Saldo tersedia/terreservasi, belanja periode, langkah awal, status layanan | OWNER | loading, first-use (checklist), saldo-nol (ajakan isi saldo), data-usang dengan waktu pembaruan, layanan-dijeda | 003, 010, 017, 018, 032, 033 | FR-013 |
| SCR-008 | API Key | Daftar key; buat; cabut; lihat batas | OWNER | empty, creating, secret-sekali-tampil (peringatan tidak dapat dilihat lagi), salin-gagal, batas-jumlah, mencabut, dicabut, gagal/hasil-tidak-diketahui | 001, 002, 004, 007, 010, 011, 013, 015, 017, 027, 028, 039 | FR-009 |
| SCR-009 | Model dan Harga | Daftar model dijual dan tarif efektif per kategori | OWNER | loading, empty (belum ada model dijual), model-dijeda | 002, 015, 017, 018, 025 | FR-010 |
| SCR-010 | Pemakaian | Daftar request, filter, grafik harian, rincian biaya per request | OWNER | loading, empty, tanpa-hasil-filter, belum-final (unresolved), error-parsial (grafik gagal, daftar tetap) | 002, 010, 015, 016, 017, 018, 024, 028, 031, 032 | FR-013 |
| SCR-011 | Transaksi | Riwayat ledger: redeem, debit, adjustment | OWNER | loading, empty, tanpa-hasil-filter | 002, 015, 016, 017, 018, 024, 031 | FR-013 |
| SCR-012 | Panduan Integrasi | Base URL, autentikasi, contoh konfigurasi, kode error | OWNER | belum-ada-key (tautan buat key) | 004, 019, 026 | FR-018 |
| SCR-013 | Akun dan Keamanan | Ubah password, daftar sesi dan cabut, tutup akun | OWNER | submitting, password-lama-salah, sesi-dicabut, konfirmasi tutup akun | 007, 008, 010, 011, 014, 020, 030 | FR-006, FR-019 |
| SCR-014 | Ringkasan Operasi | Belanja, selisih proyeksi dan terekonsiliasi, kewajiban voucher, antrean unresolved, kill switch | ADMIN; kill switch step-up | loading, data-usang, biaya-unknown ditandai, layanan-dijeda, mengubah-flag, gagal | 003, 008, 010, 011, 015, 018, 031, 032, 035 | FR-003, FR-015, FR-017 |
| SCR-015 | Pelanggan | Daftar dan pencarian lewat username; detail pelanggan dengan tab Ringkasan, Pemakaian (per periode, model, key), Request, Transaksi, API Key; tambah saldo langsung; undang; suspend/restore; adjustment; cabut key | ADMIN; tambah saldo, adjustment dan cabut key step-up | empty, tanpa-hasil, username-tidak-ditemukan, mengundang, undangan-terkirim/gagal-kirim, konfirmasi-tambah-saldo (username dan nominal), saldo-ditambah (receipt), hasil-tidak-diketahui, ditangguhkan, konflik, gagal | 002, 007, 008, 010, 011, 013, 015, 016, 017, 019, 024, 025, 029, 031, 032, 035, 036, 037, 040 | FR-014 |
| SCR-016 | Upstream dan Route | Form upstream: nama, base URL per protokol, API key, catatan ketentuan; uji koneksi; eligibility; cost profile dengan currency dan kurs; pemetaan model; kesehatan route | ADMIN; perubahan step-up | empty, pending/blocked/eligible, base-URL-ditolak (alasan), key-tersimpan (tersamar, hanya dapat diganti), menguji, uji-lulus/gagal/tidak-tersedia, cost-usang, kurs-usang, circuit-terbuka, konflik, gagal | 002, 007, 008, 009, 010, 011, 013, 014, 015, 017, 022, 035 | FR-012, FR-003 |
| SCR-017 | Request dan Rekonsiliasi | Daftar request lintas tenant (metadata), antrean unresolved, penyelesaian kasus | ADMIN; penyelesaian step-up | loading, empty, tanpa-hasil, menyelesaikan, sudah-diselesaikan (replay), gagal | 002, 008, 010, 011, 015, 016, 017, 024, 025, 028, 031, 035 | FR-015 |
| SCR-018 | Audit | Daftar audit event dengan filter | ADMIN | loading, empty, tanpa-hasil | 002, 016, 017, 024, 025, 028, 031 | FR-016 |

Login admin dan verifikasi TOTP memakai pola SCR-004 dengan tambahan UAR-035; tidak diberi SCR tersendiri karena hanya berbeda pada langkah faktor kedua. Dialog step-up adalah komponen bersama (UAR-008 dengan UAR-035).

## 4. Alur utama

### FLOW-001: Dari undangan sampai request pertama (FR-006, FR-005, FR-009, FR-011)

Undangan diterima lewat email, lalu SCR-005 aktivasi, SCR-007 menampilkan checklist, SCR-001 menukar kode, SCR-008 membuat key dan menyalin secret, SCR-012 mengonfigurasi tool, request pertama, dan checklist selesai berdasarkan data server.

Alternatif: pelanggan membuat key sebelum menukar kode; request ditolak dengan `insufficient_balance` dan panduan menautkan ke Isi Saldo.
Kegagalan: tautan undangan kedaluwarsa (hubungi admin); salin secret gagal (secret tetap terlihat untuk disalin manual sampai panel ditutup); request pertama gagal (panduan memetakan kode error ke tindakan).

### FLOW-002: Penjualan dan penerbitan kode oleh admin (FR-004)

Admin memverifikasi pembayaran di luar aplikasi, membuka SCR-002, mengisi nominal dan referensi penjualan, lolos step-up, menerima kode sekali tampil, lalu mengirimnya lewat kanal sendiri.

Kegagalan: hasil tidak diketahui karena timeout (periksa daftar berdasarkan referensi penjualan sebelum mencoba lagi; replay mengembalikan voucher yang sama tanpa kode mentah, lalu cabut dan ganti bila kode tidak sempat tersalin).

### FLOW-003: Menetapkan harga dan membuka penjualan model (FR-001, FR-003, FR-012)

SCR-016 mendaftarkan upstream dan cost profile serta menandai eligible; SCR-003 mengisi tarif dan faktor, melihat preview dan hasil margin guard, lalu publish dengan konfirmasi; model muncul di SCR-009.

Kegagalan: margin-blocked (tampilkan kategori yang berada di bawah floor); cost-usang (minta pembaruan cost profile); konflik versi (muat ulang perubahan terbaru tanpa menimpa).

### FLOW-004: Memahami biaya satu request (FR-013)

SCR-010, pilih request, rincian menampilkan token per kategori, tarif snapshot, perhitungan, debit dan state. Request belum final menjelaskan bahwa dana ditahan dan kapan akan diselesaikan.

### FLOW-005: Menghentikan kerugian (FR-017, FR-003)

Alert diterima di luar aplikasi, admin membuka SCR-014, mengaktifkan kill switch global atau per model lewat step-up, portal menampilkan status layanan dijeda, dan request baru ditolak dengan `service_paused`.

### FLOW-006: Menyelesaikan request unresolved (FR-015)

SCR-017 antrean, buka kasus, masukkan bukti usage atau putuskan pelepasan, lolos step-up; settlement tunggal terbentuk dan pelanggan melihat state final di SCR-010.

### FLOW-008: Penjualan dengan tambah saldo langsung (FR-014)

Admin memverifikasi pembayaran di luar aplikasi, membuka SCR-015, mencari username, memilih tambah saldo, mengisi nominal dan referensi penjualan, memeriksa konfirmasi yang menampilkan username dan nominal, lolos step-up, dan melihat receipt. Pelanggan melihat entri di SCR-011.

Kegagalan: username tidak ditemukan (tidak ada perubahan); hasil tidak diketahui (periksa tab Transaksi pelanggan sebelum mengulang; pengulangan dengan kunci yang sama tidak menambah saldo dua kali).

### FLOW-007: Key bocor (FR-009)

SCR-008, cabut key lewat konfirmasi di tempat; request baru dengan key itu ditolak; pelanggan membuat key pengganti. Riwayat pemakaian key lama tetap terlihat.

## 5. Copy dan kosakata

Draft Bahasa Indonesia, PROPOSED. Nada lugas, tanpa emoji. Angka uang selalu disertai kode atau simbol currency. Contoh di dokumentasi memakai data sintetis.

Kosakata status tetap:

| Entity | Status yang ditampilkan |
|---|---|
| API key | Aktif, Dicabut, Kedaluwarsa |
| Kode redeem | Draf, Aktif, Ditukar, Dicabut, Kedaluwarsa |
| Request | Berjalan, Selesai, Gagal, Dibatalkan, Belum final |
| Tenant | Aktif, Ditangguhkan, Ditutup |
| Harga | Draf, Terbit, Ditarik |
| Upstream | Menunggu tinjauan, Layak, Diblokir |

Pesan kunci:

| Situasi | Teks |
|---|---|
| Login gagal | Username atau password tidak cocok. |
| Reset diminta | Jika email terdaftar, kami mengirim tautan untuk mengatur ulang password. |
| Dibatasi | Terlalu banyak percobaan. Coba lagi dalam {waktu}. |
| Redeem berhasil | Saldo bertambah {nominal}. Saldo sekarang {saldo}. |
| Kode tidak dapat dipakai | Kode ini tidak dapat dipakai. Periksa penulisannya atau hubungi penjual. |
| Hasil redeem tidak diketahui | Kami belum dapat memastikan hasilnya. Periksa riwayat transaksi sebelum mencoba lagi. |
| Secret key | Salin key ini sekarang. Setelah panel ditutup, key tidak dapat ditampilkan lagi. |
| Cabut key | Cabut key "{nama}"? Tool yang memakai key ini akan langsung ditolak. |
| Request belum final | Biaya request ini belum final. Dana sebesar {nominal} ditahan sampai diselesaikan. |
| Layanan dijeda | Layanan sedang dijeda sementara. Request baru ditolak; saldo Anda tidak berubah. |
| Step-up admin | Masukkan kode autentikator untuk melanjutkan. |
| Terbit kode | Kode hanya ditampilkan sekali. Salin dan kirim ke pembeli sekarang. |
| Margin di bawah batas | Tarif {kategori} berada di bawah batas biaya. Harga tidak dapat diterbitkan. |
| Tambah saldo langsung | Tambah {nominal} ke saldo {username}? Tindakan ini langsung berlaku dan tercatat. |
| Request tanpa biaya | Request ini tidak dikenakan biaya karena tidak ada token yang diproses. |
| Biaya estimasi | Biaya request ini dihitung dari estimasi karena penyedia model tidak melaporkan pemakaian. |
| API key upstream tersimpan | API key tersimpan dan tidak dapat ditampilkan lagi. Masukkan key baru untuk menggantinya. |
| Base URL ditolak | Base URL harus memakai HTTPS dan mengarah ke alamat publik. |
| Uji koneksi tidak tersedia | Upstream ini tidak menyediakan pengujian tanpa biaya. Koneksi belum dibuktikan. |

Pesan kode redeem tidak membedakan salah, kedaluwarsa, dicabut atau sudah dipakai pihak lain kepada pengguna yang bukan pemiliknya. Pemilik redemption yang mengulang mendapat receipt yang sama.

## 6. Responsive, keyboard dan aksesibilitas

- Lebar minimum 360 px (NFR-009). Tabel menjadi daftar bertumpuk atau bergulir di dalam wadahnya; halaman tidak bergulir horizontal.
- Semua alur P0 dapat diselesaikan dengan keyboard. Fokus kembali ke pemicu setelah dialog atau panel ditutup. Setelah aksi berhasil, fokus pindah ke hasil (receipt, secret, pesan).
- Hasil aksi keuangan diumumkan lewat region status atau alert sesuai tingkat keparahan; warna tidak menjadi satu-satunya penanda.
- Angka yang berubah sendiri (saldo) tidak diumumkan berulang; pembaruan diumumkan setelah aksi pengguna.
- Gerak mengikuti preferensi reduced-motion. Tidak ada animasi yang menunda tampilnya hasil aksi keuangan.
- Kode redeem dan secret key memakai font dengan pembeda karakter yang jelas dan dapat dipilih sebagai teks.

Target WCAG 2.2 AA (NFR-006). Kriteria rinci dan pengujian komponen ditulis di DSD.

## 7. Lapisan brand dan ilustrasi

Arah anime editorial (DESIGN.md section 11) dipakai bertingkat agar layar uang tetap tenang:

| Tingkat | Layar | Yang tampil |
|---|---|---|
| Penuh | SCR-004, 005, 006; halaman publik; halaman 404 dan layanan-dijeda | Panel brand: tipografi display besar, bidang coral, keterangan kecil dwibahasa, slot maskot (UAR-042, CMP-036) |
| Sedang | SCR-007 Beranda; SCR-012 Panduan; state empty dan first-use di semua daftar | Pita judul bergaya editorial; maskot kecil pada empty state dan checklist (UAR-043, CMP-037) |
| Minimal | SCR-001, 002, 003, 008, 010, 011, 013 sampai 018 | Hanya aksen: label sudut kecil dan warna brand pada judul. Tanpa ilustrasi di dekat nominal, form dan konfirmasi |

Maskot tidak pernah menjadi satu-satunya pembawa informasi: setiap ilustrasi memiliki teks yang setara. Ekspresi maskot boleh mengikuti state (kosong, berhasil, gagal) tetapi pesan error tetap berupa teks. Sampai aset orisinal tersedia (OQ-008), slot menampilkan bentuk geometris netral dan tata letak tetap utuh.

## 8. Keputusan yang belum selesai

- Bahasa antarmuka: menunggu konfirmasi ASM-003. Currency tampilan Rupiah (CONFIRMED); tarif per sejuta token dapat bernilai pecahan Rupiah dan ditampilkan apa adanya, sedangkan saldo dan debit ditampilkan dengan pembulatan tampilan yang tidak mengubah nilai ledger.
- Tema gelap: tidak masuk scope kecuali diminta; bila masuk, seluruh layar diuji pada kedua tema.
- SCR-012 memuat satu bagian per tool target (Hermes, OpenCode, ZCode, Codex, Claude Code); bagian sebuah tool baru tampil setelah fixture-nya lulus, dan menyebut model mana yang dapat dipakai tool itu.
- Kebijakan tampilan request belum final: OQ-006.

<!-- END ROUTER-UX v0.4.0 -->
