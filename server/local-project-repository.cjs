const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const AUTOSAVE_PROJECT_ID = '_autosave';
const DEFAULT_HISTORY_LIMIT = 30;
const PROJECT_ID_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const VERSION_ID_PATTERN = /^\d+-[a-f0-9]{12}$/;
const ASSET_ID_PATTERN = /^sha256_[a-f0-9]{64}$/;
const MAX_ASSET_BYTES = 100 * 1024 * 1024;

function assertProjectId(projectId) {
  if (!PROJECT_ID_PATTERN.test(projectId)) {
    throw new Error('Invalid local project id.');
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateSnapshot(raw) {
  if (!isRecord(raw) || !Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) {
    throw new Error('Invalid project snapshot.');
  }
  if (!Number.isFinite(raw.savedAt) || raw.savedAt <= 0) {
    throw new Error('Invalid project snapshot timestamp.');
  }
  if (raw.projectId != null) {
    if (typeof raw.projectId !== 'string') {
      throw new Error('Invalid local project id.');
    }
    assertProjectId(raw.projectId);
  }
  return raw;
}

function snapshotContentDigest(snapshot) {
  const { savedAt: _savedAt, ...content } = snapshot;
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(content))
    .digest('hex')
    .slice(0, 12);
}

function parseImageDataUrl(value) {
  const match = String(value || '').match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.+)$/u);
  if (!match) return null;
  const buffer = Buffer.from(match[2], 'base64');
  if (!buffer.length || buffer.length > MAX_ASSET_BYTES) return null;
  return {
    buffer,
    mimeType: match[1] || 'image/jpeg',
  };
}

