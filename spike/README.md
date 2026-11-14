# Spike TASK-006: gateway percobaan

Status: selesai dijalankan 2026-11-13. BUKAN kode produksi dan tidak boleh dikembangkan menjadi produksi apa adanya.

Tujuan: membuktikan bahwa stack ADR-004 (TypeScript di Node.js, PostgreSQL) sanggup menjalankan relay stream, pembatalan, admission atomik, fallback dan settlement sesuai `docs/ARCHITECTURE.md` section 2, 3 dan 10, pada dua permukaan protokol.

## Yang ada

| Berkas | Isi |
|---|---|
| `src/money.ts` | Hitung debit dan hold dengan BigInt unit mikro-IDR; satu pembulatan |
| `src/gateway.ts` | Gateway: autentikasi key, admission dengan hold, routing per model dan protokol, fallback sebelum byte pertama, relay SSE, settlement idempotent |
| `src/mock-upstream.ts` | Upstream tiruan untuk format Chat Completions dan Anthropic Messages, dengan mode gagal |
| `test/spike.test.ts` | 14 test |
| `bench.ts`, `bench-result.json` | Pengukuran overhead |
| `test-result.txt` | Keluaran test terakhir |

Tanpa framework HTTP; satu dependency (`pg` 8.23.1). TypeScript dijalankan langsung oleh Node tanpa langkah build.

## Menjalankan

    docker run -d --name router-spike-pg -e POSTGRES_PASSWORD=spike_local_only -e POSTGRES_DB=spike -p 127.0.0.1:55432:5432 postgres:18
    npm install
    npm test
    npm run bench

Kata sandi database di atas hanya untuk container lokal yang terikat ke 127.0.0.1. Lingkungan saat dijalankan: Node v24.21.0, PostgreSQL 18 di Docker, WSL2.

## Hasil test

14 dari 14 lulus, tiga kali berturut-turut. Yang dibuktikan pada upstream tiruan:

- Stream diteruskan tanpa mengubah satu byte pun; usage mentah tidak dikalikan.
- Usage format Chat Completions (total input termasuk cache) dan format Anthropic (input sudah eksklusif) menghasilkan debit yang sama, Rp102, cocok dengan contoh di `docs/BILLING_REDEEM.md` section 2.3.
- Usage yang tidak konsisten ditolak normalizer, bukan ditebak.
- Pembulatan sekali setelah semua kategori dijumlahkan.
- Request paralel tidak melampaui saldo selama hold menutupi pemakaian.
- Fallback: rute pertama 503, rute kedua tidak mengirim byte pertama sampai batas waktu, rute ketiga berhasil; satu debit, tiga attempt tercatat.
- Semua rute gagal: satu error terstruktur, tanpa debit.
- Error 400 dari upstream diteruskan tanpa fallback dan tanpa debit.
- Gagal setelah stream mulai: tidak ada fallback; di-settle sebagai estimasi, bukan nol.
- Usage nol: tanpa debit, hold dilepas penuh.
- Klien memutus di tengah stream: upstream menerima pembatalan; tepat satu debit.
- Model tidak dijual dan key salah ditolak sebelum ada hold.
- Model yang hanya punya rute Chat Completions tidak dilayani di permukaan Anthropic.
- Setelah tiap skenario: saldo sama dengan jumlah entri ledger, tidak ada hold tersisa, tidak ada koneksi database bocor.

## Temuan

1. Bug nyata tertangkap test: jalur penolakan saat admission (saldo kurang, model tidak ada) keluar tanpa melepas koneksi database. Di bawah beban, pool habis dan settlement macet. Diperbaiki dengan `finally`. Untuk produksi: semua pemakaian koneksi lewat satu pembungkus transaksi, dan test wajib memeriksa koneksi bocor.
2. RSK-009 terbukti dapat terjadi: bila upstream melaporkan token input lebih banyak daripada estimasi dari ukuran body, debit melebihi hold dan saldo menjadi negatif (ada test khusus). Perilaku saat ini sesuai dokumen: pemakaian tetap didebit penuh dan request berikutnya ditolak. Untuk produksi estimasi input harus lebih kuat daripada "ukuran body dibagi dua", misalnya menghitung token secara lokal atau memakai batas konteks model.
3. Overhead (lihat `bench-result.json`; satu mesin, loopback, upstream tiruan yang menjawab seketika, PostgreSQL di Docker; bukan uji kapasitas):
   - Berurutan: waktu sampai byte pertama p50 sekitar 0,9 ms langsung dan 9,2 ms lewat gateway; p95 1,6 ms dan 11,7 ms. Tambahan sekitar 8 sampai 10 ms per request, hampir seluruhnya dari round trip database (cari key, admission, baca rute, catat attempt, ubah state).
   - 20 bersamaan pada SATU akun: p50 73 ms, p95 423 ms, sekitar 150 request per detik. Penyebabnya penguncian baris akun yang membuat admission dan settlement satu tenant berjalan bergiliran. Antar-tenant tidak saling mengunci, tetapi itu belum diukur.
   - Untuk produksi: kurangi round trip (gabungkan query, cache key dan rute di memori dengan masa berlaku pendek), ukur dengan banyak tenant, dan tetapkan NFR-002 dari pengukuran itu.
4. Runtime: pembatalan lewat AbortSignal sampai ke upstream; relay dengan backpressure berjalan; Node menjalankan TypeScript tanpa build. Tidak ditemukan alasan untuk meninggalkan ADR-001 atau ADR-004.

## Yang tidak dicakup

Respons non-stream; permukaan Responses; upstream nyata; lebih dari satu instance gateway; batas laju; circuit breaker; batas diam (idle) stream; margin guard; snapshot harga saat harga berubah di tengah request; pemulihan setelah proses mati di antara debit dan pencatatan; banyak tenant; TLS; apa pun dari portal dan backoffice.
