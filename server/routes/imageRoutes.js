const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const mime = require('mime-types');
const sharp = require('sharp');
const config = require('../../config');
const imageRepository = require('../db/imageRepository');
const { requirePassword } = require('../middleware/auth');
const { safeJoin, getThumbHash, generateThumbHash, CACHE_DIR_NAME, TRASH_DIR_NAME, CONFIG_DIR_NAME } = require('../utils/fileUtils');
const { verifyAlbumPassword, isAlbumLocked } = require('../utils/albumUtils');
const { formatImageResponse, parseMeta } = require('../utils/urlUtils');
const previewService = require('../services/previewService');

const router = express.Router();
const STORAGE_PATH = config.storage.path;

const SENSITIVE_SEGMENTS = ['.cache', '.trash', '.preview', 'config'];
function isSensitivePath(relPath) {
    return relPath.replace(/\\/g, '/').split('/').some(s => SENSITIVE_SEGMENTS.includes(s));
}

// ── 内部辅助 ──────────────────────────────────────────────────────────────────

async function applySharp(filePath, query) {
    const { w, h, q, fmt, rows, cols, idx } = query;
    let img = sharp(filePath).rotate();

    if (rows && cols && idx !== undefined) {
        const r = parseInt(rows), c = parseInt(cols), i = parseInt(idx);
        if (r > 0 && c > 0 && i >= 0 && i < r * c) {
            const meta = await img.metadata();
            const subW = Math.floor(meta.width / c);
            const subH = Math.floor(meta.height / r);
            const row = Math.floor(i / c), col = i % c;
            img.extract({
                left: col * subW, top: row * subH,
                width: Math.min(subW, meta.width - col * subW),
                height: Math.min(subH, meta.height - row * subH)
            });
        }
    }

    if (w || h) {
        img = img.resize({
            width: w ? parseInt(w) : null,
            height: h ? parseInt(h) : null,
            fit: 'cover', position: 'center', withoutEnlargement: true
        });
    }

    let outMime = mime.lookup(filePath) || 'application/octet-stream';
    if (fmt === 'webp')      { img = img.webp({ quality: q ?? 80 });  outMime = 'image/webp'; }
    else if (fmt === 'jpeg') { img = img.jpeg({ quality: q ?? 80 }); outMime = 'image/jpeg'; }
    else if (fmt === 'png')  { img = img.png();                       outMime = 'image/png';  }
    else if (fmt === 'avif') { img = img.avif({ quality: q ?? 50 }); outMime = 'image/avif'; }
    else if (q) {
        const orig = (mime.lookup(filePath) || '').toLowerCase();
        if (orig.includes('jpeg') || orig.includes('jpg')) { img = img.jpeg({ quality: q }); outMime = 'image/jpeg'; }
        else if (orig.includes('webp'))  { img = img.webp({ quality: q });  outMime = 'image/webp'; }
        else if (orig.includes('avif'))  { img = img.avif({ quality: q });  outMime = 'image/avif'; }
        else                             { img = img.png();                  outMime = 'image/png';  }
    }

    return { buffer: await img.toBuffer(), mime: outMime };
}

function recordStats(size, relPath) {
    try { imageRepository.recordView(size); imageRepository.incrementViews(relPath); } catch (e) { /* ignore */ }
}

async function servePreviewImage(req, res, relPath) {
    try {
        if (isSensitivePath(relPath)) return res.status(403).json({ success: false, error: 'Access denied' });
        const filePath = safeJoin(STORAGE_PATH, relPath);
        if (!await fs.pathExists(filePath)) return res.status(404).json({ success: false, error: 'Not found' });

        getThumbHash(filePath).then(h => { if (!h) generateThumbHash(filePath); });

        let previewPath = await previewService.getPreviewPath(relPath);
        if (!previewPath || !await fs.pathExists(previewPath)) {
            await previewService.generatePreview(filePath, relPath).catch(() => {});
            previewPath = await previewService.getPreviewPath(relPath);
        }

        if (previewPath && await fs.pathExists(previewPath)) {
            const stats = await fs.stat(previewPath).catch(() => ({ size: 0 }));
            if (stats.size > 0) {
                recordStats(stats.size, relPath);
                res.setHeader('Content-Type', 'image/webp');
                res.setHeader('Cache-Control', 'public, max-age=31536000');
                return res.sendFile(previewPath);
            }
            await fs.remove(previewPath).catch(() => {});
        }

        const { buffer } = await applySharp(filePath, { fmt: 'webp', q: 80 });
        if (!buffer || buffer.length === 0) {
            return res.status(500).json({ success: false, error: 'Failed to generate preview' });
        }
        recordStats(buffer.length, relPath);
        res.setHeader('Content-Type', 'image/webp');
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        return res.send(buffer);
    } catch (e) {
        console.error('Serve preview error:', e);
        res.setHeader('Cache-Control', 'no-store');
        res.status(500).json({ success: false, error: 'Error serving preview' });
    }
}

