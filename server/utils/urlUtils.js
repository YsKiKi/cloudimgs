const path = require('path');

function parseMeta(image) {
    if (typeof image.meta_json === 'string') {
        try { return JSON.parse(image.meta_json); } catch (e) { return {}; }
    }
    if (typeof image.meta_json === 'object' && image.meta_json) return image.meta_json;
    return {};
}

function encodeRelPath(relPath) {
    return relPath.split("/").map(encodeURIComponent).join("/");
}

function formatImageResponse(req, image) {
    if (!image || !image.rel_path) return image;

    const relPathStr = encodeRelPath(image.rel_path);
    const previewRelPath = relPathStr.replace(/\.[^.]+$/, '.webp');
    const meta = parseMeta(image);

    return {
        filename: image.filename,

        previewUrl: `/api/images/preview/${previewRelPath}`,
        rawUrl: `/api/images/raw/${relPathStr}`,

        width: image.width,
        height: image.height,
        size: image.size,
        format: meta.format,

        space: meta.space,
        channels: meta.channels,
        density: meta.density,
        hasAlpha: meta.hasAlpha,

        thumbhash: image.thumbhash,
        uploadTime: image.upload_time,
    };
}

module.exports = {
    formatImageResponse,
    parseMeta,
    encodeRelPath,
};
