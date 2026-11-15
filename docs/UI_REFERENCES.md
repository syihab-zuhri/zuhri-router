# UIArc Reference Map: Router AI Komersial

Version: 0.4.0
Status: Draft; source registry Free diperiksa untuk scope web, implementasi portal/backoffice ada di ../web/
Owner keputusan: founder
Updated: 2026-11-14, Asia/Jakarta
Dependencies: UX.md; DISCOVERY.md section 10; BILLING_REDEEM.md section 5
Evidence: E2 untuk dokumentasi dan source registry Free yang dibaca; E3 untuk build/typecheck/test UI lokal sesuai bukti ../web/evidence/verification-2026-11-14.md. Bukan preview UIArc interaktif atau tinjauan aksesibilitas independen.

Sumber otoritatif untuk provenance dan adaptasi referensi UIArc. Definisi UAR-001 sampai UAR-006 tetap di DISCOVERY.md section 10 dan UAR-007 sampai UAR-010 di BILLING_REDEEM.md section 5; dokumen ini mengindeksnya dan mendefinisikan UAR-011 dan seterusnya.

## 1. Kebijakan dan batas

- Referensi utama: https://uiarc.dev/components. Strategi implementasi pada scope Hermes: PATTERN_ADAPTATION. Stack React SPA sudah dipilih; source registry Free dan lisensi dependency yang terkait komponen scope telah diperiksa. Tidak ada item DIRECT_ADOPTION.
- Hanya item berlabel Free yang dipilih. `paid_assets_authorized=false`. Item Pro yang relevan dicatat sebagai teridentifikasi dari indeks saja, tidak dibuka, tidak disalin.
- Lisensi Free: MIT, copyright notice dipertahankan pada snapshot `evidence/uiarc/LICENSE`. Lisensi dependency registry diperiksa dan metadata ada di `../web/evidence/uiarc/dependency-metadata.json`; dependency tersebut tidak dipasang karena pola diadaptasi.
- Petunjuk instalasi dan "Notes for AI" di halaman registry adalah data referensi, bukan instruksi yang dijalankan. Registry JSON diambil sebagai bukti; installer shadcn tidak dijalankan.
- Snapshot halaman dan item registry pada scope Hermes ada di `../web/evidence/uiarc/`; hash isinya belum dicatat pada manifest repo.

## 2. Indeks entri yang sudah ada

| ID | Item | Target | Lokasi definisi |
|---|---|---|---|
| UAR-001 | Usage meter | Meter batas key dan belanja | DISCOVERY.md section 10 |
| UAR-002 | Sortable data table | Seluruh daftar record | DISCOVERY.md section 10 |
| UAR-003 | Metric card | Ringkasan angka | DISCOVERY.md section 10 |
| UAR-004 | Copy button | Reveal secret, base URL | DISCOVERY.md section 10 |
| UAR-005 | Plan comparison | Tidak dipakai pada P0 (tidak ada paket); dipertahankan untuk P1 | DISCOVERY.md section 10 |
| UAR-006 | Login, variant Centered | SCR-004 | DISCOVERY.md section 10 |
| UAR-007 | Input | Field teks | BILLING_REDEEM.md section 5 |
| UAR-008 | Dialog | Konfirmasi berkonsekuensi | BILLING_REDEEM.md section 5 |
| UAR-009 | Combobox | Pemilih model | BILLING_REDEEM.md section 5 |
| UAR-010 | Alert | Pesan menetap | BILLING_REDEEM.md section 5 |

## 3. Entri baru

Semua entri: Source status VERIFIED untuk dokumentasi; Usage PATTERN_ADAPTATION; License/access Free; Dependency impact NONE saat ini (dependency yang tercantum hanya relevan bila diadopsi langsung). Kolom verifikasi tetap spesifikasi per-komponen. Untuk scope web yang benar-benar dibangun, bukti implementasi/browser tercatat di ../web/evidence/verification-2026-11-14.md; ini bukan klaim bahwa semua komponen/UAR telah diimplementasikan atau diuji.

