const path = require('path');

/**
 * Formats an image object for JSON response, ensuring fullUrl is an absolute URL.
 * @param {Object} req - Express request object
 * @param {Object} image - Image object (must have rel_path)
 * @returns {Object} Formatted image object
 */
function formatImageResponse(req, image) {
    // Basic validation
    if (!image || !image.rel_path) return image;

    const relPathStr = image.rel_path.split("/").map(encodeURIComponent).join("/");
    const url        = `/api/images/${relPathStr}`;            // 向后兼容（智能：无参数=预览，有参数=原图）
    const previewUrl = `/api/images/preview/${relPathStr}`;    // 专用预览图接口（WebP 优化）
    const rawUrl     = `/api/images/raw/${relPathStr}`;        // 专用原图接口
    const fullUrl        = `${req.protocol}://${req.get('host')}${url}`;
    const fullPreviewUrl = `${req.protocol}://${req.get('host')}${previewUrl}`;
    const fullRawUrl     = `${req.protocol}://${req.get('host')}${rawUrl}`;

    // Parse meta_json if it exists and is a string
    let meta = {};
    if (typeof image.meta_json === 'string') {
        try {
            meta = JSON.parse(image.meta_json);
        } catch (e) { }
    } else if (typeof image.meta_json === 'object') {
        meta = image.meta_json;
    }

    return {
        // Standard fields
        filename: image.filename,
        relPath: image.rel_path,
        fullUrl: fullUrl,           // 绝对 URL（向后兼容，智能路由）
        url: url,                   // 相对 URL（向后兼容，智能路由）
        previewUrl: previewUrl,     // 预览图相对 URL（WebP 优化）
        rawUrl: rawUrl,             // 原图相对 URL
        fullPreviewUrl: fullPreviewUrl, // 预览图绝对 URL
        fullRawUrl: fullRawUrl,     // 原图绝对 URL
        width: image.width,
        height: image.height,
        size: image.size,
        uploadTime: image.upload_time,
        mime: image.mime_type, // Some places user mime_type

        // Merge extra fields if present
        ...meta,

        // Allow overriding or adding specific fields if they exist on the input object
        // but were not in the standard list above (e.g. thumbhash)
        thumbhash: image.thumbhash,
    };
}

module.exports = {
    formatImageResponse
};
