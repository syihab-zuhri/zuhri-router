# Matriks state UX (Hermes Tahap sepuluh)

Kerangka dibuat Claude dari tabel layar `docs/UX.md` (SCR-004 sampai SCR-018), kolom state. Hermes mengisi kolom Penerapan dan Test. Penerapan: berkas dan fungsi, atau "belum", atau "tidak berlaku" dengan alasan. Test: berkas dan nama test yang memeriksa teks atau role yang terlihat untuk state itu, atau "belum". Status: `teruji`, `ada tanpa test`, `belum`, `butuh server`, atau `tidak berlaku`.

Jumlah state: 82. Inventaris source dan assertion pada 2026-11-21, base `48a60a3` beserta perubahan lokal Tahap sepuluh. `teruji` berarti ada assertion teks/role khusus state di test yang disebut; bukan klaim bahwa seluruh skrip tersebut dijalankan ulang pada sesi ini. Run aktual, kegagalan dan pengulangan dicatat terpisah di `hermes-log.md`. Baris gabungan dari kerangka tetap dipertahankan; bila baru sebagian varian tercakup, kolom Test menjelaskan batasnya dan status tidak dinaikkan menjadi teruji.

Rekap Tahap dua belas (2026-11-23 malam): 58 teruji, 17 ada tanpa test, 0 belum, 7 butuh server. Sebelas state naik dari `ada tanpa test` (dua di antaranya digabung: SCR-014 data-usang dan SCR-017 sudah-diselesaikan/replay yang sebelumnya `butuh server`), seluruhnya lewat test yang memeriksa teks atau role yang terlihat di `web/test/e2e/admin-states.spec.ts`, `web/test/e2e/overview-stale.spec.ts` dan `web/test/e2e/admin-operations.spec.ts`. `undangan-terkirim/gagal-kirim` tetap `ada tanpa test` karena varian gagal POST belum diperiksa. Rekap Tahap sebelas: 47 teruji, 26 ada tanpa test, 1 belum, 8 butuh server. Total 82; 15 layar (dihitung dengan skrip dari kolom Status). Sepuluh state yang sebelumnya ada tanpa test mendapat assertion terlihat; SCR-007 data-usang dan SCR-016 circuit-terbuka dilengkapi dengan RED-GREEN. Rekap Tahap sepuluh sebelumnya: 35 teruji, 36 ada tanpa test, 2 belum, 9 butuh server. `butuh server` berarti kontrak executable saat ini belum cukup, bukan izin membuat kontrak atau mock baru.

## SCR-004 Masuk

| State | Penerapan | Test | Status |
|---|---|---|---|
| submitting | `web/src/auth.tsx` — `LoginPage` memakai `useAction` dan `Button busy` | `web/test/e2e/portal-state-matrix.spec.ts` — `masuk menampilkan submitting sampai respons diterima`; menahan respons; status m.saving dan tombol aria-busy | teruji |
| kredensial-salah (pesan seragam) | `web/src/auth.tsx` — `LoginPage` merender `ErrorBox`; `web/src/messages.ts` — `errorText.auth_invalid` dan `invalid_credentials` memakai pesan seragam | `web/scripts/account-local-verify.mjs:193–222` — skenario “Ubah password pelanggan” dan “Tutup akun permanen” memeriksa pesan `errorText.auth_invalid` saat password lama/akun tertutup ditolak | teruji |
| dibatasi dengan waktu tunggu | `web/src/auth.tsx` — `LoginPage` memakai `ErrorBox`; `web/src/ui.tsx` — `errorMessage` menangani HTTP 429 dan Retry-After | `web/test/e2e/portal-state-matrix.spec.ts` — `masuk dibatasi menampilkan waktu tunggu dari Retry-After`; alert waktu tunggu 120 detik | teruji |
| server-error | `web/src/auth.tsx` — `LoginPage` merender `ErrorBox` | `web/test/e2e/portal-state-matrix.spec.ts` — `masuk menampilkan server-error tanpa mengaku berhasil`; alert internal_error dan tetap di /masuk | teruji |

## SCR-005 Aktivasi Undangan

