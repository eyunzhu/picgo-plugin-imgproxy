'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const pluginFactory = require('../index')
const {
  DEFAULT_DEBUG_LOG,
  DEFAULT_ENABLE_S3_SOURCE,
  DEFAULT_SKIP_IF_ALREADY_IMGPROXY,
  IMGPROXY_SIGNING_MODE_INSECURE,
  IMGPROXY_SIGNING_MODE_SIGNED,
  PLUGIN_NAME,
  buildSignedUrlFromSource,
  buildS3SourceUrl,
  isAlreadyImgproxyUrl,
  isHttpUrl,
  normalizePluginConfig,
  pickSourceUrl,
  signPath
} = require('../lib/imgproxy')
const {
  isImageLikeItem,
  resolveImgproxySource,
  resolveS3UploaderSource,
  resolveSharedImgproxySource,
  resolveThirdPartyS3Source
} = require('../lib/source-resolver')

const EXAMPLE_KEY = '943b421c9eb07c830af81030552c86009268de4e532ba2ee2eab8247c6da0881'
const EXAMPLE_SALT = '520f986b998545b4785e0defbc4f3c1203f22de2374a3d53cb7a7fe9fea309c5'

function createPluginConfig(overrides) {
  return {
    imgproxyBaseUrl: 'https://imgproxy.example.com/',
    imgproxyKey: EXAMPLE_KEY,
    imgproxySalt: EXAMPLE_SALT,
    processingPath: '/rs:fit:300:300/',
    sourceUrlMode: 'current',
    skipIfAlreadyImgproxy: true,
    debugLog: false,
    enableS3Source: false,
    ...overrides
  }
}

function readConfig(config, path) {
  return path.split('.').reduce((result, segment) => {
    if (!result || typeof result !== 'object') {
      return undefined
    }

    return result[segment]
  }, config)
}

function createRuntimeContext(config) {
  return {
    getConfig(path) {
      return readConfig(config, path)
    }
  }
}

function createI18n(language) {
  return {
    getLanguage() {
      return language
    }
  }
}

function createPluginHost(overrides) {
  const registrations = []
  const ctx = {
    helper: {
      afterUploadPlugins: {
        register(id, plugin) {
          registrations.push({ id, plugin })
        }
      }
    },
    getConfig() {
      return {}
    },
    log: {
      info() {},
      warn() {}
    },
    ...overrides
  }

  return {
    ctx,
    registrations
  }
}

test('module entry exposes CommonJS and default-compatible exports', () => {
  assert.equal(typeof pluginFactory, 'function')
  assert.equal(pluginFactory.default, pluginFactory)
  assert.equal(pluginFactory.picgoPlugin, pluginFactory)
})

test('signPath matches the documented example vector', () => {
  const path = '/rs:fit:300:300/plain/http://img.example.com/pretty/image.jpg'
  const signature = signPath(path, EXAMPLE_KEY, EXAMPLE_SALT)

  assert.equal(signature, 'm3k5QADfcKPDj-SDI2AIogZbC3FlAXszuwhtWXYqavc')
})

test('buildSignedUrlFromSource supports HTTP source', () => {
  const url = buildSignedUrlFromSource(
    { backend: 'http', url: 'https://img.example.com/pretty/image.jpg' },
    createPluginConfig()
  )

  assert.equal(
    url,
    'https://imgproxy.example.com/RsDk6hOke5bOcPX2RCm1cKOC-J1UZqhzq6CG9W0Gsj0/rs:fit:300:300/plain/https://img.example.com/pretty/image.jpg'
  )
})

test('buildS3SourceUrl builds plain s3 bucket/key source', () => {
  assert.equal(
    buildS3SourceUrl('public', 'img/Echo-idle-01.png'),
    's3://public/img/Echo-idle-01.png'
  )
})

test('normalizePluginConfig applies defaults for booleans and S3 settings', () => {
  const normalizedConfig = normalizePluginConfig({
    imgproxyBaseUrl: 'https://imgproxy.example.com/',
    imgproxyKey: EXAMPLE_KEY,
    imgproxySalt: EXAMPLE_SALT,
    processingPath: 'rs:fit:300:300'
  })

  assert.equal(normalizedConfig.skipIfAlreadyImgproxy, DEFAULT_SKIP_IF_ALREADY_IMGPROXY)
  assert.equal(normalizedConfig.debugLog, DEFAULT_DEBUG_LOG)
  assert.equal(normalizedConfig.enableS3Source, DEFAULT_ENABLE_S3_SOURCE)
  assert.equal(normalizedConfig.signingMode, IMGPROXY_SIGNING_MODE_SIGNED)
})

