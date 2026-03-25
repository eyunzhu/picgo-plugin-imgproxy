'use strict'

const {
  DEFAULT_DEBUG_LOG,
  DEFAULT_ENABLE_S3_SOURCE,
  DEFAULT_SKIP_IF_ALREADY_IMGPROXY,
  DEFAULT_SOURCE_URL_MODE,
  PLUGIN_NAME,
  buildSignedUrlFromSource,
  isAlreadyImgproxyUrl,
  isHttpUrl,
  normalizePluginConfig,
  pickSourceUrl,
  sourceDescriptorToString
} = require('./lib/imgproxy')
const { resolveLocale, translate } = require('./lib/i18n')
const { isImageLikeItem, resolveImgproxySource } = require('./lib/source-resolver')

const AFTER_UPLOAD_PLUGIN_ID = PLUGIN_NAME
const processingTaskStore = new WeakMap()

function deferToEndOfTick() {
  return new Promise((resolve) => {
    setImmediate(resolve)
  })
}

function getLogger(ctx) {
  if (ctx && ctx.log) {
    return ctx.log
  }

  return {
    info: console.log,
    warn: console.warn,
    error: console.error
  }
}

function formatErrorMessage(error) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return String(error)
}

function translateMessage(localeLike, key, variables) {
  return translate(localeLike, key, variables)
}

function logDebug(logger, config, localeLike, key, variables) {
  if (config.debugLog) {
    logger.info(`[imgproxy] ${translateMessage(localeLike, key, variables)}`)
  }
}

function buildConfigWarningMessage(error, localeLike) {
  return translateMessage(localeLike, 'config_warning_insecure_hint', {
    message: formatErrorMessage(error)
  })
}

function readPluginConfig(configHost) {
  if (!configHost || typeof configHost.getConfig !== 'function') {
    return {}
  }

  const config = configHost.getConfig(PLUGIN_NAME)
  return config && typeof config === 'object' ? config : {}
}

function getAfterUploadRegistry(ctx) {
  if (
    !ctx ||
    !ctx.helper ||
    !ctx.helper.afterUploadPlugins ||
    typeof ctx.helper.afterUploadPlugins.register !== 'function'
  ) {
    throw new Error(translateMessage(ctx, 'host_after_upload_missing'))
  }

  return ctx.helper.afterUploadPlugins
}

function isPluginEnabled(configHost) {
  if (!configHost || typeof configHost.getConfig !== 'function') {
    return true
  }

  return configHost.getConfig(`picgoPlugins.${PLUGIN_NAME}`) !== false
}

function withProcessingGuard(ctx, taskFactory) {
  if (!ctx || (typeof ctx !== 'object' && typeof ctx !== 'function')) {
    return taskFactory()
  }

  const runningTask = processingTaskStore.get(ctx)

  if (runningTask) {
    return runningTask
  }

  const task = Promise.resolve().then(taskFactory)
  processingTaskStore.set(ctx, task)

  return task.finally(() => {
    if (processingTaskStore.get(ctx) === task) {
      processingTaskStore.delete(ctx)
    }
  })
}

function createAfterUploadHandler(pluginCtx) {
  return async function handle(ctx) {
    const configHost = ctx && typeof ctx.getConfig === 'function' ? ctx : pluginCtx
    const logger = getLogger(ctx || pluginCtx)
    const locale = resolveLocale(ctx, pluginCtx, configHost)
    return withProcessingGuard(ctx, async () => {
      if (!isPluginEnabled(configHost)) {
        logger.info(translateMessage(locale, 'log_skipped_disabled'))
        return ctx
      }

      let config

      try {
        config = normalizePluginConfig(configHost.getConfig(PLUGIN_NAME), locale)
      } catch (error) {
        logger.warn(
          translateMessage(locale, 'log_skipped_invalid_config', {
            message: buildConfigWarningMessage(error, locale)
          })
        )
        return ctx
      }

      if (!ctx || !Array.isArray(ctx.output) || ctx.output.length === 0) {
        logger.info(translateMessage(locale, 'log_skipped_no_output'))
        return ctx
      }

      // PicGo 当前会用 Promise.all 并发执行 afterUpload 插件。
      // 这里主动让出一拍，尽量等其他同步插件先完成 URL 改写，
      // 再基于“更接近最终态”的公开链接或 S3 元数据进行签名。
      const initialPublicSources = ctx.output.map((item) => {
        return pickSourceUrl(item, config.sourceUrlMode)
      })
      await deferToEndOfTick()

      let replacedCount = 0
      let skippedCount = 0

      for (const [index, item] of ctx.output.entries()) {
        try {
          const resolvedSource = resolveImgproxySource(item, configHost, config)

          if (!resolvedSource.descriptor) {
            skippedCount += 1
            logDebug(
              logger,
              config,
              locale,
              'debug_skip_unresolved',
              {
                index: index + 1,
                reason: resolvedSource.reason || 'unknown'
              }
            )
            continue
          }

          const descriptor = resolvedSource.descriptor
          const imageInspection = isImageLikeItem(item, descriptor)

          if (!imageInspection.isImage) {
            skippedCount += 1
            logDebug(
              logger,
              config,
              locale,
              'debug_skip_non_image',
              {
                index: index + 1,
                reason: imageInspection.reason
              }
            )
            continue
          }

          const beforeDeferredSource = initialPublicSources[index]

          if (
            descriptor.backend === 'http' &&
            beforeDeferredSource &&
            beforeDeferredSource !== descriptor.url
          ) {
            logDebug(
              logger,
              config,
              locale,
              'debug_rewritten',
              {
                index: index + 1,
                beforeSource: beforeDeferredSource,
                afterSource: descriptor.url
              }
            )
          }

          if (descriptor.backend === 'http') {
            if (!isHttpUrl(descriptor.url)) {
              skippedCount += 1
              logger.warn(
                translateMessage(locale, 'log_warn_invalid_http', {
                  fieldName: resolvedSource.fieldName || 'unknown'
                })
              )
              continue
            }

            if (
              config.skipIfAlreadyImgproxy &&
              isAlreadyImgproxyUrl(descriptor.url, config.imgproxyBaseUrl)
            ) {
              skippedCount += 1
              logDebug(
                logger,
                config,
                locale,
                'debug_skip_already_signed',
                {
                  index: index + 1
                }
              )
              continue
            }
          }

          logDebug(
            logger,
            config,
            locale,
            'debug_sign_strategy',
            {
              index: index + 1,
              strategy: resolvedSource.strategy,
              source: sourceDescriptorToString(descriptor, locale)
            }
          )

          const signedUrl = buildSignedUrlFromSource(descriptor, config, locale)
          item.imgUrl = signedUrl
          item.url = signedUrl
          replacedCount += 1
        } catch (error) {
          skippedCount += 1
          logger.warn(
            translateMessage(locale, 'log_warn_skip_item', {
              message: formatErrorMessage(error)
            })
          )
        }
      }

      logger.info(
        translateMessage(locale, 'log_summary', {
          replacedCount,
          skippedSuffix:
            skippedCount > 0
              ? translateMessage(locale, 'log_skipped_suffix', {
                  skippedCount
                })
              : ''
        })
      )
      return ctx
    })
  }
}

