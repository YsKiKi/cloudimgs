const path = require('path');
const fs = require('fs-extra');
const bcrypt = require('bcryptjs');
const config = require('../../config');
const { safeJoin, CACHE_DIR_NAME, CONFIG_DIR_NAME, TRASH_DIR_NAME } = require('./fileUtils');

const STORAGE_PATH = config.storage.path;
const BCRYPT_ROUNDS = 10;

async function getAlbumPasswordPath(dirPath) {
    const absDir = safeJoin(STORAGE_PATH, dirPath);
    return path.join(absDir, "config", "album_password.json");
}

async function setAlbumPassword(dirPath, plainPassword) {
    const configPath = await getAlbumPasswordPath(dirPath);
    if (!plainPassword) {
        if (await fs.pathExists(configPath)) {
            await fs.remove(configPath);
        }
        return;
    }
    const hash = await bcrypt.hash(plainPassword, BCRYPT_ROUNDS);
    await fs.ensureDir(path.dirname(configPath));
    await fs.writeJSON(configPath, { hash });
}

async function verifyAlbumPassword(dirPath, password) {
    try {
        const configPath = await getAlbumPasswordPath(dirPath);
        if (await fs.pathExists(configPath)) {
            const data = await fs.readJson(configPath);
            // 兼容旧版明文密码: 如果存在 hash 字段用 bcrypt 验证，否则用明文比较后自动迁移
            if (data.hash) {
                return bcrypt.compare(password, data.hash);
            }
            // 旧版明文兼容 — 验证后自动迁移为 hash
            if (data.password === password) {
                await setAlbumPassword(dirPath, password);
                return true;
            }
            return false;
        }
        return true; // 无密码文件 = 不需要密码
    } catch (e) {
        return false;
    }
}

async function isAlbumLocked(dirPath) {
    try {
        const configPath = await getAlbumPasswordPath(dirPath);
        if (await fs.pathExists(configPath)) {
            const data = await fs.readJson(configPath);
            return !!(data.hash || data.password);
        }
    } catch (e) { }
    return false;
}

async function getAllLockedDirectories() {
    const lockedDirs = [];
    async function scan(dir) {
        const absDir = safeJoin(STORAGE_PATH, dir);
        try {
            const files = await fs.readdir(absDir);
            for (const file of files) {
                if (file === CACHE_DIR_NAME || file === CONFIG_DIR_NAME || file === TRASH_DIR_NAME) continue;
                if (file.startsWith('.')) continue;

                const filePath = path.join(absDir, file);
                const stats = await fs.stat(filePath);
                if (stats.isDirectory()) {
                    const relPath = path.join(dir, file).replace(/\\/g, "/");
                    if (await isAlbumLocked(relPath)) {
                        lockedDirs.push(relPath);
                    }
                    await scan(relPath);
                }
            }
        } catch (e) { }
    }
    await scan("");
    return lockedDirs;
}

module.exports = {
    getAlbumPasswordPath,
    setAlbumPassword,
    verifyAlbumPassword,
    isAlbumLocked,
    getAllLockedDirectories
};
