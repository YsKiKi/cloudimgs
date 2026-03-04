const path = require('path');
const fs = require('fs-extra');
const sharp = require('sharp');
const config = require('../../config');
const { safeJoin } = require('../utils/fileUtils');

const PREVIEW_DIR_NAME = ".preview";
const STORAGE_PATH = config.storage.path;

// WebP 预览图配置
const PREVIEW_CONFIG = {
    quality: 80,        // WebP 质量 (0-100)
    maxWidth: 2048,     // 最大宽度
    maxHeight: 2048,    // 最大高度
};

/**
 * 生成图片的 WebP 预览图
 * @param {string} originalPath - 原始图片的绝对路径
 * @param {string} relPath - 图片的相对路径
 * @returns {Promise<string|null>} - 预览图的绝对路径，失败返回null
 */
async function generatePreview(originalPath, relPath) {
    try {
        const ext = path.extname(originalPath).toLowerCase();
        
        // 跳过视频文件
        if (['.mp4', '.webm', '.avi', '.mov', '.mkv'].includes(ext)) {
            return null;
        }

        // 已经是webp的话，也可以选择生成压缩版本或直接跳过
        // 这里我们仍然为webp生成一个优化版本
        
        const dir = path.dirname(relPath);
        const filename = path.basename(relPath);
        const previewDir = safeJoin(STORAGE_PATH, path.join(dir, PREVIEW_DIR_NAME));
        const previewFilename = path.parse(filename).name + '.webp';
        const previewPath = path.join(previewDir, previewFilename);

        // 确保预览目录存在
        await fs.ensureDir(previewDir);

        // 检查预览图是否已存在
        if (await fs.pathExists(previewPath)) {
            // 检查原图是否比预览图新
            const originalStat = await fs.stat(originalPath);
            const previewStat = await fs.stat(previewPath);
            
            if (originalStat.mtime <= previewStat.mtime) {
                // 预览图是最新的，无需重新生成
                return previewPath;
            }
        }

        // 生成 WebP 预览图
        await sharp(originalPath)
            .rotate() // 自动根据EXIF旋转
            .resize(PREVIEW_CONFIG.maxWidth, PREVIEW_CONFIG.maxHeight, {
                fit: 'inside',
                withoutEnlargement: true
            })
            .webp({ quality: PREVIEW_CONFIG.quality })
            .toFile(previewPath);

        console.log(`Preview generated: ${relPath} -> ${previewFilename}`);
        return previewPath;

    } catch (err) {
        console.error(`Failed to generate preview for ${relPath}:`, err);
        return null;
    }
}

/**
 * 获取图片的预览图路径
 * @param {string} relPath - 图片的相对路径
 * @returns {Promise<string|null>} - 预览图的绝对路径，不存在返回null
 */
async function getPreviewPath(relPath) {
    try {
        const dir = path.dirname(relPath);
        const filename = path.basename(relPath);
        const previewFilename = path.parse(filename).name + '.webp';
        const previewPath = safeJoin(
            STORAGE_PATH, 
            path.join(dir, PREVIEW_DIR_NAME, previewFilename)
        );

        if (await fs.pathExists(previewPath)) {
            return previewPath;
        }
        return null;
    } catch (err) {
        return null;
    }
}

/**
 * 删除图片的预览图
 * @param {string} relPath - 图片的相对路径
 */
async function deletePreview(relPath) {
    try {
        const previewPath = await getPreviewPath(relPath);
        if (previewPath) {
            await fs.remove(previewPath);
            console.log(`Preview deleted: ${relPath}`);
        }
    } catch (err) {
        console.error(`Failed to delete preview for ${relPath}:`, err);
    }
}

/**
 * 批量生成目录下所有图片的预览图
 * @param {string} dir - 目录的相对路径
 */
async function generatePreviewsForDirectory(dir = "") {
    try {
        const dirPath = safeJoin(STORAGE_PATH, dir);
        const files = await fs.readdir(dirPath);
        
        for (const file of files) {
            // 跳过特殊目录
            if (file.startsWith('.') || file === 'config') {
                continue;
            }
            
            const filePath = path.join(dirPath, file);
            const stats = await fs.stat(filePath);
            
            if (stats.isDirectory()) {
                // 递归处理子目录
                await generatePreviewsForDirectory(path.join(dir, file));
            } else if (stats.isFile()) {
                // 处理图片文件
                const relPath = path.join(dir, file).replace(/\\/g, '/');
                const ext = path.extname(file).toLowerCase();
                
                // 只处理图片文件
                if (['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff', '.svg'].includes(ext)) {
                    await generatePreview(filePath, relPath);
                }
            }
        }
        
        console.log(`Previews generation completed for directory: ${dir || 'root'}`);
    } catch (err) {
        console.error(`Failed to generate previews for directory ${dir}:`, err);
    }
}

module.exports = {
    generatePreview,
    getPreviewPath,
    deletePreview,
    generatePreviewsForDirectory,
    PREVIEW_DIR_NAME
};
