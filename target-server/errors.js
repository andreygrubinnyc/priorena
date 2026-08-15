'use strict';

const PUBLIC_ERRORS = Object.freeze({
  INVALID_ID: Object.freeze({ statusCode: 400, message: 'A valid stable identifier is required' }),
  INVALID_QUERY: Object.freeze({ statusCode: 400, message: 'The request query is invalid' }),
  INVALID_REQUEST: Object.freeze({ statusCode: 400, message: 'The request body is invalid' }),
  IMPORT_VALIDATION_FAILED: Object.freeze({ statusCode: 400, message: 'Import feed validation failed' }),
  METHOD_NOT_ALLOWED: Object.freeze({ statusCode: 405, message: 'The request method is not allowed' }),
  NOT_FOUND: Object.freeze({ statusCode: 404, message: 'The requested target resource was not found' }),
  OUTPUT_TOO_LARGE: Object.freeze({ statusCode: 413, message: 'The requested target output is too large' }),
  PREVIEW_CONFLICT: Object.freeze({ statusCode: 409, message: 'The approved preview no longer matches the target state' }),
  REVISION_CONFLICT: Object.freeze({ statusCode: 409, message: 'The target data changed; refresh and try again' })
});

const IMPORT_VALIDATION_REASONS = new Set([
  'cell-too-long',
  'content-too-large',
  'csv-column-count',
  'duplicate-csv-header',
  'empty-structured-text',
  'field-too-long',
  'invalid-feed-shape',
  'invalid-field',
  'invalid-input',
  'invalid-json',
  'invalid-records',
  'invalid-source',
  'jira-key-pair-required',
  'malformed-csv',
  'missing-record-content',
  'no-epic-conflict',
  'too-many-records',
  'unsupported-csv-header',
  'unsupported-version'
]);

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

function invalidRequest() {
  return new TargetApiError('INVALID_REQUEST');
}

function importValidation(reason, context = {}) {
  if (!IMPORT_VALIDATION_REASONS.has(reason)) throw new TypeError('Unsupported import validation reason');
  const validation = { reason };
  if (context.recordIndex !== undefined) {
    if (!Number.isInteger(context.recordIndex) || context.recordIndex < 0 || context.recordIndex >= 100) {
      throw new TypeError('Import validation record index is invalid');
    }
    validation.recordIndex = context.recordIndex;
  }
  if (context.field !== undefined) {
    if (typeof context.field !== 'string' || !/^[A-Za-z][A-Za-z0-9]{0,49}$/.test(context.field)) {
      throw new TypeError('Import validation field is invalid');
    }
    validation.field = context.field;
  }
  const error = new TargetApiError('IMPORT_VALIDATION_FAILED');
  error.validation = Object.freeze(validation);
  return error;
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

function previewConflict() {
  return new TargetApiError('PREVIEW_CONFLICT');
}

function revisionConflict() {
  return new TargetApiError('REVISION_CONFLICT');
}

function publicErrorBody(error) {
  const safe = error instanceof TargetApiError ? error : new TargetApiError('NOT_FOUND');
  const body = { error: { code: safe.code, message: safe.message } };
  if (safe.code === 'IMPORT_VALIDATION_FAILED' && safe.validation) body.error.validation = safe.validation;
  return body;
}

module.exports = {
  PUBLIC_ERRORS,
  TargetApiError,
  invalidId,
  invalidQuery,
  invalidRequest,
  importValidation,
  methodNotAllowed,
  notFound,
  outputTooLarge,
  previewConflict,
  publicErrorBody,
  revisionConflict
};
