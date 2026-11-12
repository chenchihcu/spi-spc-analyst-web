// 登入頁顯示的版本與更新時間的原始碼預設值；必須與主頁（spi-spc.html 的 #appVer／#appBuilt）一致，測試會檢查
// APP_BUILT 不隨提交更新：tools/build-cloudflare.mjs 在 build 時把實際時間寫進 dist/index.html 與 .build/build-info.mjs，
// Worker 經 package.json 的 #build-info（workerd 條件）讀 build 產物，Node 測試讀本檔
export const APP_VERSION = "v10.22.1";
export const APP_BUILT = "0000-00-00 00:00:00";
