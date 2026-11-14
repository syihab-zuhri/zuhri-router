# Design System and Component Specification: Router AI Komersial

Version: 0.2.0
Status: Draft; spesifikasi komponen, belum ada komponen yang dibangun atau diuji
Owner keputusan: founder
Updated: 2026-11-13, Asia/Jakarta
Dependencies: DESIGN.md; UX.md; UI_REFERENCES.md
Evidence: E1. Kolom verifikasi adalah spesifikasi, bukan hasil.

Sumber otoritatif untuk perilaku komponen. Setiap komponen menautkan UAR atau CUSTOM_GAP. API/props final mengikuti stack (ADR-004) dan, pada DIRECT_ADOPTION, mengikuti props yang dideklarasikan sumber; dokumen ini tidak mengarang props UIArc.

## 1. Aturan yang berlaku untuk semua komponen

- Nilai visual hanya dari token DESIGN.md.
- State interaksi yang berlaku: default, hover (pointer halus), focus-visible, pressed, disabled; ditambah invalid dan read-only pada input.
- Nama aksesibel wajib. Kontrol ikon memakai label teks tersembunyi.
- Aksi yang mengubah data: tombol masuk state loading dan menolak klik kedua; hasil ditampilkan setelah jawaban server, tidak optimistis. Pencegahan submit ganda di UI tidak menggantikan idempotency server.
- Hasil aksi diumumkan ke teknologi bantu lewat region status atau alert sesuai tingkat.
- Teks antarmuka berasal dari satu berkas pesan agar bahasa dapat diganti.
- Verifikasi minimum tiap komponen: uji perilaku pada state yang berlaku, navigasi keyboard, pemeriksaan aksesibilitas otomatis, dan tampilan pada 360 px. Katalog komponen (misalnya halaman galeri internal atau alat sejenis) dipilih pada TASK-020.

## 2. Inventaris komponen

| CMP | Komponen | UAR | Dipakai di | Catatan khusus proyek |
|---|---|---|---|---|
| CMP-001 | AppShell dan navigasi | UAR-038 (CUSTOM_GAP), UAR-030 | Semua layar bersesi | Section 3.1 |
| CMP-002 | Button | UAR-011 | Semua | Varian primary, secondary, ghost, danger; ukuran md dan lg |
| CMP-003 | TextField | UAR-007 | Form | Label terlihat, helper, error terhubung |
| CMP-004 | PasswordField | UAR-014 | SCR-004, 005, 006, 013, 016 | Juga untuk memasukkan API key upstream; autocomplete dimatikan pada pemakaian itu |
| CMP-005 | MoneyField | UAR-013 | SCR-002, 003, 008, 015, 016 | Section 3.2 |
| CMP-006 | DecimalField | UAR-012 | SCR-003 (faktor model), SCR-016 (kurs) | Section 3.3 |
| CMP-007 | Select | UAR-022 | Filter, pilihan pendek | – |
| CMP-008 | ModelCombobox | UAR-009 | SCR-003, 008, 016, filter | Menampilkan ID publik dan nama; opsi nonaktif menyebut alasan; pencarian di server |
| CMP-009 | Checkbox | UAR-039 | Pilihan model pada scope key | Hanya untuk pilihan yang dikonfirmasi submit |
| CMP-010 | TextArea | UAR-040 | Alasan adjustment, catatan ketentuan upstream | Batas panjang ditampilkan |
| CMP-011 | OtpField | UAR-035 | Login admin, step-up | Enam digit, mendukung tempel |
| CMP-012 | DataTable | UAR-002, UAR-016 | Semua daftar | Section 3.4 |
| CMP-013 | FilterBar | UAR-024, UAR-025, UAR-031 | Daftar berfilter | Filter tercermin di URL |
| CMP-014 | StatusBadge | UAR-015 | Semua daftar dan detail | Kosakata dan warna dari DESIGN.md section 3; tanpa animasi |
| CMP-015 | MetricCard | UAR-003 | SCR-007, 014, 015 | Menampilkan periode dan waktu pembaruan; state usang dan gagal |
| CMP-016 | UsageMeter | UAR-001 | Batas belanja key, batas global | Label dan angka, bukan hanya batang |
| CMP-017 | SpendChart | UAR-032 | SCR-007, 010, 014, 015 | Tabel alternatif wajib; nilai dari agregat server |
| CMP-018 | Alert | UAR-010 | Semua | Error dan hasil tidak-diketahui menetap sampai ditindak |
| CMP-019 | Toast | UAR-020 | Konfirmasi non-keuangan | Dilarang untuk hasil keuangan dan error |
| CMP-020 | ConfirmDialog | UAR-008 | Aksi berkonsekuensi | Section 3.5 |
| CMP-021 | StepUpDialog | UAR-008, UAR-035 | Aksi admin ber-step-up | Section 3.6 |
| CMP-022 | SecretReveal | UAR-004, UAR-010 | API key baru, kode redeem baru | Section 3.7 |
| CMP-023 | InlineConfirm | UAR-027 | Cabut API key pada baris | Tanpa undo; mode yang menuntut kesengajaan |
| CMP-024 | SidePanel | UAR-028 | Rincian request, form buat key | Punya URL bila rincian perlu dibagikan |
| CMP-025 | RowActions | UAR-029 | Tabel admin | Aksi destruktif terakhir |
| CMP-026 | EmptyState | UAR-017 | Semua daftar | Teks berbeda untuk belum-ada dan tanpa-hasil |
| CMP-027 | LoadingPlaceholder | UAR-018 | Semua | Tidak menampilkan angka lama sebagai terbaru |
| CMP-028 | Tabs | UAR-019 | Detail pelanggan, detail model | Tab aktif tercermin di URL |
| CMP-029 | PageHeader dan Breadcrumb | UAR-036, UAR-037 | Halaman detail | – |
| CMP-030 | CodeSnippet | UAR-026, UAR-004 | SCR-012 | Placeholder key, tidak pernah key nyata |
| CMP-031 | OnboardingChecklist | UAR-033 | SCR-007 | Status dari server |
| CMP-032 | Tooltip | UAR-021 | Kontrol ikon | Tidak memuat informasi wajib |
| CMP-033 | Pagination | UAR-016 | Bagian dari CMP-012 | Halaman di URL |
| CMP-034 | Receipt | UAR-003, UAR-010 | Hasil redeem, tambah saldo, terbit kode | Section 3.8; komposisi dari token, tidak ada padanan tunggal |
| CMP-035 | Progress | UAR-041 | Cadangan; belum ada pemakaian P0 | Tidak dibangun sampai ada kebutuhan |
| CMP-036 | BrandPanel | UAR-042 | SCR-004, 005, 006, halaman publik, 404, layanan-dijeda | Section 3.9 |
| CMP-037 | Illustration (slot maskot) | UAR-043, UAR-017 | Empty state, checklist, BrandPanel | Section 3.10 |

