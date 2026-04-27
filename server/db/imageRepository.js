const db = require('./database');

const insertImage = db.prepare(`
  INSERT INTO images (filename, rel_path, size, mtime, upload_time, width, height, orientation, thumbhash, meta_json)
  VALUES (@filename, @rel_path, @size, @mtime, @upload_time, @width, @height, @orientation, @thumbhash, @meta_json)
`);

const updateImage = db.prepare(`
  UPDATE images 
  SET filename = @filename, size = @size, mtime = @mtime, upload_time = @upload_time, 
      width = @width, height = @height, orientation = @orientation, thumbhash = @thumbhash, meta_json = @meta_json
  WHERE rel_path = @rel_path
`);

const getImageByPath = db.prepare('SELECT * FROM images WHERE rel_path = ?');
const getAllImagesQuery = db.prepare('SELECT * FROM images ORDER BY upload_time DESC');
const deleteImageByPath = db.prepare('DELETE FROM images WHERE rel_path = ?');
const countImages = db.prepare('SELECT COUNT(*) as count FROM images');
const getImagesByDir = db.prepare("SELECT * FROM images WHERE rel_path LIKE ? || '/%' ORDER BY upload_time DESC");
const getPreviewsQuery = db.prepare("SELECT * FROM images WHERE rel_path LIKE ? || '/%' ORDER BY upload_time DESC LIMIT ?");
const getRandomPreviewsQuery = db.prepare("SELECT * FROM images WHERE rel_path LIKE ? || '/%' ORDER BY RANDOM() LIMIT ?");
const countImagesByDirQuery = db.prepare("SELECT COUNT(*) as count FROM images WHERE rel_path LIKE ? || '/%'");
const getAllImagesByViewsQuery = db.prepare('SELECT * FROM images ORDER BY views DESC');

// 直接子图查询（只取本层，不含子孙目录）
const getDirectPreviewsInDirQuery = db.prepare(
    "SELECT * FROM images WHERE rel_path LIKE ? || '/%' AND rel_path NOT LIKE ? || '/%/%' ORDER BY upload_time DESC LIMIT ?"
);
const getDirectPreviewsInRootQuery = db.prepare(
    "SELECT * FROM images WHERE rel_path NOT LIKE '%/%' ORDER BY upload_time DESC LIMIT ?"
);
const countDirectImagesInDirQuery = db.prepare(
    "SELECT COUNT(*) as count FROM images WHERE rel_path LIKE ? || '/%' AND rel_path NOT LIKE ? || '/%/%'"
);
const countDirectImagesInRootQuery = db.prepare(
    "SELECT COUNT(*) as count FROM images WHERE rel_path NOT LIKE '%/%'"
);

// 分页查询 — DB 层面高效分页
const paginateAllQuery = db.prepare('SELECT * FROM images ORDER BY upload_time DESC LIMIT ? OFFSET ?');
const paginateByDirQuery = db.prepare("SELECT * FROM images WHERE rel_path LIKE ? || '/%' ORDER BY upload_time DESC LIMIT ? OFFSET ?");
const countByDirSearchQuery = db.prepare("SELECT COUNT(*) as count FROM images WHERE rel_path LIKE ? || '/%' AND filename LIKE '%' || ? || '%'");
const paginateByDirSearchQuery = db.prepare("SELECT * FROM images WHERE rel_path LIKE ? || '/%' AND filename LIKE '%' || ? || '%' ORDER BY upload_time DESC LIMIT ? OFFSET ?");
const countAllSearchQuery = db.prepare("SELECT COUNT(*) as count FROM images WHERE filename LIKE '%' || ? || '%'");
const paginateAllSearchQuery = db.prepare("SELECT * FROM images WHERE filename LIKE '%' || ? || '%' ORDER BY upload_time DESC LIMIT ? OFFSET ?");

// 仅直接子图分页查询
const paginateDirectInDirQuery = db.prepare(
    "SELECT * FROM images WHERE rel_path LIKE ? || '/%' AND rel_path NOT LIKE ? || '/%/%' ORDER BY upload_time DESC LIMIT ? OFFSET ?"
);
const paginateDirectInRootQuery = db.prepare(
    "SELECT * FROM images WHERE rel_path NOT LIKE '%/%' ORDER BY upload_time DESC LIMIT ? OFFSET ?"
);
const getRandomByDirQuery = db.prepare("SELECT * FROM images WHERE rel_path LIKE ? || '/%' ORDER BY RANDOM() LIMIT 1");
const getRandomAllQuery = db.prepare("SELECT * FROM images ORDER BY RANDOM() LIMIT 1");

// 批量操作
const insertMany = db.transaction((images) => {
    for (const img of images) insertImage.run(img);
});

// 重命名（原子替换路径）
const renameImage = db.transaction((oldRelPath, newRelPath, newFilename) => {
    const existing = getImageByPath.get(oldRelPath);
    if (!existing) return null;
    deleteImageByPath.run(oldRelPath);
    existing.rel_path = newRelPath;
    existing.filename = newFilename;
    insertImage.run(existing);
    return existing;
});

