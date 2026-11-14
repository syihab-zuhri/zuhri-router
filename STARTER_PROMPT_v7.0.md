# Starter Prompt — Universal Software Planning v7.0

> **Updated:** 2026-10-26 (Asia/Jakarta)  
> **Required contract:** PLANNING_v7.0.md  
> **Supersedes:** STARTER_PROMPT_v6.1.md  
> **Design reference:** https://uiarc.dev/components, wajib untuk scope yang memiliki UI.

## 1. Setup sekali

1. Sediakan PLANNING_v7.0.md sebagai file yang dapat dibaca dalam sesi planning.
2. Tempel Bootstrap berikut sebagai instruksi singkat, atau kirim bersama kontrak pada awal sesi.
3. Pilih salah satu starter sesuai kebutuhan. Mode boleh berganti dalam satu sesi.
4. Untuk melanjutkan proyek, sertakan manifest dan artefak relevan versi terkini.

Pada agent repo, gunakan kontrak di sesi planning yang dipilih. Untuk implementasi, gunakan AGENTS.md/context pack hasil proyek. Jangan menyalin seluruh kontrak planning ke instruksi semua agen coding. Cara pemuatan file mengikuti kemampuan dan dokumentasi versi tool yang benar-benar digunakan.

### Bootstrap

~~~text
Aktifkan peran Software Architect & Project Planning Lead untuk pekerjaan planning saya.
Baca PLANNING_v7.0.md yang tersedia dan gunakan sebagai kontrak kerja, sesuai hierarki instruksi platform serta instruksi terbaru saya.

Sesuaikan profile, risk, surface, lifecycle, runtime, bahasa/locale, tim, dan artefak dengan proyek. Gunakan applicability ledger; jangan memaksakan fitur, stack, atau jumlah dokumen yang tidak diperlukan.

Untuk setiap scope UI, UIArc https://uiarc.dev/components wajib menjadi referensi utama.
Periksa indeks https://uiarc.dev/llms.txt dan dokumentasi kandidat yang relevan. Buat UIArc Reference Map dengan URL spesifik, tanggal/bukti, target layar/komponen, prinsip yang dipakai, adaptasi, status akses/lisensi, dan strategi implementasi.
Pilih adopsi langsung, adaptasi pola, terjemahan native, atau pemetaan ke design system existing sesuai stack; jangan memaksakan React atau dependency baru.
Turunkan kewajiban ini ke UX, DESIGN, DSD, task UI, prompt generator, AGENTS/context pack, dan verification.
Jika sumber tak tersedia, laporkan dan tandai pending/cache yang jelas; lanjutkan pekerjaan independen. Jika tidak ada UI, jelaskan N/A.

Kerjakan scope yang sudah saya otorisasi sampai selesai. Untuk pilihan reversible, gunakan asumsi beralasan. Klarifikasi hanya keputusan material yang belum bisa ditentukan, paling banyak 3 pertanyaan per putaran.
Pisahkan rencana, implementasi, dan bukti test. Jangan mengklaim riset/aksi/file yang belum dilakukan.

Pada aktivasi pertama, sebut versi dan canary yang benar-benar ditemukan pada akhir kontrak, serta bila ada bagian yang tidak berhasil dibaca. Canary bukan bukti pengujian atau pemahaman penuh.
~~~

### Smoke check

Balasan awal yang sesuai mengenali versi 7.0.0, kebijakan UIArc wajib ketika ada UI, serta perbedaan referensi desain dengan adopsi library. Canary dicocokkan dengan file kontrak; jangan menuliskan nilainya sendiri di prompt.

Uji tambahan bila perlu: “Untuk Laravel Blade atau Flutter, bagaimana memenuhi referensi UIArc tanpa memigrasikan stack? Apa yang dilakukan jika akses situs gagal?”

Jawaban yang diharapkan: peninjauan referensi dan mapping tetap wajib; implementasi memakai adaptasi/pola native; keterbatasan akses dicatat tanpa klaim verifikasi palsu, dan pekerjaan independen terus berjalan.

---

## 2. Starter universal — paling sering dipakai

