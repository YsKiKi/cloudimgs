const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const config = require('../../config');
const { upload, uploadAny, handleMulterError } = require('../middleware/upload');
const { requirePassword } = require('../middleware/auth');
const { saveBase64Image, safeJoin, sanitizeFilename, generateThumbHash, downloadFromUrl } = require('../utils/fileUtils');
const { formatImageResponse, encodeRelPath } = require('../utils/urlUtils');
const imageRepository = require('../db/imageRepository');
const { getFileMetadata, parseAudioDuration } = require('../services/metadataService');
const clipService = require('../services/clipService');
const previewService = require('../services/previewService');
const sharp = require('sharp');

const router = express.Router();
const STORAGE_PATH = config.storage.path;

router.post('/upload-base64', requirePassword, async (req, res) => {
    try {
        let dir = req.body.dir || req.query.dir || "";
        dir = dir.replace(/\\/g, "/");

        if (!req.body.base64Image) {
            return res.status(400).json({ success: false, error: 'Missing base64Image parameter' });
        }

        const { filename, filePath, size, mimetype } = await saveBase64Image(req.body.base64Image, dir);
        const relPath = path.join(dir, filename).replace(/\\/g, "/");

        const metadata = await getFileMetadata(filePath, relPath);
        const originalName = req.body.originalName || filename;

        const dbResult = imageRepository.add({
            filename: sanitizeFilename(originalName),
            rel_path: relPath,
            ...metadata
        });

        try {
            let imageId = dbResult.lastInsertRowid;
            if (!imageId || imageId.toString() === '0') {
                const existing = imageRepository.getByPath(relPath);
                if (existing) imageId = existing.id;
            }
            if (imageId) {
                clipService.addToQueue({ id: imageId, rel_path: relPath, filename: sanitizeFilename(originalName) });
            }
        } catch (queueErr) {
            console.error('Queue error:', queueErr);
        }

        imageRepository.recordUpload(size);

        previewService.generatePreview(filePath, relPath).catch(err => {
            console.error('Failed to generate preview:', err);
        });

        const formatted = formatImageResponse(req, imageRepository.getByPath(relPath) || {
            filename: sanitizeFilename(originalName),
            rel_path: relPath,
            width: metadata.width,
            height: metadata.height,
            size,
            upload_time: metadata.upload_time,
            mime_type: mimetype,
            thumbhash: metadata.thumbhash
        });

        res.json({
            success: true,
            data: { ...formatted, originalName, mimetype }
        });
    } catch (error) {
        console.error('Base64 upload error:', error);
        return res.status(400).json({ success: false, error: error.message || 'Failed to process base64 image' });
    }
});

// 1.0 URL 上传
router.post('/upload-url', requirePassword, async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) {
            return res.status(400).json({ success: false, error: "缺少 url 参数" });
        }

        let dir = req.body.dir || "";
        dir = dir.replace(/\\/g, "/");

        // Download image from URL
        let imageData;
        try {
            imageData = await downloadFromUrl(url);
        } catch (downloadErr) {
            return res.status(400).json({ success: false, error: `下载图片失败: ${downloadErr.message}` });
        }

        // Convert to base64 and save
        const base64Data = `data:${imageData.mimetype};base64,${imageData.buffer.toString('base64')}`;
        const { filename, filePath, size, mimetype } = await saveBase64Image(base64Data, dir);
        const relPath = path.join(dir, filename).replace(/\\/g, "/");

        // Generate metadata
        const metadata = await getFileMetadata(filePath, relPath);

        // Extract original name from URL if possible
        const urlPathname = new URL(url).pathname;
        const urlFilename = decodeURIComponent(urlPathname.split('/').pop() || filename);
        const ext = path.extname(urlFilename);
        const nameWithoutExt = path.basename(urlFilename, ext);
        const originalName = ext ? `${nameWithoutExt}${ext}` : filename;

        const dbResult = imageRepository.add({
            filename: sanitizeFilename(originalName),
            rel_path: relPath,
            ...metadata
        });

        // Add to magic search queue
        try {
            let imageId = dbResult.lastInsertRowid;
            if (!imageId || imageId.toString() === '0') {
                const existing = imageRepository.getByPath(relPath);
                if (existing) imageId = existing.id;
            }
            if (imageId) {
                clipService.addToQueue({ id: imageId, rel_path: relPath, filename: originalName });
            }
        } catch (queueErr) {
            console.error("Queue error:", queueErr);
        }

        // Record upload stats
        imageRepository.recordUpload(size);

        const formatted = formatImageResponse(req, imageRepository.getByPath(relPath) || {
            filename: originalName,
            rel_path: relPath,
            width: metadata.width,
            height: metadata.height,
            size: size,
            upload_time: metadata.upload_time,
            mime_type: mimetype,
            thumbhash: metadata.thumbhash
        });

        res.json({
            success: true,
            message: "URL 图片上传成功",
            data: {
                ...formatted,
                originalName: originalName,
                mimetype: mimetype
            }
        });
    } catch (error) {
        console.error("URL 上传错误:", error);
        return res.status(500).json({ success: false, error: error.message || "URL 图片上传失败" });
    }
});

