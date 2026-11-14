# Design: Router AI Komersial

Version: 0.2.0
Status: Draft; arah brand CONFIRMED founder (CR-006): anime editorial digabung dengan design system ini. Nilai token PROPOSED; belum ada implementasi atau tangkapan layar
Owner keputusan: founder
Updated: 2026-11-13, Asia/Jakarta
Dependencies: UX.md; UI_REFERENCES.md; ARCHITECTURE.md ADR-004
Evidence: E1 untuk keputusan desain. Rasio kontras di section 3 dihitung dari nilai hex usulan (evidence/2026-11-13-design/contrast.json); itu aritmetika atas nilai token, bukan pengujian UI yang dirender.

Sumber otoritatif untuk makna dan pemakaian token visual. Sumber nilai token saat implementasi adalah satu file variabel CSS; tabel di dokumen ini adalah nilai awalnya dan setelah file itu ada, file itulah yang diedit.

## 1. Brand dan prinsip

Arah (CONFIRMED founder, CR-006): gabungan dua lapisan. Lapisan sistem: Navy, Blue, Gold untuk semua kontrol, data dan status, seperti direncanakan sejak awal. Lapisan brand: gaya anime editorial mengikuti gambar referensi founder, dengan cream, coral, tipografi display besar dan maskot (section 11). Kepribadian: alat kerja yang dapat dipercaya untuk urusan uang, dengan wajah yang hangat dan khas.

1. Angka uang adalah konten utama. Saldo, debit dan tarif selalu terbaca jelas, rata kanan pada tabel, dengan currency.
2. Status tidak pernah hanya warna. Setiap status punya teks; warna dan ikon memperkuat.
3. Kepadatan sedang. Backoffice boleh lebih padat daripada portal, dengan token yang sama.
4. Gold dipakai hemat: penanda saldo dan hal yang perlu perhatian admin. Coral adalah warna brand untuk tipografi display dan bidang dekoratif; coral tidak pernah menjadi warna tombol, tautan, atau status, agar tidak tertukar dengan merah bahaya.
5. Gerak hanya sebagai umpan balik. Tidak ada animasi yang menunda hasil aksi keuangan.
6. Tanpa emoji. Ilustrasi dan maskot mengikuti tingkat pemakaian di UX.md section 7: penuh di layar masuk dan halaman publik, tidak ada di dekat nominal, form dan konfirmasi.

## 2. Strategi UIArc

UIArc adalah referensi utama (UI_REFERENCES.md). Dengan ADR-004 mengusulkan React, strategi per komponen menjadi salah satu dari dua:

- DIRECT_ADOPTION: untuk item Free yang perilakunya sesuai, setelah source registry, lisensi dependency dan kompatibilitas versi diperiksa (TASK-020). Belum ada item yang berstatus ini.
- PATTERN_ADAPTATION: default saat ini untuk semua item, dan pilihan tetap untuk komponen yang animasinya berlebihan bagi konteks keuangan.

Batas adaptasi yang berlaku pada kedua strategi:
- Efek morph, angka bergulir dan pegas pada nilai uang dimatikan atau disederhanakan; nilai tampil langsung.
- Token UIArc dipetakan ke token semantic proyek di bawah. Hanya ada satu sistem tema; tidak ada dua sumber nilai yang saling menimpa. Pemetaan nama token dilakukan setelah `foundation.css` UIArc dibaca dari registry.
- Notice lisensi dipertahankan pada kode yang diadopsi.

## 3. Warna

Hanya tema terang pada P0. Tema gelap di luar scope sampai diminta.

