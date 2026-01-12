#!/bin/bash
# テスト用HEICファイルをダウンロード
# 参照: https://github.com/nicothin/sample-heic-images

FIXTURES_DIR="$(dirname "$0")"

# 小さなサンプルHEICファイルをダウンロード
curl -L -o "${FIXTURES_DIR}/sample.heic" \
  "https://github.com/nicothin/sample-heic-images/raw/main/sample1.heic"

echo "Downloaded sample.heic to ${FIXTURES_DIR}/"
ls -la "${FIXTURES_DIR}/sample.heic"
