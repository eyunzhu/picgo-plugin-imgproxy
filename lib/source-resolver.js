'use strict'

const path = require('node:path')
const { URL } = require('node:url')

const { pickSourceUrl } = require('./imgproxy')
const { getTrimmedString } = require('./shared')

const IMAGE_FILE_EXTENSIONS = new Set([
  'apng',
  'avif',
  'bmp',
  'cur',
  'dib',
  'gif',
  'heic',
  'heif',
  'ico',
  'jfif',
  'jpe',
  'jpeg',
  'jpg',
  'jxl',
  'pjp',
  'pjpeg',
  'png',
  'svg',
  'svgz',
  'tif',
  'tiff',
  'webp'
])

const NON_DETERMINISTIC_MIME_TYPES = new Set([
  'application/octet-stream',
  'binary/octet-stream'
])

function getConfigValue(ctx, path) {
  if (!ctx || typeof ctx.getConfig !== 'function') {
    return undefined
  }

  const directValue = ctx.getConfig(path)
  if (typeof directValue !== 'undefined') {
    return directValue
  }

  const segments = path.split('.')
  const firstSegment = segments.shift()
  const rootValue = firstSegment ? ctx.getConfig(firstSegment) : undefined

  return segments.reduce((result, segment) => {
    if (!result || typeof result !== 'object') {
      return undefined
    }

    return result[segment]
  }, rootValue)
}

function buildMissingDescriptorResult(reason) {
  return {
    descriptor: null,
    reason
  }
}

function normalizeMimeType(value) {
  const normalizedValue = getTrimmedString(value).toLowerCase()

  if (!normalizedValue) {
    return ''
  }

  return normalizedValue.split(';')[0].trim()
}

function getFileExtension(value) {
  const normalizedValue = getTrimmedString(value)

  if (!normalizedValue) {
    return ''
  }

  const sanitizedValue = normalizedValue.split('?')[0].split('#')[0]
  const extension = path.posix.extname(sanitizedValue).toLowerCase()

  return extension.replace(/^\./, '')
}

function extractDataUrlMimeType(value) {
  const normalizedValue = getTrimmedString(value)
  const matchedMimeType = normalizedValue.match(/^data:([^;,]+)[;,]/i)

  return matchedMimeType ? normalizeMimeType(matchedMimeType[1]) : ''
}

function getHttpPathname(url) {
  const normalizedUrl = getTrimmedString(url)

  if (!normalizedUrl) {
    return ''
  }

  try {
    return new URL(normalizedUrl).pathname
  } catch (error) {
    return ''
  }
}

function inspectMimeType(mimeType, label) {
  const normalizedMimeType = normalizeMimeType(mimeType)

  if (!normalizedMimeType || NON_DETERMINISTIC_MIME_TYPES.has(normalizedMimeType)) {
    return null
  }

  return {
    isImage: normalizedMimeType.startsWith('image/'),
    reason: `${label}:${normalizedMimeType}`
  }
}

function inspectExtension(value, label) {
  const extension = getFileExtension(value)

  if (!extension) {
    return null
  }

  return {
    isImage: IMAGE_FILE_EXTENSIONS.has(extension),
    reason: `${label}:${extension}`
  }
}

function isImageLikeItem(item, descriptor) {
  const mimeCandidates = [
    ['contentType', item && item.contentType],
    ['mimeType', item && item.mimeType],
    ['mime', item && item.mime],
    [
      'imgproxySource.contentType',
      item && item.imgproxySource && item.imgproxySource.contentType
    ],
    ['imgproxySource.mime', item && item.imgproxySource && item.imgproxySource.mime],
    ['base64Image', extractDataUrlMimeType(item && item.base64Image)]
  ]

  for (const [label, value] of mimeCandidates) {
    const inspectedMimeType = inspectMimeType(value, label)
    if (inspectedMimeType) {
      return inspectedMimeType
    }
  }

  const extensionCandidates = [
    ['extname', item && item.extname],
    ['fileName', item && item.fileName],
    ['uploadPath', item && item.uploadPath],
    ['imgproxySource.key', item && item.imgproxySource && item.imgproxySource.key]
  ]

  if (descriptor && descriptor.backend === 's3') {
    extensionCandidates.push(['descriptor.key', descriptor.key])
  }

  if (descriptor && descriptor.backend === 'http') {
    extensionCandidates.push(['descriptor.url', getHttpPathname(descriptor.url)])
  }

  for (const [label, value] of extensionCandidates) {
    const inspectedExtension = inspectExtension(value, label)
    if (inspectedExtension) {
      return inspectedExtension
    }
  }

  return {
    isImage: false,
    reason: 'no image mime type or extension was detected'
  }
}

