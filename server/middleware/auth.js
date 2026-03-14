const crypto = require('crypto');
const config = require('../../config');

function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
        // 仍需消耗恒定时间，防止长度泄露
        crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}

function requirePassword(req, res, next) {
    if (!config.security.password.enabled) {
        return next();
    }

    const password =
        req.headers["x-access-password"] || req.body.password || req.query.password;

    if (!password) {
        return res.status(401).json({ error: "需要提供访问密码" });
    }

    if (!safeEqual(password, config.security.password.accessPassword)) {
        return res.status(401).json({ error: "密码错误" });
    }

    next();
}

module.exports = { requirePassword, safeEqual };
