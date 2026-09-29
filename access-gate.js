const ACCESS_SESSION_KEY = 'gt-parking-access-v1';
const ACCESS_CODE_KEY = 'gt-parking-access-code-v1';
const EXPECTED_HASH = '6ef3867147c600f4b7ff7b2e00d0468f6e3b33a1aa2b834bfacbe5bec47e1828';

const gate = document.querySelector('#access-gate');
const form = document.querySelector('#access-form');
const input = document.querySelector('#access-code');
const error = document.querySelector('#access-error');
let appStarted = false;

async function digest(value) {
  const bytes = new TextEncoder().encode(String(value || ''));
  const result = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...result].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function startApp() {
  if (appStarted) return;
  appStarted = true;
  await Promise.all([
    import('./app.js'),
    import('./sync-diagnostics.js')
  ]);
}

function openBoard(code) {
  if (code) sessionStorage.setItem(ACCESS_CODE_KEY, code);
  sessionStorage.setItem(ACCESS_SESSION_KEY, 'ok');
  document.body.classList.remove('access-locked');
  if (gate) gate.hidden = true;
  startApp().catch(console.error);
}

const savedCode = sessionStorage.getItem(ACCESS_CODE_KEY);
if (savedCode) {
  digest(savedCode).then(hash => {
    if (hash === EXPECTED_HASH) openBoard();
    else requestAnimationFrame(() => input?.focus());
  });
} else {
  requestAnimationFrame(() => input?.focus());
}

form?.addEventListener('submit', async event => {
  event.preventDefault();
  if (error) error.textContent = '';
  const candidate = await digest(input?.value || '');
  if (candidate !== EXPECTED_HASH) {
    if (error) error.textContent = 'Incorrect code.';
    if (input) {
      input.value = '';
      input.focus();
    }
    return;
  }
  openBoard(input.value);
  input.value = '';
});