test('normalizePluginConfig rejects imgproxyBaseUrl with query string', () => {
  assert.throws(
    () =>
      normalizePluginConfig({
        imgproxyBaseUrl: 'https://imgproxy.example.com/?debug=1',
        imgproxyKey: EXAMPLE_KEY,
        imgproxySalt: EXAMPLE_SALT,
        processingPath: 'rs:fit:300:300'
      }),
    /imgproxy 服务地址不能包含 query 或 hash/
  )
})

test('normalizePluginConfig reports English validation errors when locale is English', () => {
  assert.throws(
    () =>
      normalizePluginConfig(
        {
          imgproxyBaseUrl: 'https://imgproxy.example.com/?debug=1',
          imgproxyKey: EXAMPLE_KEY,
          imgproxySalt: EXAMPLE_SALT,
          processingPath: 'rs:fit:300:300'
        },
        'en-US'
      ),
    /imgproxyBaseUrl must not contain query string or hash/
  )
})

test('normalizePluginConfig supports insecure mode when key and salt are both empty', () => {
  const normalizedConfig = normalizePluginConfig({
    imgproxyBaseUrl: 'https://imgproxy.example.com/',
    imgproxyKey: '',
    imgproxySalt: '',
    processingPath: 'rs:fit:300:300'
  })

  assert.equal(normalizedConfig.signingMode, IMGPROXY_SIGNING_MODE_INSECURE)
  assert.equal(normalizedConfig.imgproxyKey, '')
  assert.equal(normalizedConfig.imgproxySalt, '')
})

test('normalizePluginConfig rejects partial signing config', () => {
  assert.throws(
    () =>
      normalizePluginConfig({
        imgproxyBaseUrl: 'https://imgproxy.example.com/',
        imgproxyKey: EXAMPLE_KEY,
        imgproxySalt: '',
        processingPath: 'rs:fit:300:300'
      }),
    /imgproxyKey 和 imgproxySalt 必须同时填写/
  )
})

test('buildSignedUrlFromSource supports insecure mode when key and salt are empty', () => {
  const url = buildSignedUrlFromSource(
    { backend: 'http', url: 'https://img.example.com/pretty/image.jpg' },
    createPluginConfig({
      imgproxyKey: '',
      imgproxySalt: ''
    })
  )

  assert.equal(
    url,
    'https://imgproxy.example.com/insecure/rs:fit:300:300/plain/https://img.example.com/pretty/image.jpg'
  )
})

test('pickSourceUrl respects sourceUrlMode with fallback', () => {
  const item = {
    originImgUrl: 'https://origin.example.com/a.png',
    imgUrl: 'https://rewritten.example.com/a.png',
    url: 'https://fallback.example.com/a.png'
  }

  assert.equal(pickSourceUrl(item, 'current'), 'https://rewritten.example.com/a.png')
  assert.equal(pickSourceUrl(item, 'origin'), 'https://origin.example.com/a.png')
  assert.equal(
    pickSourceUrl({ imgUrl: '', url: 'https://fallback.example.com/b.png' }, 'origin'),
    'https://fallback.example.com/b.png'
  )
})

test('resolveSharedImgproxySource prefers explicit S3 metadata', () => {
  const result = resolveSharedImgproxySource({
    imgproxySource: {
      backend: 's3',
      bucket: 'public',
      key: 'img/Echo-idle-01.png'
    }
  })

  assert.equal(result.strategy, 'imgproxySource.s3')
  assert.deepEqual(result.descriptor, {
    backend: 's3',
    bucket: 'public',
    key: 'img/Echo-idle-01.png'
  })
})

test('resolveSharedImgproxySource trims explicit source metadata', () => {
  const result = resolveSharedImgproxySource({
    imgproxySource: {
      backend: 's3',
      bucket: ' public ',
      key: ' /img/Echo-idle-01.png '
    }
  })

  assert.deepEqual(result.descriptor, {
    backend: 's3',
    bucket: 'public',
    key: '/img/Echo-idle-01.png'
  })
})

