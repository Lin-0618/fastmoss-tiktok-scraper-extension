# FastMoss TikTok 数据导出扩展

这是一个 Chrome Manifest V3 扩展，用来在 FastMoss 视频来源页抓取表格数据，自动翻页，并导出完整 CSV 与 TikTok 达人主页链接 TXT。

## 使用方式

1. 打开 Chrome 的 `chrome://extensions/`
2. 开启右上角「开发者模式」
3. 点击「加载已解压的扩展程序」
4. 选择本目录：`d:\tiktok\工具开发\chrome扩展-爬取数据`
5. 打开并登录 `https://www.fastmoss.com/zh/media-source/video`
6. 点击扩展图标，设置最多页数，点击「开始抓取」
7. 优先使用「下载 CSV」打开表格；CSV 已带 UTF-8 BOM，Windows Excel 可正确识别中文

完整说明见：[docs/操作手册.md](docs/操作手册.md)

## 导出字段

- 页码
- 行号
- 视频标题
- 视频时长
- 达人昵称
- 达人 handle
- TikTok 达人主页链接
- TikTok 视频链接
- FastMoss 达人详情链接
- FastMoss 视频详情链接
- FastMoss 视频 ID
- 国家/地区
- 类目/标签
- 粉丝数
- 发布时间
- 播放量
- 来源页面

## 验证

```powershell
npm.cmd test
npm.cmd run check
```