// 1.1 上传图片 (Multer)
router.post('/upload', requirePassword, upload.any(), handleMulterError, async (req, res) => {
    try {
        let dir = req.body.dir || req.query.dir || "";
        dir = dir.replace(/\\/g, "/");

        if (req.files && req.files.length > 0) req.file = req.files[0];
        if (!req.file) return res.status(400).json({ success: false, error: 'No file selected' });

        const relPath = path.join(dir, req.file.filename).replace(/\\/g, "/");
        const metadata = await getFileMetadata(req.file.path, relPath);

        let originalName = req.file.originalname;
        if (!/[^\u0000-\u00ff]/.test(originalName)) {
            try { originalName = Buffer.from(originalName, "latin1").toString("utf8"); } catch (e) { }
        }

        const dbResult = imageRepository.add({
            filename: req.file.filename,
            rel_path: relPath,
            ...metadata
        });

        // 检查是否覆盖了现有文件，如果是则清除 sharp 缓存
        const forceOverwrite =
            req.query.overwrite === "true" ||
            req.body?.overwrite === "true" ||
            req.query.overwrite === true ||
            req.body?.overwrite === true;
        if (forceOverwrite) {
            try {
                // 清除 sharp 缓存以确保下次访问读取新文件
                sharp.cache(false);
                sharp.cache(true);
            } catch (e) { }
        }

        try {
            let imageId = dbResult.lastInsertRowid;
            if (!imageId || imageId.toString() === '0') {
                const existing = imageRepository.getByPath(relPath);
                if (existing) imageId = existing.id;
            }
            if (imageId) {
                clipService.addToQueue({ id: imageId, rel_path: relPath, filename: req.file.filename }, 'high');
            }
        } catch (queueErr) {
            console.error('Queue error:', queueErr);
        }

        imageRepository.recordUpload(req.file.size);

        previewService.generatePreview(req.file.path, relPath).catch(err => {
            console.error('Failed to generate preview:', err);
        });

        const formatted = formatImageResponse(req, {
            filename: req.file.filename,
            rel_path: relPath,
            width: metadata.width,
            height: metadata.height,
            size: req.file.size,
            upload_time: metadata.upload_time,
            mime_type: req.file.mimetype,
            thumbhash: metadata.thumbhash
        });

        res.json({
            success: true,
            data: { ...formatted, originalName, mimetype: req.file.mimetype }
        });
    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({ success: false, error: 'Upload failed' });
    }
});

// 1.2 处理图片（缩放+居中合成到指定尺寸）
router.post('/process-image', requirePassword, upload.single("image"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "没有选择图片文件" });
      }

      const width = parseInt(req.body.width || req.query.width);
      const height = parseInt(req.body.height || req.query.height);

      if (!width || !height || width <= 0 || height <= 0) {
        return res.status(400).json({ error: "请提供有效的宽度和高度参数" });
      }

      let dir = req.body.dir || req.query.dir || "";
      dir = dir.replace(/\\/g, "/");

      const inputBuffer = await fs.readFile(req.file.path);
      const metadata = await sharp(inputBuffer).metadata();

      const scaleX = width / metadata.width;
      const scaleY = height / metadata.height;
      const scale = Math.min(scaleX, scaleY);

      const scaledWidth = Math.round(metadata.width * scale);
      const scaledHeight = Math.round(metadata.height * scale);

      const left = Math.round((width - scaledWidth) / 2);
      const top = Math.round((height - scaledHeight) / 2);

      const processedBuffer = await sharp({
        create: {
          width: width,
          height: height,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 }
        }
      })
        .composite([
          {
            input: await sharp(inputBuffer)
              .resize(scaledWidth, scaledHeight)
              .toBuffer(),
            left: left,
            top: top
          }
        ])
        .png()
        .toBuffer();

      let originalName = req.file.originalname;
      if (!/[^ -ÿ]/.test(originalName)) {
        try { originalName = Buffer.from(originalName, "latin1").toString("utf8"); } catch (e) { }
      }

      const ext = path.extname(originalName);
      const nameWithoutExt = path.basename(originalName, ext);
      let processedFilename = `${nameWithoutExt}_processed_${width}x${height}.png`;
      processedFilename = sanitizeFilename(processedFilename);

      const dest = safeJoin(STORAGE_PATH, dir);
      await fs.ensureDir(dest);

      let finalFilename = processedFilename;
      let counter = 1;

      if (!config.upload.allowDuplicateNames) {
        while (fs.existsSync(path.join(dest, finalFilename))) {
          if (config.upload.duplicateStrategy === "timestamp") {
            finalFilename = `${nameWithoutExt}_processed_${width}x${height}_${Date.now()}_${counter}.png`;
          } else if (config.upload.duplicateStrategy === "counter") {
            finalFilename = `${nameWithoutExt}_processed_${width}x${height}_${counter}.png`;
          } else if (config.upload.duplicateStrategy === "overwrite") {
            break;
          }
          counter++;
        }
      }

      const processedFilePath = path.join(dest, finalFilename);
      await fs.writeFile(processedFilePath, processedBuffer);
      await fs.remove(req.file.path);

      const relPath = path.join(dir, finalFilename).replace(/\\/g, "/");

      const fileInfo = {
        filename: finalFilename,
        originalName: originalName,
        processedSize: { width, height },
        originalSize: { width: metadata.width, height: metadata.height },
        size: processedBuffer.length,
        mimetype: "image/png",
        uploadTime: new Date().toISOString(),
        url: `/api/images/${relPath.split("/").map(encodeURIComponent).join("/")}`,
        relPath,
        fullUrl: `${getBaseUrl(req)}/api/images/${relPath.split("/").map(encodeURIComponent).join("/")}`,
      };

      res.json({
        success: true,
        message: "图片处理成功",
        data: fileInfo,
      });
    } catch (error) {
      console.error("图片处理错误:", error);
      if (req.file && req.file.path) {
        try { await fs.remove(req.file.path); } catch (cleanupError) { }
      }
      res.status(500).json({ error: "图片处理失败" });
    }
});