| State | Penerapan | Test | Status |
|---|---|---|---|
| token-valid | `web/src/auth.tsx` — `TokenPage` mengambil token dari `takeToken` dan menampilkan form aktivasi | `web/test/e2e/portal.spec.ts` — `aktivasi menghapus fragment sebelum request dan merender hasil server` menjalankan aktivasi dengan token lalu memeriksa pesan sukses terlihat | teruji |
| username-sudah-dipakai | `web/src/auth.tsx` — `TokenPage` merender `ErrorBox`; pesan `username_taken` ada di `web/src/messages.ts` | `web/test/e2e/portal-state-matrix.spec.ts` — `aktivasi username sudah dipakai menampilkan arahan memilih nama lain`; alert username_taken, nama tetap terisi dan tidak ada pesan sukses | teruji |
| username-tidak-valid | `web/src/auth.tsx` — validasi HTML `pattern` dan `ErrorBox`; pesan `username_invalid` ada di `web/src/messages.ts` | belum | ada tanpa test |
| token-kedaluwarsa/terpakai (arahan hubungi admin) | `web/src/auth.tsx` — `TokenPage` menampilkan `ErrorBox`; pesan `invite_invalid` ada di `web/src/messages.ts` | `web/scripts/admin-customers-local-verify.mjs:307–320` — skenario “Memakai tautan aktivasi yang sama kedua kali harus ditolak” memeriksa `errorText.invite_invalid` terlihat dan arahan hubungi admin | teruji |
| submitting | `web/src/auth.tsx` — `TokenPage` menampilkan `Alert` dengan `m.saving` dan `Button busy` sampai respons aktivasi diterima | `web/test/e2e/portal-state-matrix.spec.ts` — `aktivasi mengumumkan submitting sampai server menjawab` menahan respons, memeriksa teks status, aria-busy dan belum ada sukses; GREEN 1/1 | teruji |
| password-lemah | `web/src/auth.tsx` — input password `minLength={10}` dan `ErrorBox`; pesan `weak_password` ada di `web/src/messages.ts` | belum | ada tanpa test |
| berhasil lalu masuk | `web/src/auth.tsx` — `TokenPage` menampilkan `m.activated` setelah respons sukses; link kembali masuk | `web/test/e2e/portal.spec.ts` — `aktivasi menghapus fragment sebelum request dan merender hasil server` memeriksa teks `Akun sudah aktif. Silakan masuk.` | teruji |

## SCR-006 Pemulihan Akses

| State | Penerapan | Test | Status |
|---|---|---|---|
| terkirim (pesan sama untuk semua email) | `web/src/auth.tsx` — `RequestResetPage` menampilkan `m.resetSent` setelah `/api/auth/reset/request` sukses | `web/test/e2e/portal-state-matrix.spec.ts` — `pemulihan terkirim memakai pesan sama untuk email terdaftar dan tidak dikenal`; status m.resetSent sama untuk kedua respons kontrak ok | teruji |
| token-tidak-valid | `web/src/auth.tsx` — `TokenPage` tanpa token menampilkan `m.tokenMissing`; token ditolak ditampilkan lewat `ErrorBox` dan `reset_invalid` di `web/src/messages.ts` | `web/test/e2e/portal-state-matrix.spec.ts` — `pemulihan token tidak valid memberi arahan tanpa form sukses`; alert token hilang dan reset_invalid dari server; tidak ada sukses | teruji |
| submitting | `web/src/auth.tsx` — `RequestResetPage` dan `TokenPage` menampilkan `Alert` dengan `m.saving` serta tombol busy selama permintaan/penyelesaian reset | `web/test/e2e/portal-state-matrix.spec.ts` — `pemulihan akses mengumumkan submitting pada permintaan dan penyelesaian reset` menahan kedua respons, memeriksa teks status, aria-busy dan belum ada sukses; GREEN 1/1 | teruji |
| berhasil | `web/src/auth.tsx` — `TokenPage` menampilkan `m.resetDone` setelah `/api/auth/reset/complete` sukses | `web/test/e2e/portal-state-matrix.spec.ts` — `pemulihan akses mengumumkan submitting pada permintaan dan penyelesaian reset` memeriksa role status dengan `m.resetDone` sesudah respons sukses | teruji |

## SCR-007 Beranda

