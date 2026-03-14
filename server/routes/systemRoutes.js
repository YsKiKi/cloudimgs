const express = require('express');
const imageRepository = require('../db/imageRepository');
const { requirePassword, safeEqual } = require('../middleware/auth');

const router = express.Router();

router.get('/health', (req, res) => {
    res.status(200).json({ status: "ok" });
});

router.get('/stats', (req, res) => {
    const count = imageRepository.count();
    res.json({
        success: true,
        data: {
            imageCount: count
        }
    });
});

router.get('/config', requirePassword, (req, res) => {
    const config = require('../../config');
    res.json({
        success: true,
        data: {
            upload: {
                maxFileSize: config.upload.maxFileSize,
                allowedExtensions: config.upload.allowedExtensions,
                timeout: config.upload.timeout
            },
            storage: {
                filename: config.storage.filename
            },
            magicSearch: {
                enabled: config.magicSearch.enabled
            }
        }
    });
});

router.get('/auth/status', (req, res) => {
    const config = require('../../config');
    res.json({
        success: true,
        data: {
            enabled: config.security.password.enabled,
        }
    });
});

router.post('/auth/login', (req, res) => {
    const config = require('../../config');
    const { password } = req.body;
    if (!config.security.password.enabled) {
        return res.json({ success: true, message: "No password required" });
    }
    if (safeEqual(password || '', config.security.password.accessPassword || '')) {
        return res.json({ success: true, message: "Login successful" });
    }
    res.status(401).json({ success: false, error: "Incorrect password" });
});

module.exports = router;