async function serveRawImage(req, res, relPath) {
    try {
        if (isSensitivePath(relPath)) return res.status(403).json({ success: false, error: 'Access denied' });
        const filePath = safeJoin(STORAGE_PATH, relPath);
        if (!await fs.pathExists(filePath)) return res.status(404).json({ success: false, error: 'Not found' });

        getThumbHash(filePath).then(h => { if (!h) generateThumbHash(filePath); });

        const { w, h, q, fmt, rows, cols, idx } = req.query;
        const hasProcessingParams = w || h || q || fmt || rows || cols || idx !== undefined;

        if (!hasProcessingParams) {
            const stats = await fs.stat(filePath).catch(() => ({ size: 0 }));
            recordStats(stats.size, relPath);
            const contentType = mime.lookup(filePath) || 'application/octet-stream';
            res.setHeader('Content-Type', contentType);
            res.setHeader('X-Content-Type-Options', 'nosniff');
            if (contentType === 'image/svg+xml') {
                res.setHeader('Content-Security-Policy', "script-src 'none'");
            }
            res.setHeader('Cache-Control', 'public, max-age=86400');
            return res.sendFile(filePath);
        }

        try {
            const { buffer, mime: outMime } = await applySharp(filePath, req.query);
            if (!buffer || buffer.length === 0) {
                const stats = await fs.stat(filePath).catch(() => ({ size: 0 }));
                recordStats(stats.size, relPath);
                res.setHeader('Content-Type', mime.lookup(filePath) || 'application/octet-stream');
                return res.sendFile(filePath);
            }
            recordStats(buffer.length, relPath);
            res.setHeader('Content-Type', outMime);
            res.setHeader('Cache-Control', 'public, max-age=31536000');
            return res.send(buffer);
        } catch (e) {
            const stats = await fs.stat(filePath).catch(() => ({ size: 0 }));
            recordStats(stats.size, relPath);
            res.setHeader('Content-Type', mime.lookup(filePath) || 'application/octet-stream');
            return res.sendFile(filePath);
        }
    } catch (e) {
        console.error('Serve raw error:', e);
        res.setHeader('Cache-Control', 'no-store');
        res.status(500).json({ success: false, error: 'Error serving image' });
    }
}

async function getPreviewJsonResponse(req, dbImage, relPath) {
    const baseResponse = formatImageResponse(req, dbImage);
    const filePath = safeJoin(STORAGE_PATH, relPath);
    const previewMeta = await previewService.getPreviewMetadata(filePath, relPath);
    if (!previewMeta) return baseResponse;
    return {
        ...baseResponse,
        width: previewMeta.width,
        height: previewMeta.height,
        size: previewMeta.size,
        format: previewMeta.format,
        space: previewMeta.space,
        channels: previewMeta.channels,
        hasAlpha: previewMeta.hasAlpha,
    };
}

// 将 .webp 预览路径解析为原始文件 relPath
async function resolvePreviewPath(relPath) {
    if (!relPath.endsWith('.webp')) return relPath;
    const filePath = safeJoin(STORAGE_PATH, relPath);
    if (await fs.pathExists(filePath)) return relPath;
    const base = relPath.slice(0, -5);
    for (const ext of ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.avif', '.svg', '.webp']) {
        const candidate = base + ext;
        if (await fs.pathExists(safeJoin(STORAGE_PATH, candidate))) return candidate;
    }
    return relPath;
}

// ── 地图数据 ──────────────────────────────────────────────────────────────────

