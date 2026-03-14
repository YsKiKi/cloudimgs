const path = require('path');
const fs = require('fs-extra');
const bcrypt = require('bcryptjs');
const config = require('../../config');
const { safeJoin } = require('./fileUtils');

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

module.exports = {
    getAlbumPasswordPath,
    setAlbumPassword,
    verifyAlbumPassword,
    isAlbumLocked
};
