# Deploy: satu server dengan Docker

Status: ditulis 2026-11-14. Image dan compose diuji secara lokal (lihat docs/CHANGELOG.md CR-022); belum pernah dijalankan di server publik. Menjalankannya di server yang dapat diakses publik memerlukan izin founder.

Susunan: Caddy (TLS otomatis) → aplikasi (API, gateway, dan web dari satu origin) → PostgreSQL. Satu instance aplikasi saja: batas laju dan kesehatan rute disimpan di memori proses.

## Dua susunan

- `compose.yml`: Caddy mengurus HTTPS; butuh port 80 dan 443 serta DNS langsung ke server.
- `compose.tunnel.yml`: aplikasi hanya pada `127.0.0.1:${APP_PORT}`; dibuka lewat Cloudflare Tunnel atau proxy lokal. Image dimuat dengan `docker save | ssh ... docker load`, tidak dibangun di server. Susunan inilah yang terpasang di VPS founder (CHANGELOG CR-028).

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
- **Pemantauan**: bot Telegram (lihat di bawah) mengirim peringatan dan menjawab `/status`. Bot berjalan di dalam server yang sama, jadi ia tidak dapat memberi tahu bila server itu sendiri mati; pasang juga pemeriksa uptime eksternal ke `/readyz`.
- **Email**: `MAILER=smtp` dengan app password; tanpa itu undangan tidak terkirim.

## Bot Telegram

1. Di Telegram, buat bot lewat @BotFather dan salin tokennya.
2. Kirim pesan apa saja ke bot itu dari akun (atau grup) yang akan menerima peringatan, lalu ambil chat id-nya, misalnya dari `https://api.telegram.org/bot<token>/getUpdates`.
3. Isi `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_CHAT_ID` di `deploy/.env`, lalu nyalakan ulang aplikasi.

Bot hanya membaca. Ia mengirim: server menyala, kode redeem diterbitkan atau dicabut, tambah saldo dan koreksi, admin masuk, perubahan upstream dan harga, upstream bermasalah (termasuk saldo upstream habis), semua rute gagal untuk sebuah model, request menunggu keputusan, dan saldo tidak cocok dengan ledger. Perintah: `/status`. Hanya chat dengan id yang dikonfigurasi yang dijawab. Pesan tidak pernah memuat API key, kode redeem, atau isi percakapan.

## Backup ke Google Drive

1. Pasang rclone di server dan jalankan `rclone config` sekali: buat remote bertipe Google Drive (misalnya bernama `gdrive`) dengan akun Google Anda sendiri.
2. Jadwalkan: `15 * * * *  cd /srv/zrouter && RCLONE_REMOTE=gdrive:zrouter-backups sh deploy/backup.sh /srv/zrouter-backups`.

Berkas di Drive yang lebih tua dari 30 hari dihapus oleh skrip. Dump berisi seluruh database, termasuk email pelanggan dan API key upstream dalam bentuk terenkripsi; kunci enkripsinya (`APP_SECRET_KEY`) tidak ada di dalam dump dan harus disimpan terpisah. Unggahan ke Drive belum pernah dijalankan; hanya dump dan pemulihan lokal yang sudah diuji.

## Pembaruan

    git pull
    docker compose -f deploy/compose.yml --env-file deploy/.env up -d --build

Untuk susunan tunnel: bangun image di mesin lain, `docker save <image> | gzip | ssh <server> 'gunzip | sudo docker load'`, jalankan backup, set `APP_IMAGE=<image>` di `.env`, lalu `up -d`. Image sebelumnya tetap ada dengan tag lama untuk kembali bila perlu (kembali ke image lama tidak membatalkan migrasi).

Migrasi dijalankan saat start. Stream yang sedang berjalan diberi waktu 60 detik saat container berhenti; sesudah itu terputus dan ditagih sebagai estimasi.

## Bila domain di belakang proxy lain (misalnya Cloudflare)

`TRUST_PROXY` harus sama dengan jumlah proxy di depan aplikasi (Caddy saja = 1; Cloudflare + Caddy = 2). Angka yang salah membuat batas laju keliru: terlalu besar memungkinkan alamat dipalsukan, terlalu kecil menggabungkan semua pelanggan ke satu alamat.