router.get('/map-data', requirePassword, async (req, res) => {
    const images = imageRepository.getAll();
    const data = images.filter(img => {
        const meta = parseMeta(img);
        return meta.gps;
    }).map(img => {
        const formatted = formatImageResponse(req, img);
        const meta = parseMeta(img);
        return {
            filename: img.filename,
            lat: meta.gps.lat,
            lng: meta.gps.lng,
            date: img.upload_time,
            thumbUrl: `${formatted.previewUrl}?w=200`,
            thumbhash: img.thumbhash,
            previewUrl: formatted.previewUrl,
            rawUrl: formatted.rawUrl
        };
    });
    res.json({ success: true, data });
});

// ── 目录列表 ──────────────────────────────────────────────────────────────────

router.get('/directories', requirePassword, async (req, res) => {
    try {
        async function getDirectories(dir) {
            const absDir = safeJoin(STORAGE_PATH, dir);
            let results = [];
            try {
                const files = await fs.readdir(absDir);
                for (const file of files) {
                    if ([CACHE_DIR_NAME, CONFIG_DIR_NAME, TRASH_DIR_NAME].includes(file)) continue;
                    if (file.startsWith('.')) continue;

                    const filePath = path.join(absDir, file);
                    const stats = await fs.stat(filePath);
                    if (!stats.isDirectory()) continue;

                    const relPath = path.join(dir, file).replace(/\\/g, '/');
                    const previews = imageRepository.getPreviews(relPath, 3).map(img =>
                        `/api/images/${img.rel_path.split('/').map(encodeURIComponent).join('/')}?w=400`
                    );

                    results.push({
                        name: file,
                        path: relPath,
                        previews,
                        imageCount: imageRepository.countByDir(relPath),
                        mtime: stats.mtime
                    });

                    const children = await getDirectories(relPath);
                    results = results.concat(children);
                }
            } catch (e) { /* directory read error, skip */ }
            return results;
        }

        res.json({ success: true, data: await getDirectories('') });
    } catch (e) {
        console.error('List directories error:', e);
        res.status(500).json({ success: false, error: 'Failed to list directories' });
    }
});

// ── 图片列表 ──────────────────────────────────────────────────────────────────

router.get('/images', requirePassword, async (req, res) => {
    try {
        const dir = (req.query.dir || '').replace(/\\/g, '/');
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize) || 10));
        const search = req.query.search || '';

        if (dir && await isAlbumLocked(dir)) {
            const albumPassword = req.headers['x-album-password'];
            if (!albumPassword || !(await verifyAlbumPassword(dir, albumPassword))) {
                return res.status(403).json({ success: false, error: 'Album password required', locked: true });
            }
        }

        const { data: paginated, total } = imageRepository.paginate(dir, search, page, pageSize);

        res.setHeader('Cache-Control', 'no-store');
        res.json({
            success: true,
            data: paginated.map(img => formatImageResponse(req, img)),
            pagination: { current: page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
        });
    } catch (e) {
        console.error('List images error:', e);
        res.status(500).json({ success: false, error: 'Failed to list images' });
    }
});

// ── 图片元数据 ────────────────────────────────────────────────────────────────

router.get('/images/meta/*', requirePassword, async (req, res) => {
    const relPath = decodeURIComponent(req.params[0]);
    try {
        const dbImage = imageRepository.getByPath(relPath);
        const filePath = safeJoin(STORAGE_PATH, relPath);

        if (!dbImage && !await fs.pathExists(filePath)) {
            return res.status(404).json({ success: false, error: 'Image not found' });
        }

        let fileInfo = {};
        if (dbImage) {
            fileInfo = {
                width: dbImage.width,
                height: dbImage.height,
                orientation: dbImage.orientation,
                ...JSON.parse(dbImage.meta_json || '{}')
            };
        }

        const fstats = await fs.stat(filePath);
        const mimeType = mime.lookup(filePath) || 'application/octet-stream';

        if (!fileInfo.space || !fileInfo.width) {
            const { getFileMetadata } = require('../services/metadataService');
            const freshMeta = await getFileMetadata(filePath, relPath, fstats);
            const freshJson = JSON.parse(freshMeta.meta_json);
            fileInfo = {
                ...fileInfo,
                width: freshMeta.width,
                height: freshMeta.height,
                orientation: freshMeta.orientation,
                ...freshJson
            };
        }

        const metaImage = {
            filename: path.basename(relPath),
            rel_path: relPath,
            size: fstats.size,
            upload_time: fstats.mtime.toISOString(),
            mime_type: mimeType,
            width: fileInfo.width,
            height: fileInfo.height,
            meta_json: fileInfo,
            thumbhash: dbImage?.thumbhash
        };
        const base = formatImageResponse(req, metaImage);
        res.json({
            success: true,
            data: {
                ...base,
                ...(fileInfo.exif && { exif: fileInfo.exif }),
                ...(fileInfo.gps && { gps: fileInfo.gps }),
            }
        });
    } catch (e) {
        console.error('Meta error:', e);
        res.status(500).json({ success: false, error: 'Failed to fetch metadata' });
    }
});

