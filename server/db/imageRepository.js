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
const countImagesByDirQuery = db.prepare("SELECT COUNT(*) as count FROM images WHERE rel_path LIKE ? || '/%'");

// 分页查询 — DB 层面高效分页
const paginateAllQuery = db.prepare('SELECT * FROM images ORDER BY upload_time DESC LIMIT ? OFFSET ?');
const paginateByDirQuery = db.prepare("SELECT * FROM images WHERE rel_path LIKE ? || '/%' ORDER BY upload_time DESC LIMIT ? OFFSET ?");
const countByDirSearchQuery = db.prepare("SELECT COUNT(*) as count FROM images WHERE rel_path LIKE ? || '/%' AND filename LIKE '%' || ? || '%'");
const paginateByDirSearchQuery = db.prepare("SELECT * FROM images WHERE rel_path LIKE ? || '/%' AND filename LIKE '%' || ? || '%' ORDER BY upload_time DESC LIMIT ? OFFSET ?");
const countAllSearchQuery = db.prepare("SELECT COUNT(*) as count FROM images WHERE filename LIKE '%' || ? || '%'");
const paginateAllSearchQuery = db.prepare("SELECT * FROM images WHERE filename LIKE '%' || ? || '%' ORDER BY upload_time DESC LIMIT ? OFFSET ?");
const getRandomByDirQuery = db.prepare("SELECT * FROM images WHERE rel_path LIKE ? || '/%' ORDER BY RANDOM() LIMIT 1");
const getRandomAllQuery = db.prepare("SELECT * FROM images ORDER BY RANDOM() LIMIT 1");

// 批量操作
const insertMany = db.transaction((images) => {
    for (const img of images) insertImage.run(img);
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
    getByPath: (relPath) => getImageByPath.get(relPath),
    getAll: () => getAllImagesQuery.all(),
    delete: (relPath) => deleteImageByPath.run(relPath),
    count: () => countImages.get().count,
    getByDir: (dir) => {
        if (!dir) return getAllImagesQuery.all();
        return getImagesByDir.all(dir);
    },
    getPreviews: (dir, limit = 3) => getPreviewsQuery.all(dir, limit),
    countByDir: (dir) => countImagesByDirQuery.get(dir).count,
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