function createPluginConfig(ctx) {
  const config = readPluginConfig(ctx)
  const locale = resolveLocale(ctx)

  return [
    {
      name: 'imgproxyBaseUrl',
      type: 'input',
      default: config.imgproxyBaseUrl || '',
      required: true,
      alias: translateMessage(locale, 'cfg_base_url_alias'),
      message: translateMessage(locale, 'cfg_base_url_message')
    },
    {
      name: 'imgproxyKey',
      type: 'input',
      default: config.imgproxyKey || '',
      required: false,
      alias: translateMessage(locale, 'cfg_key_alias'),
      message: translateMessage(locale, 'cfg_key_message')
    },
    {
      name: 'imgproxySalt',
      type: 'input',
      default: config.imgproxySalt || '',
      required: false,
      alias: translateMessage(locale, 'cfg_salt_alias'),
      message: translateMessage(locale, 'cfg_salt_message')
    },
    {
      name: 'processingPath',
      type: 'input',
      default: config.processingPath || 'rs:fit:300:300',
      required: true,
      alias: translateMessage(locale, 'cfg_processing_alias'),
      message: translateMessage(locale, 'cfg_processing_message')
    },
    {
      name: 'sourceUrlMode',
      type: 'list',
      default: config.sourceUrlMode || DEFAULT_SOURCE_URL_MODE,
      alias: translateMessage(locale, 'cfg_source_mode_alias'),
      message: translateMessage(locale, 'cfg_source_mode_message'),
      choices: [
        {
          name: translateMessage(locale, 'cfg_source_mode_current'),
          value: 'current'
        },
        {
          name: translateMessage(locale, 'cfg_source_mode_origin'),
          value: 'origin'
        }
      ]
    },
    {
      name: 'enableS3Source',
      type: 'confirm',
      default:
        typeof config.enableS3Source === 'boolean'
          ? config.enableS3Source
          : DEFAULT_ENABLE_S3_SOURCE,
      alias: translateMessage(locale, 'cfg_enable_s3_alias'),
      message: translateMessage(locale, 'cfg_enable_s3_message')
    },
    {
      name: 'skipIfAlreadyImgproxy',
      type: 'confirm',
      default:
        typeof config.skipIfAlreadyImgproxy === 'boolean'
          ? config.skipIfAlreadyImgproxy
          : DEFAULT_SKIP_IF_ALREADY_IMGPROXY,
      alias: translateMessage(locale, 'cfg_skip_signed_alias'),
      message: translateMessage(locale, 'cfg_skip_signed_message')
    },
    {
      name: 'debugLog',
      type: 'confirm',
      default: typeof config.debugLog === 'boolean' ? config.debugLog : DEFAULT_DEBUG_LOG,
      alias: translateMessage(locale, 'cfg_debug_alias'),
      message: translateMessage(locale, 'cfg_debug_message')
    }
  ]
}

function picGoPlugin(ctx) {
  const afterUploadHandler = createAfterUploadHandler(ctx)

  const register = () => {
    getAfterUploadRegistry(ctx).register(AFTER_UPLOAD_PLUGIN_ID, {
      handle: afterUploadHandler
    })
  }

  return {
    register,
    config: createPluginConfig
  }
}

module.exports = picGoPlugin
module.exports.default = picGoPlugin
module.exports.picgoPlugin = picGoPlugin
module.exports._test = {
  AFTER_UPLOAD_PLUGIN_ID,
  createAfterUploadHandler,
  createPluginConfig
}
