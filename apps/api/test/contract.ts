import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';

// Checks a real API response against the OpenAPI document of the app under test.
// The document is built in process (buildOpenApiDocument), so no file is read.
const DOCUMENT_ID = 'urn:product-finder:openapi';

export interface ContractResponse {
  status: number;
  headers: Record<string, unknown>;
  body: unknown;
}

interface ResponseObject {
  content?: Record<string, { schema?: unknown } | undefined>;
}

interface Operation {
  method: string;
  path: string;
  responses: Record<string, ResponseObject | undefined>;
}

interface OpenApiDocument {
  paths: Record<string, Record<string, { operationId?: string; responses?: Operation['responses'] }>>;
}

interface Contract {
  ajv: Ajv;
  operations: Map<string, Operation>;
  validators: Map<string, ValidateFunction>;
}

let contract: Contract | undefined;

/** Uses the document of the app under test. Call it once before the first check. */
export function setContractDocument(source: object): void {
  const document = JSON.parse(JSON.stringify(source)) as OpenApiDocument;
  // The document uses the OpenAPI keyword `example`, which strict mode rejects.
  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  // The whole document is one schema, so a $ref resolves inside it and a response schema is reached by a JSON pointer.
  ajv.addSchema({ ...document, $id: DOCUMENT_ID }, DOCUMENT_ID);

  const operations = new Map<string, Operation>();
  for (const [route, methods] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (operation.operationId) {
        operations.set(operation.operationId, {
          method: method.toUpperCase(),
          path: route,
          responses: operation.responses ?? {},
        });
      }
    }
  }
  contract = { ajv, operations, validators: new Map() };
}

function loadContract(): Contract {
  if (!contract) {
    throw new Error('Call setContractDocument(buildOpenApiDocument(app)) before expectMatchesContract.');
  }
  return contract;
}

// RFC 6901 escapes, then URI encoding for the fragment.
function token(value: string): string {
  return encodeURIComponent(value.replace(/~/g, '~0').replace(/\//g, '~1'));
}

function mediaType(contentType: unknown): string {
  return (typeof contentType === 'string' ? contentType : '').split(';')[0].trim().toLowerCase();
}

function isEmptyObject(value: unknown): boolean {
  return value !== null && typeof value === 'object' && Object.keys(value).length === 0;
}

function describeError(error: ErrorObject): string {
  const where = error.instancePath === '' ? 'body' : `body${error.instancePath}`;
  const detail = Object.keys(error.params).length > 0 ? ` ${JSON.stringify(error.params)}` : '';
  return `  ${where}: ${error.message}${detail}`;
}

function responseOf(operation: Operation, label: string, status: number): ResponseObject {
  const response = operation.responses[String(status)];
  if (!response) {
    throw new Error(
      `${label} answered ${status}, which the OpenAPI document does not document. ` +
        `Documented: ${Object.keys(operation.responses).sort().join(', ')}.`,
    );
  }
  return response;
}

// A documented answer without a body, such as a 304. supertest gives {} as an empty body.
function expectNoBody(label: string, res: ContractResponse, type: string): void {
  const empty = res.body === undefined || res.body === '' || isEmptyObject(res.body);
  if (type !== '' || !empty) {
    throw new Error(
      `${label} answered ${res.status} with a body, but the OpenAPI document documents no body.`,
    );
  }
}

function validatorFor(pointer: string): ValidateFunction {
  const { ajv, validators } = loadContract();
  let validate = validators.get(pointer);
  if (!validate) {
    validate = ajv.compile({ $ref: `${DOCUMENT_ID}#${pointer}` });
    validators.set(pointer, validate);
  }
  return validate;
}

/**
 * Throws unless `res` is documented for the operation: the status and content type are listed and the body fits
 * the schema. An undocumented status or content type is contract drift. Headers and extra properties are not checked.
 * It looks up exact status keys only, not `default` or `2XX`.
 */
export function expectMatchesContract(res: ContractResponse, operationId: string): void {
  const { operations } = loadContract();
  const operation = operations.get(operationId);
  if (!operation) {
    throw new Error(
      `the OpenAPI document has no operation "${operationId}". Known: ${[...operations.keys()].sort().join(', ')}.`,
    );
  }
  const label = `${operationId} (${operation.method} ${operation.path})`;
  const response = responseOf(operation, label, res.status);
  const type = mediaType(res.headers['content-type']);
  if (!response.content) {
    expectNoBody(label, res, type);
    return;
  }
  if (!response.content[type]?.schema) {
    throw new Error(
      `${label} answered ${res.status} as "${type}", which the OpenAPI document does not document. ` +
        `Documented: ${Object.keys(response.content).join(', ') || 'no body'}.`,
    );
  }
  const pointer = `/paths/${token(operation.path)}/${token(operation.method.toLowerCase())}/responses/${token(String(res.status))}/content/${token(type)}/schema`;
  const validate = validatorFor(pointer);
  if (!validate(res.body)) {
    const errors = (validate.errors ?? []).map(describeError).join('\n');
    throw new Error(
      `${label} answered ${res.status} as "${type}", and the body does not match the OpenAPI document ` +
        `(${pointer}):\n${errors}\nBody: ${(JSON.stringify(res.body) as string | undefined)?.slice(0, 500)}`,
    );
  }
}