| State | Penerapan | Test | Status |
|---|---|---|---|
| loading | `web/src/customer.tsx` — `HomePage` memakai `Pending` untuk `/api/balance` dan `/api/packs`; `useResource` untuk data portal | `web/test/e2e/portal-state-matrix.spec.ts` — `beranda loading tidak menampilkan saldo nol sebelum data diterima`; status memuat ditahan sampai saldo diterima | teruji |
| first-use (checklist) | `web/src/customer.tsx` — `FirstUseChecklist` menghitung saldo, key, dan baca panduan; hilang setelah seluruh langkah selesai | `web/test/e2e/portal.spec.ts` — `checklist first-use memakai saldo dan daftar key dari API lalu hilang saat semua langkah selesai`; `membuka panduan langsung menandai langkah baca pada checklist` | teruji |
| saldo-nol (ajakan isi saldo) | `web/src/customer.tsx` — `HomePage` merender ajakan saat `availableMicro <= 0` | `web/test/e2e/portal-state-matrix.spec.ts` — `beranda saldo nol mengajak isi saldo dengan tautan keyboard`; status m.zeroBalance dan tautan Isi saldo dapat dipakai keyboard pada 360 px | teruji |
| data-usang dengan waktu pembaruan | `web/src/customer.tsx` — `HomePage` mempertahankan `balance.data` dan waktu sukses terakhir saat refetch gagal; alert usang dan tombol Muat ulang; ErrorBox hanya bila belum ada data | `web/test/e2e/home-stale.spec.ts` — `saldo gagal diperbarui mempertahankan nilai dan waktu terakhir lalu pulih lewat keyboard`, `saldo gagal pertama kali tetap memakai layar galat tanpa angka rekaan`; nilai mikro eksak, node saldo sama, waktu tetap/pulih dan 360 px | teruji |
| layanan-dijeda | `web/src/customer.tsx` — `HomePage` memuat status dari `/api/me`; `web/src/app.tsx` — shell portal memuat banner jeda | `web/test/e2e/service-paused.spec.ts` — `status layanan menunjukkan Berjalan tanpa banner bila servicePaused false atau tidak ada` dan `banner layanan dijeda tampil di semua halaman portal dan tidak diulang saat navigasi` memeriksa teks/role status layanan | teruji |

## SCR-008 API Key

| State | Penerapan | Test | Status |
|---|---|---|---|
| empty | `web/src/customer.tsx` — `KeysPage` menampilkan `Empty` saat tidak ada key | `web/test/e2e/portal-state-matrix.spec.ts` — `API key empty menampilkan belum ada key tanpa tombol cabut`; heading m.keyEmpty dan tombol buat, tanpa tombol cabut | teruji |
| creating | `web/src/customer.tsx` — `KeysPage.create` memakai `useAction` dan tombol `busy`; belum ada teks submitting pada form key | belum | ada tanpa test |
| secret-sekali-tampil (peringatan tidak dapat dilihat lagi) | `web/src/customer.tsx` — `KeysPage` membuka `SecretReveal`; `web/src/ui.tsx` — `SecretReveal` menampilkan peringatan, secret dan konfirmasi buang | `web/test/e2e/states.spec.ts` — `secret tidak berada di URL/storage, copy gagal tetap tampil, escape meminta kepastian` memeriksa secret terlihat dan teks peringatan buang | teruji |
| salin-gagal | `web/src/ui.tsx` — `SecretReveal` menampilkan `m.copyFailed` ketika clipboard gagal | `web/test/e2e/states.spec.ts` — `secret tidak berada di URL/storage, copy gagal tetap tampil, escape meminta kepastian` mengassert teks status kegagalan salin | teruji |
| batas-jumlah | `web/src/customer.tsx` — `KeysPage` merender `ErrorBox` untuk error API; `key_limit_reached` dipetakan di `web/src/messages.ts` | belum | ada tanpa test |
| mencabut | `web/src/customer.tsx` — `KeysPage` menampilkan konfirmasi inline dan tombol busy selama revoke | `web/test/e2e/customer-tabs-focus.spec.ts` — `fokus kembali ke tombol cabut saat dialog ditutup dan ke judul panel sesudah key dicabut` hanya menguji aksi pencabutan admin pada pelanggan, bukan API key pelanggan | ada tanpa test |
| dicabut | `web/src/customer.tsx` — setelah POST revoke sukses `KeysPage` menampilkan `m.revoked` dan memperbarui daftar | `web/scripts/portal-local-verify.mjs:356–362` — skenario “Cabut key di UI” mengassert pesan `m.revoked` dan badge `Dicabut`; juga `web/scripts/local-browser-verify.mjs:132–134` | teruji |
| gagal/hasil-tidak-diketahui | `web/src/customer.tsx` — `KeysPage` memakai `ErrorBox`; untuk `network_unknown`, `invalid_response`, `key_already_created` menampilkan `m.unknown` dan ajakan muat ulang | belum | ada tanpa test |

