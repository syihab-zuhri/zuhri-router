# Matriks state UX (Hermes Tahap sepuluh)

Kerangka dibuat Claude dari tabel layar `docs/UX.md` (SCR-004 sampai SCR-018), kolom state. Hermes mengisi kolom Penerapan dan Test. Penerapan: berkas dan fungsi, atau "belum", atau "tidak berlaku" dengan alasan. Test: berkas dan nama test yang memeriksa teks atau role yang terlihat untuk state itu, atau "belum". Status: `teruji`, `ada tanpa test`, `belum`, `butuh server`, atau `tidak berlaku`.

Jumlah state: 82.

## SCR-004 Masuk

| State | Penerapan | Test | Status |
|---|---|---|---|
| submitting | | | |
| kredensial-salah (pesan seragam) | | | |
| dibatasi dengan waktu tunggu | | | |
| server-error | | | |

## SCR-005 Aktivasi Undangan

| State | Penerapan | Test | Status |
|---|---|---|---|
| token-valid | | | |
| username-sudah-dipakai | | | |
| username-tidak-valid | | | |
| token-kedaluwarsa/terpakai (arahan hubungi admin) | | | |
| submitting | | | |
| password-lemah | | | |
| berhasil lalu masuk | | | |

## SCR-006 Pemulihan Akses

| State | Penerapan | Test | Status |
|---|---|---|---|
| terkirim (pesan sama untuk semua email) | | | |
| token-tidak-valid | | | |
| submitting | | | |
| berhasil | | | |

## SCR-007 Beranda

| State | Penerapan | Test | Status |
|---|---|---|---|
| loading | | | |
| first-use (checklist) | | | |
| saldo-nol (ajakan isi saldo) | | | |
| data-usang dengan waktu pembaruan | | | |
| layanan-dijeda | | | |

## SCR-008 API Key

| State | Penerapan | Test | Status |
|---|---|---|---|
| empty | | | |
| creating | | | |
| secret-sekali-tampil (peringatan tidak dapat dilihat lagi) | | | |
| salin-gagal | | | |
| batas-jumlah | | | |
| mencabut | | | |
| dicabut | | | |
| gagal/hasil-tidak-diketahui | | | |

## SCR-009 Model dan Harga

| State | Penerapan | Test | Status |
|---|---|---|---|
| loading | | | |
| empty (belum ada model dijual) | | | |
| model-dijeda | | | |

## SCR-010 Pemakaian

| State | Penerapan | Test | Status |
|---|---|---|---|
| loading | | | |
| empty | | | |
| tanpa-hasil-filter | | | |
| belum-final (unresolved) | | | |
| error-parsial (grafik gagal, daftar tetap) | | | |

## SCR-011 Transaksi

| State | Penerapan | Test | Status |
|---|---|---|---|
| loading | | | |
| empty | | | |
| tanpa-hasil-filter | | | |

## SCR-012 Panduan Integrasi

| State | Penerapan | Test | Status |
|---|---|---|---|
| belum-ada-key (tautan buat key) | | | |

## SCR-013 Akun dan Keamanan

| State | Penerapan | Test | Status |
|---|---|---|---|
| submitting | | | |
| password-lama-salah | | | |
| sesi-dicabut | | | |
| konfirmasi tutup akun | | | |

## SCR-014 Ringkasan Operasi

| State | Penerapan | Test | Status |
|---|---|---|---|
| loading | | | |
| data-usang | | | |
| biaya-unknown ditandai | | | |
| layanan-dijeda | | | |
| mengubah-flag | | | |
| gagal | | | |
| panel jeda layanan di Ringkasan Operasi | | | |

## SCR-015 Pelanggan

| State | Penerapan | Test | Status |
|---|---|---|---|
| empty | | | |
| tanpa-hasil | | | |
| username-tidak-ditemukan | | | |
| mengundang | | | |
| undangan-terkirim/gagal-kirim | | | |
| konfirmasi-tambah-saldo (username dan nominal) | | | |
| saldo-ditambah (receipt) | | | |
| hasil-tidak-diketahui | | | |
| ditangguhkan | | | |
| konflik | | | |
| gagal | | | |

## SCR-016 Upstream dan Route

| State | Penerapan | Test | Status |
|---|---|---|---|
| empty | | | |
| pending/blocked/eligible | | | |
| base-URL-ditolak (alasan) | | | |
| key-tersimpan (tersamar, hanya dapat diganti) | | | |
| menguji | | | |
| uji-lulus/gagal/tidak-tersedia | | | |
| cost-usang | | | |
| kurs-usang | | | |
| circuit-terbuka | | | |
| konflik | | | |
| gagal | | | |

## SCR-017 Request dan Rekonsiliasi

| State | Penerapan | Test | Status |
|---|---|---|---|
| loading | | | |
| empty | | | |
| tanpa-hasil | | | |
| menyelesaikan | | | |
| sudah-diselesaikan (replay) | | | |
| gagal | | | |

## SCR-018 Audit

| State | Penerapan | Test | Status |
|---|---|---|---|
| loading | | | |
| empty | | | |
| tanpa-hasil | | | |
