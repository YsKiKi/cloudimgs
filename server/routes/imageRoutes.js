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
const { formatImageResponse } = require('../utils/urlUtils');
const previewService = require('../services/previewService');

const router = express.Router();
const STORAGE_PATH = config.storage.path;

// 禁止访问内部目录
const SENSITIVE_SEGMENTS = ['.cache', '.trash', '.preview', 'config'];
function isSensitivePath(relPath) {
    const segments = relPath.replace(/\\/g, '/').split('/');
    return segments.some(s => SENSITIVE_SEGMENTS.includes(s));
}

// 地图数据 — 返回所有带 GPS 数据的图像
router.get('/map-data', requirePassword, async (req, res) => {
    const images = imageRepository.getAll();
    const mapData = images.filter(img => {
        const meta = JSON.parse(img.meta_json || '{}');
        return meta.gps;
    }).map(img => {
        const formatted = formatImageResponse(req, img);
        const meta = JSON.parse(img.meta_json || '{}');
        return {
            filename: img.filename,
            relPath: img.rel_path,
            lat: meta.gps.lat,
            lng: meta.gps.lng,
            date: img.upload_time,
            thumbUrl: `${formatted.url}?w=200`,
            thumbhash: img.thumbhash,
            fullUrl: formatted.fullUrl,
            url: formatted.url
        };
    });
    res.json({ success: true, data: mapData });
});

// 目录列表
router.get('/directories', requirePassword, async (req, res) => {
    try {
        const { CACHE_DIR_NAME: CD, CONFIG_DIR_NAME: CFD, TRASH_DIR_NAME: TD } = require('../utils/fileUtils');

        // 扫描目录
        async function getDirectories(dir) {
            const absDir = safeJoin(STORAGE_PATH, dir);
            let results = [];
            try {
                const files = await fs.readdir(absDir);
                for (const file of files) {
                    if (file === CD || file === CFD || file === TD) continue;
                    if (file.startsWith('.')) continue; // 跳过隐藏文件

                    const filePath = path.join(absDir, file);
                    const stats = await fs.stat(filePath);
                    if (stats.isDirectory()) {
                        const relPath = path.join(dir, file).replace(/\\/g, "/");

                        // 从 DB 获取预览图和计数
                        // 注意：这会递归获取计数/预览，这通常是用户期望的“相册”封面
                        const previews = imageRepository.getPreviews(relPath, 3).map(img =>
                            `/api/images/${img.rel_path.split("/").map(encodeURIComponent).join("/")}?w=400`
                        );
                        const count = imageRepository.countByDir(relPath);

                        results.push({
                            name: file,
                            path: relPath,
                            fullUrl: relPath, // alias
                            previews,
                            imageCount: count,
                            mtime: stats.mtime // 文件夹本身的最后修改时间
                        });

                        // 递归扫描子相册？
                        // 如果显示树形结构，我们需要子项。
                        // 但通常典型的“相册视图”是直接子文件夹的平铺列表。
                        // 之前的代码是递归的：`results = results.concat(children);`
                        // 如果保持递归，我们将获得所有扁平化的子文件夹。
                        // UI 是否期望这样？
                        // `AlbumManager` 使用 `allAlbums`。它似乎将它们显示为卡片。
                        // 如果我有 A/B/C，我会看到 A、B 和 C 吗？
                        // 如果我看到 A并在其中点击，通常会进入 A。
                        // UI `AlbumManager` 过滤？
                        // `const allAlbums = res.data.data || [];`
                        // `setAlbums([allImagesAlbum, ...allAlbums]);`
                        // 它配置网格。
                        // 如果 API 返回所有目录的扁平列表，那么是的，递归是可以的。
                        // 让我们保持递归结构原样。

                        const children = await getDirectories(relPath);
                        results = results.concat(children);
                    }
                }
            } catch (e) { }
            return results;
        }

        const directories = await getDirectories("");
        res.json({ success: true, data: directories });

    } catch (e) {
        console.error("List directories error:", e);
        res.status(500).json({ error: "Get directories failed" });
    }
});