## SCR-009 Model dan Harga

| State | Penerapan | Test | Status |
|---|---|---|---|
| loading | `web/src/catalogue.tsx` — `CataloguePage` memakai `Pending` saat `/api/models` belum siap | belum | ada tanpa test |
| empty (belum ada model dijual) | `web/src/catalogue.tsx` — `CataloguePage` menampilkan `Empty` dengan `m.noModelsForCustomer` | `web/test/e2e/catalogue.spec.ts` — `katalog pelanggan menampilkan multiplier ringkas atau tarif tiap kategori dari string desimal` mengubah payload menjadi kosong lalu memeriksa heading “Belum ada model dijual.” | teruji |
| model-dijeda | belum; kontrak katalog `/api/models` tidak memberi status jeda per model dan komponen hanya menerima `CustomerModel` tanpa status | belum | butuh server |

## SCR-010 Pemakaian

| State | Penerapan | Test | Status |
|---|---|---|---|
| loading | `web/src/usage.tsx` — `UsagePage` memakai `Pending` untuk `/api/requests` | belum | ada tanpa test |
| empty | `web/src/usage.tsx` — `UsagePage` menampilkan `Empty` dengan `m.noRequests` jika daftar kosong | belum | ada tanpa test |
| tanpa-hasil-filter | `web/src/usage.tsx` — `UsagePage` merender `Empty` dengan `m.noFilterResults` saat filter tidak cocok dengan request pada halaman | `web/test/e2e/usage.spec.ts` — `pemakaian memuat cursor dan menampilkan status estimasi serta hold` memilih filter yang menyisakan satu hasil, tidak menguji tanpa hasil | ada tanpa test |
| belum-final (unresolved) | `web/src/usage.tsx` — `RequestDetails` menampilkan status belum final, hold dan pesan keputusan tertunda untuk state `UNRESOLVED` | `web/test/e2e/usage.spec.ts` — `pemakaian memuat cursor dan menampilkan status estimasi serta hold` memeriksa `m.notFinal` dan dana ditahan untuk request `UNRESOLVED` | teruji |
| error-parsial (grafik gagal, daftar tetap) | belum; `PageSummary` menghitung grafik dari halaman daftar yang sama, tanpa endpoint/payload terpisah untuk kegagalan grafik parsial | belum | butuh server |

## SCR-011 Transaksi

| State | Penerapan | Test | Status |
|---|---|---|---|
| loading | `web/src/customer.tsx` — `LedgerPage` memakai `Pending` saat `/api/ledger` dimuat | belum | ada tanpa test |
| empty | `web/src/customer.tsx` — `LedgerPage`/`Entries` menampilkan `Empty` ketika `entries` kosong | `web/test/e2e/states.spec.ts` — `loading, gagal dan kosong transaksi; reflow 360,768,1280 dan reduced motion` mengassert heading “Belum ada data.” setelah retry berhasil | teruji |
| tanpa-hasil-filter | belum; `web/src/customer.tsx` — `LedgerPage` hanya memiliki cursor; `/api/ledger` pada `server/src/http/app.ts` hanya menerima `before`/`limit`, belum ada kontrak filter transaksi | belum | butuh server |

## SCR-012 Panduan Integrasi

| State | Penerapan | Test | Status |
|---|---|---|---|
| belum-ada-key (tautan buat key) | `web/src/guide.tsx` — `GuidePage` memuat `/api/keys?limit=1` dan menampilkan `m.guideNoKey` serta tautan `/api-key` saat kosong | `web/test/e2e/portal-state-matrix.spec.ts` — `panduan tanpa key menampilkan ajakan dan tautan membuat key`; status m.guideNoKey, tautan /api-key dengan keyboard dan reflow 360 px | teruji |

## SCR-013 Akun dan Keamanan