function imageMimeType(buffer) {
  if (!Buffer.isBuffer(buffer)) return 'application/octet-stream';
  if (
    buffer.length >= 8
    && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  if (buffer.length >= 6 && /^GIF8[79]a$/u.test(buffer.subarray(0, 6).toString('ascii'))) {
    return 'image/gif';
  }
  return 'application/octet-stream';
}

function assetIdForBuffer(buffer) {
  return `sha256_${crypto.createHash('sha256').update(buffer).digest('hex')}`;
}

function ensureDirectory(directoryPath) {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function backupPathFor(filePath) {
  return `${filePath}.previous`;
}

function recoverInterruptedWrite(filePath) {
  const backupPath = backupPathFor(filePath);
  if (!fs.existsSync(filePath) && fs.existsSync(backupPath)) {
    fs.renameSync(backupPath, filePath);
    return;
  }
  if (fs.existsSync(filePath) && fs.existsSync(backupPath)) {
    fs.unlinkSync(backupPath);
  }
}

function atomicWriteJson(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  recoverInterruptedWrite(filePath);

  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const backupPath = backupPathFor(filePath);
  const serialized = `${JSON.stringify(value)}\n`;

  try {
    const descriptor = fs.openSync(tempPath, 'wx');
    try {
      fs.writeFileSync(descriptor, serialized, 'utf8');
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }

    if (fs.existsSync(filePath)) {
      fs.renameSync(filePath, backupPath);
    }
    fs.renameSync(tempPath, filePath);
    if (fs.existsSync(backupPath)) {
      fs.unlinkSync(backupPath);
    }
  } catch (error) {
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    if (!fs.existsSync(filePath) && fs.existsSync(backupPath)) {
      fs.renameSync(backupPath, filePath);
    }
    throw error;
  }
}

function atomicWriteBuffer(filePath, value) {
  ensureDirectory(path.dirname(filePath));
  recoverInterruptedWrite(filePath);
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  const backupPath = backupPathFor(filePath);
  try {
    const descriptor = fs.openSync(tempPath, 'wx');
    try {
      fs.writeFileSync(descriptor, value);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    if (fs.existsSync(filePath)) fs.renameSync(filePath, backupPath);
    fs.renameSync(tempPath, filePath);
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
  } catch (error) {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    if (!fs.existsSync(filePath) && fs.existsSync(backupPath)) {
      fs.renameSync(backupPath, filePath);
    }
    throw error;
  }
}

function readJsonFile(filePath) {
  recoverInterruptedWrite(filePath);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function createLocalProjectRepository(options = {}) {
  const rootDirectory = path.resolve(
    options.rootDirectory || path.join(__dirname, '..', '.data', 'studio-projects'),
  );
  const historyLimit = Math.max(
    1,
    Number.isFinite(options.historyLimit) ? Math.floor(options.historyLimit) : DEFAULT_HISTORY_LIMIT,
  );
  let writeQueue = Promise.resolve();
  const assetDirectory = path.join(rootDirectory, '.assets');

  function projectDirectory(projectId) {
    assertProjectId(projectId);
    const directory = path.resolve(rootDirectory, projectId);
    if (path.dirname(directory) !== rootDirectory) {
      throw new Error('Invalid local project path.');
    }
    return directory;
  }

  function headPath(projectId) {
    return path.join(projectDirectory(projectId), 'head.json');
  }

  function versionsDirectory(projectId) {
    return path.join(projectDirectory(projectId), 'versions');
  }

  function versionsIndexPath(projectId) {
    return path.join(projectDirectory(projectId), 'versions-index.json');
  }

  function assetPath(assetId) {
    if (!ASSET_ID_PATTERN.test(assetId)) throw new Error('Invalid local project asset id.');
    const resolved = path.resolve(assetDirectory, `${assetId}.asset`);
    if (path.dirname(resolved) !== assetDirectory) {
      throw new Error('Invalid local project asset path.');
    }
    return resolved;
  }

  function writeAssetBuffer(buffer) {
    const assetId = assetIdForBuffer(buffer);
    const filePath = assetPath(assetId);
    if (!fs.existsSync(filePath)) atomicWriteBuffer(filePath, buffer);
    return assetId;
  }

  function saveAssetDataUrl(expectedAssetId, dataUrl) {
    const parsed = parseImageDataUrl(dataUrl);
    if (!parsed) throw new Error('Invalid local project image asset.');
    const assetId = assetIdForBuffer(parsed.buffer);
    if (expectedAssetId && expectedAssetId !== assetId) {
      throw new Error('Local project image asset digest mismatch.');
    }
    writeAssetBuffer(parsed.buffer);
    return {
      assetId,
      bytes: parsed.buffer.length,
      mimeType: parsed.mimeType || imageMimeType(parsed.buffer),
    };
  }

  function readAsset(assetId) {
    const filePath = assetPath(assetId);
    recoverInterruptedWrite(filePath);
    if (!fs.existsSync(filePath)) return null;
    const buffer = fs.readFileSync(filePath);
    return {
      assetId,
      buffer,
      bytes: buffer.length,
      mimeType: imageMimeType(buffer),
    };
  }

  function compactImageAssets(value) {
    let changed = false;
    let assetCount = 0;
    const visit = (current) => {
      if (Array.isArray(current)) return current.map(visit);
      if (!isRecord(current)) return current;
      const output = {};
      for (const [key, child] of Object.entries(current)) {
        if (key === 'imageDataUrl' && typeof child === 'string') {
          const parsed = parseImageDataUrl(child);
          if (parsed) {
            const assetId = writeAssetBuffer(parsed.buffer);
            output.imageAssetId = assetId;
            output.imageAssetMimeType = parsed.mimeType;
            changed = true;
            assetCount += 1;
            continue;
          }
        }
        output[key] = visit(child);
      }
      return output;
    };
    return {
      value: visit(value),
      changed,
      assetCount,
    };
  }

  function readVersion(projectId, versionId) {
    if (!VERSION_ID_PATTERN.test(versionId)) {
      throw new Error('Invalid local project version id.');
    }
    const raw = readJsonFile(path.join(versionsDirectory(projectId), `${versionId}.json`));
    if (!raw) return null;
    try {
      return validateSnapshot(raw);
    } catch {
      return null;
    }
  }

  function readLatestValidVersion(projectId) {
    for (const filename of versionFiles(projectId)) {
      const versionId = filename.replace(/\.json$/, '');
      const snapshot = readVersion(projectId, versionId);
      if (snapshot) return snapshot;
    }
    return null;
  }

  function readSnapshot(projectId, options = {}) {
    const raw = readJsonFile(headPath(projectId));
    if (raw) {
      try {
        return validateSnapshot(raw);
      } catch {
        // Fall through to immutable history.
      }
    }
    const fallback = readLatestValidVersion(projectId);
    if (fallback && options.repair !== false) {
      atomicWriteJson(headPath(projectId), fallback);
    }
    return fallback;
  }

  function versionFiles(projectId) {
    const directory = versionsDirectory(projectId);
    if (!fs.existsSync(directory)) return [];
    return fs
      .readdirSync(directory, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile()
          && VERSION_ID_PATTERN.test(entry.name.replace(/\.json$/, ''))
          && entry.name.endsWith('.json'),
      )
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left));
  }

  function pruneVersions(projectId) {
    const directory = versionsDirectory(projectId);
    for (const filename of versionFiles(projectId).slice(historyLimit)) {
      const filePath = path.resolve(directory, filename);
      if (path.dirname(filePath) === directory) {
        fs.unlinkSync(filePath);
      }
    }
    const index = readVersionIndex(projectId);
    if (index) {
      const retainedIds = new Set(
        versionFiles(projectId).map((filename) => filename.replace(/\.json$/u, '')),
      );
      atomicWriteJson(
        versionsIndexPath(projectId),
        index.filter((item) => retainedIds.has(item.id)),
      );
    }
  }

  function versionSummary(id, snapshot) {
    return {
      id,
      savedAt: snapshot.savedAt,
      projectName:
        typeof snapshot.projectName === 'string' ? snapshot.projectName : undefined,
      nodeCount: snapshot.nodes.length,
      edgeCount: snapshot.edges.length,
      contentDigest: snapshotContentDigest(snapshot),
    };
  }

  function readVersionIndex(projectId) {
    const raw = readJsonFile(versionsIndexPath(projectId));
    if (!Array.isArray(raw)) return null;
    const items = raw.filter(
      (item) =>
        isRecord(item)
        && VERSION_ID_PATTERN.test(String(item.id || ''))
        && Number.isFinite(item.savedAt)
        && Number.isFinite(item.nodeCount)
        && Number.isFinite(item.edgeCount),
    );
    return items.length === raw.length ? items : null;
  }

  function rebuildVersionIndex(projectId) {
    const items = [];
    const seenContent = new Set();
    for (const filename of versionFiles(projectId)) {
      const id = filename.replace(/\.json$/u, '');
      const snapshot = readVersion(projectId, id);
      if (!snapshot) continue;
      const summary = versionSummary(id, snapshot);
      if (seenContent.has(summary.contentDigest)) continue;
      seenContent.add(summary.contentDigest);
      items.push(summary);
    }
    atomicWriteJson(versionsIndexPath(projectId), items);
    return items;
  }

  function updateVersionIndex(projectId, versionId, snapshot) {
    const current = readVersionIndex(projectId);
    if (!current) return;
    const next = [
      versionSummary(versionId, snapshot),
      ...current.filter((item) => item.id !== versionId),
    ].sort((left, right) => right.id.localeCompare(left.id));
    atomicWriteJson(versionsIndexPath(projectId), next);
  }

  function saveSnapshotNow(rawSnapshot, options = {}) {
    const validatedSnapshot = validateSnapshot(rawSnapshot);
    const snapshot = compactImageAssets(validatedSnapshot).value;
    const projectId = snapshot.projectId || AUTOSAVE_PROJECT_ID;
    const current = readSnapshot(projectId);
    if (Object.prototype.hasOwnProperty.call(options, 'expectedSavedAt')) {
      const expectedSavedAt = options.expectedSavedAt ?? null;
      const currentSavedAt = current?.savedAt ?? null;
      if (expectedSavedAt !== currentSavedAt) {
        return {
          projectId,
          savedAt: currentSavedAt,
          stale: true,
          conflict: true,
          expectedSavedAt,
        };
      }
    }
    if (current && current.savedAt > snapshot.savedAt) {
      return {
        projectId,
        savedAt: current.savedAt,
        stale: true,
      };
    }

    const digest = snapshotContentDigest(snapshot);
    const versionPath = path.join(
      versionsDirectory(projectId),
      `${Math.floor(snapshot.savedAt)}-${digest}.json`,
    );
    const contentChanged =
      !current
      || snapshotContentDigest(current) !== digest
      || versionFiles(projectId).length === 0;
    if (contentChanged && !fs.existsSync(versionPath)) {
      atomicWriteJson(versionPath, snapshot);
      updateVersionIndex(projectId, path.basename(versionPath, '.json'), snapshot);
    }
    atomicWriteJson(headPath(projectId), snapshot);
    atomicWriteJson(path.join(rootDirectory, 'active.json'), {
      projectId,
      projectName:
        typeof snapshot.projectName === 'string' && snapshot.projectName.trim()
          ? snapshot.projectName.trim()
          : undefined,
      savedAt: snapshot.savedAt,
    });
    pruneVersions(projectId);

    return {
      projectId,
      savedAt: snapshot.savedAt,
      stale: false,
    };
  }

  function saveSnapshot(snapshot, options) {
    const pending = writeQueue
      .catch(() => undefined)
      .then(() => saveSnapshotNow(snapshot, options));
    writeQueue = pending.then(() => undefined);
    return pending;
  }

  function listProjects() {
    if (!fs.existsSync(rootDirectory)) return [];
    return fs
      .readdirSync(rootDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && PROJECT_ID_PATTERN.test(entry.name))
      .map((entry) => {
        const snapshot = readSnapshot(entry.name);
        if (!snapshot) return null;
        return {
          projectId: entry.name,
          projectName:
            typeof snapshot.projectName === 'string' && snapshot.projectName.trim()
              ? snapshot.projectName.trim()
              : entry.name === AUTOSAVE_PROJECT_ID
                ? '自动恢复'
                : '未命名工程',
          updatedAt: snapshot.savedAt,
          nodeCount: snapshot.nodes.length,
          edgeCount: snapshot.edges.length,
          isAutosave: entry.name === AUTOSAVE_PROJECT_ID,
        };
      })
      .filter(Boolean)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  function readActiveSnapshot() {
    const active = readJsonFile(path.join(rootDirectory, 'active.json'));
    if (isRecord(active) && typeof active.projectId === 'string') {
      try {
        const snapshot = readSnapshot(active.projectId);
        if (snapshot) return snapshot;
      } catch {
        // Fall through to the newest intact head.
      }
    }
    const newest = listProjects()[0];
    return newest ? readSnapshot(newest.projectId) : null;
  }

  function listVersions(projectId) {
    const files = versionFiles(projectId);
    const indexed = readVersionIndex(projectId);
    const fileIds = new Set(files.map((filename) => filename.replace(/\.json$/u, '')));
    const summaries =
      indexed
      && indexed.every((item) => fileIds.has(item.id))
      && indexed.length <= files.length
        ? indexed
        : rebuildVersionIndex(projectId);
    return summaries.map(({ contentDigest: _contentDigest, ...summary }) => summary);
  }

  function optimizeProjectNow(projectId) {
    assertProjectId(projectId);
    const files = [
      headPath(projectId),
      ...versionFiles(projectId).map((filename) => path.join(versionsDirectory(projectId), filename)),
    ];
    let beforeBytes = 0;
    let afterBytes = 0;
    let optimizedFiles = 0;
    let assetCount = 0;
    for (const filePath of files) {
      if (!fs.existsSync(filePath)) continue;
      beforeBytes += fs.statSync(filePath).size;
      const raw = readJsonFile(filePath);
      if (!raw) {
        afterBytes += fs.statSync(filePath).size;
        continue;
      }
      const compacted = compactImageAssets(raw);
      if (compacted.changed) {
        atomicWriteJson(filePath, compacted.value);
        optimizedFiles += 1;
        assetCount += compacted.assetCount;
      }
      afterBytes += fs.statSync(filePath).size;
    }
    rebuildVersionIndex(projectId);
    return {
      projectId,
      beforeBytes,
      afterBytes,
      reclaimedBytes: Math.max(0, beforeBytes - afterBytes),
      optimizedFiles,
      assetCount,
    };
  }

  function optimizeProject(projectId) {
    const pending = writeQueue
      .catch(() => undefined)
      .then(() => optimizeProjectNow(projectId));
    writeQueue = pending.then(() => undefined);
    return pending;
  }

  return {
    flush: () => writeQueue,
    listProjects,
    listVersions,
    optimizeProject,
    readAsset,
    readActiveSnapshot,
    readSnapshot,
    readVersion,
    rootDirectory,
    saveAssetDataUrl,
    saveSnapshot,
  };
}

module.exports = {
  AUTOSAVE_PROJECT_ID,
  createLocalProjectRepository,
};