// 统计数据 SQL
const incrementViewQuery = db.prepare('UPDATE images SET views = views + 1, last_viewed = @now WHERE rel_path = @relPath');

const recordDailyUploadQuery = db.prepare(`
  INSERT INTO daily_stats (date, uploads_count, uploads_size)
  VALUES (@date, 1, @size)
  ON CONFLICT(date) DO UPDATE SET
  uploads_count = uploads_count + 1,
  uploads_size = uploads_size + @size
`);

const recordDailyViewQuery = db.prepare(`
  INSERT INTO daily_stats (date, views_count, views_size)
  VALUES (@date, 1, @size)
  ON CONFLICT(date) DO UPDATE SET
  views_count = views_count + 1,
  views_size = views_size + @size
`);

const getDailyStatsQuery = db.prepare('SELECT * FROM daily_stats ORDER BY date DESC LIMIT ?');
const getTopImagesQuery = db.prepare('SELECT * FROM images ORDER BY views DESC LIMIT ?');

module.exports = {
    add: (image) => {
        try {
            return insertImage.run(image);
        } catch (e) {
            if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                console.warn(`Image ${image.rel_path || image.relPath} already exists in DB. Attempting update.`);
                return updateImage.run(image);
            }
            throw e;
        }
    },
    update: (image) => updateImage.run(image),
    rename: (oldRelPath, newRelPath, newFilename) => renameImage(oldRelPath, newRelPath, newFilename),
    getByPath: (relPath) => getImageByPath.get(relPath),
    getAll: () => getAllImagesQuery.all(),
    getAllByViews: () => getAllImagesByViewsQuery.all(),
    delete: (relPath) => deleteImageByPath.run(relPath),
    count: () => countImages.get().count,
    getByDir: (dir) => {
        if (!dir) return getAllImagesQuery.all();
        return getImagesByDir.all(dir);
    },
    getPreviews: (dir, limit = 3) => getPreviewsQuery.all(dir, limit),
    getRandomPreviews: (dir, limit = 3) => getRandomPreviewsQuery.all(dir, limit),
    countByDir: (dir) => countImagesByDirQuery.get(dir).count,
    // 只含直接子图（不含子孙目录图片）
    getDirectPreviews: (dir, limit = 3) => {
        if (!dir) return getDirectPreviewsInRootQuery.all(limit);
        return getDirectPreviewsInDirQuery.all(dir, dir, limit);
    },
    hasDirectImages: (dir) => {
        if (!dir) return countDirectImagesInRootQuery.get().count > 0;
        return countDirectImagesInDirQuery.get(dir, dir).count > 0;
    },
    countDirectImages: (dir) => {
        if (!dir) return countDirectImagesInRootQuery.get().count;
        return countDirectImagesInDirQuery.get(dir, dir).count;
    },
    insertMany,
    transaction: (fn) => db.transaction(fn),

    // 高效分页查询
    paginate: (dir, search, page, pageSize) => {
        const offset = (page - 1) * pageSize;
        if (dir && search) {
            const total = countByDirSearchQuery.get(dir, search).count;
            const data = paginateByDirSearchQuery.all(dir, search, pageSize, offset);
            return { data, total };
        } else if (dir) {
            const total = countImagesByDirQuery.get(dir).count;
            const data = paginateByDirQuery.all(dir, pageSize, offset);
            return { data, total };
        } else if (search) {
            const total = countAllSearchQuery.get(search).count;
            const data = paginateAllSearchQuery.all(search, pageSize, offset);
            return { data, total };
        } else {
            const total = countImages.get().count;
            const data = paginateAllQuery.all(pageSize, offset);
            return { data, total };
        }
    },

    // 仅直接子图分页
    paginateDirect: (dir, page, pageSize) => {
        const offset = (page - 1) * pageSize;
        if (!dir) {
            const total = countDirectImagesInRootQuery.get().count;
            const data = paginateDirectInRootQuery.all(pageSize, offset);
            return { data, total };
        }
        const total = countDirectImagesInDirQuery.get(dir, dir).count;
        const data = paginateDirectInDirQuery.all(dir, dir, pageSize, offset);
        return { data, total };
    },

    // 随机图片（DB 层）
    getRandom: (dir) => {
        if (dir) return getRandomByDirQuery.get(dir);
        return getRandomAllQuery.get();
    },

    // Stats Methods
    incrementViews: (relPath) => incrementViewQuery.run({ relPath, now: Date.now() }),
    recordUpload: (size) => {
        const date = new Date().toISOString().split('T')[0];
        recordDailyUploadQuery.run({ date, size });
    },
    recordView: (size) => {
        const date = new Date().toISOString().split('T')[0];
        recordDailyViewQuery.run({ date, size });
    },
    getDailyStats: (limit = 30) => getDailyStatsQuery.all(limit),
    getTopImages: (limit = 10) => getTopImagesQuery.all(limit),
};