| State | Penerapan | Test | Status |
|---|---|---|---|
| submitting | `web/src/account-customer.tsx` — `CustomerAccountPage` memakai `pwAction`, `revokeAction`, `closeAction`; alert `m.saving` dan tombol busy | belum; `akun pelanggan: ubah password, kelola sesi, dan uji negatif penutupan akun` tidak menahan respons untuk mengassert submitting | ada tanpa test |
| password-lama-salah | `web/src/account-customer.tsx` — `passwordErrorOverrides`, `accountErrorText` di `CustomerAccountPage` | `web/test/e2e/account-customer.spec.ts` — `akun pelanggan: ubah password, kelola sesi, dan uji negatif penutupan akun` memeriksa alert `am.wrongCurrentPassword` | teruji |
| sesi-dicabut | `web/src/account-customer.tsx` — `CustomerAccountPage.confirmRevoke` merender `am.sessionRevoked` untuk sesi lain; sesi sendiri menuju masuk | `web/test/e2e/account-customer.spec.ts` — `akun pelanggan: ubah password, kelola sesi, dan uji negatif penutupan akun` memeriksa pesan sesi dicabut dan hilangnya ID sesi | teruji |
| konfirmasi tutup akun | `web/src/account-customer.tsx` — `CustomerAccountPage` membuka modal konsekuensi dan konfirmasi username/password | `web/test/e2e/account-customer.spec.ts` — `akun pelanggan: ubah password, kelola sesi, dan uji negatif penutupan akun` memeriksa role dialog, teks konsekuensi, fokus, batal, dan konflik | teruji |

## SCR-014 Ringkasan Operasi

| State | Penerapan | Test | Status |
|---|---|---|---|
| loading | `web/src/admin-overview.tsx` — `AdminOverviewPage` menampilkan `Pending` sampai overview dan gateway siap | `web/test/e2e/admin-overview.spec.ts` — `ringkasan operasi menangani keadaan memuat, gagal dengan h1 tetap ada, dan nol` memeriksa `m.loading` | teruji |
| data-usang | `web/src/admin-overview.tsx` — `AdminOverviewPage` mempertahankan `overview.data` dan `generatedAt` terakhir saat pembacaan ulang gagal; `Alert` `m.adminOverviewStale`; layar galat hanya bila `data === undefined` | `web/test/e2e/overview-stale.spec.ts` — `pembacaan ulang gagal mempertahankan angka dan waktu terakhir dengan penanda usang`, `pembacaan pertama yang gagal tetap layar galat tanpa angka rekaan`, `penanda usang terbaca dan tidak meluber pada 360 px`; angka tidak berubah, node `.metrics` sama, waktu tetap lalu pulih lewat keyboard | teruji |
| biaya-unknown ditandai | `web/src/admin-overview.tsx` — `AdminOverviewPage` menampilkan `ov.costUnavailableNote`, tidak mengarang nilai biaya | `web/test/e2e/admin-overview.spec.ts` — `rute /admin membuka ringkasan operasi dengan metrik, penanda akun minus, dan tautan tujuan` memeriksa teks catatan biaya | teruji |
| layanan-dijeda | `web/src/admin-overview.tsx` — panel gateway pada `AdminOverviewPage` merender status dan banner jeda | `web/test/e2e/admin-overview.spec.ts` — `jeda layanan menampilkan status dijeda (layanan-dijeda) dan lulus Axe + 360px` memeriksa teks status/alert | teruji |
| mengubah-flag | `web/src/admin-overview.tsx` — modal `AdminOverviewPage` merender `ov.changingFlag` selama POST gateway | `web/test/e2e/admin-overview.spec.ts` — `jeda layanan menjeda & melanjutkan lewat konfirmasi, step-up, mengubah-flag, dan tanpa pembaruan optimistis` memeriksa teks mengubah flag | teruji |
| gagal | `web/src/admin-overview.tsx` — `AdminOverviewPage` mempertahankan judul dan `ErrorBox` pada kegagalan read/mutasi | `web/test/e2e/admin-overview.spec.ts` — `ringkasan operasi menangani keadaan memuat, gagal dengan h1 tetap ada, dan nol`; `jeda layanan tidak mengubah status saat POST gagal dan menolak respons gateway cacat` | teruji |
| panel jeda layanan di Ringkasan Operasi | `web/src/admin-overview.tsx` — `AdminOverviewPage` menyediakan region gateway, alasan, waktu, pelaku dan konfirmasi jeda/lanjut | `web/test/e2e/admin-overview.spec.ts` — `rute /admin membuka ringkasan operasi dengan metrik, penanda akun minus, dan tautan tujuan`; `jeda layanan menjeda & melanjutkan lewat konfirmasi, step-up, mengubah-flag, dan tanpa pembaruan optimistis` | teruji |

