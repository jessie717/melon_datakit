import { describe, expect, test } from 'bun:test';
import { parseSpecText, SpecParseError } from './parse';
import { normalizeSpec } from './normalize';

const MINIMAL_JSON = JSON.stringify({
  openapi: '3.1.0',
  info: { title: 'T', version: '1' },
  paths: {
    '/ping': {
      get: {
        responses: { '200': { description: 'ok' } },
      },
    },
  },
});

const MINIMAL_YAML = `
openapi: 3.0.3
info:
  title: Y
  version: "1"
paths:
  /ping:
    get:
      responses:
        "200":
          description: ok
`;

describe('parseSpecText', () => {
  test('JSON 文本解析 + dereference', async () => {
    const { spec, openapiVersion } = await parseSpecText(MINIMAL_JSON);
    expect(openapiVersion).toBe('3.1.0');
    expect(spec['paths']).toBeDefined();
  });

  test('YAML 文本解析', async () => {
    const { openapiVersion } = await parseSpecText(MINIMAL_YAML);
    expect(openapiVersion).toBe('3.0.3');
  });

  test('$ref dereference', async () => {
    const withRef = JSON.stringify({
      openapi: '3.0.3',
      info: { title: 'T', version: '1' },
      paths: {
        '/a': {
          get: {
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/A' } },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: { A: { type: 'object', properties: { name: { type: 'string' } } } },
      },
    });
    const { spec } = await parseSpecText(withRef);
    const { routes } = normalizeSpec(spec);
    const props = (routes[0]!.responses[0]!.schema as { properties?: Record<string, unknown> })
      .properties;
    expect(Object.keys(props ?? {})).toContain('name');
  });

  test('空文本 → SpecParseError', async () => {
    expect(parseSpecText('')).rejects.toBeInstanceOf(SpecParseError);
  });

  test('非法 JSON → SpecParseError', async () => {
    expect(parseSpecText('{bad json')).rejects.toBeInstanceOf(SpecParseError);
  });

  test('非 OpenAPI 文档 → SpecParseError', async () => {
    expect(parseSpecText(JSON.stringify({ hello: 'world' }))).rejects.toBeInstanceOf(
      SpecParseError
    );
  });
});
