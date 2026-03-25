'use strict'

function getTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

module.exports = {
  getTrimmedString
}
