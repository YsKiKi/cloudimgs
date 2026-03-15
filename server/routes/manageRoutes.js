const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const config = require('../../config');
const { requirePassword } = require('../middleware/auth');
const imageRepository = require('../db/imageRepository');
const { syncFileSystem } = require('../services/syncService');
const { safeJoin, TRASH_DIR_NAME, CACHE_DIR_NAME, sanitizeFilename } = require('../utils/fileUtils');
const { setAlbumPassword, verifyAlbumPassword } = require('../utils/albumUtils');
const { formatImageResponse } = require('../utils/urlUtils');
const previewService = require('../services/previewService');

const router = express.Router();
const STORAGE_PATH = config.storage.path;

// ── 内部辅助 ──────────────────────────────────────────────────────────────────

function shouldUseTrash(req) {
    const param = req.query.useTrash;
    return param !== undefined ? param === 'true' : !!(config.deletion && config.deletion.useTrash);
}

async function moveToTrash(filePath) {
    const ext = path.extname(filePath);
    const name = path.basename(filePath, ext);
    const trashPath = path.join(STORAGE_PATH, TRASH_DIR_NAME, `${name}_${Date.now()}${ext}`);
    await fs.ensureDir(path.dirname(trashPath));
    await fs.move(filePath, trashPath, { overwrite: true });
}

async function cleanupRelatedFiles(filePath, relPath) {
    const cacheFile = path.join(path.dirname(filePath), CACHE_DIR_NAME, `${path.basename(filePath)}.th`);
    if (await fs.pathExists(cacheFile)) await fs.remove(cacheFile);
    await previewService.deletePreview(relPath);
    imageRepository.delete(relPath);
}

async function moveRelatedFiles(oldFilePath, oldRelPath, newFilePath, newRelPath) {
    // 移动 thumbhash 缓存
    const oldCachePath = path.join(path.dirname(oldFilePath), CACHE_DIR_NAME, `${path.basename(oldFilePath)}.th`);
    if (await fs.pathExists(oldCachePath)) {
        const newCacheDir = path.join(path.dirname(newFilePath), CACHE_DIR_NAME);
        await fs.ensureDir(newCacheDir);
        await fs.move(oldCachePath, path.join(newCacheDir, `${path.basename(newFilePath)}.th`));
    }
    // 移动预览图
    const oldPreviewPath = await previewService.getPreviewPath(oldRelPath);
    if (oldPreviewPath && await fs.pathExists(oldPreviewPath)) {
        const newPreviewDir = path.join(path.dirname(newFilePath), previewService.PREVIEW_DIR_NAME);
        await fs.ensureDir(newPreviewDir);
        const newPreviewFilename = path.parse(path.basename(newFilePath)).name + '.webp';
        await fs.move(oldPreviewPath, path.join(newPreviewDir, newPreviewFilename));
    }
}

async function resolveUniquePath(basePath, dir, filename) {
    let filePath = safeJoin(basePath, path.join(dir, filename));
    if (!await fs.pathExists(filePath)) return { filePath, relPath: path.join(dir, filename).replace(/\\/g, '/') };

    const ext = path.extname(filename);
    const name = path.basename(filename, ext);
    let counter = 1;
    while (await fs.pathExists(filePath)) {
        const candidate = `${name}_${Date.now()}_${counter}${ext}`;
        filePath = safeJoin(basePath, path.join(dir, candidate));
        counter++;
    }
    const relPath = path.relative(basePath, filePath).replace(/\\/g, '/');
    return { filePath, relPath };
}

// ── 同步 ──────────────────────────────────────────────────────────────────────

router.post('/sync', requirePassword, async (req, res) => {
    try {
        await syncFileSystem();
        res.json({ success: true });
    } catch (e) {
        console.error('Sync failed:', e);
        res.status(500).json({ success: false, error: 'Sync failed' });
    }
});

// ── 相册密码 ──────────────────────────────────────────────────────────────────

router.post('/album/password', requirePassword, async (req, res) => {
    try {
        const { dir, password } = req.body;
        if (dir === undefined) return res.status(400).json({ success: false, error: 'Missing directory' });

        await setAlbumPassword(dir, password || null);
        res.json({ success: true });
    } catch (e) {
        console.error('Set album password error:', e);
        res.status(500).json({ success: false, error: 'Failed to set album password' });
    }
});

router.post('/album/verify', requirePassword, async (req, res) => {
    try {
        const { dir, password } = req.body;
        if (dir === undefined) return res.status(400).json({ success: false, error: 'Missing directory' });

        const isValid = await verifyAlbumPassword(dir, password);
        if (!isValid) return res.status(401).json({ success: false, error: 'Incorrect password' });
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, error: 'Verification failed' });
    }
});

// ── 删除 ──────────────────────────────────────────────────────────────────────

router.delete('/images/*', requirePassword, async (req, res) => {
    const relPath = decodeURIComponent(req.params[0]);
    try {
        const filePath = safeJoin(STORAGE_PATH, relPath);
        if (!await fs.pathExists(filePath)) {
            imageRepository.delete(relPath);
            return res.status(404).json({ success: false, error: 'File not found' });
        }

        if (shouldUseTrash(req)) {
            await moveToTrash(filePath);
        } else {
            await fs.remove(filePath);
        }
        await cleanupRelatedFiles(filePath, relPath);
        res.json({ success: true });
    } catch (e) {
        console.error('Delete image error:', e);
        res.status(500).json({ success: false, error: 'Delete failed' });
    }
});

