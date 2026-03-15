import React from 'react';
import { Typography, Card, Collapse, Tag, Divider, theme, Button, message, Tooltip, Table } from 'antd';
import {
  FileImageOutlined,
  FolderOutlined,
  InfoCircleOutlined,
  CopyOutlined,
  FileTextOutlined,
  LockOutlined,
  SearchOutlined,
  ShareAltOutlined,
  BarChartOutlined
} from '@ant-design/icons';
import { getPassword } from "../utils/secureStorage";

const { Title, Text, Paragraph } = Typography;
const { Panel } = Collapse;

const ApiDocs = () => {
  const { token } = theme.useToken();
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const savedPassword = typeof window !== "undefined" ? (getPassword() || "") : "";

  const containerStyle = { maxWidth: 900, margin: '0 auto', padding: '40px 20px' };
  const endpointStyle = { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8, flexWrap: 'wrap' };
  const methodTagStyle = () => ({ minWidth: 60, textAlign: 'center', fontWeight: 'bold' });
  const responseStyle = {
    background: token.colorFillQuaternary,
    borderRadius: 8,
    padding: '12px 16px',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 13,
    whiteSpace: 'pre-wrap',
    overflowX: 'auto',
    lineHeight: 1.6,
  };

  const copyText = (text) => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text)
        .then(() => message.success("已复制 CURL 命令"))
        .catch(() => message.error("复制失败"));
      return;
    }
    const input = document.createElement("input");
    input.style.position = "fixed";
    input.style.top = "-10000px";
    document.body.appendChild(input);
    input.value = text;
    input.focus();
    input.select();
    try { document.execCommand("copy"); message.success("已复制 CURL 命令"); }
    catch (e) { message.error("复制失败"); }
    finally { document.body.removeChild(input); }
  };

  const buildCurl = (endpoint, method = 'GET', options = {}) => {
    const fullUrl = `${origin}${endpoint}`;
    const esc = (str) => str.replace(/'/g, "'\\''");
    const pwdHeader = savedPassword ? ` -H 'X-Access-Password: ${esc(savedPassword)}'` : "";
    const albumPwdHeader = options.albumPassword ? ` -H 'X-Album-Password: ${esc(options.albumPassword)}'` : "";
    let cmd = `curl -X ${method} "${fullUrl}"${pwdHeader}${albumPwdHeader}`;
    if (method === 'POST' || method === 'PUT') {
      if (options.isMultipart) {
        cmd += ` \\\n  -F "${options.fileParam || 'image'}=@/path/to/file"`;
        (options.extraParams || []).forEach(p => { cmd += ` \\\n  -F "${p.key}=${p.value}"`; });
      } else if (options.isJson) {
        cmd += ` \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(options.body)}'`;
      }
    }
    return cmd;
  };

  const CurlButton = ({ endpoint, method, options }) => (
    <Tooltip title="复制 CURL 命令">
      <Button size="small" icon={<CopyOutlined />}
        onClick={(e) => { e.stopPropagation(); copyText(buildCurl(endpoint, method, options)); }}>
        CURL
      </Button>
    </Tooltip>
  );

  const ResponseBlock = ({ json }) => <div style={responseStyle}>{json}</div>;

  const getMethodColor = (method) => {
    switch (method?.toUpperCase()) {
      case 'GET': return 'blue';
      case 'POST': return 'green';
      case 'PUT': return 'orange';
      case 'DELETE': return 'red';
      default: return 'default';
    }
  };

  const ApiEndpoint = ({ title, method, path, description, params, requestExample, responseExample, curlOptions }) => {
    const columns = [
      { title: '参数名', dataIndex: 'name', key: 'name', width: '25%' },
      { title: '类型', dataIndex: 'type', key: 'type', width: '15%' },
      { title: '必填', dataIndex: 'required', key: 'required', width: '10%', render: (v) => v ? <Text type="danger">是</Text> : '否' },
      { title: '说明', dataIndex: 'description', key: 'description' },
    ];

    return (
      <>
        <Card type="inner" title={title} bordered={false}>
          <Paragraph>{description}</Paragraph>
          
          <Divider orientation="left" plain>接口地址</Divider>
          <div style={endpointStyle}>
            <Tag color={getMethodColor(method)} style={methodTagStyle()}>{method}</Tag>
            <Text code copyable>{path}</Text>
            <CurlButton endpoint={path.split('?')[0]} method={method} options={curlOptions} />
          </div>

          {params && params.length > 0 && (
            <>
              <Divider orientation="left" plain>请求参数</Divider>
              <Table 
                dataSource={params} 
                columns={columns} 
                pagination={false} 
                size="small" 
                rowKey="name" 
                bordered 
              />
            </>
          )}

          {requestExample && (
            <>
              <Divider orientation="left" plain>请求示例</Divider>
              <div style={responseStyle}>
                {typeof requestExample === 'string' ? requestExample : JSON.stringify(requestExample, null, 2)}
              </div>
            </>
          )}

          {responseExample && (
            <>
              <Divider orientation="left" plain>返回示例</Divider>
              <ResponseBlock json={responseExample} />
            </>
          )}
        </Card>
        <Divider />
      </>
    );
  };

  // ── Section builders ─────────────────────────────────────────────────────

  const renderAuth = () => (
    <Panel header={<span style={{ fontWeight: 600, fontSize: 16 }}>认证管理</span>} key="auth" extra={<LockOutlined />}>
      <ApiEndpoint
        title="检查认证状态"
        method="GET"
        path="/api/auth/status"
        description="检查当前系统是否开启了密码保护。"
        responseExample={`{
  "success": true,
  "data": { "requirePassword": true, "hasPassword": true }
}`}
      />

      <ApiEndpoint
        title="验证访问密码"
        method="POST"
        path="/api/auth/login"
        description={<>验证系统访问密码。验证成功后在后续请求 Header 中携带 <Text code>X-Access-Password</Text>。</>}
        params={[
          { name: 'password', type: 'string', required: true, description: '访问密码' }
        ]}
        requestExample={{ password: "your_password" }}
        responseExample={`// 成功
{ "success": true }
// 失败
{ "success": false, "error": "Invalid password" }`}
        curlOptions={{ isJson: true, body: { password: "your_password" } }}
      />
    </Panel>
  );

  const renderImages = () => (
    <Panel header={<span style={{ fontWeight: 600, fontSize: 16 }}>图片管理</span>} key="images" extra={<FileImageOutlined />}>
      {/* 说明卡片 */}
      <Card type="inner" title="📖 预览图 / 原图 / 文件直出" bordered={false} style={{ background: token.colorInfoBg, marginBottom: 16 }}>
        <ul>
          <li><Text code>/api/images/preview/:path</Text> — <Tag color="green">预览图</Tag> WebP 压缩，适合展示</li>
          <li><Text code>/api/images/raw/:path</Text> — <Tag color="blue">原图</Tag> 无参数返回原始文件，有参数实时处理</li>
          <li><Text code>/api/files/:path</Text> — <Tag color="volcano">文件直出</Tag> 无处理、无统计</li>
        </ul>
        <Paragraph type="secondary" style={{ marginTop: 8 }}>
          所有列表接口返回的每张图片都包含 <Text code>url</Text>（预览图）、<Text code>rawUrl</Text>（原图）、<Text code>fileUrl</Text>（直出）三个 URL。
        </Paragraph>
      </Card>

      <ApiEndpoint
        title="获取图片列表"
        method="GET"
        path="/api/images"
        description="分页获取图片列表，支持目录筛选和关键词搜索。"
        params={[
          { name: 'page', type: 'integer', required: false, description: '页码（默认 1）' },
          { name: 'pageSize', type: 'integer', required: false, description: '每页数量（默认 10，最大 200）' },
          { name: 'dir', type: 'string', required: false, description: '目录路径（可选）' },
          { name: 'search', type: 'string', required: false, description: '搜索关键词（可选）' },
          { name: 'X-Album-Password', type: 'header', required: false, description: '加密相册的访问密码' },
        ]}
        requestExample="GET /api/images?page=1&pageSize=20"
        responseExample={`{
  "success": true,
  "data": [
    {
      "filename": "sunset.jpg",
      "url": "/api/images/preview/photos/sunset.jpg",
      "rawUrl": "/api/images/raw/photos/sunset.jpg",
      "fileUrl": "/api/files/photos/sunset.jpg",
      "fullUrl": "https://example.com/api/images/preview/photos/sunset.jpg",
      "width": 1920, "height": 1080, "size": 204800,
      "thumbhash": "...", "uploadTime": "2025-01-01T00:00:00Z"
    }
  ],
  "pagination": { "current": 1, "pageSize": 20, "total": 100, "totalPages": 5 }
}`}
      />

      <ApiEndpoint
        title="获取指定图片 — 预览图"
        method="GET"
        path="/api/images/preview/:path"
        description={<>返回 WebP 优化预览图（最大 2048×2048，质量 80%）。支持 <Text code>format=json</Text> 返回预览图元数据。</>}
        params={[
            { name: ':path', type: 'path', required: true, description: '图片相对路径' },
            { name: 'format', type: 'string', required: false, description: '传 json 返回元数据' },
        ]}
        responseExample={`{
  "success": true,
  "data": {
    "filename": "sunset.webp",
    "originalFilename": "sunset.jpg",
    "url": "...", "rawUrl": "...", "fileUrl": "...",
    "width": 2048, "height": 1365, "size": 51200,
    "format": "webp"
  }
}`}
      />

      <ApiEndpoint
        title="获取指定图片 — 原图"
        method="GET"
        path="/api/images/raw/:path"
        description="无参数时返回原始文件；有处理参数时使用 Sharp 实时处理。"
        params={[
            { name: ':path', type: 'path', required: true, description: '图片相对路径' },
            { name: 'w', type: 'integer', required: false, description: '目标宽度 (px)' },
            { name: 'h', type: 'integer', required: false, description: '目标高度 (px)' },
            { name: 'q', type: 'integer', required: false, description: '质量 1-100 (默认 80)' },
            { name: 'fmt', type: 'string', required: false, description: '输出格式: webp/jpeg/png/avif' },
            { name: 'rows', type: 'integer', required: false, description: '切分行数' },
            { name: 'cols', type: 'integer', required: false, description: '切分列数' },
            { name: 'idx', type: 'integer', required: false, description: '切分块索引' },
        ]}
        requestExample="GET /api/images/raw/photo.jpg?w=800&fmt=webp"
      />

      <ApiEndpoint
        title="文件直出"
        method="GET"
        path="/api/files/:path"
        description="直接发送原始文件，不记录访问统计，不走 Sharp 管道。适合直链下载。"
        params={[
            { name: ':path', type: 'path', required: true, description: '文件相对路径' }
        ]}
      />

      <ApiEndpoint
        title="获取图片元数据"
        method="GET"
        path="/api/images/meta/:path"
        description="获取图片的详细元信息（EXIF、GPS、色彩空间等）。"
        params={[
            { name: ':path', type: 'path', required: true, description: '图片相对路径' }
        ]}
        responseExample={`{
  "success": true,
  "data": {
    "filename": "sunset.jpg",
    "url": "...", "rawUrl": "...", "fileUrl": "...",
    "width": 4032, "height": 3024, "size": 3145728,
    "space": "srgb", "channels": 3, "hasAlpha": false,
    "gps": { "lat": 31.23, "lng": 121.47 },
    "exif": { "Make": "Apple", "Model": "iPhone 15 Pro" }
  }
}`}
      />

      <ApiEndpoint
        title="随机图片 — 预览图"
        method="GET"
        path="/api/random/preview"
        description={<>随机选取一张图片返回 WebP 预览图。支持 <Text code>dir</Text> 限定目录和 <Text code>format=json</Text> 返回元数据。</>}
        params={[
          { name: 'dir', type: 'string', required: false, description: '限定目录' },
          { name: 'format', type: 'string', required: false, description: '传 json 返回元数据' },
        ]}
      />

       <ApiEndpoint
        title="随机图片 — 原图"
        method="GET"
        path="/api/random/raw"
        description="随机选取一张图片返回原始文件。支持与原图相同的处理参数。"
        params={[
          { name: 'dir', type: 'string', required: false, description: '限定目录' },
          { name: 'w/h/q...', type: 'mixed', required: false, description: '同原图处理参数' },
        ]}
      />

      <ApiEndpoint
        title="获取地图数据"
        method="GET"
        path="/api/map-data"
        description="获取所有包含 GPS 信息的图片坐标数据，用于地图展示。"
        responseExample={`{
  "success": true,
  "data": [
    { "filename": "sunset.jpg", "lat": 31.23, "lng": 121.47, "date": "...", "thumbUrl": "...", "url": "..." }
  ]
}`}
      />
    </Panel>
  );

  const renderUpload = () => (
    <Panel header={<span style={{ fontWeight: 600, fontSize: 16 }}>上传接口</span>} key="upload" extra={<FileTextOutlined />}>
      <ApiEndpoint
        title="上传图片"
        method="POST"
        path="/api/upload"
        description="上传图片到指定目录，自动生成 WebP 预览图和元数据。"
        params={[
          { name: 'image', type: 'file', required: true, description: '图片文件' },
          { name: 'dir', type: 'string', required: false, description: '目标目录' },
        ]}
        curlOptions={{ isMultipart: true, extraParams: [{ key: 'dir', value: 'photos' }] }}
        responseExample={`{
  "success": true,
  "data": {
    "filename": "sunset.jpg",
    "url": "/api/images/preview/photos/sunset.jpg",
    "rawUrl": "/api/images/raw/photos/sunset.jpg",
    "fileUrl": "/api/files/photos/sunset.jpg",
    "fullUrl": "https://...",
    "width": 1920, "height": 1080, "size": 204800,
    "originalName": "IMG_001.jpg", "mimetype": "image/jpeg"
  }
}`}
      />

      <ApiEndpoint
        title="上传图片 (Base64)"
        method="POST"
        path="/api/upload-base64"
        description="通过 Base64 字符串上传图片。"
        params={[
          { name: 'base64Image', type: 'string', required: true, description: 'Base64 图片字符串（含 data URI scheme）' },
          { name: 'dir', type: 'string', required: false, description: '目标目录' },
          { name: 'originalName', type: 'string', required: false, description: '原始文件名' },
        ]}
        curlOptions={{ isJson: true, body: { base64Image: "data:image/png;base64,...", dir: "photos" } }}
      />

      <ApiEndpoint
        title="上传任意文件"
        method="POST"
        path="/api/upload-file"
        description="上传任意类型文件。图片文件自动生成预览图，音频文件自动解析时长。"
        params={[
          { name: 'file', type: 'file', required: true, description: '文件对象' },
          { name: 'dir', type: 'string', required: false, description: '目标目录' },
          { name: 'filename', type: 'string', required: false, description: '自定义文件名' },
        ]}
        curlOptions={{ isMultipart: true, fileParam: 'file', extraParams: [{ key: 'dir', value: 'files' }, { key: 'filename', value: 'custom.ext' }] }}
        responseExample={`{
  "success": true,
  "data": {
    "filename": "doc.pdf",
    "originalName": "doc.pdf",
    "size": 102400,
    "mimetype": "application/pdf",
    "uploadTime": "2025-01-01T00:00:00Z",
    "url": "/api/files/files/doc.pdf",
    "relPath": "files/doc.pdf"
  }
}`}
      />
    </Panel>
  );

  const renderManage = () => (
    <Panel header={<span style={{ fontWeight: 600, fontSize: 16 }}>文件管理</span>} key="manage" extra={<FolderOutlined />}>
      <ApiEndpoint
        title="重命名/移动图片"
        method="PUT"
        path="/api/images/:path"
        description="对图片进行重命名或移动到其他目录。"
        params={[
          { name: ':path', type: 'path', required: true, description: '图片相对路径' },
          { name: 'newName', type: 'string', required: false, description: '新文件名' },
          { name: 'newDir', type: 'string', required: false, description: '新目录路径' },
        ]}
        curlOptions={{ isJson: true, body: { newName: "new-name.jpg", newDir: "new/path" } }}
        responseExample={`{
  "success": true,
  "data": {
    "filename": "new-name.jpg",
    "url": "/api/images/preview/new/path/new-name.jpg",
    "rawUrl": "...", "fileUrl": "..."
  }
}`}
      />

      <ApiEndpoint
        title="删除图片"
        method="DELETE"
        path="/api/images/:path"
        description="删除指定图片（若启用回收站则移入回收站）。"
        params={[
            { name: ':path', type: 'path', required: true, description: '图片相对路径' }
        ]}
        responseExample={`{ "success": true }`}
      />

      <ApiEndpoint
        title="删除文件"
        method="DELETE"
        path="/api/files/:path"
        description="删除指定非图片文件。"
        params={[
            { name: ':path', type: 'path', required: true, description: '文件相对路径' }
        ]}
      />

      <ApiEndpoint
        title="批量移动"
        method="POST"
        path="/api/batch/move"
        description="将多个文件批量移动到目标目录。"
        params={[
          { name: 'files', type: 'array', required: true, description: '文件相对路径数组' },
          { name: 'targetDir', type: 'string', required: true, description: '目标目录' },
        ]}
        curlOptions={{ isJson: true, body: { files: ["photo1.jpg", "photo2.jpg"], targetDir: "archive" } }}
        responseExample={`{
  "success": true,
  "data": { "successCount": 2, "failCount": 0 }
}`}
      />

      <ApiEndpoint
        title="同步文件系统"
        method="POST"
        path="/api/sync"
        description="扫描磁盘与数据库的差异并进行同步。"
        responseExample={`{
  "success": true,
  "data": { "added": 5, "removed": 2, "updated": 1 }
}`}
      />
    </Panel>
  );

  const renderDirectories = () => (
    <Panel header={<span style={{ fontWeight: 600, fontSize: 16 }}>目录管理</span>} key="dirs" extra={<FolderOutlined />}>
      <ApiEndpoint
        title="获取目录列表"
        method="GET"
        path="/api/directories"
        description="获取所有图片目录结构（含预览图和图片计数）。"
        responseExample={`{
  "success": true,
  "data": [
    {
      "name": "travel",
      "path": "travel",
      "previews": ["/api/images/travel/img1.jpg?w=400"],
      "imageCount": 42,
      "mtime": "2025-01-01T00:00:00Z"
    }
  ]
}`}
      />

      <ApiEndpoint
        title="创建目录"
        method="POST"
        path="/api/directories"
        description="创建新的图片目录。"
        params={[
            { name: 'path', type: 'string', required: true, description: '目录路径' }
        ]}
        curlOptions={{ isJson: true, body: { path: "new-album" } }}
        responseExample={`{
  "success": true,
  "data": { "path": "new-album" }
}`}
      />

      <ApiEndpoint
        title="设置相册密码"
        method="POST"
        path="/api/album/password"
        description="设置或移除相册的访问密码（留空密码则移除）。"
        params={[
            { name: 'dir', type: 'string', required: true, description: '目录路径' },
            { name: 'password', type: 'string', required: false, description: '新密码（留空移除）' }
        ]}
        curlOptions={{ isJson: true, body: { dir: "private-album", password: "123" } }}
      />

      <ApiEndpoint
        title="验证相册密码"
        method="POST"
        path="/api/album/verify"
        description="验证相册密码是否正确。"
        params={[
            { name: 'dir', type: 'string', required: true, description: '目录路径' },
            { name: 'password', type: 'string', required: true, description: '密码' }
        ]}
        curlOptions={{ isJson: true, body: { dir: "private-album", password: "123" } }}
      />
    </Panel>
  );

  const renderSearch = () => (
    <Panel header={<span style={{ fontWeight: 600, fontSize: 16 }}>语义搜索 (CLIP)</span>} key="search" extra={<SearchOutlined />}>
      <ApiEndpoint
        title="语义搜索图片"
        method="GET"
        path="/api/search"
        description="使用自然语言查询语义搜索图片（需启用 CLIP 服务）。"
        params={[
             { name: 'q', type: 'string', required: true, description: '搜索关键词' },
             { name: 'page', type: 'integer', required: false, description: '页码' },
             { name: 'pageSize', type: 'integer', required: false, description: '每页数量' },
             { name: 'matchCount', type: 'integer', required: false, description: '返回匹配数量(默认50)' },
             { name: 'threshold', type: 'float', required: false, description: '相似度阈值' },
        ]}
        requestExample="GET /api/search?q=sunset beach"
        responseExample={`{
  "success": true,
  "data": [ { "filename": "beach.jpg", "url": "...", "similarity": 0.85, ... } ],
  "pagination": { "current": 1, "pageSize": 20, "total": 5, "totalPages": 1 }
}`}
      />

      <ApiEndpoint
        title="扫描新图片"
        method="POST"
        path="/api/search/scan"
        description="扫描并索引新增的图片到 CLIP 向量数据库。"
        responseExample={`{
  "success": true,
  "data": { "message": "Scan completed", "indexed": 10, "total": 500 }
}`}
      />

      <ApiEndpoint
        title="重建索引"
        method="POST"
        path="/api/search/reindex"
        description="清除现有索引并重新索引所有图片。"
      />

      <ApiEndpoint
        title="索引状态"
        method="GET"
        path="/api/search/status"
        description="查看当前索引队列状态。"
        responseExample={`{
  "success": true,
  "data": { "queueLength": 0, "processing": false }
}`}
      />
    </Panel>
  );

  const renderShare = () => (
    <Panel header={<span style={{ fontWeight: 600, fontSize: 16 }}>分享管理</span>} key="share" extra={<ShareAltOutlined />}>
      <ApiEndpoint
        title="生成分享链接"
        method="POST"
        path="/api/share/generate"
        description="为目录生成有时限的分享链接。"
        params={[
          { name: 'path', type: 'string', required: true, description: '目录路径' },
          { name: 'expireSeconds', type: 'integer', required: true, description: '过期时间（秒），0 为永不过期' },
          { name: 'burnAfterReading', type: 'boolean', required: false, description: '阅后即焚' },
        ]}
        curlOptions={{ isJson: true, body: { path: "travel", expireSeconds: 86400 } }}
        responseExample={`{
  "success": true,
  "data": { "token": "abc123..." }
}`}
      />

      <ApiEndpoint
        title="获取分享列表"
        method="GET"
        path="/api/share/list"
        description="获取指定目录下的所有分享链接。"
        params={[
          { name: 'path', type: 'string', required: true, description: '目录路径' },
        ]}
        requestExample="GET /api/share/list?path=travel"
        responseExample={`{
  "success": true,
  "data": [
    { "token": "abc123", "dir_path": "travel", "expire_at": "...", "burn_after_reading": 0, "created_at": "..." }
  ]
}`}
      />

      <ApiEndpoint
        title="删除分享链接"
        method="DELETE"
        path="/api/share/:token"
        description="撤销指定分享链接。"
        params={[
             { name: ':token', type: 'path', required: true, description: '分享 Token' },
        ]}
      />

      <ApiEndpoint
        title="访问分享内容（公开）"
        method="GET"
        path="/api/share/access/:token"
        description="通过分享 token 公开访问相册内容（无需认证）。"
        params={[
             { name: ':token', type: 'path', required: true, description: '分享 Token' },
             { name: 'page', type: 'integer', required: false, description: '页码' },
             { name: 'pageSize', type: 'integer', required: false, description: '每页数量' },
        ]}
        responseExample={`{
  "success": true,
  "data": [ { "filename": "...", "url": "...", ... } ],
  "dirName": "travel",
  "pagination": { "current": 1, "pageSize": 20, "total": 42, "totalPages": 3 }
}`}
      />
    </Panel>
  );

  const renderStats = () => (
    <Panel header={<span style={{ fontWeight: 600, fontSize: 16 }}>系统与统计</span>} key="system" extra={<BarChartOutlined />}>
      <ApiEndpoint
        title="获取系统状态"
        method="GET"
        path="/api/stats"
        description="获取存储空间使用情况及图片总数统计。"
        responseExample={`{
  "success": true,
  "data": {
    "totalImages": 1000,
    "totalSize": "2.5 GB",
    "storageUsed": "...",
    ...
  }
}`}
      />

      <ApiEndpoint
        title="获取系统配置"
        method="GET"
        path="/api/config"
        description="获取当前系统公开配置信息。"
      />

      <ApiEndpoint
        title="流量统计"
        method="GET"
        path="/api/stats/traffic"
        description="获取最近 30 天的每日流量数据。"
        responseExample={`{
  "success": true,
  "data": [
    { "date": "2025-01-01", "views": 120, "uploads": 5, "bandwidth": 524288000 }
  ]
}`}
      />

      <ApiEndpoint
        title="热门图片"
        method="GET"
        path="/api/stats/top-images"
        description="获取访问量最高的图片列表。"
        params={[
             { name: 'limit', type: 'integer', required: false, description: '返回数量（默认 10）' },
        ]}
        responseExample={`{
  "success": true,
  "data": [
    { "filename": "popular.jpg", "url": "...", "rawUrl": "...", "views": 1500, ... }
  ]
}`}
      />
    </Panel>
  );

  // ── Main render ──────────────────────────────────────────────────────────

  return (
    <div style={containerStyle}>
      <div style={{ textAlign: 'center', marginBottom: 40 }}>
        <Title level={1} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <img src="/favicon.svg" alt="Logo" style={{ width: 48, height: 48, objectFit: 'contain' }} />
          云图 — API 文档
        </Title>
        <Paragraph type="secondary" style={{ fontSize: 16 }}>
          云图提供 RESTful API，用于图片的上传、管理、搜索与分享。所有接口统一返回 JSON 格式：
        </Paragraph>
        <div style={{ ...responseStyle, maxWidth: 500, margin: '16px auto', textAlign: 'left' }}>
{`// 成功
{ "success": true, "data": { ... } }

// 失败
{ "success": false, "error": "Error message" }`}
        </div>
        {savedPassword && (
          <Tag color="success" icon={<LockOutlined />} style={{ marginTop: 8 }}>
            已自动在 CURL 示例中包含您的访问密码
          </Tag>
        )}
      </div>

      <Collapse defaultActiveKey={['auth', 'images']} size="large">
        {renderAuth()}
        {renderImages()}
        {renderUpload()}
        {renderManage()}
        {renderDirectories()}
        {renderSearch()}
        {renderShare()}
        {renderStats()}
      </Collapse>

      <div style={{ marginTop: 40, textAlign: 'center' }}>
        <Text type="secondary">© {new Date().getFullYear()} Cloud Gallery API</Text>
      </div>
    </div>
  );
};

export default ApiDocs;
