const tick = (ms) => new Promise((r) => setTimeout(r, ms));

export async function until(fn, n = 150, step = 20) {
  for (let i = 0; i < n; i++) {
    if (fn()) return true;
    await tick(step);
  }
  return false;
}

export function openPickerTab(d, tab = 'spi') {
  d.querySelector('#btnOpenRecModal')?.click();
  const btn = tab === 'place' ? '#btnPickPlace' : tab === 'specs' ? '#btnPickSpecs' : '#btnPickSpi';
  d.querySelector(btn)?.click();
}

export async function openPlacePicker(d) {
  d.querySelector('#btnSelectPlace')?.click();
  if (d.querySelector('#recPickerModal')?.hidden) {
    openPickerTab(d, 'place');
  }
  await until(() => d.querySelector('#recPickerModal') && !d.querySelector('#recPickerModal').hidden);
}

export async function uploadPlaceViaPicker(w, d, { part, rev, side = 'TOP', unit = 'mm', body, name = 'place.csv' }) {
  await openPlacePicker(d);
  const $ = (s) => d.querySelector(s);
  $('#upPlacePart').value = part;
  $('#upPlaceRev').value = rev;
  $('#upPlaceSide').value = side;
  $('#upPlaceUnit').value = unit;
  const inp = $('#upPlaceFile');
  Object.defineProperty(inp, 'files', { configurable: true, value: [new w.File([body], name)] });
  inp.dispatchEvent(new w.Event('change'));
  await until(() => $('#upPlaceFileName')?.textContent === name || /單位|預覽|失敗/.test($('#upPlaceState')?.textContent || ''));
  for (let attempt = 0; attempt < 4; attempt++) {
    $('#btnSubmitPlace')?.click();
    const ok = await until(
      () => /已存入座標檔/.test($('#upPlaceState')?.innerHTML || '') || /上傳失敗/.test($('#upPlaceState')?.textContent || ''),
      80
    );
    if (ok && /已存入|上傳失敗/.test($('#upPlaceState')?.textContent || $('#upPlaceState')?.innerHTML || '')) break;
    if (/相近/.test($('#upPlaceState')?.innerHTML || '')) continue;
    break;
  }
  const failed = /上傳失敗/.test($('#upPlaceState')?.textContent || '');
  if (!failed && part && rev) {
    await applyPlaceFromPicker(w, d, part, rev);
  }
}

export async function applyPlaceFromPicker(w, d, part, rev) {
  if (d.querySelector('#recPickerModal')?.hidden) await openPlacePicker(d);
  else if (!d.querySelector('#boxPickPlace') || d.querySelector('#boxPickPlace').hidden) {
    d.querySelector('#btnPickPlace')?.click();
  }
  await until(
    () => [...d.querySelectorAll('#tblPickPlace tr')].some(
      (tr) => tr.textContent.includes(part) && (!rev || tr.textContent.includes(rev)) && tr.querySelector('[data-pact="use-place"]')
    ),
    100
  );
  const row = [...d.querySelectorAll('#tblPickPlace tr')].find(
    (tr) => tr.textContent.includes(part) && (!rev || tr.textContent.includes(rev))
  );
  row?.querySelector('[data-pact="use-place"]')?.click();
  await until(
    () => w.SPI_TEST_HOOK.getPlace()?.part === part && (!rev || w.SPI_TEST_HOOK.getPlace()?.rev === rev),
    100
  );
  d.querySelector('#recPickerClose')?.click();
}

export function getPlacePart(w) {
  return w.SPI_TEST_HOOK.getPlace()?.part ?? '';
}

export function getPlaceRev(w) {
  return w.SPI_TEST_HOOK.getPlace()?.rev ?? '';
}

export async function openPickerReload(d) {
  openPickerTab(d, 'spi');
  await until(() => !d.querySelector('#recPickerModal')?.hidden);
  d.querySelector('#recPickerReload')?.click();
}

export async function openPickerSpecs(d) {
  openPickerTab(d, 'specs');
  await until(() => !d.querySelector('#recPickerModal')?.hidden);
  d.querySelector('#recPickerReload')?.click();
}