## SCR-015 Pelanggan

| State | Penerapan | Test | Status |
|---|---|---|---|
| empty | `web/src/admin-customers.tsx` — `CustomersPage` menampilkan `m.customerListEmpty` bila daftar kosong tanpa prefix | `web/test/e2e/admin-states.spec.ts` — `daftar pelanggan kosong membedakan belum ada pelanggan dari tanpa hasil filter`; heading `m.customerListEmpty` tampil dan `m.customerNoMatches` tidak | teruji |
| tanpa-hasil | `web/src/admin-customers.tsx` — `CustomersPage` menampilkan `m.customerNoMatches` untuk hasil prefix kosong | `web/test/e2e/admin-customers.spec.ts` — `daftar pelanggan meminta halaman/filter ke API dan detail tetap dibuka dari pilihan` memeriksa heading tanpa hasil | teruji |
| username-tidak-ditemukan | `web/src/admin-customers.tsx` — `CustomerDetail` memakai `ErrorBox`; `web/src/messages.ts` memetakan `username_not_found` | `web/test/e2e/admin-states.spec.ts` — `detail pelanggan yang tidak ditemukan menjelaskan username tidak ditemukan dan menyediakan muat ulang`; alert `errorText.username_not_found`, tombol ulang, tablist tidak dirender | teruji |
| mengundang | `web/src/admin-customers.tsx` — `CustomersPage` memakai `inviteAction.busy`, `m.saving` dan tombol busy | `web/test/e2e/admin-states.spec.ts` — `undangan menampilkan keadaan mengundang sampai server menjawab`; `role=status` `m.saving`, tombol `aria-busy`, receipt belum tampil sampai respons | teruji |
| undangan-terkirim/gagal-kirim | `web/src/admin-customers.tsx` — `CustomersPage` membedakan `emailSent` dan fallback tautan manual, serta `ErrorBox` | `web/test/e2e/admin.spec.ts` — `undangan tanpa email mengungkapkan tautan server tanpa meluber di 360 px` memeriksa tautan dan `m.inviteManualDelivery`; `web/test/e2e/admin-states.spec.ts` — `undangan yang dikirim lewat email menyebut kanal email, bukan tautan manual` memeriksa `m.inviteSentByEmail` tanpa tombol salin. Varian gagal POST belum | ada tanpa test |
| konfirmasi-tambah-saldo (username dan nominal) | `web/src/admin-customers.tsx` — `CustomerDetail` menampilkan modal `m.topupConfirm` | `web/test/e2e/admin-customers.spec.ts` — `pencarian username dan tambah saldo menunggu konfirmasi serta mempertahankan kunci saat step-up` memeriksa username dan nominal dalam dialog | teruji |
| saldo-ditambah (receipt) | `web/src/admin-customers.tsx` — `CustomerDetail` merender `Receipt kind="topup"`; `web/src/ui.tsx` — `Receipt` | `web/test/e2e/admin-customers.spec.ts` — `pencarian username dan tambah saldo menunggu konfirmasi serta mempertahankan kunci saat step-up` memeriksa heading receipt setelah server mengonfirmasi | teruji |
| hasil-tidak-diketahui | `web/src/admin-customers.tsx` — `CustomerDetail` memakai `ErrorBox`; `web/src/ui.tsx` — `errorMessage`; `network_unknown`/`invalid_response` memakai `m.unknown` | `web/test/e2e/admin-states.spec.ts` — `tambah saldo yang gagal tanpa jawaban server tidak mengaku berhasil dan menawarkan periksa transaksi`; alert `m.unknown`, receipt tidak tampil, 360 px | teruji |
| ditangguhkan | `web/src/admin-customers.tsx` — `CustomerDetail` merender `m.adminSuspended` pada ringkasan dan badge status | `web/test/e2e/admin.spec.ts` — `suspend dan koreksi saldo meminta konfirmasi, step-up, dan mengirim nilai integer mikro-kredit` memeriksa pesan ditangguhkan setelah perubahan | teruji |
| konflik | `web/src/admin-customers.tsx` — `CustomersPage` menampilkan `m.inviteConflict`; `CustomerDetail` memakai `ErrorBox` untuk version conflict | `web/scripts/admin-customers-local-verify.mjs:323–328` — skenario “Mengundang email yang sama lagi harus menampilkan pesan konflik” mengassert role alert dengan `m.inviteConflict`; konflik versi saldo belum tercakup | teruji |
| gagal | `web/src/admin-customers.tsx` — `CustomersPage`/`CustomerDetail` menampilkan `ErrorBox` dengan retry pembacaan | belum | ada tanpa test |