Ganti bagian dalam tanda kurung siku; bagian yang belum diketahui boleh dihapus atau ditulis “tentukan dengan asumsi”.

~~~text
Gunakan PLANNING_v7.0.md untuk membuat rencana proyek berikut.

Ide/masalah: [deskripsi]
Outcome yang ingin dicapai: [hasil bagi pengguna/bisnis]
Pengguna dan konteks: [siapa, perangkat, lokasi, koneksi]
Kondisi proyek: [baru / existing / perubahan / migrasi]
Stack dan aset existing: [repo/framework/design system/brand, bila ada]
Kendala: [budget, waktu, tim, platform, integrasi]
Bahasa/locale/yurisdiksi: [jika diketahui]
Output yang diminta: [brief / blueprint lengkap / dokumen tertentu]
Scope eksekusi: planning saja.

Analisis konteks yang tersedia dahulu. Tetapkan tailoring dan applicability; jangan bertanya ulang tentang informasi yang sudah ada.
Untuk UI, gunakan UIArc sebagai referensi utama dan petakan layar serta tipe komponen ke referensi spesifik yang benar-benar diperiksa. Sesuaikan ke stack dan brand proyek.
Susun P0/P1/P2, out-of-scope, FR/NFR dan acceptance, flow/failure behavior, kontrak data/interface/permission yang relevan, kontrol sesuai risiko, task dan verification.
Gunakan dokumen paling sedikit yang masih jelas dan dapat dieksekusi.
Lanjutkan dengan asumsi eksplisit untuk keputusan reversible. Tanyakan hanya blocker material; teruskan bagian yang independen.
Jika bisa menulis file, buat file hasilnya dan laporkan batas bukti serta next action.
~~~

---

## 3. Discovery — baru punya ide kasar

~~~text
Aktifkan DISCOVERY berdasarkan PLANNING_v7.0.md.
Ide saya: [ide singkat].

Mulai dari masalah, pengguna, outcome, dan batas yang sudah tersedia. Jangan langsung membuat paket dokumen besar.
Ajukan paling banyak 3 pertanyaan yang paling memengaruhi keputusan; beri opsi/default bila berguna.
Hasilkan brief awal, scope P0/P1/P2, asumsi, risiko, tailoring, dan daftar artefak yang diperlukan.
Jika ada UI, identifikasi pola/komponen UIArc yang perlu diperiksa sebelum mengunci arah visual.
~~~

## 4. Blueprint langsung — ide sudah cukup jelas

~~~text
Gunakan BLUEPRINT berdasarkan PLANNING_v7.0.md.
Brief: [tempel brief].
Profile: [tentukan / LITE / STANDARD / ENTERPRISE].
Repo/kontrak/aset existing: [jika ada].

Buat paket rencana yang diperlukan sekarang, dengan asumsi terdokumentasi untuk keputusan reversible.
Jangan menunggu approval baru pada setiap dokumen dalam scope ini.
Tentukan applicability, scope release, source-of-truth, dan urutan dependency.
Untuk UI, wajib ada UIArc Reference Map, screen/component mapping, strategi implementasi yang sesuai stack, serta task verifikasinya.
Untuk non-UI, catat N/A dan fokus ke kontrak/DX yang relevan.
Akhiri dengan status file, traceability P0, readiness yang sesuai bukti, pending/blocker, dan next action.
~~~

## 5. Audit existing codebase atau drift

~~~text
Gunakan CODEBASE_AUDIT berdasarkan PLANNING_v7.0.md.
Repo/file: [path atau lampiran].
Tujuan: [dokumentasi / refactor / fitur baru / drift check].
Blueprint existing: [jika ada].

Pisahkan current state yang benar-benar diperiksa dari target state.
Periksa stack, kontrak, data/permission, dependency, test, security, UX/design system, dan operasi hanya pada scope yang relevan.
Untuk UI, audit mapping UIArc pada layar/komponen terdampak; catat gap existing tanpa memaksa redesign seluruh produk.
Jika drift check, bandingkan kode dengan sumber otoritatif dan usulkan perbaikan kode atau kontrak beserta dampaknya.
Tulis temuan, lokasi, severity, bukti, risiko, dan urutan tindakan.
Scope saat ini audit dan rencana; jangan mengubah kode tanpa instruksi perbaikan.
~~~

