// AI 服務商一致性（靜態）：頁面與後端依型錄能力欄位分支，不比對服務商名稱；共用按鈕名稱與型錄同步
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AI_CHECK_MODELS_BTN, AI_PROVIDER_CATALOG } from '../lib/ai-providers.mjs';
import { formatUpstreamFailureMessage } from '../cloudflare/ai.mjs';

const html = readFileSync(new URL('../spi-spc.html', import.meta.url), 'utf8');
const server = readFileSync(new URL('../cloudflare/ai.mjs', import.meta.url), 'utf8');

test('後端錯誤訊息不比對服務商名稱；三個服務商用同一個按鈕名稱', () => {
  assert.doesNotMatch(server, /provLabel\s*===|PROVIDERS\.nvidia/);
  assert.doesNotMatch(server, /更新模型清單/);
  for (const p of AI_PROVIDER_CATALOG) {
    const msg = formatUpstreamFailureMessage(p.label, 404, { message: 'The model `x` does not exist', code: 'model_not_found' }, false);
    assert.match(msg, new RegExp(`「${AI_CHECK_MODELS_BTN}」`), p.id);
    const zero = formatUpstreamFailureMessage(p.label, 429, { message: 'limit: 0', hasLimitZero: true }, false);
    assert.ok(zero.includes(p.ui.consoleName), `${p.id} 額度為 0 時指向 ${p.ui.consoleName}`);
  }
});

test('頁面 AI 設定不手寫各服務商欄位，按鈕名稱與型錄相同', () => {
  assert.match(html, new RegExp(`const AI_CHECK_MODELS_BTN="${AI_CHECK_MODELS_BTN}"`));
  assert.doesNotMatch(html, /更新模型清單/);
  assert.doesNotMatch(html, /data-ai-prov="(?:openai|antigravity|nvidia)"/, '服務商切換鈕由型錄產生');
  for (const p of AI_PROVIDER_CATALOG) assert.doesNotMatch(html, new RegExp(`id="${p.ui.inputId}"`), `${p.id} 金鑰欄位由型錄產生`);
  assert.doesNotMatch(html, /<option value="o4-mini"/, '不留已移除的靜態模型選項');
});