function resolveConfiguredS3Source(item, ctx, options) {
  if (!item || typeof item !== 'object') {
    return buildMissingDescriptorResult('item is missing')
  }

  if (item.type !== options.type) {
    return buildMissingDescriptorResult(`item.type is not ${options.type}`)
  }

  const uploadPath = getTrimmedString(item.uploadPath)

  if (!uploadPath) {
    return buildMissingDescriptorResult(`${options.type} item.uploadPath is missing`)
  }

  const bucketName = getTrimmedString(getConfigValue(ctx, options.bucketConfigPath))
  if (!bucketName) {
    return buildMissingDescriptorResult(`${options.bucketConfigPath} is missing`)
  }

  return {
    descriptor: {
      backend: 's3',
      bucket: bucketName,
      key: uploadPath
    },
    strategy: options.strategy,
    fieldName: 'uploadPath'
  }
}

function resolveSharedImgproxySource(item) {
  if (
    !item ||
    typeof item !== 'object' ||
    !item.imgproxySource ||
    typeof item.imgproxySource !== 'object'
  ) {
    return buildMissingDescriptorResult('missing imgproxySource')
  }

  const sharedSource = item.imgproxySource
  const normalizedBackend = getTrimmedString(sharedSource.backend).toLowerCase()

  if (normalizedBackend === 's3') {
    const bucket = getTrimmedString(sharedSource.bucket)
    const key = getTrimmedString(sharedSource.key)

    if (bucket && key) {
      return {
        descriptor: {
          backend: 's3',
          bucket,
          key
        },
        strategy: 'imgproxySource.s3'
      }
    }

    return buildMissingDescriptorResult('imgproxySource.s3 is missing bucket or key')
  }

  if (normalizedBackend === 'http') {
    const url = getTrimmedString(sharedSource.url)

    if (url) {
      return {
        descriptor: {
          backend: 'http',
          url
        },
        strategy: 'imgproxySource.http',
        fieldName: 'imgproxySource.url'
      }
    }

    return buildMissingDescriptorResult('imgproxySource.http is missing url')
  }

  return buildMissingDescriptorResult(
    `unsupported imgproxySource backend: ${String(sharedSource.backend || 'unknown')}`
  )
}

function resolveThirdPartyS3Source(item, ctx) {
  return resolveConfiguredS3Source(item, ctx, {
    type: 'aws-s3',
    bucketConfigPath: 'picBed.aws-s3.bucketName',
    strategy: 'picgo-plugin-s3'
  })
}

function resolveS3UploaderSource(item, ctx) {
  return resolveConfiguredS3Source(item, ctx, {
    type: 's3-uploader',
    bucketConfigPath: 'picBed.s3-uploader.bucketName',
    strategy: 'picgo-plugin-s3-uploader'
  })
}

function resolveHttpSource(item, config) {
  const sourceUrl = pickSourceUrl(item, config.sourceUrlMode)

  if (!sourceUrl) {
    return buildMissingDescriptorResult('missing imgUrl/url/originImgUrl')
  }

  const originImgUrl = item && typeof item === 'object' ? getTrimmedString(item.originImgUrl) : ''
  const imgUrl = item && typeof item === 'object' ? getTrimmedString(item.imgUrl) : ''
  let fieldName = 'url'

  if (config.sourceUrlMode === 'origin' && originImgUrl) {
    fieldName = 'originImgUrl'
  } else if (imgUrl) {
    fieldName = 'imgUrl'
  }

  return {
    descriptor: {
      backend: 'http',
      url: sourceUrl
    },
    strategy: fieldName === 'originImgUrl' ? 'origin-http' : 'current-http',
    fieldName
  }
}

function resolveImgproxySource(item, ctx, config) {
  if (config.enableS3Source) {
    const sharedSource = resolveSharedImgproxySource(item)
    if (sharedSource.descriptor) {
      return sharedSource
    }

    const s3UploaderSource = resolveS3UploaderSource(item, ctx)
    if (s3UploaderSource.descriptor) {
      return s3UploaderSource
    }

    const thirdPartyS3Source = resolveThirdPartyS3Source(item, ctx)
    if (thirdPartyS3Source.descriptor) {
      return thirdPartyS3Source
    }
  }

  return resolveHttpSource(item, config)
}

module.exports = {
  getConfigValue,
  isImageLikeItem,
  resolveHttpSource,
  resolveImgproxySource,
  resolveS3UploaderSource,
  resolveSharedImgproxySource,
  resolveThirdPartyS3Source
}
