'use strict';

const PUBLIC_ERRORS = Object.freeze({
  INVALID_ID: Object.freeze({ statusCode: 400, message: 'A valid stable identifier is required' }),
  INVALID_QUERY: Object.freeze({ statusCode: 400, message: 'The request query is invalid' }),
  METHOD_NOT_ALLOWED: Object.freeze({ statusCode: 405, message: 'The request method is not allowed' }),
  NOT_FOUND: Object.freeze({ statusCode: 404, message: 'The requested target resource was not found' }),
  OUTPUT_TOO_LARGE: Object.freeze({ statusCode: 413, message: 'The requested target output is too large' })
});

class TargetApiError extends Error {
  constructor(code) {
    const definition = PUBLIC_ERRORS[code];
    if (!definition) throw new TypeError(`Unsupported target API error code: ${code}`);
    super(definition.message);
    this.name = 'TargetApiError';
    this.code = code;
    this.statusCode = definition.statusCode;
  }
}

function invalidId() {
  return new TargetApiError('INVALID_ID');
}

function invalidQuery() {
  return new TargetApiError('INVALID_QUERY');
}

function notFound() {
  return new TargetApiError('NOT_FOUND');
}

function methodNotAllowed() {
  return new TargetApiError('METHOD_NOT_ALLOWED');
}

function outputTooLarge() {
  return new TargetApiError('OUTPUT_TOO_LARGE');
}

function publicErrorBody(error) {
  const safe = error instanceof TargetApiError ? error : new TargetApiError('NOT_FOUND');
  return { error: { code: safe.code, message: safe.message } };
}

module.exports = {
  PUBLIC_ERRORS,
  TargetApiError,
  invalidId,
  invalidQuery,
  methodNotAllowed,
  notFound,
  outputTooLarge,
  publicErrorBody
};
