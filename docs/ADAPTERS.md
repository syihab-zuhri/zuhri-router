# Kontrak Adapter Upstream: Router AI Komersial

Version: 0.2.0
Status: Draft; disusun dari dokumentasi, belum ada request yang dikirim ke upstream mana pun
Owner keputusan: founder
Updated: 2026-11-13, Asia/Jakarta
Dependencies: ARCHITECTURE.md section 2, 3, 6 dan ADR-002; BILLING_REDEEM.md section 2
Evidence: E2 untuk isi dokumentasi DeepSeek pada evidence/2026-11-13-upstream/. Perilaku runtime belum diamati.

Sumber otoritatif untuk semantic per upstream: pemetaan usage ke kategori biaya, endpoint per protokol, error, batas dan hal yang belum diketahui. Satu section per upstream. DeepSeek dan Dahono Router memiliki dokumentasi terbaca; "API dari Codex" belum dapat ditulis (OQ-007).

## 1. Aturan umum semua adapter

- Adapter adalah pass-through sejenis: body request dan respons diteruskan tanpa mengubah semantic. Yang diubah gateway hanya: nama model publik ke nama model upstream, kredensial pelanggan diganti kredensial upstream, dan penambahan identitas pelanggan tersamar bila upstream mendukung isolasi per pengguna.
- Header autentikasi pelanggan tidak pernah diteruskan ke upstream. Header yang diteruskan ditentukan per protokol; pada permukaan Anthropic, header `anthropic-*` diteruskan apa adanya.
- Usage dibaca dari respons upstream, disimpan mentah, lalu dinormalisasi ke empat kategori BILLING_REDEEM.md section 2.1 dengan versi normalizer.
- Nama model pada respons ke pelanggan adalah nama publik yang diminta, agar tool tidak bingung; nama upstream dicatat pada attempt.
- Setiap asumsi di bawah yang berlabel "belum diamati" menjadi kasus fixture pada TEST-011 dan TEST-020 sebelum upstream ditandai eligible.

## 2. DeepSeek

Status eligibility: pending. Hak penjualan kembali belum disimpulkan (ARCHITECTURE.md section 6).

### 2.1 Endpoint

| Permukaan gateway | Base URL upstream | Catatan dari dokumentasi |
|---|---|---|
| API-001 Chat Completions | `https://api.deepseek.com` | Stream SSE diakhiri `data: [DONE]` |
| API-003 Anthropic Messages | `https://api.deepseek.com/anthropic` | Autentikasi `x-api-key` atau `Authorization: Bearer`; bila keduanya ada, Authorization yang dipakai. `anthropic-version` diabaikan. `anthropic-beta` diabaikan untuk messages kecuali nilai Files API |
| API-005 Responses | `https://api.deepseek.com` | Stream berupa event bernama dengan `sequence_number`; berakhir dengan `response.completed`, `response.incomplete` atau `response.failed`; tidak ada `[DONE]` |
| API-004 hitung token | Belum ditemukan pada halaman yang dibaca | Diperlakukan tidak tersedia sampai dibuktikan; gateway menjawab sesuai kontrak "tidak didukung" permukaan itu |

Nama model pada dokumentasi saat diperiksa: `deepseek-flash` dan `deepseek-v4-pro`. Daftar model yang dijual ditentukan admin, bukan disalin otomatis dari sini.

### 2.2 Pemetaan usage

| Permukaan | Field upstream | Kategori |
|---|---|---|
| Chat Completions | `prompt_cache_miss_tokens` | input_uncached_tokens |
| | `prompt_cache_hit_tokens` | cache_read_tokens |
| | `completion_tokens` | output_tokens. `completion_tokens_details.reasoning_tokens` adalah rincian, tidak ditambahkan lagi |
| | – | cache_write_tokens = 0, `unsupported`: caching otomatis dan tidak ada tarif pembuatan cache pada halaman harga |
| Anthropic Messages | `input_tokens` | input_uncached_tokens. Dokumentasi menyatakan field ini sudah tidak termasuk cache |
| | `cache_read_input_tokens` | cache_read_tokens |
| | `cache_creation_input_tokens` | Selalu 0 menurut dokumentasi; nilai selain 0 diperlakukan anomali dan request menjadi UNRESOLVED |
| | `output_tokens` | output_tokens; sudah termasuk token thinking. Pada stream, nilai di `message_delta` kumulatif, bukan penambahan |
| Responses | `usage` pada objek respons di event akhir | Nama field rinci belum dibaca; pemetaan ditulis setelah referensi field diperiksa. Sampai itu, permukaan ini tidak dibuka untuk DeepSeek |

