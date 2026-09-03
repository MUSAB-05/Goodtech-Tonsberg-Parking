import { APP_CONFIG } from './config.js';
import { ParkingBackend } from './backend-adapter.js';

const PENDING_KEY = 'gt-parking-pending-v1';
const backend = new ParkingBackend({
  baseUrl: APP_CONFIG.mantleBaseUrl,
  namespace: APP_CONFIG.mantleNamespace,
  key: APP_CONFIG.mantleKey,
  timeoutMs: 10000
});

let lastReport = 'Diagnostics have not been run yet.';
let running = false;

function pendingValue(entry) {
  if (entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'value')) return entry.value ?? null;
  return entry ?? null;
}

function readPending() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function savePending(pending) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(pending));
}

function describeError(error) {
  if (!error) return 'Unknown error';
  const bits = [];
  if (error.name) bits.push(`name=${error.name}`);
  if (error.kind) bits.push(`kind=${error.kind}`);
  if (error.status) bits.push(`status=${error.status}`);
  if (error.message) bits.push(`message=${error.message}`);
  if (error.cause?.name) bits.push(`cause=${error.cause.name}`);
  if (error.cause?.message) bits.push(`causeMessage=${error.cause.message}`);
  return bits.join(' | ') || String(error);
}

function ensureDialog() {
  let dialog = document.querySelector('#sync-diagnostics');
  if (dialog) return dialog;
  dialog = document.createElement('dialog');
  dialog.id = 'sync-diagnostics';
  dialog.className = 'picker diagnostics-dialog';
  dialog.innerHTML = `
    <div class="diagnostics-inner">
      <div class="picker-head">
        <div><p class="eyebrow">SYNC DIAGNOSTICS</p><h2>Shared storage check</h2></div>
        <button class="icon-button diagnostics-close" type="button" aria-label="Close">×</button>
      </div>
      <p class="diagnostics-help">This checks the connection from this exact browser. Your queued bookings are preserved.</p>
      <div id="diagnostics-summary" class="diagnostics-summary">Ready to test.</div>
      <pre id="diagnostics-output" class="diagnostics-output"></pre>
      <div class="diagnostics-actions">
        <button id="diagnostics-run" class="compact-button" type="button">Run test & retry</button>
        <button id="diagnostics-copy" class="compact-button" type="button">Copy report</button>
      </div>
    </div>`;
  document.body.appendChild(dialog);
  dialog.querySelector('.diagnostics-close').addEventListener('click', () => dialog.close());
  dialog.querySelector('#diagnostics-run').addEventListener('click', () => runDiagnostics(true));
  dialog.querySelector('#diagnostics-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(lastReport);
      dialog.querySelector('#diagnostics-summary').textContent = 'Diagnostic report copied.';
    } catch {
      dialog.querySelector('#diagnostics-summary').textContent = 'Could not copy automatically. Select the report text instead.';
    }
  });
  return dialog;
}

async function testDomainReachability(lines) {
  const origin = String(APP_CONFIG.mantleBaseUrl || 'https://mantledb.sh/v2').replace(/\/v2\/?$/, '');
  try {
    await fetch(`${origin}/?gt-parking-probe=${Date.now()}`, { mode: 'no-cors', cache: 'no-store' });
    lines.push('1. Mantle domain reachability: PASS');
    return true;
  } catch (error) {
    lines.push(`1. Mantle domain reachability: FAIL — ${describeError(error)}`);
    return false;
  }
}

async function testAuthenticatedApi(lines) {
  try {
    const ok = await backend.healthCheck();
    lines.push(`2. Authenticated Mantle API: ${ok ? 'PASS' : 'FAIL — unexpected health result'}`);
    return Boolean(ok);
  } catch (error) {
    lines.push(`2. Authenticated Mantle API: FAIL — ${describeError(error)}`);
    return false;
  }
}

