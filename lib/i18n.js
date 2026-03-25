'use strict'

const SUPPORTED_LANGUAGES = {
  EN: 'en',
  ZH_CN: 'zh-CN'
}

const MESSAGES = {
  [SUPPORTED_LANGUAGES.ZH_CN]: {
    host_after_upload_missing:
      '[imgproxy] 当前宿主未提供 helper.afterUploadPlugins.register，无法注册后处理插件',
    config_warning_insecure_hint:
      '${message}；如果你的 imgproxy 未启用签名，请将 imgproxyKey 和 imgproxySalt 同时留空，插件会自动使用 insecure 模式',
    log_skipped_invalid_config: '[imgproxy] 已跳过：${message}',
    log_skipped_disabled: '[imgproxy] 已跳过：插件已禁用',
    log_skipped_no_output: '[imgproxy] 已跳过：未发现上传结果',
    log_warn_invalid_http:
      '[imgproxy] 已跳过一项：来源链接不是有效的 http/https URL（${fieldName}）',
    log_warn_skip_item: '[imgproxy] 已跳过一项：${message}',
    log_summary: '[imgproxy] 已替换 ${replacedCount} 个链接${skippedSuffix}',
    log_skipped_suffix: '，跳过 ${skippedCount} 项',
    debug_skip_unresolved: '跳过第 ${index} 项：未解析到可用来源，原因：${reason}',
    debug_skip_non_image: '跳过第 ${index} 项：当前上传项未识别为图片，原因：${reason}',
    debug_rewritten:
      '检测到第 ${index} 项在签名前被其他插件重写：${beforeSource} -> ${afterSource}',
    debug_skip_already_signed: '跳过第 ${index} 项：当前链接已属于 imgproxyBaseUrl，不重复签名',
    debug_sign_strategy: '第 ${index} 项使用 ${strategy} 策略进行签名：${source}',
    cfg_base_url_alias: 'imgproxy 服务地址',
    cfg_base_url_message: '例如 https://imgproxy.example.com 或 https://imgproxy.example.com/proxy',
    cfg_key_alias: 'IMGPROXY_KEY',
    cfg_key_message:
      '可留空；若填写则必须是十六进制格式，并且需要与 IMGPROXY_SALT 同时填写',
    cfg_salt_alias: 'IMGPROXY_SALT',
    cfg_salt_message:
      '可留空；若填写则必须是十六进制格式，并且需要与 IMGPROXY_KEY 同时填写',
    cfg_processing_alias: '处理参数',
    cfg_processing_message: '例如 rs:fit:300:300',
    cfg_source_mode_alias: 'HTTP 来源选择',
    cfg_source_mode_message: '签名 HTTP 链接时优先用哪条来源？',
    cfg_source_mode_current: 'current：优先当前 imgUrl（推荐）',
    cfg_source_mode_origin: 'origin：优先 originImgUrl',
    cfg_enable_s3_alias: '启用 S3 源',
    cfg_enable_s3_message: '上传器提供 bucket/key 时，是否优先用 s3://bucket/key？',
    cfg_skip_signed_alias: '跳过已签名链接',
    cfg_skip_signed_message: '当前链接已属于 imgproxyBaseUrl 时是否跳过？',
    cfg_debug_alias: '调试日志',
    cfg_debug_message: '是否输出来源解析和跳过原因？',
    err_key_required: '${fieldName} 不能为空',
    err_key_invalid: '${fieldName} 必须是有效的偶数字节十六进制字符串',
    err_key_salt_pair:
      'imgproxyKey 和 imgproxySalt 必须同时填写，或者同时留空以启用 insecure 模式',
    err_base_url_required: '请填写 imgproxy 服务地址',
    err_base_url_invalid: 'imgproxy 服务地址必须是有效的 http/https URL',
    err_base_url_query_hash: 'imgproxy 服务地址不能包含 query 或 hash',
    err_processing_required: '请填写 imgproxy 处理参数',
    err_path_required: 'path 不能为空',
    err_s3_key_required: 'S3 对象 key 不能为空',
    err_s3_bucket_required: 'S3 bucket 不能为空',
    err_source_descriptor_required: '来源描述不能为空',
    err_http_source_required: 'HTTP 来源 URL 不能为空',
    err_source_backend_unsupported: '不支持的来源类型：${backend}'
  },
  [SUPPORTED_LANGUAGES.EN]: {
    host_after_upload_missing:
      '[imgproxy] Current host does not expose helper.afterUploadPlugins.register, so the after-upload plugin cannot be registered',
    config_warning_insecure_hint:
      '${message}; if your imgproxy runs without signing, leave both imgproxyKey and imgproxySalt empty and the plugin will switch to insecure mode automatically',
    log_skipped_invalid_config: '[imgproxy] skipped: ${message}',
    log_skipped_disabled: '[imgproxy] skipped: plugin disabled',
    log_skipped_no_output: '[imgproxy] skipped: no upload output found',
    log_warn_invalid_http:
      '[imgproxy] skipped one item: source URL is not a valid http/https URL (${fieldName})',
    log_warn_skip_item: '[imgproxy] skipped one item: ${message}',
    log_summary: '[imgproxy] replaced ${replacedCount} uploaded URLs${skippedSuffix}',
    log_skipped_suffix: ', skipped ${skippedCount}',
    debug_skip_unresolved:
      'Skipped item ${index}: no usable source was resolved, reason: ${reason}',
    debug_skip_non_image:
      'Skipped item ${index}: current upload item was not recognized as an image, reason: ${reason}',
    debug_rewritten:
      'Detected that item ${index} was rewritten by another plugin before signing: ${beforeSource} -> ${afterSource}',
    debug_skip_already_signed:
      'Skipped item ${index}: current URL already belongs to imgproxyBaseUrl',
    debug_sign_strategy:
      'Item ${index} uses strategy ${strategy} for signing: ${source}',
    cfg_base_url_alias: 'imgproxy Base URL',
    cfg_base_url_message: 'For example: https://imgproxy.example.com or https://imgproxy.example.com/proxy',
    cfg_key_alias: 'IMGPROXY_KEY',
    cfg_key_message:
      'Optional; if provided, it must be hex and must be filled together with IMGPROXY_SALT',
    cfg_salt_alias: 'IMGPROXY_SALT',
    cfg_salt_message:
      'Optional; if provided, it must be hex and must be filled together with IMGPROXY_KEY',
    cfg_processing_alias: 'Processing Path',
    cfg_processing_message: 'For example: rs:fit:300:300',
    cfg_source_mode_alias: 'HTTP Source Mode',
    cfg_source_mode_message: 'Which HTTP source should be preferred when generating the imgproxy URL?',
    cfg_source_mode_current: 'current: prefer current imgUrl (recommended)',
    cfg_source_mode_origin: 'origin: prefer originImgUrl',
    cfg_enable_s3_alias: 'Enable S3 Source',
    cfg_enable_s3_message:
      'When uploader metadata provides bucket/key, should the plugin prefer s3://bucket/key?',
    cfg_skip_signed_alias: 'Skip Signed URLs',
    cfg_skip_signed_message:
      'Skip processing when the current URL already belongs to imgproxyBaseUrl?',
    cfg_debug_alias: 'Debug Log',
    cfg_debug_message: 'Output source resolution details and skip reasons?',
    err_key_required: '${fieldName} is required',
    err_key_invalid: '${fieldName} must be a valid even-length hex string',
    err_key_salt_pair:
      'imgproxyKey and imgproxySalt must be provided together, or both left empty to enable insecure mode',
    err_base_url_required: 'Please provide imgproxyBaseUrl',
    err_base_url_invalid: 'imgproxyBaseUrl must be a valid http/https URL',
    err_base_url_query_hash: 'imgproxyBaseUrl must not contain query string or hash',
    err_processing_required: 'Please provide processingPath',
    err_path_required: 'path is required',
    err_s3_key_required: 'S3 object key is required',
    err_s3_bucket_required: 'S3 bucket is required',
    err_source_descriptor_required: 'source descriptor is required',
    err_http_source_required: 'HTTP source URL is required',
    err_source_backend_unsupported: 'unsupported source backend: ${backend}'
  }
}