| Token semantic | Nilai | Pemakaian | Kontras terhitung |
|---|---|---|---|
| `--color-bg` | #F6F8FB | Latar halaman | – |
| `--color-surface` | #FFFFFF | Kartu, tabel, form | – |
| `--color-surface-muted` | #EEF1F6 | Baris kepala tabel, bidang nonaktif | – |
| `--color-text` | #0F172A | Teks utama | 17,85 di surface; 16,78 di bg |
| `--color-text-muted` | #475569 | Teks pendukung, label sekunder | 7,58 di surface; 7,12 di bg |
| `--color-text-disabled` | #64748B | Teks kontrol nonaktif | 4,2 di surface-muted |
| `--color-border` | #D5DCE6 | Garis pemisah dekoratif | 1,38; bukan batas kontrol |
| `--color-border-control` | #76849A | Batas input dan kontrol | 3,79 di surface |
| `--color-primary` | #1D4ED8 | Tombol utama, tautan, fokus | 6,7 terhadap putih, dua arah |
| `--color-primary-hover` | #1E40AF | Hover dan pressed tombol utama | 8,72 untuk teks putih |
| `--color-nav-bg` | #0B1F3A | Latar navigasi (navy) | Putih 16,52 |
| `--color-nav-text-muted` | #B6C2D6 | Tautan navigasi tidak aktif | 9,18 di nav-bg |
| `--color-accent` | #F2C14E | Penanda aktif dan fokus di atas navy | 9,84 di nav-bg |
| `--color-accent-text` | #8A5A00 | Teks gold di latar terang | 5,93 di surface |
| `--color-accent-bg` | #FFF6DB | Latar sorotan perhatian | accent-text 5,49 |
| `--color-success-text` / `-bg` | #166534 / #E8F6EC | Berhasil, aktif, layak | 6,39 |
| `--color-warning-text` / `-bg` | #92400E / #FEF3C7 | Perlu perhatian, usang, belum final | 6,37 |
| `--color-danger-text` / `-bg` | #991B1B / #FDECEC | Gagal, dicabut, diblokir | 7,28 |
| `--color-danger` | #991B1B | Tombol destruktif, teks error di surface. Digelapkan agar jelas berbeda dari coral brand | 8,31 terhadap putih, dua arah |
| `--color-info-text` / `-bg` | #1E40AF / #E8EEFD | Informasi netral, draf | 7,51 |
| `--color-neutral-text` / `-bg` | #334155 / #EEF1F6 | Status netral, kedaluwarsa, ditutup | 9,15 |

Semua pasangan teks di atas melampaui 4,5:1 kecuali teks nonaktif, yang memang tidak diwajibkan. Batas kontrol ditargetkan minimal 3:1 terhadap surface. Angka ini harus diverifikasi ulang pada UI yang dirender, termasuk state hover dan fokus.

Pemetaan status ke warna (teks status dari UX.md section 5):

| Kelompok | Status |
|---|---|
| success | Aktif, Selesai, Terbit, Layak, Ditukar |
| warning | Belum final, Menunggu tinjauan, biaya atau kurs usang |
| danger | Gagal, Dicabut, Diblokir, Ditangguhkan |
| info | Draf, Berjalan |
| neutral | Kedaluwarsa, Dibatalkan, Ditutup, Ditarik |

## 4. Tipografi

Font sistem, tanpa unduhan font: `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`. Monospace untuk key, kode redeem, request ID dan contoh konfigurasi: `ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace`. Dependency impact: NONE.

| Token | Ukuran / tinggi baris / bobot | Pemakaian |
|---|---|---|
| `--text-xs` | 12 / 16 / 500 | Badge, keterangan tabel |
| `--text-sm` | 14 / 20 / 400 | Isi tabel, teks pendukung |
| `--text-base` | 16 / 24 / 400 | Isi utama dan semua input (mencegah zoom otomatis pada ponsel) |
| `--text-lg` | 18 / 28 / 600 | Judul kartu, judul dialog |
| `--text-xl` | 24 / 32 / 600 | Judul halaman |
| `--text-display` | 32 / 40 / 600 | Saldo dan angka ringkasan utama |

Angka uang dan token memakai `font-variant-numeric: tabular-nums`. Format angka mengikuti locale Indonesia (pemisah ribuan titik) dengan awalan `Rp`; kode dan ID tidak diformat.

## 5. Spasi, tata letak dan bentuk