Pemeriksaan konsistensi Chat Completions: `prompt_tokens` harus sama dengan hit ditambah miss. Bila tidak sama, request menjadi UNRESOLVED, bukan ditebak.

Perbedaan penting antar-permukaan: pada Chat Completions total input mencakup cache dan dipecah lewat dua field; pada Anthropic `input_tokens` sudah eksklusif. Normalizer tidak boleh mengurangkan cache dua kali pada permukaan Anthropic.

### 2.3 Usage pada stream

- Chat Completions: dokumentasi menyatakan chunk terakhir sebelum `[DONE]` membawa usage seluruh request, baik `stream_options.include_usage` diisi maupun tidak, dan tidak ada chunk khusus usage. Gateway tidak perlu menyisipkan opsi itu, tetapi tetap memvalidasi keberadaan usage pada chunk terakhir.
- Anthropic: usage akhir dibaca dari `message_delta.usage` terakhir.
- Responses: usage dibaca dari objek pada `response.completed` atau `response.incomplete`.
- Stream yang berakhir tanpa penanda akhir protokolnya dianggap terputus: bila belum ada byte konten diteruskan berlaku aturan usage nol; bila sudah ada, berlaku aturan usage hilang (ARCHITECTURE.md section 2).

### 2.4 Batas output dan bound admission

- Chat Completions: `max_tokens` antara 1 dan 393216. Bila kosong, default upstream 8K pada mode non-thinking dan 64K pada mode thinking, lebih tinggi lagi pada effort maksimum. Karena default bergantung mode, gateway tidak mengandalkan default upstream: bila pelanggan tidak mengisi, gateway mengisi batas default model dari katalog dan memakai nilai itu untuk hold.
- Batas atas yang diizinkan per model dan per key ditetapkan admin dan boleh lebih rendah daripada batas upstream.
- Estimasi input untuk hold memakai ukuran body dengan rasio konservatif; dokumentasi hanya memberi perkiraan kasar karakter per token, sehingga rasio ditetapkan lewat fixture dan pelanggaran bound dipantau (RSK-009).

### 2.5 Biaya

- Harga dalam USD per sejuta token, berbeda per model, dengan tiga komponen: input cache hit, input cache miss, output.
- Ada tarif peak dan off-peak. Cost profile memakai tarif peak sebagai batas konservatif untuk margin guard. Jam berlakunya peak belum dibaca dari halaman harga dan tidak diasumsikan.
- Angka harga tidak disalin ke dokumen ini karena cepat berubah; admin memasukkannya ke cost profile dengan tanggal as-of dan kurs.

### 2.6 Error dan retry

| Status upstream | Arti menurut dokumentasi | Perlakuan gateway |
|---|---|---|
| 400, 422 | Format atau parameter tidak valid | Diteruskan ke pelanggan dalam bentuk protokol; tidak di-retry; tidak didebit |
| 401 | API key salah | Masalah konfigurasi upstream: pelanggan menerima `upstream_unavailable`; alert ke admin; route ditandai tidak sehat. Pesan upstream tidak diteruskan |
| 402 | Saldo akun upstream habis | Sama dengan 401, dengan alert prioritas tinggi; route dihentikan sampai admin menindak |
| 429 | Batas laju atau konkurensi akun | Retry terbatas ke route lain untuk model yang sama bila ada; bila tidak, `upstream_unavailable` dengan Retry-After |
| 500, 503 | Gangguan atau beban berlebih | Retry terbatas sebelum byte pertama; circuit breaker |

Batas konkurensi berlaku per akun upstream, bukan per API key, sehingga seluruh pelanggan berbagi satu kuota. Batas konkurensi gateway per route diatur di bawah kuota itu. Angka kuota berubah dan dimasukkan sebagai konfigurasi route.

### 2.7 Isolasi per pengguna

Dokumentasi menyediakan parameter `user_id` untuk isolasi keamanan konten, cache dan penjadwalan per pengguna di sisi bisnis. PROPOSED: gateway mengirim pengenal tenant tersamar yang stabil dan tidak dapat dibalik (bukan username, email, atau ID internal mentah), agar cache satu pelanggan tidak dipakai pelanggan lain dan tindakan keamanan konten tidak mengenai semua pelanggan. Nama dan letak parameter per permukaan diperiksa saat implementasi.

### 2.8 Kewajiban dari ketentuan yang terbaca

Ketentuan Open Platform yang dibaca mewajibkan: perjanjian dengan end user, pengungkapan bahwa output dihasilkan AI dan dapat keliru, serta menjaga API key agar tidak dibagikan atau diekspos di sisi klien. Ketiganya dipenuhi lewat syarat layanan produk, teks pada portal, dan penyimpanan key hanya di server. Ini daftar kewajiban yang terbaca, bukan penilaian kepatuhan.

