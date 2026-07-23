# Blueprint High-Level — AI-Powered News Dashboard

> **Status:** Draft untuk review (revisi setelah diskusi produk)  
> **Tujuan:** Menyetujui arah — belum implementasi / dokumen detail.

---

## 1. Apa produk ini

Dashboard **B2B decision-support** untuk manajemen perusahaan klien. **Terpisah** dari portal berita publik EGI Media.

- Bukan agregator berita; bukan pengambil keputusan otomatis.
- Membantu menjawab: apa terjadi → kenapa penting bagi perusahaan → dampak → risiko → apa yang dipantau.
- Sumber berita: artikel **published** editorial EGI Media (`egi-media-backend`).

**Pembagian tanggung jawab:**

| Siapa | Peran |
|---|---|
| **AI (nano)** + sistem | Membentuk isu, label, ranking daftar |
| **AI (mini)** | Insight / analisa dalam + narasi laporan |
| **Manusia** | Koreksi isu, review laporan, keputusan bisnis |

---

## 2. Constraint & model

| Model | Peran |
|---|---|
| `gpt-5-nano-2025-08-07` | Klasifikasi & ringkasan ringan — **satu tujuan per panggilan** |
| `gpt-5-mini-2025-08-07` | Analisa mendalam, alasan prioritas, narasi laporan |

- **Tanpa embedding / tanpa vector DB.**
- **Tanpa hard prefilter** (rules/keyword **tidak** membuang artikel sebelum nano). Keputusan relevansi = **nano**.
- Output AI **tidak langsung trusted** — backend validasi schema & business rule dulu.
- Dilarang satu panggilan yang sekaligus classify + summarize + analyze.

---

## 3. Konsep inti (wajib dipahami)

| Konsep | Arti |
|---|---|
| **Ingest** | Ambil & siapkan artikel dari backend. Belum ada penilaian bisnis. |
| **Relevansi** | “Artikel ini terkait Company Context?” → `high` / `medium` / `low` / `none`. **Bukan** penentu top 5. |
| **Isu** | Satu **topik/event** untuk perusahaan. **Isu ≠ artikel.** Banyak artikel relevan bisa mengisi **satu** isu. |
| **Analisa** | Insight **per isu** (bahan = seluruh artikel yang ter-link ke isu itu + Company Context). |
| **Prioritas** | `tinggi` / `sedang` / `rendah` — seberapa mendesak isu diperhatikan. Dipakai untuk ranking. |
| **Top 5** | Filter **tampilan** dashboard default setelah prioritas ada — **bukan** batas jumlah analisa. |

Contoh: 100 artikel hari ini → 30 relevan → **bukan** otomatis 30 isu (bisa jauh lebih sedikit setelah cluster baru/update).

---

## 4. Halaman (ringkas)

Dari mockup (sumber kebenaran fitur):

1. **Onboarding** — tur + setup Company Context  
2. **Executive Summary** — isu prioritas (default maks. **5**)  
3. **Alerts** — inbox email peringatan  
4. **Reports** — harian / mingguan / bulanan + review  
5. **Saved** — bookmark  
6. **Settings** — Company Context & preferensi  

---

## 5. Alur high-level (urutan)

```text
Ingest artikel (backend)
  → Relevansi vs Company Context          [nano]
  → jika bukan none:
       Isu: baru vs update isu aktif      [nano]
       + judul + one-liner                [nano, panggilan terpisah]
  → Analisa insight per isu               [mini]
       (+ label fakta/analisis/asumsi)    [nano, setelah mini]
  → Prioritas enum + alasan               [nano enum; mini alasan]
  → Alert (kelayakan + kirim)             [aturan + nano label; lihat §7]
  → Laporan terjadwal                     [mini narasi; metrik = backend]
  → Dashboard: urut prioritas → top 5     [backend / rules]
```

### Detail singkat per tahap

1. **Ingest** — tarik artikel published; siapkan data (list/detail sesuai kebutuhan tahap berikutnya).  
2. **Relevansi** — nano klasifikasi terhadap Company Context; input tipikal: judul + **summary** (+ context). Yang `none` di-log & tidak lanjut jadi isu.  
3. **Isu** — nano: baru atau update isu aktif (jendela kemiripan tipikal ~7 hari). Analis boleh merge/split.  
4. **Analisa** — mini menulis apa/mengapa/dampak/risiko/pantauan **per isu**; sumber = artikel yang ter-link ke isu (bisa banyak). Dilakukan untuk isu **baru** atau **ter-update** — bisa lebih dari 5.  
5. **Prioritas** — beda dari relevansi. Butuh hasil analisa + context. Nano = label; mini = alasan.  
6. **Ranking dashboard** — backend: `tinggi→sedang→rendah`, dalam tier sama urut **paling baru update**, ambil **5**. Sisanya tetap ada (search/laporan/drawer).  
7. **Alert & laporan** — lihat §6–§7.

---

## 6. Pembagian nano vs mini vs rules

**Nano** — volume tinggi, sempit (satu tujuan per call):

