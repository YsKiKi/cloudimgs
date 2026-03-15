const express = require('express');
const router = express.Router();
const clipService = require('../services/clipService');
const { requirePassword } = require('../middleware/auth');
const { formatImageResponse } = require('../utils/urlUtils');

// 语义搜索
router.post('/semantic', requirePassword, async (req, res) => {
    try {
        const { query, limit } = req.body;
        if (!query) return res.status(400).json({ success: false, error: 'Query is required' });

        const results = await clipService.search(query, limit || 50);
        const data = results.map(r => ({
            ...formatImageResponse(req, r),
            score: r.distance
        }));

        res.json({ success: true, data });
    } catch (error) {
        console.error('Semantic search error:', error);
        res.status(500).json({ success: false, error: 'Search failed' });
    }
});

// 触发全量扫描
router.post('/scan', requirePassword, async (req, res) => {
    try {
        const result = await clipService.scanAll();
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 重建索引
router.post('/reindex', requirePassword, async (req, res) => {
    try {
        const result = await clipService.reindex();
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 队列状态
router.get('/status', requirePassword, (req, res) => {
    res.json({
        success: true,
        data: {
            queueLength: clipService.queue.length,
            processing: clipService.processing
        }
    });
});

module.exports = router;