| ID | Item dan URL | Target | Prinsip yang dipakai | Adaptasi proyek | Verifikasi / dependency bila direct |
|---|---|---|---|---|---|
| UAR-011 | Button, https://uiarc.dev/components/button/markdown | Semua aksi tunggal | Tombol native; loading memakai aria-busy dan aria-disabled agar fokus tidak hilang; ikon saja wajib bernama | Aksi keuangan tidak memakai perubahan label optimistis; label berubah hanya setelah server mengonfirmasi | Keyboard, state loading/disabled, target sentuh; motion |
| UAR-012 | Number field, https://uiarc.dev/components/number-field/markdown | SCR-003 faktor model; batas angka non-uang | Spinbutton dengan min/max, pengumuman clamp, peringatan batas memakai teks | Nilai dikirim sebagai string desimal dan divalidasi server; angka JavaScript bukan sumber kebenaran; batas mengikuti konfigurasi FR-001 | Input desimal, clamp, pembaca layar, mobile keypad; motion, lucide-react |
| UAR-013 | Money input, https://uiarc.dev/components/money-input/markdown | SCR-002 nominal kode; SCR-003 tarif dasar; SCR-015 adjustment; batas belanja key | Nilai sebagai integer unit minor; currency dikunci satu kode; inputMode sesuai currency | Currency tunggal sesuai OQ-004; konversi ke unit internal mikro di server; tanpa chip tambah cepat; batas 12 digit dokumentasi diperiksa terhadap nominal maksimum | Paste, nol di depan, nilai maksimum, pembaca layar; motion, lucide-react |
| UAR-014 | Password field, https://uiarc.dev/components/password-field/markdown | SCR-004, SCR-005, SCR-006, SCR-013, login admin | Tombol tampilkan bernama dengan aria-pressed; autocomplete current-password/new-password | String bawaan diterjemahkan ke bahasa produk | Password manager, keyboard; motion |
| UAR-015 | Badge, https://uiarc.dev/components/badge/markdown | Status key, voucher, request, tenant, route, harga | Label menyatakan status tanpa bergantung warna; tidak mengumumkan perubahan sendiri | Kosakata status tetap per entity (UX.md section 5); tanpa morph pada tabel panjang | Kontras, teks status, kepadatan tabel; motion |
| UAR-016 | Pagination, https://uiarc.dev/components/pagination/markdown | Semua daftar berhalaman | Landmark nav, aria-current, kontrol penuh oleh induk | Halaman dan urutan dijalankan server; state halaman di URL | Batas awal/akhir, keyboard, sinkron URL; motion, lucide-react |
| UAR-017 | Empty state, https://uiarc.dev/components/empty-state/markdown | First-use dan tanpa hasil pada semua daftar | Judul, penjelasan, aksi berikutnya; bukan untuk loading atau error | Teks berbeda untuk belum-ada-data dan tanpa-hasil-filter | Nama region, aksi; motion, lucide-react |
| UAR-018 | Skeleton, https://uiarc.dev/components/skeleton/markdown | Loading konten berbentuk diketahui | role status dengan aria-busy | Saldo tidak menampilkan angka lama sebagai seolah terbaru saat memuat ulang gagal | Pengumuman loading, reduced motion; motion |
| UAR-019 | Tabs, https://uiarc.dev/components/tabs/markdown | Tampilan sejajar dalam satu halaman: detail tenant, detail model | Tablist/tab/tabpanel; dokumentasi menyatakan bukan untuk navigasi rute tingkat aplikasi | Tidak dipakai sebagai navigasi utama (lihat UAR-038) | Panah, fokus, overflow sempit; Radix tabs, motion, lucide-react |
| UAR-020 | Toast, https://uiarc.dev/components/toast/markdown | Konfirmasi singkat non-keuangan: disalin, preferensi tersimpan | role status polite; timer tidak berhenti saat hover sehingga pesan harus pendek | Hasil redeem, publish harga, terbit kode dan error tidak memakai toast; memakai receipt atau alert menetap | Pengumuman, posisi mobile; motion, lucide-react |
| UAR-021 | Tooltip, https://uiarc.dev/components/tooltip/markdown | Label kontrol ikon dan teks terpotong | Pelengkap saja; tidak untuk informasi wajib di perangkat sentuh | Penjelasan tarif dan status tidak disembunyikan di tooltip | Fokus keyboard, sentuh; Radix tooltip, motion |
| UAR-022 | Select, https://uiarc.dev/components/select/markdown | Pilihan pendek tetap: state filter, periode preset, bucket cache | Listbox dengan label terhubung | Daftar panjang memakai UAR-009 | Keyboard, label; Radix select, motion, lucide-react |
| UAR-023 | Switch, https://uiarc.dev/components/switch/markdown | Preferensi berdampak rendah yang langsung berlaku | role switch; untuk pengaturan yang berlaku seketika | Tidak dipakai untuk kill switch, enable penjualan model atau eligibility; aksi itu memakai tombol dengan UAR-008 | Nama aksesibel, state; Radix switch, motion |
| UAR-024 | Filter toolbar, https://uiarc.dev/components/filter-toolbar/markdown | SCR-010, SCR-011, SCR-015, SCR-017, SCR-018 | Chip filter dapat dihapus, satu chip per field, perubahan diumumkan | Filter dikirim ke server; daftar nilai pendek; model memakai UAR-009 | Hapus chip dan perpindahan fokus, tumpuk di bawah 520 px; motion, lucide-react |
| UAR-025 | Search field, https://uiarc.dev/components/search-field/markdown | Pencarian daftar tenant, voucher (ID/prefix), request ID | Input search berlabel dengan tombol hapus | Debounce dan pencarian di server; kode redeem mentah tidak pernah dicari | Clear mengembalikan fokus; motion, lucide-react |
| UAR-026 | Code block, https://uiarc.dev/components/code-block/markdown | SCR-012 contoh konfigurasi | Region berlabel, scroll horizontal di dalam blok, salin | Contoh memakai placeholder key; tidak menyisipkan key nyata | Scroll keyboard, salin; motion, lucide-react |
| UAR-027 | Confirm morph, https://uiarc.dev/components/confirm-morph/markdown | Cabut API key pada baris daftar | Konfirmasi di tempat, fokus mengikuti, perlindungan klik ganda, hasil dan error dengan retry | Tanpa undo karena revoke tidak dapat dibalik; memakai mode yang menuntut kesengajaan; aksi keuangan admin tetap memakai UAR-008 | Enter tertahan, pengumuman hasil, ruang pada layar sempit; motion, lucide-react |
| UAR-028 | Drawer, https://uiarc.dev/components/drawer/markdown | Rincian request, rincian voucher, form buat key | Dialog modal bernama, fokus terjebak dan kembali; seret bukan satu-satunya cara menutup | Rincian yang perlu tautan langsung juga punya URL | Escape, fokus kembali, lebar mobile; Radix dialog, motion, lucide-react |
| UAR-029 | Dropdown menu, https://uiarc.dev/components/dropdown-menu/markdown | Aksi baris pada tabel admin | Peran menu, item destruktif terakhir dan menyebut apa yang dihapus | Aksi berizin step-up membuka UAR-008 | Typeahead, item nonaktif; Radix dropdown-menu, motion, lucide-react |
| UAR-030 | User menu, https://uiarc.dev/components/user-menu/markdown | Titik masuk akun di shell | Pemicu bernama, sign out asinkron dengan aria-busy | Tanpa status kehadiran; pengalih tema hanya bila tema gelap masuk scope | Keyboard, lembar bawah di ponsel; motion, lucide-react |
| UAR-031 | Date range picker, https://uiarc.dev/components/date-range-picker/markdown | Filter periode SCR-010, SCR-011, SCR-014, SCR-017 | Preset, draft sampai Apply, grid dengan label tanggal lengkap | Zona waktu periode dinyatakan pada layar; rentang maksimum dibatasi server | Navigasi grid, pengumuman rentang, satu bulan di layar sempit; motion, lucide-react |
| UAR-032 | Bar chart, https://uiarc.dev/components/bar-chart/markdown | Belanja harian SCR-007, SCR-010, SCR-014 | Ringkasan role img, tabel tersembunyi berisi semua nilai, scrub dapat difokus | Nilai dari agregat server dalam unit ledger; grafik bukan sumber angka tagihan | Tabel alternatif cocok dengan agregat; motion |
| UAR-033 | Onboarding checklist, https://uiarc.dev/components/onboarding-checklist/markdown | SCR-007 langkah awal: redeem, buat key, request pertama | Tiga sampai delapan langkah longgar, progres dan error diumumkan | Status langkah dihitung server dari data nyata, bukan dicentang manual | Fokus pindah setelah langkah selesai; motion, lucide-react |
| UAR-034 | Login and sign up, variant Sign up, https://uiarc.dev/components/blocks/signup-form/markdown (halaman multi-variant; hanya section Sign up, baris 543-675 snapshot) | SCR-005 aktivasi undangan | Error field terhubung, error submit role alert, kekuatan password berupa teks | Tanpa tombol provider sosial dan opt-in pemasaran; email berasal dari undangan dan tidak dapat diubah; alur provider pada contoh adalah simulasi | Validasi server, token undangan, keyboard; variant Split dan Immersive pada halaman yang sama berlabel Pro dan tidak dipakai |
| UAR-035 | OTP input, https://uiarc.dev/components/blocks/otp-input/markdown | Kode TOTP admin dan step-up | Grup berlabel, slot bernama, autocomplete one-time-code, paste | Adaptasi satu input native menerima TOTP enam digit atau recovery code 20 karakter sesuai kontrak backend; bukan enam tab stop | Keyboard/assistive tech dan recovery code diverifikasi pada flow integrasi lokal; perilaku registry adalah referensi |
| UAR-036 | Page header, https://uiarc.dev/components/blocks/page-header/markdown | Kepala halaman detail tenant dan model | Breadcrumb dengan aria-current, aksi sekunder pindah ke menu saat sempit | Tanpa avatar grup dan aksi contoh; blok tidak menerima props dan aksinya simulasi sehingga hanya pola yang diambil | Lipatan saat scroll tidak menyembunyikan status |
| UAR-037 | Breadcrumb, https://uiarc.dev/components/breadcrumb/markdown | Halaman detail bertingkat di backoffice | Landmark nav berurutan, item terakhir bukan tautan | Jalur dipendekkan di mobile karena komponen tidak memotong sendiri | Urutan baca, wrap |
| UAR-038 | Navigasi aplikasi (app shell) | Shell portal dan backoffice | – | CUSTOM_GAP, lihat section 4 | Lihat section 4 |
| UAR-039 | Checkbox, https://uiarc.dev/components/checkbox/markdown | Pilihan model pada scope API key (SCR-008) | role checkbox dengan label nyata; untuk pilihan yang dikonfirmasi submit, bukan yang langsung berlaku | Tanpa state indeterminate kecuali ada pilih-semua | Label, keyboard, target sentuh; Radix checkbox, motion |
| UAR-040 | Textarea, https://uiarc.dev/components/textarea/markdown | Alasan adjustment (SCR-015), catatan ketentuan upstream (SCR-016) | Label nyata, error terhubung dan role alert; tidak membesar otomatis | Batas panjang ditampilkan; isi tidak boleh memuat secret dan itu dinyatakan pada helper | Label, batas panjang, pembaca layar; motion |
| UAR-041 | Progress, https://uiarc.dev/components/progress/markdown | Cadangan; belum ada pemakaian P0 | role progressbar untuk progres terukur; bukan live region | Kuota memakai UAR-001, bukan ini | Tidak dibangun sampai ada kebutuhan; motion, lucide-react |
| UAR-042 | Hero section, https://uiarc.dev/components/blocks/hero-section/markdown | Panel brand pada SCR-004, 005, 006 dan halaman publik (CMP-036) | Satu h1; ajakan berupa tautan atau tombol berteks; elemen dekoratif disembunyikan dari teknologi bantu; reduced motion menghilangkan transform | Tanpa kanvas WebGL, tanpa dasbor contoh dan logo pelanggan contoh; komposisi diganti tipografi display dan slot ilustrasi orisinal mengikuti DESIGN.md section 11; tinggi tidak dipaksa satu layar penuh pada halaman form | Urutan baca, kontras teks di atas bidang warna, 360 px; komposisi blok tidak diadopsi |
| UAR-043 | Empty states (block), https://uiarc.dev/components/blocks/empty-states/markdown | Ilustrasi pada empty, tanpa-hasil, 404, layanan-dijeda (CMP-037) | Satu gaya ilustrasi untuk semua momen; ilustrasi role img berlabel; aksi contoh adalah simulasi; satu adegan diambil per layar, bukan galeri bertab | Ilustrasi diganti maskot orisinal; tanpa morph bentuk dan parallax; tetap ada judul, penjelasan dan aksi dari UAR-017 | Label gambar, tampilan tanpa gambar, reduced motion |

