const express = require('express');
const router = express.Router();
const shareRepository = require('../db/shareRepository');
const imageRepository = require('../db/imageRepository');
const { requirePassword } = require('../middleware/auth');
const { formatImageResponse, parseMeta } = require('../utils/urlUtils');

// 查询分享链接列表
router.get('/list', requirePassword, (req, res) => {
    try {
        const { path: sharePath } = req.query;
        const shares = shareRepository.listByPath(sharePath || '');
        const now = Date.now();
        const data = shares.map(s => {
            let status = 'active';
            if (s.is_revoked) status = 'revoked';
            else if (s.burn_after_reading && s.views > 0) status = 'burned';
            else if (s.expire_seconds > 0 && now > s.created_at + s.expire_seconds * 1000) status = 'expired';
            return {
                token: s.token,
                path: s.path,
                createdAt: s.created_at,
                expireSeconds: s.expire_seconds,
                burnAfterReading: !!s.burn_after_reading,
                status,
                views: s.views
            };
        });
        res.json({ success: true, data });
    } catch (e) {
        console.error('List shares error:', e);
        res.status(500).json({ success: false, error: 'Failed to list shares' });
    }
});

// 生成分享链接
router.post('/generate', requirePassword, (req, res) => {
    try {
        const { path, expireSeconds, burnAfterReading } = req.body;
        if (path === undefined) return res.status(400).json({ success: false, error: 'Missing path' });

        const token = shareRepository.create({
            path,
            expireSeconds: expireSeconds || 0,
            burnAfterReading: !!burnAfterReading
        });
        res.json({ success: true, data: { token } });
    } catch (e) {
        console.error('Generate share error:', e);
        res.status(500).json({ success: false, error: 'Failed to generate share' });
    }
});

// 作废分享链接
router.post('/revoke', requirePassword, (req, res) => {
    try {
        const { signature } = req.body;
        if (!signature) return res.status(400).json({ success: false, error: 'Missing signature' });

        shareRepository.revoke(signature);
        res.json({ success: true });
    } catch (e) {
        console.error('Revoke share error:', e);
        res.status(500).json({ success: false, error: 'Failed to revoke share' });
    }
});

// 删除分享链接
router.delete('/:token', requirePassword, (req, res) => {
    try {
        const token = req.params.token;
        if (!token) return res.status(400).json({ success: false, error: 'Missing token' });
        shareRepository.delete(token);
        res.json({ success: true });
    } catch (e) {
        console.error('Delete share error:', e);
        res.status(500).json({ success: false, error: 'Failed to delete share' });
    }
});

// 访问分享内容（公开）
router.get('/access', (req, res) => {
    try {
        const { token, page = 1, pageSize = 20 } = req.query;
        if (!token) return res.status(400).json({ success: false, error: 'Missing token' });

        const share = shareRepository.getByToken(token);
        if (!share) return res.status(404).json({ success: false, error: 'Invalid link' });
        if (share.is_revoked) return res.status(403).json({ success: false, error: 'Link has been revoked' });

        const now = Date.now();
        if (share.expire_seconds > 0 && now > share.created_at + share.expire_seconds * 1000) {
            return res.status(403).json({ success: false, error: 'Link expired' });
        }
        if (share.burn_after_reading && share.views > 0) {
            return res.status(403).json({ success: false, error: 'Link already used (burned)' });
        }

        const images = imageRepository.getByDir(share.path);
        const p = Math.max(1, parseInt(page) || 1);
        const ps = Math.min(200, Math.max(1, parseInt(pageSize) || 20));
        const total = images.length;
        const sliced = images.slice((p - 1) * ps, p * ps);
        const dirName = share.path.split('/').pop() || (share.path === '' ? '全部图片' : share.path);

        shareRepository.incrementView(token);

        res.json({
            success: true,
            data: sliced.map(img => {
                const base = formatImageResponse(req, img);
                const meta = parseMeta(img);
                return {
                    ...base,
                    ...(meta.exif && { exif: meta.exif }),
                    ...(meta.gps && { gps: meta.gps }),
                };
            }),
            dirName,
            pagination: { current: p, pageSize: ps, total, totalPages: Math.ceil(total / ps) }
        });
    } catch (e) {
        console.error('Share access error:', e);
        res.status(500).json({ success: false, error: 'Failed to access share' });
    }
});

module.exports = router;
