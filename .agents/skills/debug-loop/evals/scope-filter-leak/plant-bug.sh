#!/usr/bin/env bash
# 在 repo 根目錄執行：移除問題清單的元件範圍篩選（tests/fixtures/mutations-component-scope.json「問題清單沒篩元件」）並提交，模擬回報的錯誤
set -eu
node -e 'const fs=require("fs");const f="&&(sc===null||sc.own.has(x.id))&&";const h=fs.readFileSync("spi-spc.html","utf8");if(h.split(f).length!==2)process.exit(1);fs.writeFileSync("spi-spc.html",h.replace(f,"&&"))'
git -c user.name=dev -c user.email=dev@example.invalid commit -qam "refactor: 簡化問題清單篩選條件"