async function reconcilePending(lines, shouldWrite) {
  const pending = readPending();
  const entries = Object.entries(pending);
  lines.push(`3. Local pending queue: ${entries.length} item${entries.length === 1 ? '' : 's'}`);
  if (!entries.length) return { before: 0, after: 0, recovered: 0 };

  lines.push(`   Keys: ${entries.map(([key]) => key).join(', ')}`);
  const changes = Object.fromEntries(entries.map(([key, entry]) => [key, pendingValue(entry)]));
  const months = [...new Set(entries.map(([key]) => String(key).slice(0, 7)))];
  let writeError = null;

  if (shouldWrite) {
    try {
      await backend.setBookings(changes);
      lines.push('4. Batch retry: PASS');
    } catch (error) {
      writeError = error;
      lines.push(`4. Batch retry: FAIL — ${describeError(error)}`);
    }
  } else {
    lines.push('4. Batch retry: skipped during silent probe');
  }

  let remote = null;
  try {
    remote = await backend.getBookings(months);
    lines.push('5. Read-back verification: PASS');
  } catch (error) {
    lines.push(`5. Read-back verification: FAIL — ${describeError(error)}`);
    return { before: entries.length, after: entries.length, recovered: 0, error: writeError || error };
  }

  let recovered = 0;
  for (const [key, entry] of entries) {
    const desired = pendingValue(entry);
    const actual = Object.prototype.hasOwnProperty.call(remote || {}, key) ? remote[key] : null;
    if (backend.valuesMatch(actual, desired)) {
      delete pending[key];
      recovered++;
    }
  }
  savePending(pending);
  const after = Object.keys(pending).length;
  lines.push(`6. Queue reconciliation: ${recovered} confirmed remotely, ${after} still pending`);
  return { before: entries.length, after, recovered, error: writeError };
}

function recommendation(domainOk, apiOk, result, lines) {
  if (!domainOk) {
    lines.push('');
    lines.push('Conclusion: this device/network cannot reach mantledb.sh. This is a network/DNS/filtering problem, not a booking-data problem.');
    return 'MantleDB is blocked or unreachable from this device/network.';
  }
  if (!apiOk) {
    lines.push('');
    lines.push('Conclusion: mantledb.sh is reachable, but the authenticated browser request is being rejected/blocked. The detailed error above is the useful part.');
    return 'MantleDB is reachable, but the authenticated API request is failing.';
  }
  if (result?.after > 0) {
    lines.push('');
    lines.push('Conclusion: the backend connection works, but some queued records still do not match remote state. Their keys are listed above.');
    return `${result.after} queued booking${result.after === 1 ? '' : 's'} still need recovery.`;
  }
  lines.push('');
  lines.push('Conclusion: shared storage is healthy and the pending queue is clear.');
  return 'Shared storage is healthy.';
}

async function runDiagnostics(showDialog = true) {
  if (running) return;
  running = true;
  const dialog = ensureDialog();
  const summary = dialog.querySelector('#diagnostics-summary');
  const output = dialog.querySelector('#diagnostics-output');
  if (showDialog && !dialog.open) dialog.showModal();
  summary.textContent = 'Running browser-side sync tests…';
  output.textContent = '';

  const lines = [
    `GT Parking sync diagnostics`,
    `Time: ${new Date().toISOString()}`,
    `Page: ${location.href}`,
    `Online flag: ${navigator.onLine}`,
    `Namespace: ${APP_CONFIG.mantleNamespace}`,
    `Pending at start: ${Object.keys(readPending()).length}`,
    ''
  ];

  try {
    const domainOk = await testDomainReachability(lines);
    const apiOk = domainOk ? await testAuthenticatedApi(lines) : false;
    const result = apiOk ? await reconcilePending(lines, true) : { after: Object.keys(readPending()).length };
    const message = recommendation(domainOk, apiOk, result, lines);
    lastReport = lines.join('\n');
    output.textContent = lastReport;
    summary.textContent = message;

    if (apiOk && result.after === 0 && result.before > 0) {
      const connection = document.querySelector('#connection');
      if (connection) {
        connection.textContent = 'Live';
        connection.className = 'connection live';
        connection.title = 'Shared bookings are synchronized.';
      }
      setTimeout(() => location.reload(), 900);
    }
  } catch (error) {
    lines.push(`Unexpected diagnostics failure: ${describeError(error)}`);
    lastReport = lines.join('\n');
    output.textContent = lastReport;
    summary.textContent = 'Diagnostics itself encountered an unexpected error.';
  } finally {
    running = false;
  }
}

function attach() {
  const connection = document.querySelector('#connection');
  if (!connection) return;
  connection.classList.add('connection-clickable');
  connection.setAttribute('role', 'button');
  connection.setAttribute('tabindex', '0');
  connection.setAttribute('aria-label', 'Open shared storage diagnostics');
  connection.addEventListener('click', () => runDiagnostics(true));
  connection.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      runDiagnostics(true);
    }
  });
}

attach();