Login dan aktivasi (SCR-004, 005, 006) adalah komposisi CMP-002, 003, 004 dan 018 mengikuti UAR-006 dan UAR-034, bukan komponen tersendiri.

## 3. Spesifikasi rinci

### 3.1 CMP-001 AppShell dan navigasi

Purpose: kerangka portal dan backoffice. Anatomy: tautan lewati-ke-konten, navigasi samping dalam landmark nav berlabel, area konten utama dalam landmark main, bilah atas berisi saldo (portal) dan menu akun.
Behavior: halaman aktif ditandai `aria-current="page"` dan penanda visual accent. Pada lebar di bawah 1024 px navigasi menjadi panel yang dibuka tombol bernama; panel menjebak fokus, tertutup dengan Escape, dan fokus kembali ke tombol. Perpindahan rute memindahkan fokus ke judul halaman.
States: default, panel-terbuka, layanan-dijeda (pita Alert menetap), sesi-berakhir.
Tokens: nav-bg, nav-text-muted, accent.
Verification: urutan tab; fokus panel; penanda aktif terbaca pembaca layar; 360 px tanpa gulir horizontal.

### 3.2 CMP-005 MoneyField

Purpose: memasukkan nominal Rupiah. Nilai yang dikirim adalah string integer unit minor atau desimal yang disepakati kontrak API, bukan angka floating point.
Behavior: awalan `Rp` statis; pemisah ribuan saat mengetik; tempel menerima angka dengan atau tanpa pemisah; tanda minus ditolak; batas atas dari server ditampilkan. Tarif per sejuta token boleh memiliki pecahan; nominal kode dan tambah saldo bilangan bulat Rupiah.
States: default, focus, invalid (di luar batas, bukan angka), disabled, read-only.
Keyboard: keypad numerik pada ponsel.
Verification: tempel berbagai format; nol di depan; nilai maksimum; pembaca layar menyebut nilai dan currency; nilai terkirim cocok dengan yang tampil.

### 3.3 CMP-006 DecimalField

Purpose: faktor model dan kurs. Behavior: menerima desimal dengan jumlah digit pecahan terbatas sesuai kontrak; nilai dikirim sebagai string; batas dan langkah dari konfigurasi server; pesan batas berupa teks. Nol, negatif dan bukan-angka ditolak di klien dan tetap divalidasi server.
Verification: batas bawah dan atas; koma dan titik desimal sesuai locale; pengumuman perubahan.

### 3.4 CMP-012 DataTable

Purpose: semua daftar record. Behavior: pengurutan, filter dan pagination dijalankan server; kepala kolom yang dapat diurutkan adalah tombol dengan `aria-sort`; keterangan tabel menyebut isi dan jumlah hasil. Kolom uang rata kanan dengan tabular-nums. Pada lebar sempit setiap baris menjadi kartu berlabel.
States: loading (CMP-027), empty dan tanpa-hasil (CMP-026), error dengan tombol coba lagi, error-parsial.
Verification: urutan konsisten lintas halaman; filter tenant tidak dapat dilewati dari klien; keyboard pada kepala kolom; tampilan kartu pada 360 px.

