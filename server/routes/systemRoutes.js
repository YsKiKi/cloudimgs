const express = require('express');
const imageRepository = require('../db/imageRepository');
const { requirePassword, safeEqual } = require('../middleware/auth');

const router = express.Router();

// 健康检查
router.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// 图片统计
router.get('/stats', (req, res) => {
    res.json({ success: true, data: { imageCount: imageRepository.count() } });
});

// 系统配置
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
            storage: { filename: config.storage.filename },
            magicSearch: { enabled: config.magicSearch.enabled }
        }
    });
});

// 认证状态
router.get('/auth/status', (req, res) => {
    const config = require('../../config');
    res.json({ success: true, data: { enabled: config.security.password.enabled } });
});

// 登录验证
router.post('/auth/login', (req, res) => {
    const config = require('../../config');
    const { password } = req.body;
    if (!config.security.password.enabled) {
        return res.json({ success: true });
    }
    if (safeEqual(password || '', config.security.password.accessPassword || '')) {
        return res.json({ success: true });
    }
    res.status(401).json({ success: false, error: 'Incorrect password' });
});

module.exports = router;
