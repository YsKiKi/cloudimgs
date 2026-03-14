require("dotenv").config();
const express = require("express");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const path = require("path");
const fs = require("fs-extra");
const config = require("../config");

const uploadRoutes = require("./routes/uploadRoutes");
const imageRoutes = require("./routes/imageRoutes");
const manageRoutes = require("./routes/manageRoutes");
const systemRoutes = require("./routes/systemRoutes");
const statsRoutes = require("./routes/statsRoutes");
const searchRoutes = require("./routes/searchRoutes");
const shareRoutes = require("./routes/shareRoutes");
const { migrateFromLegacyJson, syncFileSystem } = require("./services/syncService");


const app = express();
const PORT = config.server.port || 5000; // fallback

// 中间件
const corsOptions = {
  origin: process.env.CORS_ORIGIN || true, // 设置 CORS_ORIGIN 环境变量限定来源
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Access-Password', 'X-Album-Password'],
};
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

// 登录接口速率限制 — 防暴力破解
const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "请求过于频繁，请稍后再试" },
});
app.use('/api/auth/login', loginLimiter);

// 上传接口速率限制
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: "上传过于频繁，请稍后再试" },
});
app.use('/api/upload', uploadLimiter);
app.use('/api/upload-base64', uploadLimiter);
app.use('/api/upload-file', uploadLimiter);

// 静态文件服务 - 设置合适的缓存策略
app.use(express.static(path.join(__dirname, "../client/build"), {
  setHeaders: (res, filePath) => {
    // HTML 文件不缓存，确保总是获取最新版本
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    // CSS、JS、字体等静态资源（带hash）长期缓存
    else if (/\.(css|js|woff2?|ttf|eot|svg|png|jpg|jpeg|gif|ico|webp)$/i.test(filePath)) {
      // 带hash的文件可以长期缓存（1年）
      if (/\.[a-f0-9]{8}\.(css|js)$/i.test(filePath)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } 
      // 其他资源适中缓存（1天）
      else {
        res.setHeader('Cache-Control', 'public, max-age=86400');
      }
    }
  }
}));

app.set("trust proxy", process.env.TRUST_PROXY || "loopback");

// 路由
// 顺序很重要！
// /api/health 可能最先
app.use("/api", systemRoutes);

// 流量统计
app.use("/api/stats", statsRoutes);

// 魔法搜图
app.use("/api/search", searchRoutes);

// 上传
app.use("/api", uploadRoutes); // /upload, /upload-base64

// 分享
app.use("/api/share", shareRoutes);

// 管理（密码、回收站、批量移动）
app.use("/api", manageRoutes); // /batch/move, /album/*, /images/* (DELETE)

// 图片 (GET) - 放在最后捕获 /images/*
app.use("/api", imageRoutes); // /images, /images/*, /files/*

// 数据库迁移和同步
(async () => {
  try {
    console.log("Initializing database...");
    await migrateFromLegacyJson();
    await syncFileSystem();

    if (config.magicSearch.enabled) {
      // 触发后台扫描任何丢失的嵌入 (低优先级)
      // 这里没有 await，以便让服务器立即启动
      const clipService = require('./services/clipService');
      clipService.scanAll().catch(e => console.error("Background scan failed:", e));
    }
  } catch (e) {
    console.error("Initialization failed:", e);
  }
})();

// 回收站清理任务
const { TRASH_DIR_NAME, safeJoin } = require("./utils/fileUtils");
const STORAGE_PATH = config.storage.path;

async function cleanTrash() {
  const trashDir = path.join(STORAGE_PATH, TRASH_DIR_NAME);
  if (!(await fs.pathExists(trashDir))) return;

  try {
    const files = await fs.readdir(trashDir);
    const now = Date.now();
    const EXPIRE_TIME = 30 * 24 * 60 * 60 * 1000; // 30 Days

    for (const file of files) {
      const filePath = path.join(trashDir, file);
      try {
        const stats = await fs.stat(filePath);
        if (now - stats.mtimeMs > EXPIRE_TIME) {
          await fs.remove(filePath);
          console.log(`[Trash] Cleaned expired file: ${file}`);
        }
      } catch (e) {
        // ignore
      }
    }
  } catch (e) {
    console.error("[Trash] Cleanup failed:", e);
  }
}

// 启动清理任务
cleanTrash();
setInterval(cleanTrash, 24 * 60 * 60 * 1000);


// 所有其他 GET 请求都返回 React 应用 (SPA 支持)
app.get('*', (req, res) => {
  // 避免 API 请求返回 HTML
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: "Not Found" });
  }
  // 设置 index.html 不缓存
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, "../client/build", "index.html"));
});

// 全局错误处理（捕获非 UTF-8 编码 URL 导致的 URIError 等）
app.use((err, req, res, _next) => {
  if (err instanceof URIError) {
    return res.status(400).json({ error: "Invalid URL encoding" });
  }
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

// 启动服务器
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
