'use strict'

const { createHmac } = require('node:crypto')
const { URL } = require('node:url')
const { translate } = require('./i18n')
const { getTrimmedString } = require('./shared')

const PLUGIN_NAME = 'picgo-plugin-imgproxy'
const DEFAULT_SOURCE_URL_MODE = 'current'
const SOURCE_URL_MODES = ['current', 'origin']
const DEFAULT_SKIP_IF_ALREADY_IMGPROXY = true
const DEFAULT_DEBUG_LOG = false
const DEFAULT_ENABLE_S3_SOURCE = false
const IMGPROXY_SIGNING_MODE_INSECURE = 'insecure'
const IMGPROXY_SIGNING_MODE_SIGNED = 'signed'

function translateMessage(localeLike, key, variables) {
  return translate(localeLike, key, variables)
}

function assertHexString(value, fieldName, localeLike) {
  const normalizedValue = getTrimmedString(value)

  if (!normalizedValue) {
    throw new Error(translateMessage(localeLike, 'err_key_required', { fieldName }))
  }

  if (!/^[\da-fA-F]+$/.test(normalizedValue) || normalizedValue.length % 2 !== 0) {
    throw new Error(translateMessage(localeLike, 'err_key_invalid', { fieldName }))
  }

  return normalizedValue.toLowerCase()
}

function normalizeOptionalHexString(value, fieldName, localeLike) {
  const normalizedValue = getTrimmedString(value)

  if (!normalizedValue) {
    return ''
  }

  return assertHexString(normalizedValue, fieldName, localeLike)
}

function decodeHex(value, fieldName, localeLike) {
  return Buffer.from(assertHexString(value, fieldName, localeLike), 'hex')
}

