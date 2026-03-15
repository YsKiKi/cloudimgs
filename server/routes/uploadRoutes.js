const express = require('express');
const path = require('path');
const fs = require('fs-extra');
const config = require('../../config');
const { upload, uploadAny, handleMulterError } = require('../middleware/upload');
const { requirePassword } = require('../middleware/auth');
const { saveBase64Image, safeJoin, sanitizeFilename, generateThumbHash } = require('../utils/fileUtils');
const { formatImageResponse, encodeRelPath } = require('../utils/urlUtils');
const imageRepository = require('../db/imageRepository');
const { getFileMetadata, parseAudioDuration } = require('../services/metadataService');
const clipService = require('../services/clipService');
const previewService = require('../services/previewService');

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

router.post('/upload-file', requirePassword, uploadAny.single("file"), handleMulterError, async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'No file selected' });

        let dir = req.body.dir || req.query.dir || "";
        dir = dir.replace(/\\/g, "/");


        const customFilename = req.body.filename || req.query.filename;
        let finalFilename = req.file.filename;
        let displayName = req.file.originalname;

        if (customFilename) {
            const safeCustom = sanitizeFilename(customFilename);
            const targetDir = safeJoin(STORAGE_PATH, dir);
            const oldPath = req.file.path;
            let newPath = path.join(targetDir, safeCustom);

            let counter = 1;
            const ext = path.extname(safeCustom);
            const nameBase = path.basename(safeCustom, ext);

            if (!config.upload.allowDuplicateNames) {
                while (fs.existsSync(newPath)) {
                    if (config.upload.duplicateStrategy === 'timestamp') {
                        newPath = path.join(targetDir, `${nameBase}_${Date.now()}_${counter}${ext}`);
                    } else {
                        newPath = path.join(targetDir, `${nameBase}_${counter}${ext}`);
                    }
                    counter++;
                }
            }
            finalFilename = path.basename(newPath);
            displayName = customFilename;
            if (oldPath !== newPath) {
                fs.renameSync(oldPath, newPath);
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
        console.error('File upload error:', error);
        res.status(500).json({ success: false, error: 'File upload failed' });
    }
});

module.exports = router;