test('resolveThirdPartyS3Source adapts picgo-plugin-s3 output', () => {
  const result = resolveThirdPartyS3Source(
    {
      type: 'aws-s3',
      uploadPath: 'img/Echo-idle-01.png'
    },
    createRuntimeContext({
      picBed: {
        'aws-s3': {
          bucketName: 'public'
        }
      }
    })
  )

  assert.equal(result.strategy, 'picgo-plugin-s3')
  assert.deepEqual(result.descriptor, {
    backend: 's3',
    bucket: 'public',
    key: 'img/Echo-idle-01.png'
  })
})

test('resolveS3UploaderSource adapts s3-uploader fallback output', () => {
  const result = resolveS3UploaderSource(
    {
      type: 's3-uploader',
      uploadPath: ' img/Echo-idle-01.png '
    },
    createRuntimeContext({
      picBed: {
        's3-uploader': {
          bucketName: ' public '
        }
      }
    })
  )

  assert.equal(result.strategy, 'picgo-plugin-s3-uploader')
  assert.deepEqual(result.descriptor, {
    backend: 's3',
    bucket: 'public',
    key: 'img/Echo-idle-01.png'
  })
})

test('resolveImgproxySource falls back to HTTP when S3 source is unavailable', () => {
  const result = resolveImgproxySource(
    {
      imgUrl: 'https://origin.example.com/a.png'
    },
    createRuntimeContext({}),
    createPluginConfig({ enableS3Source: true })
  )

  assert.equal(result.strategy, 'current-http')
  assert.deepEqual(result.descriptor, {
    backend: 'http',
    url: 'https://origin.example.com/a.png'
  })
})

test('resolveImgproxySource falls back to s3-uploader uploadPath when shared metadata is missing', () => {
  const result = resolveImgproxySource(
    {
      type: 's3-uploader',
      uploadPath: 'img/Echo-idle-01.png',
      imgUrl: 'https://public.gs.example.com/img/Echo-idle-01.png'
    },
    createRuntimeContext({
      picBed: {
        's3-uploader': {
          bucketName: 'public'
        }
      }
    }),
    createPluginConfig({ enableS3Source: true })
  )

  assert.equal(result.strategy, 'picgo-plugin-s3-uploader')
  assert.deepEqual(result.descriptor, {
    backend: 's3',
    bucket: 'public',
    key: 'img/Echo-idle-01.png'
  })
})

test('isImageLikeItem prefers image mime type when available', () => {
  const result = isImageLikeItem(
    {
      contentType: 'image/png',
      fileName: 'archive.zip'
    },
    {
      backend: 'http',
      url: 'https://example.com/archive.zip'
    }
  )

  assert.deepEqual(result, {
    isImage: true,
    reason: 'contentType:image/png'
  })
})

test('isImageLikeItem rejects non-image extension when no positive mime exists', () => {
  const result = isImageLikeItem(
    {
      fileName: 'archive.zip'
    },
    {
      backend: 'http',
      url: 'https://example.com/archive.zip'
    }
  )

  assert.deepEqual(result, {
    isImage: false,
    reason: 'fileName:zip'
  })
})

test('isImageLikeItem detects image by s3 object key', () => {
  const result = isImageLikeItem(
    {
      uploadPath: 'assets/no-extension'
    },
    {
      backend: 's3',
      key: 'img/Echo-idle-01.png'
    }
  )

  assert.deepEqual(result, {
    isImage: true,
    reason: 'descriptor.key:png'
  })
})

test('plugin afterUpload handler rewrites HTTP source', async () => {
  const registrations = []
  const bootCtx = {
    helper: {
      afterUploadPlugins: {
        register(id, plugin) {
          registrations.push({ id, plugin })
        }
      }
    }
  }

  const plugin = pluginFactory(bootCtx)
  plugin.register()

  const logs = []
  const runtimeConfig = {
    'picgo-plugin-imgproxy': createPluginConfig({ sourceUrlMode: 'origin' })
  }
  const runCtx = {
    output: [
      {
        imgUrl: 'https://rewritten.example.com/a.png',
        url: 'https://rewritten.example.com/a.png',
        originImgUrl: 'https://origin.example.com/a.png'
      }
    ],
    getConfig(path) {
      return readConfig(runtimeConfig, path)
    },
    log: {
      info(message) {
        logs.push(['info', message])
      },
      warn(message) {
        logs.push(['warn', message])
      }
    }
  }

  const result = await registrations[0].plugin.handle(runCtx)

  assert.equal(result, runCtx)
  assert.equal(
    runCtx.output[0].imgUrl,
    'https://imgproxy.example.com/Leo1L2qdiFl6bOi1WVcwpTbQrS8XamXebKYIhmHmacw/rs:fit:300:300/plain/https://origin.example.com/a.png'
  )
  assert.equal(runCtx.output[0].url, runCtx.output[0].imgUrl)
  assert.equal(logs.some((entry) => entry[0] === 'info'), true)
})