- Klasifikasi relevansi (+ alasan singkat di call terpisah, jika dipakai)
- Baru vs update isu; judul; one-liner
- Label fakta / analisis / asumsi (setelah analisa mini)
- Enum prioritas; label kelayakan alert
- Blurb pendek email **langsung** saja (lihat §7)
- Rewrite terbatas setelah manusia edit ringkasan

**Mini** — mendalam:

- Draft Company Context (12 field) dari dokumen/URL
- Analisa multi-bagian grounded ke perusahaan
- Alasan prioritas
- Narasi laporan (harian/mingguan/bulanan)

**Rules / backend (tanpa LLM):**

- Ranking & tampilan dashboard maks. **5** (default view)
- Gate kirim email (dedupe, quiet hours, preferensi, “tidak kirim ulang tanpa perkembangan”)
- Agregasi metrik untuk laporan (jumlah isu, delta WoW/MoM, dll.)
- Fallback schema-fail
- Template HTML/teks email

**Ditunda:** pembelajaran otomatis dari feedback.

---

## 7. Alert & email (aturan dikunci — tanpa “kadang”)

Alert bergantung pada **prioritas + adanya perkembangan baru + aturan kirim**, bukan prioritas saja.

### Pemetaan channel (produk — masih bisa dikunci lebih ketat di §9)

| Kondisi | Channel |
|---|---|
| `tinggi` + isu baru / update material | Email **langsung** |
| `sedang` + ada perkembangan baru | **Ringkasan harian** |
| `rendah` atau tanpa perkembangan baru | Tidak email (dashboard saja) |

### Siapa menulis isi email

| | Langsung | Ringkasan harian |
|---|---|---|
| Kerangka (subject pattern, layout, CTA) | **Template tetap** | **Template tetap** |
| Judul, prioritas, one-liner, link | **Data isu existing** (wajib) | **Data isu existing** (wajib) |
| Blurb “perkembangan baru” / “dampak singkat” | **Nano — selalu** (field pendek saja) | **Tidak** — tidak pakai nano |
| Mini | **Tidak pernah** untuk email operasional | **Tidak pernah** |

Jika field wajib kosong → **email tidak dikirim** (bukan diisi LLM seadanya).

---

## 8. Laporan

- Sumber = **isu + insight + prioritas** yang sudah ada — bukan rangkuman 100 artikel mentah.
- **Harian** — isu dengan perkembangan baru (fokus prioritas lebih tinggi).  
- **Mingguan** — isu aktif minggu itu + banding minggu lalu.  
- **Bulanan** — tren sebulan + banding bulan lalu.  
- Bisa mencakup **lebih dari top 5** dashboard.  
- Narasi = **mini**; angka/agregat = **backend**.

---

## 9. Sentuhan backend / frontend

- Artikel: **`egi-media-backend`** (read-only bagi produk AI).
- List biasanya tanpa full content → detail saat perlu body.
- URL sitasi portal publik: `/{locale}/articles/{id}`.
- Produk AI: datastore + UI sendiri (`egi-media-ai-frontend`); tidak menulis balik DB editorial.
- **Company switcher** (satu akun, banyak entitas) ≠ **multi-tenant** (isolasi antar klien bayar).

---

## 10. Yang sudah diarahkan vs masih OPEN

### Sudah diarahkan (konfirmasi)

- Tidak semua artikel → isu; tidak semua isu → alert.
- Relevansi = nano (bukan hard prefilter); relevansi ≠ top 5.
- Isu ≠ artikel; analisa = per isu (sumber = artikel ter-link).
- Analisa untuk isu baru/ter-update (boleh >5); top 5 = tampilan setelah prioritas.
- Prioritas setelah analisa; ranking top 5 = backend.
- Email: template + data isu; nano hanya blurb email langsung; digest tanpa nano; mini tidak menulis email.
- Laporan dari isu/insight; narasi mini.
- Tanpa embedding/vector; satu prompt = satu tujuan.

### Masih OPEN

1. Ambang pasti “update material” & apakah `tinggi` saja cukup untuk langsung.  
2. Kriteria merge isu / ownership taksonomi (selain jendela ~7 hari).  
3. Payload handoff nano → mini.  
4. Binding sitasi ketat (tolak URL/ID fiktif).  
5. Output mana wajib human review sebelum kirim email/share laporan.  
6. Isolasi multi-tenant AI per klien.  
7. Kebijakan schema-fail (reject / retry / antrian manusia).  
8. Ekstraksi Company Context: mini selalu vs nano untuk sumber pendek.  
9. Setelah ambang alert dikunci: eligibility full rules-only vs tetap soft-label nano.  
10. Kapan feedback learning diaktifkan.

---

## 11. Selanjutnya

Dokumen teknis untuk Data Engineer & AI Engineer:

- **`AI-Dashboard-Technical-Detail.md`** (root)

Implementasi tetap menunggu item **OPEN** yang kritis dikunci (terutama ambang alert & update material). Item detail prompt file per task / schema JSON final bisa diturunkan dari dokumen teknis itu.