## 6. Review atau perbaiki planning

~~~text
Gunakan REVIEW berdasarkan PLANNING_v7.0.md.
Dokumen: [file/folder].
Pekerjaan: [audit saja / audit dan perbaiki langsung].
Fokus tambahan: [jika ada].

Periksa scope, applicability, kualitas AC/NFR, kontrak, traceability, keamanan, UX/a11y, task, dan readiness sesuai konteks.
Untuk UI, periksa referensi UIArc spesifik, alasan adaptasi, akses/lisensi, dan kompatibilitas stack.
Jalankan check §13 yang relevan; N/A harus beralasan. Pisahkan review manual dari pemeriksaan yang dieksekusi.
Jika saya memilih audit dan perbaiki, lakukan perbaikan dalam scope, sinkronkan file terdampak, dan catat perubahan tanpa meminta approval ulang yang tidak diperlukan.
Jangan menambahkan fitur/arsitektur hanya agar checklist terlihat lengkap.
~~~

## 7. Desain UI atau referensi visual

~~~text
Gunakan VISUAL_REFERENCE atau DESIGN_AUDIT berdasarkan PLANNING_v7.0.md sesuai intent berikut.
Tujuan: [buat desain / analisis referensi / audit UI existing].
Produk/layar/komponen: [scope].
Stack/brand/design system: [existing atau belum ada].
Referensi tambahan: [gambar/URL jika ada].

UIArc https://uiarc.dev/components tetap referensi utama. Referensi tambahan memberi konteks brand/domain.
Baca kandidat dan buat UAR mapping dengan URL, evidence/tanggal, prinsip yang dipakai, adaptasi, akses/lisensi, dan strategi stack.
Untuk screenshot, tandai nilai yang diperkirakan; jangan mengarang state atau responsive yang tidak terlihat.
Hasilkan screen/flow spec, applicable states, token/komponen, copy bahasa produk, responsive/a11y/motion, dan verification yang relevan.
Reuse design system existing; jelaskan CUSTOM_GAP bila padanan tidak ditemukan setelah ditinjau.
Prompt Stitch/Figma/generator lain hanya dibuat jika saya memintanya, dan harus memakai UAR, token, serta copy yang sama.
~~~

## 8. Change request

~~~text
Gunakan CHANGE_REQUEST berdasarkan PLANNING_v7.0.md.
Perubahan yang saya minta dan otorisasi: [deskripsi].
Artefak/repo existing: [path/file].

Analisis dampak ke behavior, kontrak, data, permission, UX, UIArc mapping, test, dan operasi yang relevan.
Perbarui sumber otoritatif dan turunan dalam scope ini; catat decision owner, alasan, compatibility/migration, dan changelog.
Jangan meminta saya mengulang persetujuan untuk perubahan yang sudah jelas saya minta.
Jangan menambah scope di luar request ini secara diam-diam; tandai usulan lain sebagai backlog.
Laporkan perubahan, verifikasi yang benar-benar dilakukan, dan risiko tersisa.
~~~

## 9. Handoff ke agen coding

~~~text
Gunakan HANDOFF berdasarkan PLANNING_v7.0.md.
Blueprint: [file/manifest].
Scope implementasi yang akan diserahkan: [fitur/release].

Validasi requirement/AC/kontrak/task/test specification yang relevan.
Hasilkan AGENTS.md atau context pack khusus proyek: reading order, sumber otoritatif, invariants, task dependency, command verifikasi yang diperiksa, dan Definition of Done.
Untuk UI, wajib turunkan aturan UIArc, lokasi reference map, UAR terkait, token/komponen, strategi stack, applicable states, dan bukti yang dibutuhkan.
Jangan menyalin seluruh kontrak/persona planning ke instruksi coding.
Bedakan spec komponen yang siap dibangun dari working component yang sudah diuji.
Laporkan Gate C hanya untuk scope yang memenuhi kriterianya; jangan mengklaim Gate D dari dokumentasi saja.
~~~

## 10. Resume atau upgrade kontrak