test('plugin afterUpload handler skips non-image uploads', async () => {
  const { createAfterUploadHandler } = pluginFactory._test
  const logs = []
  const pluginCtx = {
    getConfig(path) {
      return readConfig(
        {
          'picgo-plugin-imgproxy': createPluginConfig({
            sourceUrlMode: 'current',
            debugLog: true
          })
        },
        path
      )
    },
    log: {
      info(message) {
        logs.push(['info', message])
      },
      warn(message) {
        logs.push(['warn', message])
      }
    }
  }

  const runCtx = {
    output: [
      {
        fileName: 'manual.pdf',
        extname: '.pdf',
        imgUrl: 'https://download.example.com/manual.pdf',
        url: 'https://download.example.com/manual.pdf'
      }
    ],
    getConfig: pluginCtx.getConfig,
    log: pluginCtx.log
  }

  await createAfterUploadHandler(pluginCtx)(runCtx)

  assert.equal(runCtx.output[0].imgUrl, 'https://download.example.com/manual.pdf')
  assert.equal(logs.some((entry) => entry[1].includes('未识别为图片')), true)
})

test('plugin afterUpload handler still signs image when URL has no extension but file metadata is image', async () => {
  const { createAfterUploadHandler } = pluginFactory._test
  const pluginConfig = createPluginConfig({
    sourceUrlMode: 'current'
  })
  const pluginCtx = {
    getConfig(path) {
      return readConfig(
        {
          'picgo-plugin-imgproxy': pluginConfig
        },
        path
      )
    },
    log: {
      info() {},
      warn() {}
    }
  }

  const runCtx = {
    output: [
      {
        fileName: 'Echo-idle-01.png',
        extname: '.png',
        imgUrl: 'https://assets.example.com/download?id=1',
        url: 'https://assets.example.com/download?id=1'
      }
    ],
    getConfig: pluginCtx.getConfig,
    log: pluginCtx.log
  }

  await createAfterUploadHandler(pluginCtx)(runCtx)

  assert.equal(
    runCtx.output[0].imgUrl,
    buildSignedUrlFromSource(
      {
        backend: 'http',
        url: 'https://assets.example.com/download?id=1'
      },
      pluginConfig
    )
  )
})

test('plugin factory is compatible with PicGo GUI, PicGo Core and PicList hosts', () => {
  const hostContexts = [
    {
      hostName: 'PicGo GUI',
      overrides: {
        GUI_VERSION: '2.3.1'
      }
    },
    {
      hostName: 'PicGo Core',
      overrides: {
        VERSION: '1.5.0'
      }
    },
    {
      hostName: 'PicList',
      overrides: {
        GUI_VERSION: '1.9.1',
        PICLIST_VERSION: '1.9.1'
      }
    }
  ]

  for (const hostContext of hostContexts) {
    const { ctx, registrations } = createPluginHost(hostContext.overrides)
    const plugin = pluginFactory(ctx)

    plugin.register()

    assert.equal(typeof plugin.register, 'function', `${hostContext.hostName} should expose register`)
    assert.equal(plugin.config, pluginFactory._test.createPluginConfig)
    assert.equal(registrations.length, 1)
    assert.equal(registrations[0].id, PLUGIN_NAME)
    assert.equal(typeof registrations[0].plugin.handle, 'function')
  }
})

test('plugin metadata is consumable by PicGo GUI and PicList plugin list logic', () => {
  const { ctx } = createPluginHost({
    GUI_VERSION: '2.3.1'
  })
  const plugin = pluginFactory(ctx)

  const pluginConfig = plugin.config ? plugin.config(ctx) : []
  const pluginListSnapshot = {
    uploaderName: plugin.uploader || '',
    transformerName: plugin.transformer || '',
    pluginConfigLength: pluginConfig.length
  }

  assert.deepEqual(pluginListSnapshot, {
    uploaderName: '',
    transformerName: '',
    pluginConfigLength: 8
  })
})

