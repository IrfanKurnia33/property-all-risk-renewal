# Alur draft quotation renewal Property All Risks (v2)

Berdasarkan diskusi dengan Falih yang membahas renewal flow versi pertama (`docs\renewal-flow-v1`), berikut alur draft versi kedua yang telah disesuaikan dengan alur kerja di MIR Group.

## BAGIAN 1: Koordinasi Broker (MIR) dengan Asuransi (*Insurer*)

### Step 1: Start dari Bahan Renewal

- Broker punya file (.docx) quotation tahun lalu.
- **PENTING:** Di sini, klien belum memiliki peran, karena broker masih hanya berkoordinasi dengan asuransi.

Biasanya, sumber yang digunakan Falih (MIR) untuk membuat *renewal quotation slip* adalah:

1. ***Final Slip* dari periode sebelumnya:** Karena *final slip* adalah T&C yang sudah disepakati oleh broker, klien, dan asuransi pada periode lalu, yang dimana apabila klien tidak mengajukan klaim, maka asuransi cenderung akan menerima T&C yang sama dengan periode sebelumnya.
2. ***Standard T&C:*** Mengapa masih dibandingkan dengan *Standard T&C*? Karena bisa saja terdapat perubahan yang terjadi, yang mana lebih menguntungkan klien.

### Step 2: Mengirim Quotation

Broker mengirim *quotation* (yang biasanya berasal dari *final slip* periode sebelumnya) ke pihak asuransi.

### Step 3A dan 3B: Review

Broker dan Asuransi melakukan peninjauan. Lihat `docs\renewal-flow-v2\Step-3A-dan-3B.svg` untuk konteks. Proses ini terus berjalan *back-and-forth* hingga muncul kesepakatan antara Broker dan Asuransi.

### Step 4: Proposal

Setelah negosiasi dengan Asuransi mencapai kesepakatan, Broker akan membuat dan mengirimkan proposal perpanjangan asuransi ke pihak **Klien**.

Pihak broker harus memerika nama, alamat, dan atribut data lain untuk *matching* lokasi. Di sini, broker melihat dari nilai tahun lalu, update terkini, sumber konfirmasi, dan status terbaru.

Di step ini, Falih dari pihak broker harus bisa tahu mana saja data atau detail yang belum cocok untuk dilakukan *follow-up*.

## BAGIAN 2: Koordinasi Broker (MIR) dengan Klien

### Step 5: Review oleh Klien

**Klien** meninjau, dan melakukan *update data* (seperti lokasi usaha, nilai *sum insured*, dan lain-lain).

### Step 6: Melihat perbandingan data.

Lihat `docs\renewal-flow-v2\Step-6.svg` untuk konteks. Di sini, broker melakukan pemeriksaan data terkini.

Apabila data belum sesuai/cocok, broker akan kembali berkoordinasi dengan klien untuk mendapatkan/memastikan lokasi lama dan baru beserta nilainya. Broker juga mencatat konfirmasi.

> Jika data belum sesuai, *draft export* akan ditahan dan kita kembali ke **Step 4: Proposal**.

### Step 6: Final Review

> **Catatan dari Falih:** Broker tidak memiliki approval yang bersifat formal. Broker hanya membantu terjadinya *approval* antara klien dan pihak asuransi.
>
> Broker hanya boleh meninjau data, dan **TIDAK BOLEH** memasukkan nilai pertanggungan atau lokasi. Semua konfirmasi detail data harus diperoleh dari klien.

Di tahap ini, broker memastikan semua lokasi, perubahan nilai dari yang lama ke yang baru itu sesuai (beserta konfirmasinya). Falih juga melakukan *double-checking* terhadap periode, rate/premi, *deductibles*, dan klausulnya. Klausul lama tetap utuh, usulan perubahan (amandemen) dicatat secara terpisah.

> Export data hanya dilakukan setelah semua rincian jelas.

### Step 7: End

Setelah broker mendapat semua data yang *updated* dan persetujuan klien untuk perpanjangan, broker akan *binding* perpanjangan ke pihak asuransi. Kemudian asuransi akan berstatus aktif sesuai periode barunya.