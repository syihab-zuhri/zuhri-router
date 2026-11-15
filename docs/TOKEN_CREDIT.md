# Model Saldo Kredit Token

Version: 0.4.0
Status: Draft; arah CONFIRMED founder (CR-013), rincian PROPOSED
Owner keputusan: founder
Updated: 2026-11-15, Asia/Jakarta
Dependencies: BILLING_REDEEM.md; ARCHITECTURE.md; PLANNING.md
Evidence: E3 untuk bagian yang sudah diimplementasikan dan diuji di ../server/ (unit saldo, harga dengan multiplier saja, batas lebih-pakai). Paket token dan redeem ada di backend; UI belum.

Dokumen ini otoritatif untuk unit saldo dan cara tagih. Bila BILLING_REDEEM.md, ARCHITECTURE.md ADR-005, PLANNING.md atau dokumen lain menyebut saldo Rupiah, mikro-IDR, tarif Rupiah per kategori, atau margin dalam Rupiah, yang berlaku adalah dokumen ini. Dokumen-dokumen itu belum ditulis ulang; rumus, idempotency, snapshot harga, voucher sekali pakai dan aturan usage nol/hilang di dalamnya tetap berlaku dengan unit yang diganti.

## 1. Sumber

Diagram founder 2026-11-14, dibaca dari berkas mxGraph yang ditempelkan:

- Pelanggan membeli token, contoh 100.000.000 token.
- Harga pada display, contoh 10.000 (Rupiah), bisa berubah sewaktu-waktu.
- Token didapat dari kode redeem yang diberikan sistem atau admin, bernilai jumlah token yang dibeli.
- Saldo bisa dipakai untuk semua model (contoh GPT, DeepSeek, Claude dan lain-lain).
- Multiplier per nama model yang disediakan admin: x1 berarti tanpa pengali; x2 berarti token yang terbaca sistem dikali 2; boleh desimal.
- Pelanggan bisa memakai lebih sampai 500.000 token sebelum dihentikan paksa oleh sistem.

## 2. Aturan

| Hal | Aturan | Status |
|---|---|---|
| Unit saldo | Kredit token. Satu saldo untuk semua model | CONFIRMED |
| Unit internal | Integer mikro-kredit (sepersejuta kredit token), agar pengali desimal tetap eksak | PROPOSED, diimplementasikan |
| Tagihan per request | Token yang terbaca dikali pengali model, dibulatkan sekali | CONFIRMED |
| Token yang dihitung | Input, output, cache read dan cache write, masing-masing berbobot 1 kredit per token secara default. Admin dapat memberi bobot berbeda per kategori pada harga model | Default mengikuti diagram; bobot per kategori PROPOSED |
| Pengali | String desimal 0,1 sampai 100, maksimal 4 angka pecahan; per model; berversi; harga terbit immutable | Rentang PROPOSED |
| Rupiah | Hanya harga tampilan paket dan catatan penjualan. Tidak ada saldo Rupiah di ledger | CONFIRMED |
| Paket token | Nama, jumlah token, harga tampilan; dapat diubah kapan saja tanpa memengaruhi saldo yang sudah dibeli | CONFIRMED; backend diimplementasikan |
| Kode redeem | Bernilai jumlah token; jenis SALE atau PROMO | CONFIRMED; backend diimplementasikan |
| Lebih-pakai | Saldo boleh turun sampai minus 500.000 kredit. Request baru butuh saldo tersedia di atas nol; hold-nya boleh menjangkau batas itu. Nilai dapat diubah admin dengan step-up dan diaudit | Angka CONFIRMED; aturan admission PROPOSED, diimplementasikan |
| Henti paksa di tengah stream | Gateway memutus stream saat pemakaian berjalan melewati saldo ditambah batas lebih-pakai | Belum diimplementasikan (TASK-012) |
| Batas belanja API key | Dalam kredit token | Mengikuti unit |
| Batas tagihan input | Input yang ditagih tidak melebihi ukuran request pelanggan dalam byte; kelebihan dari upstream dicatat tidak ditagih | CONFIRMED (CR-018), diimplementasikan |
| Pengembalian | Tidak ada pengembalian uang. Pembelian token final; saldo tidak dapat diuangkan. Sisa saldo saat akun ditutup hangus; catatan ledger tetap ada dan tidak dihapus. Pernyataan ini ditampilkan sebelum pembelian/redeem dan pada dialog tutup akun | CONFIRMED founder 2026-11-15 (CR-035); teks antarmuka belum |

## 3. Akibat yang perlu diketahui founder

- Upstream menagih output beberapa kali lebih mahal daripada input, dan sebagian memberi diskon cache. Dengan bobot seragam, pelanggan yang pemakaiannya berat di output lebih mahal bagi usaha daripada yang berat di input, padahal keduanya membayar sama. Pengali model harus ditetapkan dari skenario terburuk (semua output), atau bobot output dinaikkan. Mesin harga sudah mendukung keduanya.
- Margin tidak lagi dapat dibaca langsung dari tarif. Margin guard (TASK-003) harus membandingkan nilai Rupiah satu kredit (dari harga paket yang berlaku, termasuk promo) dengan biaya upstream per token dikali kurs. Karena harga paket bisa berubah dan saldo lama dibeli dengan harga lama, guard memakai nilai kredit terendah yang masih beredar atau nilai yang ditetapkan admin.
- Utang lebih-pakai: pelanggan yang berhenti setelah saldo minus meninggalkan kerugian sampai 500.000 kredit dikali pengali terkecil. Top-up berikutnya menutup minus itu lebih dulu.
- Larangan klausula baku: UU 8/1999 tentang Perlindungan Konsumen Pasal 18 ayat (1) huruf c melarang klausula baku yang menyatakan pelaku usaha berhak menolak menyerahkan kembali uang yang dibayarkan konsumen, dan ayat (3) menyatakan klausula semacam itu batal demi hukum. Aturan "tidak ada pengembalian" di atas karena itu dapat tidak berlaku bila disengketakan, terutama bila layanan tidak dapat diberikan (misalnya semua upstream gagal lama). Founder sudah diberi tahu (2026-11-15); peninjauan oleh ahli hukum disarankan sebelum penjualan luas. Ini catatan risiko, bukan nasihat hukum.
- Promo paling sederhana pada model ini adalah paket dengan token lebih banyak pada harga yang sama, atau kode redeem bernilai token tanpa penjualan. Keduanya tidak memerlukan mekanisme diskon tersendiri; cukup dicatat sebagai promo pada alasan penerbitan agar terpisah dari penjualan.

## 4. Yang digantikan

ADR-005 (saldo Rupiah, mikro-IDR) dan OQ-004 ditutup ulang dengan keputusan ini. OQ-009 (bentuk promo) terjawab sebagian oleh butir terakhir section 3 dan menunggu konfirmasi founder. Contoh Rp68 menjadi Rp102 di BILLING_REDEEM.md section 2.3 tetap sah sebagai uji aritmetika mesin harga, bukan sebagai model tagihan produk.

<!-- END ROUTER-TOKEN-CREDIT v0.4.0 -->
