const express = require('express');
const axios = require('axios');
const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');
const os = require('os');

dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const BASE_URL = 'https://grverk.timon.is';
const PORT = Number(process.env.PORT || 3000);
const CACHE_TTL_MS = 4 * 60 * 1000;
const AUTO_REFRESH_MS = 5 * 60 * 1000;
const LOG_FILE = path.join(__dirname, 'timon-dashboard.log');
const ENV_PATH = path.join(__dirname, '.env');

const state = {
  authToken: null,
  tokenFetchedAt: 0,
  endpointCache: new Map(),
  dashboardCache: null,
  lastRefreshError: null,
};

function logLine(level, message, extra = null) {
  const line = `${new Date().toISOString()} [${level}] ${message}${extra ? ` ${JSON.stringify(extra)}` : ''}`;
  fs.appendFileSync(LOG_FILE, `${line}\n`, 'utf8');
  if (level === 'ERROR') {
    console.error(line);
  } else {
    console.log(line);
  }
}

app.use((req, res, next) => {
  logLine('INFO', `HTTP ${req.method} ${req.url}`, { ip: req.ip });
  next();
});

function getEnvConfig() {
  return {
    username: process.env.TIMON_USERNAME || '',
    password: process.env.TIMON_PASSWORD || '',
    pin: process.env.PIN || '',
    showInactive: (process.env.SHOW_INACTIVE_EMPLOYEES || 'true').toLowerCase() === 'true',
  };
}

function maskSecret(value) {
  if (!value) return '';
  if (value.length <= 2) return '*'.repeat(value.length);
  return `${value[0]}${'*'.repeat(value.length - 2)}${value[value.length - 1]}`;
}

function getLocalNetworkUrl() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name] || []) {
      if (net.family === 'IPv4' && !net.internal) {
        return `http://${net.address}:${PORT}`;
      }
    }
  }
  return `http://localhost:${PORT}`;
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function getDefaultRange() {
  const now = new Date();
  const to = formatDate(now);
  const from = formatDate(new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000));
  return { fromDate: from, toDate: to };
}

async function authenticate() {
  const { username, password } = getEnvConfig();
  if (!username || !password) {
    throw new Error('Missing TIMON_USERNAME or TIMON_PASSWORD in .env');
  }

  const authUrl = `${BASE_URL}/api/timon/api-token-auth/`;
  logLine('INFO', 'Timon auth request', { authUrl, username: maskSecret(username) });
  const response = await axios.post(
    authUrl,
    { username, password },
    { timeout: 12000 }
  );

  if (!response.data || !response.data.token) {
    throw new Error('Authentication succeeded but no token returned');
  }

  state.authToken = response.data.token;
  state.tokenFetchedAt = Date.now();
  logLine('INFO', 'Timon auth success');
  return state.authToken;
}

async function getToken() {
  if (!state.authToken) {
    return authenticate();
  }
  return state.authToken;
}

function endpointCacheKey(endpoint, params) {
  return `${endpoint}?${new URLSearchParams(params).toString()}`;
}

async function timonGet(endpoint, params = {}) {
  const key = endpointCacheKey(endpoint, params);
  const cached = state.endpointCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  let token = await getToken();
  const url = `${BASE_URL}${endpoint}`;

  const run = async () => {
    logLine('INFO', 'Timon GET', { url, params });
    const response = await axios.get(url, {
      headers: { Authorization: `Token ${token}` },
      params,
      timeout: 15000,
    });
    return response.data;
  };

  try {
    const data = await run();
    state.endpointCache.set(key, { data, fetchedAt: Date.now() });
    return data;
  } catch (error) {
    const status = error.response?.status;
    if (status === 401 || status === 403) {
      token = await authenticate();
      const data = await run();
      state.endpointCache.set(key, { data, fetchedAt: Date.now() });
      return data;
    }
    throw error;
  }
}

function normalizeList(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.results)) return payload.results;
  return [];
}

async function fetchDashboardData(fromDate, toDate) {
  const [employeesRaw, projectsRaw, countersRaw] = await Promise.all([
    timonGet('/api/v2/employees/'),
    timonGet('/api/v2/projects/'),
    timonGet('/api/v2/counters/', { from_date: fromDate, to_date: toDate }),
  ]);

  const employees = normalizeList(employeesRaw);
  const projects = normalizeList(projectsRaw);
  const counters = normalizeList(countersRaw);

  return {
    employees,
    projects,
    counters,
    range: { fromDate, toDate },
    fetchedAt: new Date().toISOString(),
  };
}