test('plugin config schema can be created without getConfig host', () => {
  const plugin = pluginFactory({
    helper: {
      afterUploadPlugins: {
        register() {}
      }
    }
  })

  assert.equal(Array.isArray(plugin.config({})), true)
  assert.equal(plugin.config({}).length, 8)
})

test('plugin config schema follows host language from settings.language', () => {
  const plugin = pluginFactory({
    helper: {
      afterUploadPlugins: {
        register() {}
      }
    }
  })
  const pluginConfig = plugin.config({
    getConfig(path) {
      return readConfig(
        {
          settings: {
            language: 'en-US'
          }
        },
        path
      )
    }
  })

  assert.equal(pluginConfig[0].alias, 'imgproxy Base URL')
  assert.equal(pluginConfig[0].message.includes('For example:'), true)
  assert.equal(pluginConfig[4].choices[0].name, 'current: prefer current imgUrl (recommended)')
})

test('plugin register reports unsupported host clearly', () => {
  const plugin = pluginFactory({
    helper: {}
  })

  assert.throws(
    () => plugin.register(),
    /当前宿主未提供 helper\.afterUploadPlugins\.register/
  )
})

test('plugin register reports unsupported host in English when host language is English', () => {
  const plugin = pluginFactory({
    helper: {},
    i18n: createI18n('en')
  })

  assert.throws(
    () => plugin.register(),
    /Current host does not expose helper\.afterUploadPlugins\.register/
  )
})

test('plugin warns with actionable message when signing config is incomplete', async () => {
  const { createAfterUploadHandler } = pluginFactory._test
  const logs = []
  const pluginCtx = {
    getConfig(path) {
      return readConfig(
        {
          'picgo-plugin-imgproxy': createPluginConfig({
            imgproxyKey: EXAMPLE_KEY,
            imgproxySalt: ''
          })
        },
        path
      )
    },
    log: {
      info(message) {
        logs.push(['info', message])
      },
      warn(message) {
        logs.push(['warn', message])
      }
    }
  }

  await createAfterUploadHandler(pluginCtx)({
    output: [
      {
        imgUrl: 'https://origin.example.com/a.png',
        url: 'https://origin.example.com/a.png'
      }
    ],
    getConfig: pluginCtx.getConfig,
    log: pluginCtx.log
  })

  assert.equal(logs.some((entry) => entry[1].includes('insecure 模式')), true)
})

test('plugin warns with actionable message in English when host language is English', async () => {
  const { createAfterUploadHandler } = pluginFactory._test
  const logs = []
  const pluginCtx = {
    i18n: createI18n('en'),
    getConfig(path) {
      return readConfig(
        {
          'picgo-plugin-imgproxy': createPluginConfig({
            imgproxyKey: EXAMPLE_KEY,
            imgproxySalt: ''
          })
        },
        path
      )
    },
    log: {
      info(message) {
        logs.push(['info', message])
      },
      warn(message) {
        logs.push(['warn', message])
      }
    }
  }

  await createAfterUploadHandler(pluginCtx)({
    output: [
      {
        imgUrl: 'https://origin.example.com/a.png',
        url: 'https://origin.example.com/a.png'
      }
    ],
    getConfig: pluginCtx.getConfig,
    log: pluginCtx.log,
    i18n: pluginCtx.i18n
  })

  assert.equal(logs.some((entry) => entry[1].includes('insecure mode')), true)
})

test('plugin afterUpload handler signs explicit S3 metadata', async () => {
  const registrations = []
  pluginFactory({
    helper: {
      afterUploadPlugins: {
        register(id, plugin) {
          registrations.push({ id, plugin })
        }
      }
    }
  }).register()

  const runtimeConfig = {
    'picgo-plugin-imgproxy': createPluginConfig({
      enableS3Source: true
    })
  }
  const runCtx = {
    output: [
      {
        imgproxySource: {
          backend: 's3',
          bucket: 'public',
          key: 'img/Echo-idle-01.png'
        },
        imgUrl: 'https://public.gs.example.com/img/Echo-idle-01.png'
      }
    ],
    getConfig(path) {
      return readConfig(runtimeConfig, path)
    },
    log: {
      info() {},
      warn() {}
    }
  }

  await registrations[0].plugin.handle(runCtx)

  assert.equal(
    runCtx.output[0].imgUrl,
    'https://imgproxy.example.com/UWg41BpSIr73Wrtml1ef0lR7BLEEFlzibmh4msYKeBI/rs:fit:300:300/plain/s3://public/img/Echo-idle-01.png'
  )
})

