# 📺 YouTube Smart Scheduler

Otomatik analiz ile en iyi yayın saatlerini bulan ve videoları planlayan sistem.

---

## 🏗️ Proje Yapısı

```
youtube-scheduler/
├── src/
│   ├── index.js                  # Express server giriş noktası
│   ├── routes/
│   │   └── index.js              # Tüm API route'ları
│   ├── services/
│   │   ├── authService.js        # Google OAuth2
│   │   ├── analyticsService.js   # Analytics API + skor hesaplama
│   │   ├── uploadService.js      # Video upload (Data API v3)
│   │   ├── schedulerService.js   # Cron jobs + otomatik zamanlama
│   │   └── dbService.js          # SQLite veri katmanı
│   └── utils/
│       └── logger.js             # Winston logger
├── dashboard/
│   └── index.html                # Web dashboard
├── data/                         # Otomatik oluşturulur
│   ├── scheduler.db              # SQLite veritabanı
│   ├── tokens.json               # OAuth tokens
│   └── logs/                     # Log dosyaları
├── .env.example                  # Örnek env dosyası
└── package.json
```

---

## 🔑 1. Google API Kurulumu

### A. Google Cloud Console'da Proje Oluştur
1. https://console.cloud.google.com adresine git
2. **New Project** → isim ver → Create

### B. API'leri Aktifleştir
Sol menü → **APIs & Services** → **Enable APIs** →  
Şunları ara ve enable et:
- ✅ **YouTube Data API v3**
- ✅ **YouTube Analytics API**

### C. OAuth2 Credentials Oluştur
1. **APIs & Services** → **Credentials** → **Create Credentials** → **OAuth Client ID**
2. Application type: **Web application**
3. Authorized redirect URIs'e ekle:
   ```
   http://localhost:3000/auth/callback
   ```
4. **Client ID** ve **Client Secret**'ı kopyala

### D. OAuth Consent Screen Ayarla
1. **OAuth consent screen** → External → Create
2. App name, email gir
3. Scopes ekle:
   - `https://www.googleapis.com/auth/youtube`
   - `https://www.googleapis.com/auth/yt-analytics.readonly`
4. Test users'a kendi emailini ekle

---

## 🚀 2. Kurulum

```bash
# Projeyi indir veya kopyala
cd youtube-scheduler

# Bağımlılıkları kur
npm install

# .env dosyasını oluştur
cp .env.example .env
```

`.env` dosyasını düzenle:
```env
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/callback
YOUTUBE_CHANNEL_ID=UCxxxxxxxxxxxxxxxxxxxxxxxx
PORT=3000
```

**Channel ID Nerede?**  
YouTube Studio → Ayarlar → Kanal → Gelişmiş → Channel ID (UC ile başlar)

---

## 🖥️ 3. Çalıştırma

```bash
# Geliştirme modu (auto-restart)
npm run dev

# Prodüksiyon
npm start
```

Tarayıcı: http://localhost:3000

---

## 🔐 4. İlk Kimlik Doğrulama

1. http://localhost:3000/auth/login adresine git
2. Google hesabınla giriş yap
3. Tüm izinleri onayla
4. Dashboard'a yönlendirileceksin
5. **"Run Analysis"** butonuna bas

---

## 📡 API Endpoint'leri

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| GET | `/auth/status` | Auth durumu |
| GET | `/auth/login` | OAuth başlat |
| GET | `/auth/callback` | OAuth callback |
| POST | `/api/analyze` | Analytics çalıştır |
| GET | `/api/analysis/latest` | Son analiz |
| GET | `/api/uploads/scheduled` | Planlanmış uploadlar |
| POST | `/api/uploads/auto-schedule` | Otomatik zamanlama |
| POST | `/api/uploads/schedule` | Manuel zamanlama |
| POST | `/api/uploads/now` | Hemen upload |
| GET | `/api/notifications` | Bildirimler |

---

## 🧠 Skor Algoritması

```
score = (views × 0.5) + (watchTime × 0.3) + (avgViewDuration × 0.2)
```

Her metrik normalize edilir (0–1), ardından ağırlıklı ortalama alınır.  
En yüksek skor → en iyi yayın saati.

---

## ⚙️ Cron Zamanlamaları

| Job | Sıklık | Açıklama |
|-----|--------|----------|
| Analytics | Her 24 saat | Analizi yeniler |
| Upload checker | Her 1 dakika | Planlanan uploadları kontrol eder |

---

## 🐛 Sorun Giderme

**"No auth tokens" hatası**  
→ `/auth/login` adresine git ve tekrar authorize ol

**"YOUTUBE_CHANNEL_ID not set" hatası**  
→ `.env` dosyasında `YOUTUBE_CHANNEL_ID`'yi kontrol et

**Analytics boş geliyor**  
→ Kanalın en az 30 günlük verisi olmalı  
→ YouTube Studio'da Analytics görünüyor mu kontrol et

**Upload quota hatası**  
→ YouTube Data API günlük 10.000 unit limit var  
→ Upload = ~1600 unit (günde max ~6 upload)
