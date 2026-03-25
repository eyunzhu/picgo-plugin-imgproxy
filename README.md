# picgo-plugin-imgproxy

> 一个 PicGo 的`imgproxy`处理插件
> Replace PicGo copied URLs with imgproxy signed URLs after upload.

它会在图片上传成功后，读取 PicGo 最终准备复制到剪贴板的链接，并将其替换为 imgproxy 处理后的链接。插件既支持普通 HTTP/HTTPS 来源，也支持基于 S3 元数据生成 `s3://bucket/key` 类型的 imgproxy 来源。

## 功能概览

- 上传成功后自动将输出链接替换为 imgproxy 链接
- 支持 S3 来源（需插件`picgo-plugin-s3-uploader`配合）
- 仅处理识别为图片的上传项，非图片文件会跳过，避免对附件类文件误签名

## 安装

### PicGo GUI / PicList

- 可以直接在插件设置页搜索安装 `imgproxy`、 `picgo-plugin-imgproxy`
- 也可以下载压缩包后解压本地导入

### PicGo Core

```bash
picgo install picgo-plugin-imgproxy
```

## 配置项

| Key | 说明 | 示例 |
| --- | --- | --- |
| `imgproxyBaseUrl` | imgproxy 服务地址。允许带路径前缀，不允许带 query / hash。 | `https://imgproxy.example.com` |
| `imgproxyKey` | 可选。十六进制格式的 `IMGPROXY_KEY`。若填写，必须与 `imgproxySalt` 同时填写。 | `943b...0881` |
| `imgproxySalt` | 可选。十六进制格式的 `IMGPROXY_SALT`。若填写，必须与 `imgproxyKey` 同时填写。 | `520f...09c5` |
| `processingPath` | imgproxy 处理参数。 | `rs:fit:300:300` |
| `sourceUrlMode` | HTTP 来源选择策略。`current` 优先 `imgUrl`，`origin` 优先 `originImgUrl`。 | `current` |
| `enableS3Source` | 是否优先使用 S3 元数据构造 `s3://bucket/key`。 | `true` |
| `skipIfAlreadyImgproxy` | 当前链接已经属于 `imgproxyBaseUrl` 时是否跳过。 | `true` |
| `debugLog` | 是否输出调试日志。 | `false` |

说明：

- `imgproxyKey` 和 `imgproxySalt` 同时留空时，插件会自动使用 `insecure` 模式
- `enableS3Source` 默认关闭，避免把普通公开 URL 误判成 S3 来源
- 插件会优先基于 MIME / 扩展名识别是否为图片；如识别为非图片文件，则保留原始链接不做 imgproxy 处理

## 配置示例

```json
{
  "picgo-plugin-imgproxy": {
    "imgproxyBaseUrl": "https://imgproxy.example.com",
    "imgproxyKey": "943b421c9eb07c830af81030552c86009268de4e532ba2ee2eab8247c6da0881",
    "imgproxySalt": "520f986b998545b4785e0defbc4f3c1203f22de2374a3d53cb7a7fe9fea309c5",
    "processingPath": "rs:fit:300:300",
    "sourceUrlMode": "current",
    "enableS3Source": true,
    "skipIfAlreadyImgproxy": true,
    "debugLog": false
  }
}
```

## 来源解析顺序

当 `enableS3Source = true` 时，插件会按以下顺序寻找来源：

| 优先级 | 来源 | 说明 |
| --- | --- | --- |
| 1 | `item.imgproxySource` | 优先消费上传器直接写入的结构化来源元数据 |
| 2 | `picgo-plugin-s3-uploader` | 识别 `item.type === "s3-uploader"`、`item.uploadPath` 和 `picBed.s3-uploader.bucketName` |
| 3 | `picgo-plugin-s3` | 兼容 `item.type === "aws-s3"` 的第三方插件输出 |
| 4 | HTTP 来源 | 回退到 `imgUrl` / `url` / `originImgUrl` |

当 `enableS3Source = false` 时，插件只处理 HTTP/HTTPS 来源。

## 路径示例

| 来源类型 | 输入 | 生成的 imgproxy path |
| --- | --- | --- |
| HTTP | `https://img.example.com/pretty/image.jpg` | `/rs:fit:300:300/plain/https://img.example.com/pretty/image.jpg` |
| S3 | `bucket=public`, `key=img/Echo-idle-01.png` | `/rs:fit:300:300/plain/s3://public/img/Echo-idle-01.png` |

## 与 S3 上传插件联用

如果你需要最稳的 S3 + imgproxy 链路，推荐与 [picgo-plugin-s3-uploader](https://github.com/eyunzhu/picgo-plugin-s3-uploader)一起使用。

`picgo-plugin-s3-uploader` 上传成功后会写入：

```json
{
  "imgproxySource": {
    "backend": "s3",
    "bucket": "public",
    "key": "img/Echo-idle-01.png"
  }
}
```

本插件会直接消费这份元数据并生成：

```text
/rs:fit:300:300/plain/s3://public/img/Echo-idle-01.png
```

## 兼容性说明

| 项目 | 说明 |
| --- | --- |
| 宿主兼容 | 已覆盖 PicGo GUI、PicGo Core、PicList 三类宿主入口 |
| 插件列表兼容 | 已补齐 PicGo GUI / PicList 所需的 `config` 导出 |
| 多插件并发 | 会主动让出一拍，尽量等待其他同步插件先完成 URL 改写 |
| 重复执行保护 | 同一轮上传会做并发去重，避免重复签名 |
| 禁用后残留 handler | 若宿主残留旧 handler，插件在禁用态会自跳过 |
| 已签名判断 | 不只检查同域，还会校验路径首段是否像真实签名或 `insecure` |

## 调试建议

当你怀疑与其他插件冲突时，可以：

1. 打开 `debugLog`
2. 上传一张图片
3. 查看 PicGo 日志中是否包含：
   - 来源解析策略
   - 是否检测到其他插件已改写 URL
   - 是否命中 S3 来源适配
   - 被跳过的原因

