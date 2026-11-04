# W-Reader for OpenIDEA（本地阅读试用版）

这是参考 [W-Reader](https://github.com/Wei-1021/w-reader) 功能制作的 OpenIDEA 阅读器，**不是原插件的完整移植**。支持本地 UTF-8 TXT、基础 EPUB 文字、分页、目录跳转和多本书阅读位置记忆，包括页内滚动位置（文字重新换行时恢复到附近）。书架保存提取后的正文和目录副本到 OpenIDEA 本地存储，重启后恢复最近一本，也可在书架中切换或删除；不会上传。存储上限约 32 MiB 的 UTF-16 文本及目录数据，超过或存储不可用时会提示，不能保证记忆成功。删除书架条目不会删除原文件。EPUB 依 spine 顺序提供章节，TXT 尝试识别“第X章/节/回”和“Chapter X”。不保留图片和原排版，不支持加密、DRM、在线书源或听书。分页按字符数而不是屏幕高度切分，较长页面可滚动阅读。

## 安装

本插件使用 OpenIDEA 开发版的预览插件 API 1.0，**不兼容 0.1.35**。需要使用包含 Web view 插件支持的源码构建版；预览 API 可能发生变化。

在包含本项目配套存储桥接改动的源码版 OpenIDEA 中打开 Settings → Plugins → Install Plugin from Disk，选择本目录（包含 `plugin.toml`），安装后打开右侧 W-Reader 工具窗口。插件不要求联网权限，所选文件由 OpenIDEA 的文件选择器传给插件页面。普通上游版本没有书架存储桥接，无法保存书架。

## 测试

在本目录执行 `npm install` 安装测试依赖，再执行 `npm test`。插件运行时无需安装 npm 依赖。

## 来源及许可证

功能参考原项目 W-Reader（Apache License 2.0）；本试用版为独立实现，不包含原项目代码。OpenIDEA 的插件接口详见其源码中的 `plugins/README.md`。