router.delete('/files/*', requirePassword, async (req, res) => {
    const relPath = decodeURIComponent(req.params[0]);
    try {
        const filePath = safeJoin(STORAGE_PATH, relPath);
        if (!await fs.pathExists(filePath)) {
            return res.status(404).json({ success: false, error: 'File not found' });
        }

        if (shouldUseTrash(req)) {
            await moveToTrash(filePath);
        } else {
            await fs.remove(filePath);
        }
        await cleanupRelatedFiles(filePath, relPath);
        res.json({ success: true });
    } catch (e) {
        console.error('Delete file error:', e);
        res.status(500).json({ success: false, error: 'Delete failed' });
    }
});

// ── 批量移动 ──────────────────────────────────────────────────────────────────

router.post('/batch/move', requirePassword, async (req, res) => {
    try {
        const { files, targetDir } = req.body;
        if (!Array.isArray(files) || files.length === 0) {
            return res.status(400).json({ success: false, error: 'No files selected' });
        }

        const newDir = (targetDir || '').replace(/\\/g, '/').trim();
        await fs.ensureDir(safeJoin(STORAGE_PATH, newDir));

        let successCount = 0, failCount = 0;

        for (const relPath of files) {
            try {
                const oldRelPath = decodeURIComponent(relPath).replace(/\\/g, '/');
                const oldFilePath = safeJoin(STORAGE_PATH, oldRelPath);
                if (!await fs.pathExists(oldFilePath)) { failCount++; continue; }

                const filename = path.basename(oldFilePath);
                const { filePath: newFilePath, relPath: newRelPath } = await resolveUniquePath(STORAGE_PATH, newDir, filename);

                await fs.move(oldFilePath, newFilePath);
                await moveRelatedFiles(oldFilePath, oldRelPath, newFilePath, newRelPath);

                const dbImage = imageRepository.getByPath(oldRelPath);
                if (dbImage) {
                    imageRepository.delete(oldRelPath);
                    dbImage.rel_path = newRelPath;
                    dbImage.filename = path.basename(newFilePath);
                    imageRepository.add(dbImage);
                }
                successCount++;
            } catch (e) {
                console.error(`Move failed for ${relPath}:`, e);
                failCount++;
            }
        }
        res.json({ success: true, data: { successCount, failCount } });
    } catch (e) {
        console.error('Batch move error:', e);
        res.status(500).json({ success: false, error: 'Batch move failed' });
    }
});

// ── 创建目录 ──────────────────────────────────────────────────────────────────

router.post('/directories', requirePassword, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ success: false, error: 'Missing directory name' });
        if (name.includes('..') || name.includes('\\') || name.startsWith('/')) {
            return res.status(400).json({ success: false, error: 'Invalid directory name' });
        }

        const absDir = safeJoin(STORAGE_PATH, name);
        if (await fs.pathExists(absDir)) {
            return res.status(409).json({ success: false, error: 'Directory already exists' });
        }

        await fs.ensureDir(absDir);
        res.json({ success: true, data: { path: name } });
    } catch (e) {
        console.error('Create directory failed:', e);
        res.status(500).json({ success: false, error: 'Failed to create directory' });
    }
});

// ── 重命名/移动图片 ──────────────────────────────────────────────────────────

router.put('/images/*', requirePassword, async (req, res) => {
    const relPath = decodeURIComponent(req.params[0]);
    try {
        const { newName, newDir } = req.body;
        if (!newName && newDir === undefined) {
            return res.status(400).json({ success: false, error: 'Missing newName or newDir' });
        }

        const oldFilePath = safeJoin(STORAGE_PATH, relPath);
        if (!await fs.pathExists(oldFilePath)) {
            return res.status(404).json({ success: false, error: 'File not found' });
        }

        const oldDir = path.dirname(relPath).replace(/\\/g, '/');
        const oldFilename = path.basename(relPath);
        const targetDir = newDir !== undefined ? newDir.replace(/\\/g, '/') : oldDir;
        const targetFilename = newName ? sanitizeFilename(newName) : oldFilename;
        let newRelPath = (targetDir ? targetDir + '/' : '') + targetFilename;

        if (newRelPath === relPath) {
            return res.json({ success: true, data: formatImageResponse(req, imageRepository.getByPath(relPath)) });
        }

        await fs.ensureDir(safeJoin(STORAGE_PATH, targetDir));
        let newFilePath = safeJoin(STORAGE_PATH, newRelPath);

        if (await fs.pathExists(newFilePath)) {
            let counter = 1;
            const ext = path.extname(targetFilename);
            const nameBase = path.basename(targetFilename, ext);
            while (await fs.pathExists(newFilePath)) {
                const candidate = `${nameBase}_${counter}${ext}`;
                newRelPath = (targetDir ? targetDir + '/' : '') + candidate;
                newFilePath = safeJoin(STORAGE_PATH, newRelPath);
                counter++;
            }
        }

        await fs.move(oldFilePath, newFilePath);
        await moveRelatedFiles(oldFilePath, relPath, newFilePath, newRelPath);

        const dbImage = imageRepository.getByPath(relPath);
        if (dbImage) {
            imageRepository.delete(relPath);
            dbImage.rel_path = newRelPath;
            dbImage.filename = path.basename(newFilePath);
            imageRepository.add(dbImage);
        }

        const updated = imageRepository.getByPath(newRelPath);
        res.json({ success: true, data: formatImageResponse(req, updated || { rel_path: newRelPath, filename: path.basename(newFilePath) }) });
    } catch (e) {
        console.error('Rename/move error:', e);
        res.status(500).json({ success: false, error: 'Rename/move failed' });
    }
});

module.exports = router;
