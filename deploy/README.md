# Deploy: satu server dengan Docker

Status: ditulis 2026-11-14. Image dan compose diuji secara lokal (lihat docs/CHANGELOG.md CR-022); belum pernah dijalankan di server publik. Menjalankannya di server yang dapat diakses publik memerlukan izin founder.

Susunan: Caddy (TLS otomatis) → aplikasi (API, gateway, dan web dari satu origin) → PostgreSQL. Satu instance aplikasi saja: batas laju dan kesehatan rute disimpan di memori proses.

## Syarat

- Server Linux dengan Docker dan plugin compose; port 80 dan 443 terbuka.
- DNS `A` (dan `AAAA` bila ada IPv6) untuk domain mengarah ke server sebelum Caddy dinyalakan, agar sertifikat dapat diterbitkan.

## Langkah

    cp deploy/.env.example deploy/.env      # isi; jangan di-commit
    docker compose -f deploy/compose.yml --env-file deploy/.env up -d --build
    docker compose -f deploy/compose.yml exec app sh -c 'ADMIN_PASSWORD="<password admin, min 14 karakter>" node scripts/bootstrap-admin.ts <username> <email>'

Perintah terakhir mencetak URI autentikator dan kode pemulihan satu kali. Simpan keduanya di luar server.

Periksa: `https://<domain>/readyz` menjawab `{"ok":true}`.

## Sesudah menyala

1. Masuk sebagai admin, daftarkan upstream (base URL dan API key), tandai eligible.
2. Buat model, isi pengali, terbitkan harga, buat route.
3. Buat paket token, undang pelanggan pertama.
4. Kirim satu request sungguhan lewat `https://<domain>/v1/...` dan cocokkan di layar Pemakaian.

## Yang wajib ada sebelum pelanggan nyata

- **Backup**: `sh deploy/backup.sh <folder>` membuat satu berkas dump dan menyimpan 14 hari. Jadwalkan lewat cron (contoh ada di dalam skrip) dan salin berkasnya keluar server; backup di disk yang sama tidak selamat bila disk itu rusak. Pemulihan: `CONFIRM=restore sh deploy/restore.sh <berkas>`, lalu `docker compose ... exec app node scripts/check-invariants.ts` harus keluar tanpa pelanggaran. Dump dan pemulihan sudah diuji lokal dengan alat yang sama (pg_dump, pg_restore); skrip compose-nya sendiri belum dijalankan di server.
- **`APP_SECRET_KEY`** disimpan juga di luar server.
- **Pemantauan**: belum ada alert. Minimal pemeriksa uptime eksternal ke `/readyz` dan pengecekan berkala daftar "request menunggu keputusan".
- **Email**: `MAILER=smtp` dengan app password; tanpa itu undangan tidak terkirim.

## Pembaruan

    git pull
    docker compose -f deploy/compose.yml --env-file deploy/.env up -d --build

Migrasi dijalankan saat start. Stream yang sedang berjalan diberi waktu 60 detik saat container berhenti; sesudah itu terputus dan ditagih sebagai estimasi.

## Bila domain di belakang proxy lain (misalnya Cloudflare)

`TRUST_PROXY` harus sama dengan jumlah proxy di depan aplikasi (Caddy saja = 1; Cloudflare + Caddy = 2). Angka yang salah membuat batas laju keliru: terlalu besar memungkinkan alamat dipalsukan, terlalu kecil menggabungkan semua pelanggan ke satu alamat.
