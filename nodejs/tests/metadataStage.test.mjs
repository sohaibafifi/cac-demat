import assert from 'node:assert/strict';
import test from 'node:test';
import { MetadataStage } from '../dist/services/pipeline/stages/metadataStage.js';

const stage = new MetadataStage({ resolve: async () => 'qpdf' });

test('metadata update omits unrelated streams and cleans the Info dictionary', () => {
  const source = {
    qpdf: [
      { jsonversion: 2, maxobjectid: 12, pdfversion: '1.7' },
      {
        trailer: { value: { '/Info': '5 0 R', '/Root': '1 0 R' } },
        'obj:5 0 R': {
          value: {
            '/Author': 'u:Author',
            '/CreationDate': 'u:D:20260101000000',
            '/Producer': 'u:Producer',
            '/Title': 'u:Title',
          },
        },
        'obj:12 0 R': {
          stream: {
            dict: { '/Filter': '/FlateDecode' },
            data: 'YWJj==invalid-data-after-padding',
          },
        },
      },
    ],
  };

  const updated = stage.injectInfoDictionary(source, 'Shared with PIERRE MARQUIS');

  assert.deepEqual(Object.keys(updated.qpdf[1]), ['obj:5 0 R']);
  assert.deepEqual(updated.qpdf[1]['obj:5 0 R'], {
    value: {
      '/CreationDate': 'u:D:20260101000000',
      '/Subject': 'u:Shared with PIERRE MARQUIS',
    },
  });
});

test('metadata update adds an Info reference without copying page streams', () => {
  const source = {
    qpdf: [
      { jsonversion: 2, maxobjectid: 8, pdfversion: '1.7' },
      {
        trailer: { value: { '/Root': '1 0 R', '/Size': 9 } },
        'obj:8 0 R': { stream: { dict: {}, data: 'YWJj==' } },
      },
    ],
  };

  const updated = stage.injectInfoDictionary(source, 'Shared with PIERRE MARQUIS');

  assert.deepEqual(Object.keys(updated.qpdf[1]).sort(), ['obj:9 0 R', 'trailer']);
  assert.equal(updated.qpdf[1].trailer.value['/Info'], '9 0 R');
  assert.deepEqual(updated.qpdf[1]['obj:9 0 R'], {
    value: { '/Subject': 'u:Shared with PIERRE MARQUIS' },
  });
});
