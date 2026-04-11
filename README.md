# 云图

> ☁️ **云端一隅，拾光深藏**  
> 一个简单、开放且强大的自托管图像托管解决方案。

---

## 📖 简介 | Introduction
本项目是 [cloudimgs](https://github.com/qazzxxx/cloudimgs) 的Fork版本，主要根据个人使用环境进行了一系列修改。  
感谢原作者 [qazzxxx](https://github.com/qazzxxx) 。

## 🔨 修改 | Modifications
- 增加了自动创建缩略图的功能，使用.webp优化网络环境导致的加载缓慢问题。
- 增加了嵌套文件夹的支持，允许用户更灵活地组织图片。
- 增加了系统设置页面，用户可以在前端界面调整上传、存储等配置项。
- 优化了docker部署的内存限制，降低系统资源占用。
- 新增了部分API接口，优化了部分原有接口。
- 合并近期 [qazzxxx](https://github.com/qazzxxx) 的更新。

> [!NOTE]
> 注意：由于部分内容配合AI进行编写，可能存在稳定性问题，欢迎测试和Issue反馈。

## 🛠️ 快速部署 | Quick Start

推荐使用 **Docker Compose** 进行快速部署。

### `docker-compose.yml`

```yaml
version: "3.8"

services:
  cloudimgs:
    # 使用您自己的 Docker Hub 镜像
    # 如果 fork 了项目，请将 image 替换为您的 Docker Hub 构建镜像地址
    image: wuyuekiki/cloudimgs:latest
    container_name: cloudimgs-app
    restart: unless-stopped
    ports:
      - "3001:3001"
    volumes:
      - ./uploads:/app/uploads:rw # 上传目录配置，明确读写权限
    environment:
      # 权限配置 (建议填写 NAS 用户真实 ID)
      - PUID=1000  # id -u
      - PGID=1000   # id -g
      - UMASK=002
      
      # 基础配置
      - NODE_ENV=production
      - PORT=3001
      - STORAGE_PATH=/app/uploads
      
      # 可选配置
      # - MAX_FILE_SIZE=104857600 # 最大文件大小，默认 100MB
      # - THUMBNAIL_WIDTH=0 # 瀑布流缩略图宽度（像素），默认 0 表示使用原图
      # - UPLOAD_TIMEOUT=120000 # 单个文件上传超时时间（毫秒），默认 120 秒
      # - DUPLICATE_STRATEGY=timestamp # 文件名冲突策略: timestamp | counter | overwrite
      # - USE_TRASH=true # 是否使用回收站（true=移动到.trash目录，false=真实删除）
      # - PASSWORD=your_secure_password_here # 🔐 密码保护配置
      # - ENABLE_MAGIC_SEARCH=true # ✨ 开启魔法搜索（使用本地CLIP小模型，占用内存较高）
```

### 🔐 环境变量说明

| 变量名 | 说明 | 示例 / 默认值 |
| :--- | :--- | :--- |
| `PASSWORD` | 设置访问密码，留空则无需密码 | `123456` |
| `ENABLE_MAGIC_SEARCH`| 是否开启 AI 魔法搜索 | `true` / `false` |
| `MAX_FILE_SIZE` | 最大上传文件限制 (Byte) | `104857600` (100MB) |
| `THUMBNAIL_WIDTH` | 列表缩略图宽度 (px) | `0` (原图) / `500` |
| `UPLOAD_TIMEOUT` | 单个文件上传超时时间 (ms) | `120000` (120秒) |
| `DUPLICATE_STRATEGY` | 文件名冲突策略 | `timestamp` / `counter` / `overwrite` |
| `USE_TRASH` | 删除时使用回收站 | `true` / `false` |

> [!NOTE]
> 1. 设置 `PASSWORD` 后，系统会自动启用登录保护。
> 2. 登录状态会保存在浏览器本地存储中。
> 3. 新增的上传和删除配置可在前端设置页面⚙️中调整，优先级高于环境变量。
> 4. `DUPLICATE_STRATEGY` 控制重名文件处理：`timestamp`（时间戳+计数器）、`counter`（仅计数器）、`overwrite`（直接覆盖）。
> 5. `USE_TRASH=false` 会永久删除文件，请谨慎使用。