// 图片列表
router.get('/images', requirePassword, async (req, res) => {
    try {
        let dir = req.query.dir || "";
        dir = dir.replace(/\\/g, "/");
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize) || 10));
        const search = req.query.search || "";

        const albumPassword = req.headers["x-album-password"];
        if (dir && await isAlbumLocked(dir)) {
            if (!albumPassword || !(await verifyAlbumPassword(dir, albumPassword))) {
                return res.status(403).json({ success: false, error: "需要访问密码", locked: true });
            }
        }

        // 使用 DB 层分页查询
        const { data: paginated, total } = imageRepository.paginate(dir, search, page, pageSize);
        const result = paginated.map(img => formatImageResponse(req, img));

        res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
        res.json({
            success: true,
            data: result,
            pagination: {
                current: page,
                pageSize,
                total,
                totalPages: Math.ceil(total / pageSize)
            }
        });

    } catch (e) {
        console.error("List images error:", e);
        res.status(500).json({ error: "获取图片列表失败" });
    }
});

// 提取图片元数据
router.get('/images/meta/*', requirePassword, async (req, res) => {
    const relPath = decodeURIComponent(req.params[0]);
    const dbImage = imageRepository.getByPath(relPath);

    if (!dbImage) {
        // 回退到 FS 检查？
        if (!await fs.pathExists(safeJoin(STORAGE_PATH, relPath))) {
            return res.status(404).json({ success: false, error: "图片不存在" });
        }
        // 如果存在于 FS 但不在 DB 中，也许同步服务丢失了它？返回基本信息
    }

    // DB lookup first
    let fileInfo = {};
    if (dbImage) {
        fileInfo = {
            width: dbImage.width,
            height: dbImage.height,
            orientation: dbImage.orientation,
            ...JSON.parse(dbImage.meta_json || '{}')
        };
    }

    try {
        const filePath = safeJoin(STORAGE_PATH, relPath);
        const fstats = await fs.stat(filePath);
        const mimeType = mime.lookup(filePath) || "application/octet-stream";

        // If DB miss or missing critical info (e.g. detailed EXIF or Space not in DB for old records),
        // we might want to re-parse from file on the fly given this is the "Detail View"
        // But for performance, trust DB if available.
        // However, user just asked to "fix" it, so for existing images that don't have the new fields,
        // we should probably re-extract if missing.

        let needsUpdate = false;
        if (!fileInfo.space || !fileInfo.width) {
            const { getFileMetadata } = require('../services/metadataService');
            const freshMeta = await getFileMetadata(filePath, relPath, fstats);

            // Merge fresh meta
            const freshJson = JSON.parse(freshMeta.meta_json);
            fileInfo = {
                ...fileInfo,
                width: freshMeta.width,
                height: freshMeta.height,
                orientation: freshMeta.orientation,
                ...freshJson
            };

            // Optionally update DB here? Maybe too heavy for a GET request. 
            // Let's just return it for now.
        }

        const rawInfo = {
            filename: path.basename(relPath),
            rel_path: relPath, // helper expects rel_path
            size: fstats.size,
            upload_time: fstats.mtime.toISOString(), // helper expects upload_time
            mime_type: mimeType,
            width: fileInfo.width,
            height: fileInfo.height,
            meta_json: fileInfo // helper can take object
        };

        res.json({
            success: true,
            data: formatImageResponse(req, rawInfo)
        });

    } catch (e) {
        console.error("Meta error:", e);
        res.status(400).json({ success: false, error: "Error fetching metadata" });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// 内部辅助：使用 Sharp 处理图片（支持网格切分、缩放、格式转换）
// 返回 { buffer, mime }
// ─────────────────────────────────────────────────────────────────────────────
async function applySharp(filePath, query) {
    const { w, h, q, fmt, rows, cols, idx } = query;
    let img = sharp(filePath).rotate();

    // 网格切分
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

    // 缩放
    if (w || h) {
        img = img.resize({
            width: w ? parseInt(w) : null,
            height: h ? parseInt(h) : null,
            fit: "cover", position: "center", withoutEnlargement: true
        });
    }

    // 格式 / 质量
    let outMime = mime.lookup(filePath) || "application/octet-stream";
    if (fmt === "webp")       { img = img.webp({ quality: q ?? 80 });  outMime = "image/webp"; }
    else if (fmt === "jpeg")  { img = img.jpeg({ quality: q ?? 80 }); outMime = "image/jpeg"; }
    else if (fmt === "png")   { img = img.png();                       outMime = "image/png";  }
    else if (fmt === "avif")  { img = img.avif({ quality: q ?? 50 }); outMime = "image/avif"; }
    else if (q) {
        const orig = (mime.lookup(filePath) || "").toLowerCase();
        if (orig.includes("jpeg") || orig.includes("jpg")) { img = img.jpeg({ quality: q }); outMime = "image/jpeg"; }
        else if (orig.includes("webp"))  { img = img.webp({ quality: q });  outMime = "image/webp"; }
        else if (orig.includes("avif"))  { img = img.avif({ quality: q });  outMime = "image/avif"; }
        else                             { img = img.png();                  outMime = "image/png";  }
    }

    const buffer = await img.toBuffer();
    return { buffer, mime: outMime };
}

// ─────────────────────────────────────────────────────────────────────────────
// 专职辅助：强制返回 WebP 预览图（无预览时同步生成，生成失败则压缩原图回退）
// ─────────────────────────────────────────────────────────────────────────────
async function servePreviewImage(req, res, relPath) {
    try {
        if (isSensitivePath(relPath)) return res.status(403).json({ error: "Access denied" });
        const filePath = safeJoin(STORAGE_PATH, relPath);
        if (!await fs.pathExists(filePath)) return res.status(404).json({ error: "Not found" });

        getThumbHash(filePath).then(h => { if (!h) generateThumbHash(filePath); });

        // 尝试预览缓存
        let previewPath = await previewService.getPreviewPath(relPath);
        if (!previewPath || !await fs.pathExists(previewPath)) {
            // 同步生成预览图（等待完成后再返回）
            await previewService.generatePreview(filePath, relPath).catch(err => {
                console.error('Failed to generate preview:', err);
            });
            previewPath = await previewService.getPreviewPath(relPath);
        }

        if (previewPath && await fs.pathExists(previewPath)) {
            const stats = await fs.stat(previewPath).catch(() => ({ size: 0 }));
            // Guard: don't serve empty/corrupt preview files
            if (stats.size > 0) {
                try { imageRepository.recordView(stats.size); imageRepository.incrementViews(relPath); } catch (e) { console.error("Stats error", e); }
                res.setHeader("Content-Type", "image/webp");
                res.setHeader("Cache-Control", "public, max-age=31536000");
                return res.sendFile(previewPath);
            } else {
                // Remove corrupt preview so it can be regenerated next time
                await fs.remove(previewPath).catch(() => {});
            }
        }

        // 回退：用 sharp 压缩原图为 webp
        const { buffer } = await applySharp(filePath, { fmt: 'webp', q: 80 });
        if (!buffer || buffer.length === 0) {
            return res.status(500).json({ error: "Failed to generate image" });
        }
        try { imageRepository.recordView(buffer.length); imageRepository.incrementViews(relPath); } catch (e) { console.error("Stats error", e); }
        res.setHeader("Content-Type", "image/webp");
        res.setHeader("Cache-Control", "public, max-age=31536000");
        return res.send(buffer);
    } catch (e) {
        console.error("Serve preview error:", e);
        res.setHeader("Cache-Control", "no-store");
        res.status(400).json({ error: "Error serving preview" });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 专职辅助：强制返回原图（无参数时直出文件，有处理参数时经 Sharp 处理后返回）
// ─────────────────────────────────────────────────────────────────────────────
async function serveRawImage(req, res, relPath) {
    try {
        if (isSensitivePath(relPath)) return res.status(403).json({ error: "Access denied" });
        const filePath = safeJoin(STORAGE_PATH, relPath);
        if (!await fs.pathExists(filePath)) return res.status(404).json({ error: "Not found" });

        getThumbHash(filePath).then(h => { if (!h) generateThumbHash(filePath); });

        const { w, h, q, fmt, rows, cols, idx } = req.query;
        const hasProcessingParams = w || h || q || fmt || rows || cols || idx !== undefined;

        if (!hasProcessingParams) {
            const stats = await fs.stat(filePath).catch(() => ({ size: 0 }));
            try { imageRepository.recordView(stats.size); imageRepository.incrementViews(relPath); } catch (e) { console.error("Stats error", e); }
            const contentType = mime.lookup(filePath) || 'application/octet-stream';
            res.setHeader("Content-Type", contentType);
            res.setHeader('X-Content-Type-Options', 'nosniff');
            // SVG 安全防护
            if (contentType === 'image/svg+xml') {
                res.setHeader('Content-Security-Policy', "script-src 'none'");
            }
            res.setHeader("Cache-Control", "public, max-age=86400");
            return res.sendFile(filePath);
        }

        try {
            const { buffer, mime: outMime } = await applySharp(filePath, req.query);
            if (!buffer || buffer.length === 0) {
                // Sharp returned empty buffer - fallback to original
                const stats = await fs.stat(filePath).catch(() => ({ size: 0 }));
                try { imageRepository.recordView(stats.size); imageRepository.incrementViews(relPath); } catch (e) { console.error("Stats error", e); }
                res.setHeader("Content-Type", mime.lookup(filePath) || 'application/octet-stream');
                return res.sendFile(filePath);
            }
            try { imageRepository.recordView(buffer.length); imageRepository.incrementViews(relPath); } catch (e) { console.error("Stats error", e); }
            res.setHeader("Content-Type", outMime);
            res.setHeader("Cache-Control", "public, max-age=31536000");
            return res.send(buffer);
        } catch (e) {
            // sharp 处理失败时直接发送原始文件
            const stats = await fs.stat(filePath).catch(() => ({ size: 0 }));
            try { imageRepository.recordView(stats.size); imageRepository.incrementViews(relPath); } catch (e) { console.error("Stats error", e); }
            res.setHeader("Content-Type", mime.lookup(filePath) || 'application/octet-stream');
            return res.sendFile(filePath);
        }
    } catch (e) {
        console.error("Serve raw error:", e);
        res.setHeader("Cache-Control", "no-store");
        res.status(400).json({ error: "Error serving image" });
    }
}



// ═════════════════════════════════════════════════════════════════════════════
// 路由定义
// ═════════════════════════════════════════════════════════════════════════════

// ── 随机图片 ──────────────────────────────────────────────────────────────────

// 随机图片 — 预览图（WebP 优化）
// GET /api/random/preview?dir=xxx&format=json
router.get('/random/preview', requirePassword, async (req, res) => {
    try {
        let dir = (req.query.dir || "").replace(/\\/g, "/");
        const randomImage = imageRepository.getRandom(dir || null);
        if (!randomImage) return res.status(404).json({ error: "Not Found" });
        if (req.query.format === 'json') return res.json(formatImageResponse(req, randomImage));
        await servePreviewImage(req, res, randomImage.rel_path);
    } catch (e) {
        console.error("Random preview error:", e);
        res.status(500).json({ error: "Failed to get random preview" });
    }
});

// 随机图片 — 原图（支持处理参数或 format=json）
// GET /api/random/raw?dir=xxx&w=800&fmt=webp&format=json
router.get('/random/raw', requirePassword, async (req, res) => {
    try {
        let dir = (req.query.dir || "").replace(/\\/g, "/");
        const randomImage = imageRepository.getRandom(dir || null);
        if (!randomImage) return res.status(404).json({ error: "Not Found" });
        if (req.query.format === 'json') return res.json(formatImageResponse(req, randomImage));
        await serveRawImage(req, res, randomImage.rel_path);
    } catch (e) {
        console.error("Random raw error:", e);
        res.status(500).json({ error: "Failed to get random image" });
    }
});

// ── 指定图片 ──────────────────────────────────────────────────────────────────

// 指定图片 — 预览图（WebP 优化，同步生成）
// GET /api/images/preview/:path
router.get('/images/preview/*', async (req, res) => {
    const relPath = decodeURIComponent(req.params[0]);
    await servePreviewImage(req, res, relPath);
});

// 指定图片 — 原图（支持 w/h/q/fmt/rows/cols/idx 处理参数）
// GET /api/images/raw/:path?w=800&fmt=webp
router.get('/images/raw/*', async (req, res) => {
    const relPath = decodeURIComponent(req.params[0]);
    await serveRawImage(req, res, relPath);
});

// 原始文件直出（无任何处理，用于下载）
// GET /api/files/:path
router.get('/files/*', requirePassword, (req, res) => {
    const relPath = decodeURIComponent(req.params[0]);
    try {
        if (isSensitivePath(relPath)) {
            return res.status(403).json({ error: "Access denied" });
        }
        const filePath = safeJoin(STORAGE_PATH, relPath);
        if (fs.existsSync(filePath)) {
            const contentType = mime.lookup(filePath) || 'application/octet-stream';
            res.setHeader('X-Content-Type-Options', 'nosniff');
            // SVG 安全防护：强制下载，禁止内联执行
            if (contentType === 'image/svg+xml') {
                res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
                res.setHeader('Content-Security-Policy', "script-src 'none'");
            }
            res.setHeader('Content-Type', contentType);
            res.sendFile(filePath);
        } else {
            res.status(404).json({ error: "Not found" });
        }
    } catch (e) {
        res.status(400).json({ error: "Error" });
    }
});

module.exports = router;