test('plugin afterUpload handler adapts third-party picgo-plugin-s3 output', async () => {
  const registrations = []
  pluginFactory({
    helper: {
      afterUploadPlugins: {
        register(id, plugin) {
          registrations.push({ id, plugin })
        }
      }
    }
  }).register()

  const runtimeConfig = {
    'picgo-plugin-imgproxy': createPluginConfig({
      enableS3Source: true
    }),
    picBed: {
      'aws-s3': {
        bucketName: 'public'
      }
    }
  }
  const runCtx = {
    output: [
      {
        type: 'aws-s3',
        uploadPath: 'img/Echo-idle-01.png',
        imgUrl: 'https://public.gs.example.com/img/Echo-idle-01.png'
      }
    ],
    getConfig(path) {
      return readConfig(runtimeConfig, path)
    },
    log: {
      info() {},
      warn() {}
    }
  }

  await registrations[0].plugin.handle(runCtx)

  assert.equal(
    runCtx.output[0].imgUrl,
    'https://imgproxy.example.com/UWg41BpSIr73Wrtml1ef0lR7BLEEFlzibmh4msYKeBI/rs:fit:300:300/plain/s3://public/img/Echo-idle-01.png'
  )
})

test('plugin defers rewrite so later synchronous afterUpload handlers do not overwrite it', async () => {
  const { createAfterUploadHandler } = pluginFactory._test
  const pluginCtx = {
    getConfig(path) {
      return readConfig(
        {
          'picgo-plugin-imgproxy': createPluginConfig({ sourceUrlMode: 'current' })
        },
        path
      )
    },
    log: {
      info() {},
      warn() {}
    }
  }
  const handle = createAfterUploadHandler(pluginCtx)
  const runCtx = {
    output: [
      {
        imgUrl: 'https://origin.example.com/a.png',
        url: 'https://origin.example.com/a.png'
      }
    ],
    getConfig: pluginCtx.getConfig,
    log: pluginCtx.log
  }

  const pending = handle(runCtx)
  runCtx.output[0].imgUrl = 'https://s3.example.com/final.png'
  runCtx.output[0].url = 'https://s3.example.com/final.png'

  await pending

  assert.equal(
    runCtx.output[0].imgUrl,
    'https://imgproxy.example.com/ptOiaOgoeBWA-I5xs1GjBd5vJwm5bm0FKohITG9gH9k/rs:fit:300:300/plain/https://s3.example.com/final.png'
  )
})

test('plugin skips processing when disabled even if stale handler is invoked', async () => {
  const { createAfterUploadHandler } = pluginFactory._test
  const runtimeConfig = {
    'picgo-plugin-imgproxy': createPluginConfig({ sourceUrlMode: 'current' }),
    picgoPlugins: {
      'picgo-plugin-imgproxy': false
    }
  }
  const logs = []
  const pluginCtx = {
    getConfig(path) {
      return readConfig(runtimeConfig, path)
    },
    log: {
      info(message) {
        logs.push(['info', message])
      },
      warn(message) {
        logs.push(['warn', message])
      }
    }
  }
  const handle = createAfterUploadHandler(pluginCtx)
  const runCtx = {
    output: [
      {
        imgUrl: 'https://origin.example.com/a.png',
        url: 'https://origin.example.com/a.png'
      }
    ],
    getConfig: pluginCtx.getConfig,
    log: pluginCtx.log
  }

  await handle(runCtx)

  assert.equal(runCtx.output[0].imgUrl, 'https://origin.example.com/a.png')
  assert.equal(logs.some((entry) => entry[1].includes('插件已禁用')), true)
})

test('plugin skips gracefully when ctx is missing', async () => {
  const { createAfterUploadHandler } = pluginFactory._test
  const logs = []
  const pluginCtx = {
    getConfig(path) {
      return readConfig(
        {
          'picgo-plugin-imgproxy': createPluginConfig({ sourceUrlMode: 'current' })
        },
        path
      )
    },
    log: {
      info(message) {
        logs.push(['info', message])
      },
      warn(message) {
        logs.push(['warn', message])
      }
    }
  }

  const result = await createAfterUploadHandler(pluginCtx)()

  assert.equal(result, undefined)
  assert.equal(logs.some((entry) => entry[1].includes('未发现上传结果')), true)
})