## 4. CUSTOM_GAP: navigasi aplikasi

Pencarian: kata kunci sidebar, shell, navigation, nav pada indeks evidence/2026-11-13/uiarc/llms-small.txt. Hasil: Sidebar rail, Workspace sidebar, Docs sidebar, Inbox sidebar dan Morph nav seluruhnya berlabel Pro pada indeks; tidak dibuka dan tidak dipakai. Item Free terdekat yang diperiksa: Tabs (dokumentasinya menyatakan tidak untuk navigasi rute tingkat aplikasi), Site header (ditujukan untuk situs pemasaran menurut deskripsi indeks; halaman tidak dibuka), User menu, Drawer, Breadcrumb.

Status: NO_MATCH pada tier Free untuk shell aplikasi. Rancangan: navigasi samping sederhana dari token proyek dengan daftar tautan dalam landmark nav, penanda halaman aktif lewat aria-current, tautan lewati-ke-konten, dan pada layar sempit berubah menjadi panel yang mengikuti perilaku fokus UAR-028. Titik masuk akun memakai UAR-030. Tidak merekonstruksi tampilan atau perilaku khas item Pro.

Verifikasi: urutan tab, fokus saat panel dibuka dan ditutup, penanda halaman aktif terbaca, tata letak pada 360 px. Dependency: NONE.