### 2.9 Belum diketahui

- Field usage Responses API dan perilaku penyimpanan respons.
- Apakah request yang dibatalkan klien tetap ditagih, dan apakah usage dilaporkan saat stream terputus.
- Keberadaan event keep-alive pada tiap permukaan selama jeda berpikir panjang.
- Jam peak/off-peak dan apakah tarif ditentukan saat request mulai atau selesai.
- Endpoint tanpa biaya untuk uji koneksi dan untuk membaca saldo akun.
- Isi DeepSeek Terms of Use induk.

Setiap butir menjadi pemeriksaan pada TASK-024 sebelum status eligible.

## 3. Dahono Router

Status eligibility: pending. Sumber: https://dhn.ai.id/ dan halaman docs, pricing, token-plan, reseller, terms yang diambil 2026-11-13.

### 3.1 Endpoint

| Permukaan gateway | Base URL upstream | Catatan |
|---|---|---|
| API-001 Chat Completions | `https://gateway.dahono.com/v1` | Dinyatakan kompatibel OpenAI; daftar model lewat `/v1/models` |
| API-003 Anthropic Messages | Sama, menurut dokumentasi "OpenAI & Anthropic Compatible" | Path dan header persisnya belum dibaca; diperiksa sebelum dibuka |
| API-005 Responses | Tidak disebut pada halaman yang dibaca | Diperlakukan tidak tersedia |

ID model berawalan `dahono/`. Alias `dahono/auto` memilih model secara otomatis di sisi Dahono; alias ini tidak dipetakan ke model publik bernama tertentu karena model yang melayani tidak pasti.

### 3.2 Biaya dan usage

- Dua cara bayar di sisi upstream: Token Plan (kuota prabayar berjangka) dan pay as you go dari saldo. Harga pay as you go dalam Rupiah per sejuta token, berbeda input dan output per model.
- Kuota Token Plan dipotong (input + output) kali pengali model. Token prompt yang ter-cache dihitung sama dengan token input.
- Akibat untuk cost profile: tidak ada diskon cache di sisi modal. Tarif jual cache read untuk model lewat Dahono tidak boleh di bawah biaya input; margin guard per kategori menangani ini. Bila modal berasal dari Token Plan, biaya per token adalah harga paket dibagi kuota dikali pengali, dan kuota yang hangus saat masa aktif habis adalah biaya tetap yang tidak tertutup floor per token.
- Biaya dalam Rupiah, sehingga tidak ada risiko kurs untuk route ini.
- Field usage pada respons belum dibaca. Sampai dibaca, pemetaan mengikuti bentuk OpenAI standar dengan cache_read = 0 `unknown`, dan itu berarti upstream belum boleh ditandai eligible.
- Ketentuan menyatakan data log pada dashboard Dahono adalah sumber kebenaran pemakaian; rekonsiliasi memakai itu.

### 3.3 Error

HTTP 402 saat kuota habis dan pay as you go tidak aktif: diperlakukan seperti saldo upstream habis (circuit terbuka sampai admin menindak, alert prioritas tinggi). Kode lain belum dibaca dan mengikuti aturan umum section 2.6 sampai diperiksa.

### 3.4 Program reseller

Halaman reseller menawarkan penjualan kembali paket token AI model secara whitelabel dengan REST API (membuat key per klien, batas kuota, rotasi, pemakaian per hari dan model). Ini dasar yang paling jelas untuk hak menjual kembali, tetapi modelnya berbeda dari rancangan ini: di sana Dahono menerbitkan key per pembeli, di sini gateway sendiri yang menerbitkan key dan menghitung saldo. Mana yang diizinkan ketentuannya belum disimpulkan. Tidak ada pendaftaran yang dilakukan.

### 3.5 Belum diketahui

Path dan header permukaan Anthropic; field usage dan cache; batas laju dan konkurensi; perilaku saat klien memutus; endpoint tanpa biaya untuk uji koneksi dan saldo; apakah key biasa boleh dipakai untuk melayani pembeli pihak ketiga.

## 4. "API dari Codex" dan sumber lain

Belum dapat ditulis. Founder menyatakan sebagian berupa API berbayar dan sebagian dari langganan. Kontrak adapter hanya ditulis untuk penyedia berautentikasi API key berbayar, setelah nama dan dokumentasinya diberikan. Akses dari akun langganan atau login tidak diberi adapter (PLANNING.md RSK-016).

<!-- END ROUTER-ADAPTERS v0.2.0 -->