### 3.5 CMP-020 ConfirmDialog

Purpose: konfirmasi aksi berkonsekuensi: publish harga, cabut kode, suspend, tutup akun, tambah saldo langsung. Anatomy: judul berupa pertanyaan, ringkasan dampak dengan nilai konkret (nominal, username, versi), tombol batal dan tombol aksi berlabel kata kerja.
Behavior: fokus awal pada tombol batal untuk aksi destruktif; Escape membatalkan; saat menunggu server tombol aksi loading dan dialog tidak dapat ditutup; error tampil di dalam dialog.
Verification: jebakan fokus dan pengembalian fokus; nilai pada ringkasan sama dengan yang dikirim.

### 3.6 CMP-021 StepUpDialog

Purpose: verifikasi ulang admin sebelum aksi keuangan. Behavior: muncul hanya bila server meminta; berisi CMP-011; setelah lolos, aksi asal dilanjutkan sekali tanpa pengguna mengulang form; bila gagal, aksi asal tidak dijalankan. Pesan gagal tidak merinci sisa percobaan.
Verification: aksi asal tidak pernah terkirim dua kali; pembatalan tidak meninggalkan perubahan.

### 3.7 CMP-022 SecretReveal

Purpose: menampilkan API key atau kode redeem tepat sekali. Anatomy: peringatan menetap, nilai dalam monospace yang dapat dipilih, tombol salin, tombol "Saya sudah menyalin".
Behavior: nilai hanya ada di memori halaman, tidak ditulis ke URL, penyimpanan browser, log klien atau analitik; salin gagal menampilkan pesan dan nilai tetap terlihat; menutup tanpa konfirmasi meminta kepastian; setelah ditutup nilai dibuang dari memori.
Verification: nilai tidak ada di URL, storage dan log setelah alur selesai; salin ditolak browser tertangani; keyboard.

### 3.8 CMP-034 Receipt

Purpose: bukti hasil aksi keuangan. Isi: jenis transaksi, nominal, saldo sesudahnya, ID transaksi, waktu dengan zona. Diumumkan lewat region status dan menerima fokus setelah aksi berhasil. Untuk hasil tidak-diketahui, receipt tidak ditampilkan; Alert mengarahkan ke riwayat transaksi.
Verification: nilai sama dengan entri ledger; pengulangan aksi oleh pemilik menampilkan receipt yang sama.

### 3.9 CMP-036 BrandPanel

Purpose: membawa identitas anime editorial pada layar masuk dan halaman publik. Anatomy: bidang cream, kata display sangat besar berwarna brand dengan salinan garis luar yang bertumpuk, bidang coral berisi judul putih, keterangan kecil dwibahasa, label sudut (misalnya versi, status layanan, waktu server), dan slot CMP-037 yang boleh menimpa huruf display.
Behavior: murni presentasi; tidak memuat kontrol selain tautan. Pada lebar sempit panel menjadi pita di atas form dan kata display diperkecil atau dipotong tanpa menggeser form. Kata display dekoratif disembunyikan dari teknologi bantu bila hanya mengulang judul; judul halaman yang sebenarnya tetap satu h1.
Tokens: brand, brand-deep, brand-surface, text-display-xl (DESIGN.md section 11).
Verification: urutan baca tidak terganggu; kontras teks putih di bidang brand-deep; form tetap terlihat tanpa menggulir pada 360 x 640; reduced motion; halaman tetap utuh tanpa gambar.

### 3.10 CMP-037 Illustration

Purpose: slot untuk maskot dan ilustrasi orisinal. Props konseptual: adegan (kosong, tanpa-hasil, berhasil, gagal, dijeda, sambutan), ukuran, teks alternatif atau penanda dekoratif.
Behavior: gambar dimuat malas dengan ukuran tetap agar tata letak tidak bergeser; bila gagal dimuat atau aset belum ada, tampil bentuk geometris netral. Tidak ada animasi berulang. Tidak ditempatkan di dalam dialog konfirmasi, receipt, atau di sebelah nominal.
Aset: hanya berkas yang tercatat di daftar aset dengan sumber dan hak pakai (DESIGN.md section 11.4). Karakter atau karya pihak lain tidak dipakai.
Verification: teks alternatif sesuai adegan; tata letak tanpa gambar; ukuran berkas per gambar di bawah anggaran yang ditetapkan saat implementasi.

## 4. Cakupan dan pending

Semua tipe komponen pada layar SCR-001 sampai SCR-018 memiliki CMP dan UAR atau CUSTOM_GAP. Belum ada: props final, source UIArc yang diperiksa, katalog komponen, dan hasil uji. Komponen dinyatakan selesai hanya pada tahap implementasi dengan bukti verifikasi.

<!-- END ROUTER-DSD v0.2.0 -->