test('plugin guards against duplicate concurrent handler execution on the same ctx', async () => {
  const { createAfterUploadHandler } = pluginFactory._test
  const runtimeConfig = {
    'picgo-plugin-imgproxy': createPluginConfig({
      sourceUrlMode: 'current',
      skipIfAlreadyImgproxy: false
    })
  }
  const pluginCtx = {
    getConfig(path) {
      return readConfig(runtimeConfig, path)
    },
    log: {
      info() {},
      warn() {}
    }
  }
  const handleA = createAfterUploadHandler(pluginCtx)
  const handleB = createAfterUploadHandler(pluginCtx)
  const runCtx = {
    output: [
      {
        imgUrl: 'https://origin.example.com/a.png',
        url: 'https://origin.example.com/a.png'
      }
    ],
    getConfig: pluginCtx.getConfig,
    log: pluginCtx.log
  }

  await Promise.all([handleA(runCtx), handleB(runCtx)])

  assert.equal(
    runCtx.output[0].imgUrl,
    buildSignedUrlFromSource(
      { backend: 'http', url: 'https://origin.example.com/a.png' },
      createPluginConfig({
        sourceUrlMode: 'current',
        skipIfAlreadyImgproxy: false
      })
    )
  )
})

test('plugin skips non-http URLs and already signed imgproxy HTTP URLs', async () => {
  const registrations = []
  pluginFactory({
    helper: {
      afterUploadPlugins: {
        register(id, plugin) {
          registrations.push({ id, plugin })
        }
      }
    }
  }).register()

  const logs = []
  const runtimeConfig = {
    'picgo-plugin-imgproxy': createPluginConfig({
      skipIfAlreadyImgproxy: true,
      debugLog: true
    })
  }
  const runCtx = {
    output: [
      {
        imgUrl: 'javascript:alert(1)',
        url: 'javascript:alert(1)'
      },
      {
        imgUrl:
          'https://imgproxy.example.com/Leo1L2qdiFl6bOi1WVcwpTbQrS8XamXebKYIhmHmacw/rs:fit:300:300/plain/https://origin.example.com/a.png',
        url:
          'https://imgproxy.example.com/Leo1L2qdiFl6bOi1WVcwpTbQrS8XamXebKYIhmHmacw/rs:fit:300:300/plain/https://origin.example.com/a.png'
      }
    ],
    getConfig(path) {
      return readConfig(runtimeConfig, path)
    },
    log: {
      info(message) {
        logs.push(['info', message])
      },
      warn(message) {
        logs.push(['warn', message])
      }
    }
  }

  await registrations[0].plugin.handle(runCtx)

  assert.equal(runCtx.output[0].imgUrl, 'javascript:alert(1)')
  assert.equal(
    runCtx.output[1].imgUrl,
    'https://imgproxy.example.com/Leo1L2qdiFl6bOi1WVcwpTbQrS8XamXebKYIhmHmacw/rs:fit:300:300/plain/https://origin.example.com/a.png'
  )
  assert.equal(
    logs.some((entry) => entry[1].includes('未识别为图片') || entry[1].includes('is not recognized as an image')),
    true
  )
  assert.equal(logs.some((entry) => entry[0] === 'info'), true)
})

test('URL helpers validate HTTP URL and imgproxy prefix matching', () => {
  assert.equal(isHttpUrl('https://origin.example.com/a.png'), true)
  assert.equal(isHttpUrl('javascript:alert(1)'), false)
  assert.equal(
    isAlreadyImgproxyUrl(
      'https://imgproxy.example.com/Leo1L2qdiFl6bOi1WVcwpTbQrS8XamXebKYIhmHmacw/rs:fit:300:300/plain/https://origin.example.com/a.png',
      'https://imgproxy.example.com'
    ),
    true
  )
  assert.equal(
    isAlreadyImgproxyUrl(
      'https://imgproxy.example.com/static/a.png',
      'https://imgproxy.example.com'
    ),
    false
  )
  assert.equal(
    isAlreadyImgproxyUrl(
      'https://imgproxy.example.com/proxy/insecure/rs:fit:300:300/plain/https://origin.example.com/a.png',
      'https://imgproxy.example.com/proxy'
    ),
    true
  )
})