- Skala spasi berbasis 4 px: 4, 8, 12, 16, 24, 32, 48. Nilai optik di luar skala diperbolehkan dengan alasan.
- Radius: 6 px kontrol, 10 px kartu dan dialog, penuh untuk badge.
- Elevasi: kartu memakai batas 1 px tanpa bayangan; hanya dialog, panel samping dan menu yang memakai bayangan.
- Target sentuh minimal 44 px pada layar sempit; kontrol padat backoffice minimal 32 px pada pointer halus.
- Lebar konten maksimum 1200 px; form satu kolom dengan lebar maksimum 560 px.

Breakpoint berdasar konten:

| Nama | Lebar | Perubahan |
|---|---|---|
| sempit | 360 sampai 639 px | Navigasi menjadi panel; tabel menjadi daftar bertumpuk; aksi utama selebar layar |
| sedang | 640 sampai 1023 px | Navigasi tetap panel; tabel bergulir di dalam wadah |
| lebar | 1024 px ke atas | Navigasi samping tetap; tabel penuh |

## 6. Ikon dan gambar

Ikon garis sederhana dari satu set. Bila DIRECT_ADOPTION dipakai, set mengikuti yang dibawa komponen (lucide-react pada dokumentasi UIArc) setelah vetting; bila tidak, set dipilih pada TASK-020. Ikon selalu didampingi teks kecuali pada kontrol ikon yang memiliki nama aksesibel. Tidak ada foto atau ilustrasi pada P0.

## 7. Gerak

| Token | Nilai | Pemakaian |
|---|---|---|
| `--motion-fast` | 120 ms | Hover, fokus, tekan |
| `--motion-base` | 200 ms | Buka/tutup menu, dialog, panel |

Easing standar keluar-melambat. Pada `prefers-reduced-motion`, transisi posisi dan skala dihilangkan dan hanya perubahan opasitas singkat yang tersisa. Tidak ada gerak otomatis berulang selain indikator loading.

## 8. Fokus dan state interaksi

- Cincin fokus 2 px `--color-primary` dengan jarak 2 px di latar terang; `--color-accent` di atas navy. Fokus selalu terlihat pada navigasi keyboard.
- Hover hanya pada pointer halus. Disabled memakai teks nonaktif dan surface-muted, tetap terbaca sebagai kontrol.
- Invalid: batas danger, pesan teks di bawah field, ikon opsional; tidak hanya warna.

## 9. Verifikasi

Sebelum task UI dinyatakan selesai: kontras diukur pada UI yang dirender untuk setiap pasangan token yang dipakai; reflow pada 360 px dan zoom 200%; reduced-motion; fokus terlihat pada semua kontrol; tidak ada nilai warna, ukuran atau durasi di komponen yang tidak berasal dari token.

## 10. Belum diputuskan

- Nilai persis coral dan cream setelah diukur dari berkas sumber gambar, bukan perkiraan.
- Nama produk, logo, maskot dan sumber asetnya (OQ-008).
- Font display dan lisensinya (TASK-028).
- Pemetaan nama token ke token UIArc (setelah registry dibaca).

## 11. Lapisan brand: anime editorial

### 11.1 Analisis gambar referensi

Sumber: `Portrait Version.jpg` di root proyek, diberikan founder (CR-006); 736 x 1308 px, tampil terputar 90 derajat. Semua nilai di bawah ESTIMATED dari pengamatan visual, confidence sedang; tidak ada alat pengambil warna pada sesi ini.

| Aspek | Yang terlihat |
|---|---|
| Tata letak | Poster editorial: bidang cream lebar dan satu pita coral penuh di satu sisi; karakter di tengah menimpa huruf |
| Tipografi | Satu kata display sangat besar, tebal, sans geometris, berwarna coral, dengan salinan garis luar putih yang menimpa ilustrasi; judul putih di pita coral memadukan bobot tipis dan sangat tebal; ejaan fonetik kecil; keterangan kecil dwibahasa Inggris dan Indonesia |
| Detail | Label sudut kecil berisi waktu, tanggal, suhu dan lokasi; tanda kecil seperti ikon dan tiga titik; goresan aksen di sekitar karakter |
| Warna | Cream kira-kira #FFF6EF; coral kira-kira #CD5358; putih; merah muda lembut pada ilustrasi |
| Ilustrasi | Karakter anime bergaris bersih dengan pewarnaan datar dan bayangan sederhana |
| Tidak terlihat | State interaksi, perilaku responsive, tema gelap, komponen UI. Semuanya diturunkan dari design system, bukan dari gambar |