function interpolate(template, variables) {
  return String(template).replace(/\$\{([^{}]+)\}/g, (_matchedText, variableName) => {
    const value = variables && Object.prototype.hasOwnProperty.call(variables, variableName)
      ? variables[variableName]
      : ''
    return String(value)
  })
}

function normalizeLocale(language) {
  if (typeof language !== 'string' || language.trim() === '') {
    return SUPPORTED_LANGUAGES.ZH_CN
  }

  const normalizedLanguage = language.trim().toLowerCase()

  if (normalizedLanguage.startsWith('en')) {
    return SUPPORTED_LANGUAGES.EN
  }

  return SUPPORTED_LANGUAGES.ZH_CN
}

function extractLanguage(candidate) {
  if (!candidate) {
    return ''
  }

  if (typeof candidate === 'string') {
    return candidate
  }

  if (candidate.i18n && typeof candidate.i18n.getLanguage === 'function') {
    return candidate.i18n.getLanguage()
  }

  if (typeof candidate.getConfig === 'function') {
    return candidate.getConfig('settings.language') || ''
  }

  return ''
}

function resolveLocale(...candidates) {
  for (const candidate of candidates) {
    const language = extractLanguage(candidate)
    if (language) {
      return normalizeLocale(language)
    }
  }

  return SUPPORTED_LANGUAGES.ZH_CN
}

function translate(localeLike, key, variables) {
  const locale = resolveLocale(localeLike)
  const messageTable = MESSAGES[locale] || MESSAGES[SUPPORTED_LANGUAGES.ZH_CN]
  const template = messageTable[key] || MESSAGES[SUPPORTED_LANGUAGES.ZH_CN][key] || key

  return interpolate(template, variables)
}

module.exports = {
  resolveLocale,
  translate
}
