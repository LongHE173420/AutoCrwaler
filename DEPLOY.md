# Deploy TikTokCrawler

Tai lieu nay dung cho mo hinh:

- Build o local
- Upload ban build len server Linux
- TikTokCrawler chay bang PM2 tai `/home/vndic/tiktok-crawler`
- Video usable duoc luu tai `/home/vndic/tiktok-crawler/data/videos/raw`
- AutoEric doc chung DB va lay video qua `local_path`

## 1. Cau truc thu muc tren server

Can co cac thu muc runtime sau:

```text
/home/vndic/tiktok-crawler/
  data/
    cookies/
    logs/
    videos/
      raw/
      tmp/
```

Tao thu muc:

```bash
mkdir -p /home/vndic/tiktok-crawler/data/cookies
mkdir -p /home/vndic/tiktok-crawler/data/logs
mkdir -p /home/vndic/tiktok-crawler/data/videos/raw
mkdir -p /home/vndic/tiktok-crawler/data/videos/tmp
```

## 2. Build o local

Di chuyen vao project:

```bash
cd D:\React_Native\Demo\TikTokCrawler
```

Neu dang dung PowerShell tren Windows:

```bash
npm.cmd install
npm.cmd run build
```

Neu muon test ban build tai local:

```bash
npm.cmd run start:prod
```

## 3. File can upload len server

Chi upload cac file/thu muc runtime:

- `dist/`
- `package.json`
- `package-lock.json`
- `ecosystem.config.cjs`
- `.env`
- `data/` neu muon dua san cookie file

Khong upload:

- `src/`
- `tsconfig.json`
- `node_modules/`
- `data/videos/raw` tu may Windows

## 4. Mau `.env` cho server Linux

Khuyen nghi copy tu `.env.server.example` roi sua lai:

```bash
cp .env.server.example .env
```

Gia tri quan trong:

```text
VIDEO_DOWNLOAD_DIR=/home/vndic/tiktok-crawler/data/videos/raw
FFMPEG_PATH=/usr/bin/ffmpeg
FFPROBE_PATH=/usr/bin/ffprobe
TIKTOK_BROWSER=none
MAX_POSTS_PER_VIDEO=1
```

Ghi chu:

- `TIKTOK_BROWSER=none` de server khong co dinh doc Chrome profile local
- neu co file cookie that su, dat vao `data/cookies/bot_session.txt`
- `MAX_POSTS_PER_VIDEO=1` nen dong bo voi AutoEric

## 5. Cai dependency he thong tren server

SSH vao server:

```bash
ssh vndic@103.141.144.82
cd /home/vndic/tiktok-crawler
```

Cai dependency Node:

```bash
npm ci --omit=dev
```

Neu server chua co PM2:

```bash
sudo npm install -g pm2
```

Cai binary he thong:

```bash
sudo apt-get update
sudo apt-get install -y ffmpeg python3 python3-pip
sudo pip3 install yt-dlp
```

Kiem tra:

```bash
which ffmpeg
which ffprobe
which yt-dlp
```

## 6. Chay app tren server

Khoi dong bang PM2:

```bash
npm run pm2:start
```

Xem log:

```bash
npm run pm2:logs
```

Kiem tra trang thai:

```bash
pm2 list
pm2 show tiktok-crawler
```

## 7. Kiem tra de AutoEric lay duoc video

Sau khi crawler chay, can xac nhan:

1. Server co file `.mp4` trong:

```bash
ls -lah /home/vndic/tiktok-crawler/data/videos/raw
```

2. DB co row usable:

- `downloaded = 1`
- `local_path` bat dau bang `/home/vndic/tiktok-crawler/data/videos/raw/`
- `post_count = 0`

3. Khong con row moi nao tro toi path Windows `D:\...`

Khi 3 dieu kien nay dung, AutoEric tren server se lay duoc video de dang.

## 8. Deploy lai khi co code moi

Tai local:

```bash
cd D:\React_Native\Demo\TikTokCrawler
npm.cmd run build
```

Upload lai:

- `dist/`
- `package.json` neu dependency hoac script thay doi
- `package-lock.json` neu dependency thay doi
- `ecosystem.config.cjs` neu doi PM2 config
- `.env` neu doi bien moi truong

Tren server:

```bash
cd /home/vndic/tiktok-crawler
npm ci --omit=dev
npm run pm2:restart
```

## 9. Dung, restart, xoa

Dung:

```bash
npm run pm2:stop
```

Restart:

```bash
npm run pm2:restart
```

Xoa khoi PM2:

```bash
npm run pm2:delete
```

## 10. Cho PM2 tu chay lai sau reboot

Chay mot lan tren server:

```bash
pm2 save
pm2 startup
```

## 11. Ghi nho

- PM2 chay truc tiep `dist/index.js`
- Server khong can source TypeScript de run
- TikTokCrawler phai ghi `local_path` Linux that su de AutoEric mo file duoc
- Neu khong co cookie usable, crawl TikTok co the bi han che tuy seed
- Neu app loi, uu tien kiem tra `npm run pm2:logs`
