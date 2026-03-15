const express = require('express');
const router = express.Router();
const imageRepository = require('../db/imageRepository');
const { requirePassword } = require('../middleware/auth');
const { formatImageResponse } = require('../utils/urlUtils');

// 每日流量统计
router.get('/traffic', requirePassword, async (req, res) => {
    try {
        const days = Math.min(365, Math.max(1, parseInt(req.query.days) || 30));
        const stats = imageRepository.getDailyStats(days);
        res.json({ success: true, data: stats.reverse() });
    } catch (e) {
        console.error('Fetch traffic stats error:', e);
        res.status(500).json({ success: false, error: 'Failed to fetch traffic stats' });
    }
});

// 热门图片
router.get('/top', requirePassword, async (req, res) => {
    try {
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
        const topImages = imageRepository.getTopImages(limit);
        const data = topImages.map(img => ({
            ...formatImageResponse(req, img),
            views: img.views
        }));
        res.json({ success: true, data });
    } catch (e) {
        console.error('Fetch top images error:', e);
        res.status(500).json({ success: false, error: 'Failed to fetch top images' });
    }
});

module.exports = router;