Karakter pada gambar berasal dari karya pihak lain (teks pada gambar menyebut nama dan afiliasi karakter). Karakter itu, namanya dan gambarnya tidak dipakai dan tidak ditiru pada produk. Yang diambil hanya bahasa visualnya: komposisi poster, skala tipografi, palet, keterangan dwibahasa dan label sudut.

### 11.2 Token brand

| Token | Nilai | Pemakaian | Kontras terhitung |
|---|---|---|---|
| `--color-brand` | #CD5358 (ESTIMATED) | Kata display besar, bidang dekoratif, garis aksen | 3,96 di brand-surface: hanya untuk teks besar dan elemen grafis |
| `--color-brand-deep` | #B23A48 | Bidang yang memuat teks putih berukuran biasa; teks brand kecil di latar terang | Putih 5,85; 5,48 di brand-surface |
| `--color-brand-surface` | #FFF6EF (ESTIMATED) | Latar layar tingkat penuh dan pita judul | Teks utama navy 15,48; muted 7,1; primary 6,28 |
| `--text-display-xl` | Mengisi lebar wadah, minimal 64 px, bobot 800 ke atas | Kata display pada BrandPanel | – |

Teks putih berukuran biasa tidak diletakkan di atas `--color-brand` (4,22); pakai `--color-brand-deep`. Kontrol di atas brand-surface tetap memakai token sistem; batas kontrol 3,55 di sana.

### 11.3 Aturan gabungan

- Sistem memimpin fungsi: tombol utama tetap blue, navigasi tetap navy, saldo tetap gold, status tetap dari section 3.
- Brand memimpin suasana: latar cream dan tipografi coral pada layar tingkat penuh dan sedang; pada layar tingkat minimal hanya label sudut dan aksen judul.
- Keterangan dwibahasa (Indonesia dan Inggris) hanya dekoratif pada panel brand; teks fungsional memakai satu bahasa antarmuka.
- Label sudut memuat informasi nyata dan berguna, misalnya status layanan, versi, atau waktu server. Tidak ada angka hiasan yang dapat dikira data.
- Garis luar huruf yang menimpa ilustrasi adalah dekorasi dan disembunyikan dari teknologi bantu.
- Tidak ada gerak berulang pada maskot. Gerak masuk satu kali boleh, dan hilang pada reduced motion.

### 11.4 Maskot dan aset

- Maskot dan semua ilustrasi adalah karya orisinal yang hak pakainya dimiliki founder: dibuat sendiri, dipesan dari ilustrator dengan pengalihan atau lisensi tertulis, atau dilisensikan. Sumbernya belum diputuskan (OQ-008).
- Setiap berkas tercatat pada daftar aset: nama berkas, pembuat, tanggal, dasar hak pakai, batas pemakaian. Berkas tanpa catatan tidak masuk repo.
- Tidak memakai karakter, logo, atau gambar dari anime, game, atau karya pihak lain, dan tidak membuat tiruan yang dapat dikenali sebagai karakter tersebut.
- Gambar referensi tetap di root sebagai acuan gaya dan tidak ikut dibangun ke aplikasi.
- Adegan minimum untuk P0: sambutan, kosong, tanpa-hasil, berhasil, gagal, dijeda. Gaya: garis bersih, pewarnaan datar, palet brand ditambah warna kulit dan rambut yang dipilih ilustrator.

### 11.5 Font display

Gaya referensi membutuhkan sans geometris sangat tebal, yang tidak dijamin ada pada font sistem. Kandidat font dan lisensinya dipilih lewat TASK-028; sampai itu, kata display memakai font sistem pada bobot paling tebal yang tersedia. Font isi tetap font sistem (section 4). Menambah satu berkas font display adalah satu-satunya dependency visual baru yang direncanakan.

<!-- END ROUTER-DESIGN v0.2.0 -->