## SCR-016 Upstream dan Route

| State | Penerapan | Test | Status |
|---|---|---|---|
| empty | `web/src/admin-upstreams.tsx` — `UpstreamRows`/`RoutesTable` menampilkan `Empty` saat daftar kosong | `web/test/e2e/admin-states.spec.ts` — `upstream dan route kosong memakai pesan kosong masing-masing`; heading `m.noUpstreams` dan `m.noRoutes` | teruji |
| pending/blocked/eligible | `web/src/admin-upstreams.tsx` — `UpstreamRows` memakai `Badge` untuk status; `UpstreamsPage` mengelola konfirmasi status | `web/test/e2e/upstream.spec.ts` — `upstream tidak mengisi ulang key dan perubahan URL meminta key baru` mengassert Menunggu tinjauan; `web/test/e2e/admin-states.spec.ts` — `status upstream layak dan diblokir tampil berlabel, bukan kode mentah` mengassert ketiga label badge tanpa kode mentah | teruji |
| base-URL-ditolak (alasan) | `web/src/admin-upstreams.tsx` — `UpstreamsPage` memakai `ErrorBox`; `web/src/messages.ts` memetakan `base_url_rejected` | `web/scripts/admin-catalog-local-verify.mjs:364–380` — skenario “Uji penolakan Base URL internal/IP oleh server” memeriksa `errorText.base_url_rejected` terlihat dalam dialog | teruji |
| key-tersimpan (tersamar, hanya dapat diganti) | `web/src/admin-upstreams.tsx` — `UpstreamRows` merender `keySet`/`keySetAt`; `editUpstream` mengosongkan input password | `web/test/e2e/upstreams.spec.ts` — `upstream tidak memuat ulang key dan penggantian URL meminta key baru, version dan step-up` memeriksa input kosong dan tidak ada secret, belum memeriksa pesan key tersimpan | ada tanpa test |
| menguji | belum; tidak ada endpoint uji koneksi pada `server/src/http/app.ts`; `loadUpstreamModels` hanya mengambil katalog, bukan uji koneksi | belum | butuh server |
| uji-lulus/gagal/tidak-tersedia | belum; belum ada hasil/kemampuan uji koneksi tanpa biaya pada kontrak executable | belum | butuh server |
| cost-usang | belum; `server/src/upstreams.ts` menyatakan cost profile belum tersedia; payload upstream belum memuat profil biaya/waktu acuannya | belum | butuh server |
| kurs-usang | belum; payload upstream belum memuat kurs, waktu acuannya dan ambang kedaluwarsa | belum | butuh server |
| circuit-terbuka | `web/src/admin-upstreams.tsx` — `CircuitStatus` pada `RoutesTable`, kontrak `circuit` dari `server/src/route-health.ts`/`upstreams.ts`; alasan dan waktu coba lagi, peringatan kegagalan saat tertutup | `web/test/e2e/route-circuit.spec.ts` — `circuit terbuka menjelaskan kegagalan dan upstream auth beserta waktu coba lagi`, `circuit tertutup dengan kegagalan memberi peringatan lalu hilang sesudah pembacaan baru`; kedua alasan, waktu ISO/WIB, sehat tanpa peringatan, keyboard, 360 px dan Axe | teruji |
| konflik | `web/src/admin-upstreams.tsx` — `UpstreamsPage`/`ArchiveConfirmation` memakai `ErrorBox`; pesan `version_conflict` ada di `web/src/messages.ts` | `web/test/e2e/admin-states.spec.ts` — `perubahan upstream yang bentrok versi menjelaskan data telah berubah tanpa menimpa`; alert `m.stale`, nilai baru tidak muncul di daftar | teruji |
| gagal | `web/src/admin-upstreams.tsx` — `UpstreamsPage` menampilkan `ErrorBox` untuk read/mutasi dan pesan katalog upstream gagal | `web/test/e2e/upstreams.spec.ts` — `kegagalan daftar model upstream menjelaskan bahwa ID dapat diketik manual` mengassert `m.upstreamModelsUnavailable` | teruji |