function normalizeBaseUrl(value, localeLike) {
  const normalizedValue = getTrimmedString(value)

  if (!normalizedValue) {
    throw new Error(translateMessage(localeLike, 'err_base_url_required'))
  }

  const parsedUrl = parseUrl(normalizedValue)

  if (!parsedUrl || (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:')) {
    throw new Error(translateMessage(localeLike, 'err_base_url_invalid'))
  }

  if (parsedUrl.search || parsedUrl.hash) {
    throw new Error(translateMessage(localeLike, 'err_base_url_query_hash'))
  }

  return normalizedValue.replace(/\/+$/, '')
}

function normalizeProcessingPath(value, localeLike) {
  const normalizedValue = getTrimmedString(value)

  if (!normalizedValue) {
    throw new Error(translateMessage(localeLike, 'err_processing_required'))
  }

  return normalizedValue.replace(/^\/+/, '').replace(/\/+$/, '')
}

function normalizeSourceUrlMode(value) {
  const normalizedValue = getTrimmedString(value).toLowerCase()
  return SOURCE_URL_MODES.includes(normalizedValue) ? normalizedValue : DEFAULT_SOURCE_URL_MODE
}

function normalizeBoolean(value, defaultValue) {
  if (typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    const normalizedValue = value.trim().toLowerCase()

    if (normalizedValue === 'true') {
      return true
    }

    if (normalizedValue === 'false') {
      return false
    }
  }

  return defaultValue
}

function normalizePluginConfig(config, localeLike) {
  const safeConfig = config && typeof config === 'object' ? config : {}
  const imgproxyKey = normalizeOptionalHexString(
    safeConfig.imgproxyKey,
    'imgproxyKey',
    localeLike
  )
  const imgproxySalt = normalizeOptionalHexString(
    safeConfig.imgproxySalt,
    'imgproxySalt',
    localeLike
  )

  if ((imgproxyKey && !imgproxySalt) || (!imgproxyKey && imgproxySalt)) {
    throw new Error(translateMessage(localeLike, 'err_key_salt_pair'))
  }

  return {
    imgproxyBaseUrl: normalizeBaseUrl(safeConfig.imgproxyBaseUrl, localeLike),
    imgproxyKey,
    imgproxySalt,
    processingPath: normalizeProcessingPath(safeConfig.processingPath, localeLike),
    sourceUrlMode: normalizeSourceUrlMode(safeConfig.sourceUrlMode),
    skipIfAlreadyImgproxy: normalizeBoolean(
      safeConfig.skipIfAlreadyImgproxy,
      DEFAULT_SKIP_IF_ALREADY_IMGPROXY
    ),
    debugLog: normalizeBoolean(safeConfig.debugLog, DEFAULT_DEBUG_LOG),
    enableS3Source: normalizeBoolean(safeConfig.enableS3Source, DEFAULT_ENABLE_S3_SOURCE),
    signingMode:
      imgproxyKey && imgproxySalt ? IMGPROXY_SIGNING_MODE_SIGNED : IMGPROXY_SIGNING_MODE_INSECURE
  }
}

function signPath(path, keyHex, saltHex, localeLike) {
  if (typeof path !== 'string' || path.length === 0) {
    throw new Error(translateMessage(localeLike, 'err_path_required'))
  }

  const hmac = createHmac('sha256', decodeHex(keyHex, 'imgproxyKey', localeLike))
  hmac.update(decodeHex(saltHex, 'imgproxySalt', localeLike))
  hmac.update(path)

  return hmac.digest('base64url')
}

function normalizeObjectKey(value, localeLike) {
  const normalizedValue = getTrimmedString(value)

  if (!normalizedValue) {
    throw new Error(translateMessage(localeLike, 'err_s3_key_required'))
  }

  return normalizedValue.replace(/^\/+/, '')
}

function buildS3SourceUrl(bucket, key, localeLike) {
  const normalizedBucket = getTrimmedString(bucket)

  if (!normalizedBucket) {
    throw new Error(translateMessage(localeLike, 'err_s3_bucket_required'))
  }

  const normalizedKey = normalizeObjectKey(key, localeLike)

  return `s3://${normalizedBucket}/${normalizedKey}`
}

function buildImgproxyPathFromSource(source, processingPath, localeLike) {
  if (!source || typeof source !== 'object' || typeof source.backend !== 'string') {
    throw new Error(translateMessage(localeLike, 'err_source_descriptor_required'))
  }

  const normalizedProcessingPath = normalizeProcessingPath(processingPath, localeLike)
  const normalizedBackend = getTrimmedString(source.backend).toLowerCase()

  if (normalizedBackend === 'http') {
    const normalizedUrl = getTrimmedString(source.url)

    if (!normalizedUrl) {
      throw new Error(translateMessage(localeLike, 'err_http_source_required'))
    }

    return `/${normalizedProcessingPath}/plain/${normalizedUrl}`
  }

  if (normalizedBackend === 's3') {
    const s3SourceUrl = buildS3SourceUrl(source.bucket, source.key, localeLike)

    return `/${normalizedProcessingPath}/plain/${s3SourceUrl}`
  }

  throw new Error(
    translateMessage(localeLike, 'err_source_backend_unsupported', {
      backend: source.backend
    })
  )
}

function buildSignedUrlFromSource(source, config, localeLike) {
  const normalizedConfig = normalizePluginConfig(config, localeLike)
  const path = buildImgproxyPathFromSource(source, normalizedConfig.processingPath, localeLike)
  const signature =
    normalizedConfig.signingMode === IMGPROXY_SIGNING_MODE_SIGNED
      ? signPath(
          path,
          normalizedConfig.imgproxyKey,
          normalizedConfig.imgproxySalt,
          localeLike
        )
      : IMGPROXY_SIGNING_MODE_INSECURE

  return `${normalizedConfig.imgproxyBaseUrl}/${signature}${path}`
}

function buildSignedUrl(sourceUrl, config, localeLike) {
  return buildSignedUrlFromSource({ backend: 'http', url: sourceUrl }, config, localeLike)
}

function pickSourceUrl(item, sourceUrlMode) {
  if (!item || typeof item !== 'object') {
    return ''
  }

  const originImgUrl = getTrimmedString(item.originImgUrl)
  const imgUrl = getTrimmedString(item.imgUrl)
  const url = getTrimmedString(item.url)

  if (sourceUrlMode === 'origin' && originImgUrl) {
    return originImgUrl
  }

  if (imgUrl) {
    return imgUrl
  }

  if (url) {
    return url
  }

  return ''
}

function parseUrl(value) {
  const normalizedValue = getTrimmedString(value)

  if (!normalizedValue) {
    return null
  }

  try {
    return new URL(normalizedValue)
  } catch (error) {
    return null
  }
}

function isHttpUrl(value) {
  const parsedUrl = parseUrl(value)

  return !!parsedUrl && (parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:')
}

function normalizePathPrefix(pathname) {
  if (!pathname || pathname === '/') {
    return ''
  }

  return pathname.replace(/\/+$/, '')
}

function isLikelyImgproxySignature(value) {
  return value === 'insecure' || /^[A-Za-z0-9_-]{16,}$/.test(value)
}

function isAlreadyImgproxyUrl(sourceUrl, imgproxyBaseUrl) {
  const parsedSourceUrl = parseUrl(sourceUrl)
  const parsedBaseUrl = parseUrl(imgproxyBaseUrl)

  if (!parsedSourceUrl || !parsedBaseUrl) {
    return false
  }

  if (
    (parsedSourceUrl.protocol !== 'http:' && parsedSourceUrl.protocol !== 'https:') ||
    (parsedBaseUrl.protocol !== 'http:' && parsedBaseUrl.protocol !== 'https:')
  ) {
    return false
  }

  if (parsedSourceUrl.origin !== parsedBaseUrl.origin) {
    return false
  }

  const basePathname = normalizePathPrefix(parsedBaseUrl.pathname)
  const sourcePathname = normalizePathPrefix(parsedSourceUrl.pathname)

  if (!basePathname) {
    const segments = sourcePathname.split('/').filter(Boolean)

    if (segments.length < 2) {
      return false
    }

    return isLikelyImgproxySignature(segments[0])
  }

  if (sourcePathname === basePathname) {
    return false
  }

  if (!sourcePathname.startsWith(`${basePathname}/`)) {
    return false
  }

  const relativePath = sourcePathname.slice(basePathname.length)
  const segments = relativePath.split('/').filter(Boolean)

  if (segments.length < 2) {
    return false
  }

  return isLikelyImgproxySignature(segments[0])
}

function sourceDescriptorToString(source, localeLike) {
  if (!source || typeof source !== 'object') {
    return 'unknown'
  }

  const normalizedBackend = getTrimmedString(source.backend).toLowerCase()

  if (normalizedBackend === 'http') {
    return source.url || 'http://<empty>'
  }

  if (normalizedBackend === 's3') {
    return buildS3SourceUrl(source.bucket, source.key, localeLike)
  }

  return String(source.backend || 'unknown')
}

module.exports = {
  DEFAULT_DEBUG_LOG,
  DEFAULT_ENABLE_S3_SOURCE,
  DEFAULT_SKIP_IF_ALREADY_IMGPROXY,
  DEFAULT_SOURCE_URL_MODE,
  IMGPROXY_SIGNING_MODE_INSECURE,
  IMGPROXY_SIGNING_MODE_SIGNED,
  PLUGIN_NAME,
  SOURCE_URL_MODES,
  buildImgproxyPathFromSource,
  buildS3SourceUrl,
  buildSignedUrl,
  buildSignedUrlFromSource,
  isAlreadyImgproxyUrl,
  isHttpUrl,
  normalizePluginConfig,
  parseUrl,
  pickSourceUrl,
  signPath,
  sourceDescriptorToString
}