## 5. Ditinjau dan tidak dipilih

| Item | Alasan |
|---|---|
| Card (Free) | Ditujukan untuk item jelajah dengan quick look; ringkasan angka memakai UAR-003 |
| Billing overview (Pro) | Teridentifikasi pada evidence awal; tidak diotorisasi |
| Model card, Provider keys, Provider status (Pro) | Hanya terlihat pada indeks; tidak dibuka; kebutuhan serupa dibangun dari UAR-002/003/015 |
| Billing toggle, Radio cards (Free, indeks saja) | Tidak ada paket bulanan/tahunan pada P0 |

## 6. Coverage dan pending

Seluruh layar SCR-001 sampai SCR-018 memiliki UAR pada UX.md section 3, dan seluruh tipe komponen pada DSD.md section 2 memiliki UAR atau CUSTOM_GAP.

Pemeriksaan Hermes 2026-11-14 (sisa TASK-020): source registry Free yang dipakai untuk scope HERMES_TASK.md sudah diambil dan dibaca, termasuk foundation.css dan motion-tokens. Snapshot utuh, metadata dependency dan keputusan per komponen ada di ../web/evidence/uiarc/ dan ../web/README.md. Tidak ada source Pro yang diambil. Seluruh komponen scope ini tetap PATTERN_ADAPTATION, bukan DIRECT_ADOPTION: kontrol native React/HTML, tanpa motion, lucide atau Radix yang terpasang. Lisensi dependency sumber diperiksa (motion MIT, lucide-react ISC, Radix MIT); audit instalasi produk 0 kerentanan, bukan audit pustaka yang tidak dipasang.