// 1.3 上传文件 (任意)
router.post('/upload-file', requirePassword, uploadAny.single("file"), handleMulterError, async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'No file selected' });

        let dir = req.body.dir || req.query.dir || "";
        dir = dir.replace(/\\/g, "/");


        const customFilename = req.body.filename || req.query.filename;
        let finalFilename = req.file.filename;
        let displayName = req.file.originalname;

        if (customFilename) {
            const safeCustom = sanitizeFilename(path.basename(customFilename));
            const targetDir = safeJoin(STORAGE_PATH, dir);
            const oldPath = req.file.path;
            const newPath = path.join(targetDir, safeCustom);

            if (oldPath !== newPath) {
                await fs.ensureDir(targetDir);
                let counter = 1;
                const ext = path.extname(safeCustom);
                const nameBase = path.basename(safeCustom, ext);
                let targetPath = newPath;

                if (!config.upload.allowDuplicateNames) {
                    while (fs.existsSync(targetPath)) {
                        if (config.upload.duplicateStrategy === 'timestamp') {
                            safeCustom = `${nameBase}_${Date.now()}_${counter}${ext}`;
                        } else {
                            safeCustom = `${nameBase}_${counter}${ext}`;
                        }
                        targetPath = path.join(targetDir, safeCustom);
                        counter++;
                    }
                }

                finalFilename = safeCustom;
                displayName = customFilename;
                fs.renameSync(oldPath, targetPath);
            } else {
                finalFilename = safeCustom;
                displayName = customFilename;
            }
        }

        const relPath = path.join(dir, finalFilename).replace(/\\/g, "/");
        const filePath = safeJoin(STORAGE_PATH, relPath);

        const ext = path.extname(finalFilename).toLowerCase();
        const isImage = config.upload.allowedExtensions.includes(ext);

        if (isImage) {
            const metadata = await getFileMetadata(filePath, relPath);
            imageRepository.add({
                filename: finalFilename,
                rel_path: relPath,
                ...metadata
            });
            previewService.generatePreview(filePath, relPath).catch(err => {
                console.error('Failed to generate preview:', err);
            });
        }

        let duration = null;
        if (req.file.mimetype === 'audio/mpeg' || (customFilename && customFilename.toLowerCase().endsWith('.mp3'))) {
            try {
                const d = await parseAudioDuration(filePath);
                if (d) duration = parseFloat((Math.ceil(d * 1000) / 1000).toFixed(2));
            } catch (e) { }
        }

        imageRepository.recordUpload(req.file.size);

        if (isImage) {
            const formatted = formatImageResponse(req, imageRepository.getByPath(relPath) || {
                filename: finalFilename,
                rel_path: relPath,
                size: req.file.size,
                mime_type: req.file.mimetype
            });
            return res.json({
                success: true,
                data: { ...formatted, originalName: displayName, mimetype: req.file.mimetype, ...(duration && { duration }) }
            });
        }

        const relPathStr = encodeRelPath(relPath);
        res.json({
            success: true,
            data: {
                filename: finalFilename,
                originalName: displayName,
                size: req.file.size,
                mimetype: req.file.mimetype,
                uploadTime: new Date().toISOString(),
                previewUrl: `/api/files/${relPathStr}`,
                rawUrl: `/api/files/${relPathStr}`,
                ...(duration && { duration })
            }
        });
    } catch (error) {
        console.error("文件上传错误:", error.message);
        res.status(500).json({ success: false, error: "文件上传失败: " + error.message });
    }
});

module.exports = router;
