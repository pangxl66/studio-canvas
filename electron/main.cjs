const { app, BrowserWindow, ipcMain, shell } = require('electron');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { version } = require('../package.json');
const licenseConfig = require('./license-config.cjs');

const PRODUCT_NAME = 'Studio Canvas';
const LICENSE_FILENAME = 'studio-license.json';
const LICENSE_ENDPOINT = process.env.STUDIO_LICENSE_ENDPOINT || licenseConfig.licenseEndpoint || '';
const DEV_LICENSE_KEY = process.env.STUDIO_DESKTOP_DEV_LICENSE || 'SC-DEV-LOCAL';

let mainWindow = null;

const isDevelopmentDesktop = () => !app.isPackaged;

function getLicensePath() {
  return path.join(app.getPath('userData'), LICENSE_FILENAME);
}

function safeUserName() {
  try {
    return os.userInfo().username;
  } catch {
    return 'unknown';
  }
}

function getDeviceId() {
  const rawDeviceProfile = [
    os.hostname(),
    os.platform(),
    os.arch(),
    safeUserName(),
  ].join('|');

  return crypto
    .createHash('sha256')
    .update(rawDeviceProfile)
    .digest('hex')
    .slice(0, 32);
}

function maskLicenseKey(licenseKey) {
  if (!licenseKey) {
    return undefined;
  }

  const compact = String(licenseKey).replace(/\s+/g, '');
  if (compact.length <= 8) {
    return '****';
  }

  return `${compact.slice(0, 4)}-${compact.slice(-4)}`;
}

function isExpired(expiresAt) {
  if (!expiresAt) {
    return false;
  }

  const expiresAtTime = Date.parse(expiresAt);
  return Number.isFinite(expiresAtTime) && expiresAtTime <= Date.now();
}

async function readStoredLicense() {
  try {
    const raw = await fs.readFile(getLicensePath(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeStoredLicense(record) {
  await fs.mkdir(path.dirname(getLicensePath()), { recursive: true });
  await fs.writeFile(getLicensePath(), JSON.stringify(record, null, 2), 'utf8');
}

async function clearStoredLicense() {
  try {
    await fs.unlink(getLicensePath());
  } catch {
    // Missing license files are already deactivated.
  }
}

function buildLicenseStatus(record, message) {
  const deviceId = getDeviceId();
  const baseStatus = {
    active: false,
    appVersion: version,
    configured: Boolean(LICENSE_ENDPOINT),
    devUnlockAvailable: isDevelopmentDesktop(),
    deviceId,
    isDesktop: true,
    mode: isDevelopmentDesktop() ? 'development' : 'production',
    message,
  };

  if (!record) {
    return baseStatus;
  }

  if (record.deviceId !== deviceId) {
    return {
      ...baseStatus,
      message: '授权记录属于另一台设备，请重新激活。',
    };
  }

  if (isExpired(record.expiresAt)) {
    return {
      ...baseStatus,
      expiresAt: record.expiresAt,
      licenseKeyMasked: maskLicenseKey(record.licenseKey),
      message: '授权已到期，请续费或输入新的授权码。',
      owner: record.owner,
      plan: record.plan,
    };
  }

  return {
    ...baseStatus,
    active: true,
    activatedAt: record.activatedAt,
    expiresAt: record.expiresAt,
    lastVerifiedAt: record.lastVerifiedAt,
    licenseKeyMasked: maskLicenseKey(record.licenseKey),
    message: message || '授权已激活。',
    owner: record.owner,
    plan: record.plan || 'personal',
    source: record.source,
  };
}

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function normalizeActivationPayload(payload) {
  const license = payload?.license || payload?.data || payload || {};
  const isValid =
    payload?.ok === true ||
    payload?.valid === true ||
    payload?.active === true ||
    payload?.success === true ||
    license?.valid === true ||
    license?.active === true;

  return {
    isValid,
    message: firstString(payload?.message, payload?.error, license?.message),
    owner: firstString(payload?.owner, payload?.email, license?.owner, license?.email),
    plan: firstString(payload?.plan, license?.plan) || 'personal',
    expiresAt: firstString(
      payload?.expiresAt,
      payload?.expires_at,
      license?.expiresAt,
      license?.expires_at,
    ),
    activationToken: firstString(
      payload?.activationToken,
      payload?.activation_token,
      payload?.token,
      license?.activationToken,
      license?.activation_token,
      license?.token,
    ),
  };
}

async function activateWithRemoteService(licenseKey) {
  if (!LICENSE_ENDPOINT) {
    throw new Error('未配置授权服务地址，无法在线激活。');
  }

  if (typeof fetch !== 'function') {
    throw new Error('当前桌面运行环境不支持在线请求，请升级 Electron 或 Node 运行环境。');
  }

  const response = await fetch(LICENSE_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      appVersion: version,
      deviceId: getDeviceId(),
      licenseKey,
      product: PRODUCT_NAME,
      platform: process.platform,
    }),
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  const normalized = normalizeActivationPayload(payload);
  if (!response.ok || !normalized.isValid) {
    throw new Error(
      normalized.message || `授权服务拒绝激活，请检查授权码。HTTP ${response.status}`,
    );
  }

  const now = new Date().toISOString();
  const record = {
    activatedAt: now,
    activationToken: normalized.activationToken,
    appVersion: version,
    deviceId: getDeviceId(),
    expiresAt: normalized.expiresAt,
    lastVerifiedAt: now,
    licenseKey,
    owner: normalized.owner,
    plan: normalized.plan,
    source: 'remote',
  };

  await writeStoredLicense(record);
  return buildLicenseStatus(record, normalized.message || '授权激活成功。');
}

async function activateWithDevelopmentKey(licenseKey) {
  const now = new Date().toISOString();
  const record = {
    activatedAt: now,
    appVersion: version,
    deviceId: getDeviceId(),
    expiresAt: '2099-12-31T23:59:59.000Z',
    lastVerifiedAt: now,
    licenseKey,
    owner: 'Local Developer',
    plan: 'development',
    source: 'local-dev',
  };

  await writeStoredLicense(record);
  return buildLicenseStatus(record, '本机开发测试授权已激活。');
}

function registerLicenseHandlers() {
  ipcMain.handle('studio-license:get-status', async () => {
    const record = await readStoredLicense();
    return buildLicenseStatus(record);
  });

  ipcMain.handle('studio-license:activate', async (_event, rawLicenseKey) => {
    const licenseKey = String(rawLicenseKey || '').trim();
    if (!licenseKey) {
      return buildLicenseStatus(null, '请输入授权码。');
    }

    try {
      if (isDevelopmentDesktop() && licenseKey === DEV_LICENSE_KEY) {
        return await activateWithDevelopmentKey(licenseKey);
      }

      return await activateWithRemoteService(licenseKey);
    } catch (error) {
      const currentRecord = await readStoredLicense();
      return buildLicenseStatus(
        currentRecord,
        error instanceof Error ? error.message : '授权激活失败。',
      );
    }
  });

  ipcMain.handle('studio-license:deactivate', async () => {
    await clearStoredLicense();
    return buildLicenseStatus(null, '已清除本机授权。');
  });
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    backgroundColor: '#09090b',
    height: 900,
    minHeight: 720,
    minWidth: 1100,
    show: false,
    title: PRODUCT_NAME,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs'),
      sandbox: false,
    },
    width: 1440,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    return;
  }

  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(() => {
  registerLicenseHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