## SCR-017 Request dan Rekonsiliasi

| State | Penerapan | Test | Status |
|---|---|---|---|
| loading | `web/src/admin-operations.tsx` — `UnresolvedPage`; `web/src/admin-request-list.tsx` — `AdminRequestList`, keduanya memakai `Pending` | `web/test/e2e/admin-states.spec.ts` — `antrean request menunggu keputusan menampilkan keadaan memuat sebelum daftar`; status `m.loading` ditahan, heading kosong belum tampil | teruji |
| empty | `web/src/admin-operations.tsx` — `UnresolvedPage` merender `m.noUnresolved`; `web/src/admin-request-list.tsx` — `AdminRequestList` merender `m.adminRequestsEmpty` | `web/test/e2e/admin-operations.spec.ts` — `penyelesaian request menampilkan hold dan menahan mutasi sampai step-up` mengassert heading antrean unresolved kosong; belum mengassert daftar lintas pelanggan kosong | ada tanpa test |
| tanpa-hasil | `web/src/admin-request-list.tsx` — `AdminRequestList` merender `m.adminRequestsNoMatches` jika hasil filter kosong | `web/test/e2e/admin-requests.spec.ts` — `daftar request lintas pelanggan: baris, filter, paginasi dan tautan ke pelanggan` memeriksa teks tanpa hasil | teruji |
| menyelesaikan | `web/src/admin-operations.tsx` — `UnresolvedPage` memakai `action.busy`, `m.saving` dan modal terkunci selama POST resolve | `web/test/e2e/admin-states.spec.ts` — `penyelesaian request mengumumkan menunggu jawaban server selama POST berjalan`; teks `m.saving`, tombol `aria-busy`, receipt belum tampil; `admin-operations.spec.ts` — `penyelesaian request menampilkan receipt debit dan waktu sesudah server menjawab` | teruji |
| sudah-diselesaikan (replay) | `web/src/admin-operations.tsx` — `parseResolveReceipt` memvalidasi `{ id, state, debitMicro, resolvedAt, replayed }`; judul receipt dibedakan `m.resolveReceiptReplay`, catatan `m.resolveReceiptReplayNote`; konflik berbeda keputusan memakai `errorText.already_resolved` + `m.resolveConflictHelp` | `web/test/e2e/admin-operations.spec.ts` — `penyelesaian yang diulang menandai sudah tercatat sebelumnya tanpa perubahan kedua`, `keputusan berbeda pada request yang sudah diputuskan menjelaskan already_resolved dan dapat memuat ulang antrean` | teruji |
| gagal | `web/src/admin-operations.tsx` — `UnresolvedPage` memakai `ErrorBox`; `web/src/admin-request-list.tsx` — `AdminRequestList` memakai `ErrorBox` dan retry | `web/test/e2e/admin-operations.spec.ts` — `keputusan berbeda pada request yang sudah diputuskan menjelaskan already_resolved dan dapat memuat ulang antrean` memeriksa pesan galat mutasi; galat baca antrean belum | ada tanpa test |

## SCR-018 Audit

| State | Penerapan | Test | Status |
|---|---|---|---|
| loading | `web/src/admin-operations.tsx` — `AuditPage` memakai `Pending` selama query audit dimuat | `web/test/e2e/admin-operations.spec.ts` — `audit membedakan loading dan daftar yang memang kosong` memeriksa teks loading | teruji |
| empty | `web/src/admin-operations.tsx` — `AuditPage` menampilkan `m.noAudit` bila belum ada event dan tanpa filter/cursor | `web/test/e2e/admin-operations.spec.ts` — `audit membedakan loading dan daftar yang memang kosong` memeriksa heading audit kosong | teruji |
| tanpa-hasil | `web/src/admin-operations.tsx` — `AuditPage` menampilkan `m.auditNoMatches` untuk hasil filter kosong | `web/test/e2e/admin-operations.spec.ts` — `audit menerjemahkan aksi, memfilter aksi/pelaku/target dan memakai username serta cursor server` memeriksa heading tanpa hasil audit | teruji |