// ── 随机图片 ──────────────────────────────────────────────────────────────────

router.get('/random/preview', requirePassword, async (req, res) => {
    try {
        const dir = (req.query.dir || '').replace(/\\/g, '/');
        const randomImage = imageRepository.getRandom(dir || null);
        if (!randomImage) return res.status(404).json({ success: false, error: 'No images found' });

        if (req.query.format === 'json') {
            return res.json({ success: true, data: await getPreviewJsonResponse(req, randomImage, randomImage.rel_path) });
        }
        await servePreviewImage(req, res, randomImage.rel_path);
    } catch (e) {
        console.error('Random preview error:', e);
        res.status(500).json({ success: false, error: 'Failed to get random preview' });
    }
});

router.get('/random/raw', requirePassword, async (req, res) => {
    try {
        const dir = (req.query.dir || '').replace(/\\/g, '/');
        const randomImage = imageRepository.getRandom(dir || null);
        if (!randomImage) return res.status(404).json({ success: false, error: 'No images found' });

        if (req.query.format === 'json') {
            return res.json({ success: true, data: formatImageResponse(req, randomImage) });
        }
        await serveRawImage(req, res, randomImage.rel_path);
    } catch (e) {
        console.error('Random raw error:', e);
        res.status(500).json({ success: false, error: 'Failed to get random image' });
    }
});

// ── 指定图片 ──────────────────────────────────────────────────────────────────

router.get('/images/preview/*', async (req, res) => {
    const rawRelPath = decodeURIComponent(req.params[0]);
    const relPath = await resolvePreviewPath(rawRelPath);

    if (req.query.format === 'json') {
        try {
            const dbImage = imageRepository.getByPath(relPath);
            if (!dbImage) return res.status(404).json({ success: false, error: 'Not found' });
            return res.json({ success: true, data: await getPreviewJsonResponse(req, dbImage, relPath) });
        } catch (e) {
            console.error('Preview metadata error:', e);
            return res.status(500).json({ success: false, error: 'Failed to get preview metadata' });
        }
    }
    await servePreviewImage(req, res, relPath);
});

router.get('/images/raw/*', async (req, res) => {
    const relPath = decodeURIComponent(req.params[0]);

    if (req.query.format === 'json') {
        const dbImage = imageRepository.getByPath(relPath);
        if (!dbImage) return res.status(404).json({ success: false, error: 'Not found' });
        return res.json({ success: true, data: formatImageResponse(req, dbImage) });
    }
    await serveRawImage(req, res, relPath);
});

// ── 文件直出 ──────────────────────────────────────────────────────────────────

router.get('/files/*', requirePassword, (req, res) => {
    const relPath = decodeURIComponent(req.params[0]);
    try {
        if (isSensitivePath(relPath)) return res.status(403).json({ success: false, error: 'Access denied' });

        const filePath = safeJoin(STORAGE_PATH, relPath);
        if (!fs.existsSync(filePath)) return res.status(404).json({ success: false, error: 'Not found' });

        const contentType = mime.lookup(filePath) || 'application/octet-stream';
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (contentType === 'image/svg+xml') {
            res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
            res.setHeader('Content-Security-Policy', "script-src 'none'");
        }
        res.setHeader('Content-Type', contentType);
        res.sendFile(filePath);
    } catch (e) {
        console.error('Serve file error:', e);
        res.status(500).json({ success: false, error: 'Error serving file' });
    }
});

module.exports = router;
