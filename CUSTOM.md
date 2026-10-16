# 9Router Custom — Panduan Kelola

Branch:

- `master` — salinan murni upstream (`decolua/9router`). Jangan diedit.
- `custom` — `master` + fitur custom (API Key Limit). Ini yang di-deploy.

Fitur custom hanya menyentuh **3 file upstream** (ditandai komentar `// custom:`):

| File | Isi |
|---|---|
| `src/dashboardGuard.js` | gate request `/v1*` → 503 jika limit expired/disabled/kuota habis; `/images/generations` juga ditolak jika sisa kuota < 5jt (GPT Image: < 12jt); request chat key berkuota yang membawa tool `image_generation` (codex/grok-cli) di-rewrite ke `/api/custom/chat`, yang membuang tool itu lalu memanggil `POST` route upstream aslinya → chat tetap jalan, gambar hanya lewat `/images/generations` |
| `src/lib/db/repos/usageRepo.js` | catat pemakaian token ke limit (token asli dari endpoint gambar diabaikan) |
| `src/sse/handlers/imageGeneration.js` | gate "Restrict access" per key dinonaktifkan → key restricted tetap bisa semua model text-to-image; setiap generate sukses memotong 5jt token flat; model GPT Image memotong 12jt per gambar (`chargeImageGeneration`) |

Sisanya file baru (tidak pernah konflik): `tests/unit/custom-image-key-access.test.js`, `src/lib/apiKeyLimits/`, `src/app/api/api-key-limits/`, `src/app/api/custom/chat/`, `src/app/(dashboard)/dashboard/limits/`, `src/app/p/[slug]/`, `tests/unit/api-key-limits.test.js`, `tests/unit/custom-chat-route.test.js`, `CUSTOM.md`.

DB limit (`api-key-limits.sqlite` di `~/.9router/`) dibuat otomatis saat pertama dipakai.

> ⚠️ **Jangan pernah** `npm install -g 9router` / `npm update -g 9router`, dan **jangan klik "Update"** di menu CLI atau dashboard — semuanya memasang versi resmi npm dan menimpa custom.

---

## 1. Setup lokal (sekali saja)

```bash
git remote set-url origin https://github.com/mochalvi/9router.git
git remote add upstream https://github.com/decolua/9router.git
git config rerere.enabled true   # git ingat resolusi konflik, tidak perlu resolve ulang
```

---

## 2. Update dari upstream (di lokal)

```bash
git fetch upstream
git checkout master && git merge --ff-only upstream/master && git push origin master
git checkout custom && git rebase master
```

Jika konflik (hanya mungkin di file di atas): perbaiki, pertahankan baris `// custom:`, lalu

```bash
git add <file> && git rebase --continue      # batal: git rebase --abort
```

Test (opsional tapi disarankan):

```bash
cd tests && npx vitest run unit/api-key-limits.test.js unit/custom-image-key-access.test.js && cd ..
```

> Di `unit/key-access-handlers.test.js` (upstream), 2 test **"image handler is wired"** ("denies an unlisted model…" dan "denies everything for the empty-list key") **memang gagal** — karena image dikecualikan dari restriction. Abaikan.

Push (wajib `--force-with-lease` karena rebase mengubah history):

```bash
git push --force-with-lease origin custom
```

Lalu deploy (bagian 4).

---

## 3. Install pertama di VPS

Butuh Node.js 20+, npm, git.

```bash
pkill -f "9router" || true                  # jika sebelumnya ada 9router resmi
cp -a ~/.9router ~/.9router.backup 2>/dev/null || true

cd /opt
git clone -b custom https://github.com/mochalvi/9router.git
cd 9router
```

Lanjut ke langkah **Build & pasang** di bagian 4. Data lama di `~/.9router` (provider, API key, setting) tetap terpakai.

---

## 4. Deploy / update di VPS

```bash
cd /opt/9router
git fetch origin && git reset --hard origin/custom   # bukan "git pull": aman setelah force-push
```

**Build & pasang:**

```bash
npm install && npm --prefix cli install
rm -rf .next-cli-build
NODE_OPTIONS="--max-old-space-size=3072" npm --prefix cli run build

pkill -f "9router" || true
npm uninstall -g 9router
npm install -g ./cli
hash -r
9router --version
9router
```

Catatan:

- `npm --prefix cli run build` sudah termasuk build Next.js dan membersihkan `cli/app` sendiri.
- `NODE_OPTIONS=...3072` mencegah build gagal karena heap out of memory.
- `npm uninstall -g` sebelum `install -g ./cli` memastikan binary global lama tidak tertinggal.
- VPS tidak boleh berisi edit manual — `reset --hard` akan membuangnya. Semua perubahan lewat lokal → push.

---

## 5. Rollback cepat

```bash
cd /opt/9router
git reflog                     # cari commit sebelumnya
git reset --hard <commit>
# lalu ulangi "Build & pasang" di bagian 4
```

Data: `cp -a ~/.9router.backup ~/.9router` (stop 9router dulu).
