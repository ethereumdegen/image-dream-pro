// Minimal fal.ai client using the queue API via built-in fetch (Node 18+ / Electron).
// Docs: https://docs.fal.ai/model-endpoints/queue

const QUEUE_BASE = 'https://queue.fal.run';
const API_BASE = 'https://api.fal.ai';

function authHeader(apiKey) {
  return { Authorization: `Key ${apiKey}` };
}

async function submit({ apiKey, modelId, input }) {
  const url = `${QUEUE_BASE}/${modelId}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeader(apiKey),
    },
    body: JSON.stringify(input || {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`fal.ai submit failed (${res.status}): ${text}`);
  }
  return res.json(); // { request_id, status_url, response_url, ... }
}

async function checkStatus({ apiKey, statusUrl }) {
  const res = await fetch(statusUrl, { headers: authHeader(apiKey) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`fal.ai status failed (${res.status}): ${text}`);
  }
  return res.json();
}

async function fetchResult({ apiKey, responseUrl }) {
  const res = await fetch(responseUrl, { headers: authHeader(apiKey) });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`fal.ai result failed (${res.status}): ${text}`);
  }
  return res.json();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run({ apiKey, modelId, input, pollIntervalMs = 1500, timeoutMs = 10 * 60 * 1000 }) {
  const submission = await submit({ apiKey, modelId, input });
  const { status_url: statusUrl, response_url: responseUrl } = submission;
  if (!statusUrl || !responseUrl) {
    // Some sync endpoints may return the result directly.
    return submission;
  }

  const start = Date.now();
  while (true) {
    const status = await checkStatus({ apiKey, statusUrl });
    if (status.status === 'COMPLETED') {
      return fetchResult({ apiKey, responseUrl });
    }
    if (status.status === 'FAILED' || status.status === 'ERROR') {
      throw new Error(`fal.ai run failed: ${JSON.stringify(status)}`);
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error('fal.ai run timed out');
    }
    await sleep(pollIntervalMs);
  }
}

async function getBilling({ apiKey }) {
  const url = `${API_BASE}/v1/account/billing?expand=credits`;
  const res = await fetch(url, { headers: authHeader(apiKey) });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`fal.ai billing failed (${res.status}): ${text}`);
    err.status = res.status;
    if (res.status === 403 && /ADMIN/i.test(text)) {
      err.code = 'ADMIN_KEY_REQUIRED';
    }
    throw err;
  }
  return res.json(); // { username, credits: { current_balance, currency } }
}

module.exports = { run, submit, checkStatus, fetchResult, getBilling };
