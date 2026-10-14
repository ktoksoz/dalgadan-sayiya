#!/bin/sh
# DreamHost'a yükle. Kullanım: tools/deploy.sh [KULLANICI@SUNUCU]  (varsayılan: koray@koraytoksoz.com)
# index.html'i parçalardan yeniden kurar, CSS/JS sürüm etiketini (?v=...) tarih-saatle yeniler,
# sonra yalnızca değişen dosyaları gönderir.
set -e
HOST="${1:-koray@koraytoksoz.com}"
cd "$(dirname "$0")/.."
python3 tools/assemble.py
V=$(date +%Y%m%d%H%M)
sed -i '' -E "s/\?v=[0-9]+\"/?v=$V\"/g" index.html
echo "Sürüm etiketi: $V"
rsync -avz \
  --exclude tools --exclude tests --exclude README.md --exclude PLAN.md --exclude .DS_Store --exclude .git \
  ./ "$HOST:~/sdr.koraytoksoz.com/"
echo "Yüklendi: https://sdr.koraytoksoz.com"