Cakupan registry: UAR-001/002/003/004/006/007/008/010/011/012/014/015/016/017/018/022/027/028/030/034/035/039/040/042/043. UAR-005 plan-comparison diperiksa lalu tidak dipakai: paket token ditampilkan sebagai daftar UAR-002, bukan paket langganan. UAR-013 tidak dipakai untuk saldo: TOKEN_CREDIT.md mengharuskan field kredit token; Rupiah hanya harga tampilan paket. Referensi di luar scope tersebut tetap berstatus dokumentasi saja. UAR-038 tetap CUSTOM_GAP.

Temuan yang diadaptasi: foundation source mengecualikan input dari outline dan confirm-morph menghilangkan outline; implementasi proyek wajib mempertahankan cincin fokus semua kontrol. Angka saldo tidak memakai animated-counter/Number. Dialog/drawer memakai dialog native; OTP menjadi satu field enam digit dengan paste dan autocomplete, bukan enam tab stop. Tidak ada demo OAuth/passkey atau demo transaksi yang diperlakukan sebagai backend.

Pemetaan nama foundation (hanya acuan, tidak mengimpor CSS UIArc): --background ke --color-bg; --surface/--surface-raised ke --color-surface; --surface-muted ke --color-surface-muted; --foreground ke --color-text; --text-secondary/--text-muted ke --color-text-muted; --border ke --color-border; --border-strong ke --color-border-control; --accent/--accent-strong ke --color-primary; --accent-foreground ke --color-surface; --danger ke --color-danger; --radius-control ke --radius-control; --radius-panel ke --radius-panel; --duration-fast ke --motion-fast; --duration-standard ke --motion-base. Accent UIArc adalah aksi utama, bukan gold proyek. Skala/font/warna source tidak disalin. Sumber nilai tunggal implementasi adalah ../web/src/tokens.css.

<!-- END ROUTER-UI-REFERENCES v0.4.0 -->