async function getDashboardData(fromDate, toDate, forceRefresh = false) {
  const sameRange =
    state.dashboardCache &&
    state.dashboardCache.range.fromDate === fromDate &&
    state.dashboardCache.range.toDate === toDate;

  if (
    !forceRefresh &&
    sameRange &&
    Date.now() - state.dashboardCache.fetchedAtMs < CACHE_TTL_MS
  ) {
    return { ...state.dashboardCache.payload, stale: false, warning: null };
  }

  try {
    const payload = await fetchDashboardData(fromDate, toDate);
    state.dashboardCache = {
      range: { fromDate, toDate },
      payload,
      fetchedAtMs: Date.now(),
    };
    state.lastRefreshError = null;
    return { ...payload, stale: false, warning: null };
  } catch (error) {
    const errorMessage = error.response?.data || error.message;
    state.lastRefreshError = errorMessage;
    logLine('ERROR', 'Dashboard refresh failed', { fromDate, toDate, error: errorMessage });

    if (state.dashboardCache) {
      return {
        ...state.dashboardCache.payload,
        stale: true,
        warning: 'Ekki tókst að uppfæra gögn. Sýni síðustu vistuðu gögn (data may be stale).',
      };
    }
    throw error;
  }
}

function upsertEnvValue(content, key, value) {
  const escaped = String(value ?? '').replace(/\n/g, '');
  const line = `${key}=${escaped}`;
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    return content.replace(regex, line);
  }
  return `${content.trimEnd()}\n${line}\n`;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/api/config', (_req, res) => {
  const config = getEnvConfig();
  res.json({
    localUrl: getLocalNetworkUrl(),
    pinRequired: Boolean(config.pin),
    showInactive: config.showInactive,
    hasCredentials: Boolean(config.username && config.password),
    lastRefreshError: state.lastRefreshError,
  });
});

app.post('/api/verify-pin', (req, res) => {
  const config = getEnvConfig();
  if (!config.pin) return res.json({ ok: true });
  const { pin } = req.body || {};
  if (pin && String(pin) === String(config.pin)) {
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, message: 'Rangt PIN' });
});

app.post('/api/settings', (req, res) => {
  try {
    const {
      username = '',
      password = '',
      pin = '',
      showInactive = true,
    } = req.body || {};

    let envContent = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
    envContent = upsertEnvValue(envContent, 'TIMON_USERNAME', username);
    envContent = upsertEnvValue(envContent, 'TIMON_PASSWORD', password);
    envContent = upsertEnvValue(envContent, 'PIN', pin);
    envContent = upsertEnvValue(envContent, 'SHOW_INACTIVE_EMPLOYEES', showInactive ? 'true' : 'false');
    fs.writeFileSync(ENV_PATH, envContent, 'utf8');

    process.env.TIMON_USERNAME = username;
    process.env.TIMON_PASSWORD = password;
    process.env.PIN = pin;
    process.env.SHOW_INACTIVE_EMPLOYEES = showInactive ? 'true' : 'false';

    state.authToken = null;
    state.endpointCache.clear();

    logLine('INFO', 'Settings updated');
    res.json({ ok: true });
  } catch (error) {
    logLine('ERROR', 'Settings update failed', { error: error.message });
    res.status(500).json({ ok: false, message: error.message });
  }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const defaults = getDefaultRange();
    const fromDate = req.query.from_date || defaults.fromDate;
    const toDate = req.query.to_date || defaults.toDate;
    const forceRefresh = req.query.refresh === '1';

    const data = await getDashboardData(fromDate, toDate, forceRefresh);
    res.json(data);
  } catch (error) {
    const errorMessage = error.response?.data || error.message;
    logLine('ERROR', 'Dashboard endpoint failed', { error: errorMessage });
    res.status(500).json({
      message: 'Ekki tókst að sækja gögn frá Tímon',
      details: errorMessage,
    });
  }
});

async function backgroundRefresh() {
  const { fromDate, toDate } = getDefaultRange();
  try {
    await getDashboardData(fromDate, toDate, true);
    logLine('INFO', 'Background refresh succeeded', { fromDate, toDate });
  } catch (error) {
    logLine('ERROR', 'Background refresh failed', { error: error.message });
  }
}

setInterval(backgroundRefresh, AUTO_REFRESH_MS);

app.listen(PORT, '0.0.0.0', async () => {
  logLine('INFO', `Timon dashboard listening on 0.0.0.0:${PORT}`);
  await backgroundRefresh();
});