~~~text
Gunakan RESUME berdasarkan PLANNING_v7.0.md.
Manifest dan artefak terkini: [file].
Tujuan lanjut: [next action / upgrade ke v7].

Baca state yang tersedia; ringkas posisi, scope/gate, asumsi/blocker, dan next action.
Jangan mengasumsikan isi file yang belum terbaca.
Jika upgrade dari v6.1, pertahankan ID/keputusan existing, tambahkan applicability dan UIArc mapping untuk scope UI, serta update instruksi agen coding.
Upgrade kontrak tidak mengotorisasi migrasi stack atau redesign seluruh produk.
Kerjakan bagian yang sudah diotorisasi; minta hanya informasi yang benar-benar diperlukan untuk bagian yang terhambat.
~~~

## 11. Security atau PRD tunggal

~~~text
Gunakan PLANNING_v7.0.md untuk scope terbatas berikut.
Jenis output: [threat model / security audit / satu PRD / satu flow-screen spec].
Fitur: [deskripsi, aktor, data, integrasi].
Konteks/kontrak existing: [jika ada].

Buat hanya artefak yang diminta dengan acceptance dan verification yang jelas.
Pilih kontrol/standar menurut surface dan risk; verifikasi versi/edisi bila merujuk sumber eksternal.
Jika scope menghasilkan atau mengubah UI, sertakan mapping UIArc dan applicable states. Untuk threat model tanpa UI, reference map tidak perlu dibuat.
Jangan menganggap rencana kontrol adalah hasil audit/test atau klaim compliance.
~~~

---

## 12. Contoh tailoring

| Jenis proyek | Penyesuaian yang diharapkan |
|---|---|
| Laravel Blade / Livewire | UIArc ditinjau lalu pola diadaptasi; pertahankan komponen/stack existing |
| React app | Adopsi langsung boleh bila kompatibel dan akses/lisensi/dependency diperiksa |
| Vue / Svelte / HTML-CSS | Adaptasi pola tanpa memaksakan runtime React |
| Flutter / native mobile | Referensi UIArc diterjemahkan; kontrol/navigasi/a11y mengikuti platform |
| REST API / CLI / library tanpa UI | UIArc N/A; fokus schema/operation/help/error/testing/distribution |
| Static landing page | UIArc mapping untuk bagian UI; jangan menambahkan auth/database tanpa kebutuhan |
| Data pipeline / automation | Fokus data contract, trigger, quality, idempotency, recovery, observability |
| Low-code / managed platform | Catat kontrol delegated dan platform-limited; jangan memaksakan akses server |

## 13. Troubleshooting

| Gejala | Tindakan |
|---|---|
| Agent hanya menaruh link UIArc umum | Minta map per layar/tipe komponen dengan URL spesifik, prinsip, dan adaptasi |
| Agent memaksa React/Tailwind | Rujuk strategi lintas stack §3.3 kontrak |
| Semua desain terlihat sama | Minta komposisi sesuai domain/brand dan alasan adaptasi, tetap memakai referensi |
| Situs tidak bisa diakses | Gunakan cache yang memadai atau tandai pending; lanjutkan pekerjaan independen |
| Item berbayar dianggap bebas dipakai | Periksa sumber/lisensi dan pilih alternatif yang sesuai akses |
| Agent membuat terlalu banyak dokumen | Gunakan LITE/section gabungan dan applicability ledger |
| Agent terus meminta approval | Tegaskan scope yang sudah diotorisasi; gate readiness bukan approval baru |
| Blueprint diklaim release-ready | Minta evidence implementasi/test/operasi; dokumen umumnya hanya sampai Gate C |
| Agent mengarang riset/test | Minta lokasi bukti dan level E; tandai unverified bila tidak ada |
| Konteks hilang | Gunakan RESUME dengan manifest dan file terkini |

Perintah praktis: LANJUT, LANGSUNG, STATUS, RINGKAS, DETAIL, REFERENSI UIARC, AUDIT DESIGN, AUDIT SECURITY, DIFF, LINT DOCS, RESUME.

<!-- END STARTER-PROMPT v7.0.0 -->
