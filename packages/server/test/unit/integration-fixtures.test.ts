import { describe, expect, it, vi } from 'vitest';
import {
  MEDIA_FIXTURE_TITLE,
  PROPERTY_FIXTURE_TITLE,
  TABLE_FIXTURE_TITLE,
  resolvePersistentIntegrationFixtures,
  type PersistentFixtureReader,
} from '../helpers/integration-fixtures.js';

function makeAdvancedTable(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tableId: 'table-1',
    columns: [{ name: 'Salary', propertyId: 'salary-1', type: 'number' }],
    rows: [
      { remId: 'row-1', name: 'Andrea', values: { 'salary-1': '300' } },
      { remId: 'row-2', name: 'Jozef', values: { 'salary-1': '500' } },
      { remId: 'row-empty', name: '', values: { 'salary-1': '' } },
      { remId: 'row-unrelated', name: 'Unrelated', values: {} },
    ],
    totalRows: 4,
    ...overrides,
  };
}

function makePropertyTable(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    tableId: 'tag-1',
    columns: [{ name: 'automation-level', propertyId: 'property-1', type: 'text' }],
    totalRows: 0,
    ...overrides,
  };
}

function makeReader(overrides: Partial<PersistentFixtureReader> = {}): PersistentFixtureReader {
  return {
    readTableByRemId: vi
      .fn()
      .mockImplementation((remId: string) =>
        Promise.resolve(remId === 'table-1' ? makeAdvancedTable() : makePropertyTable())
      ),
    searchByTitle: vi.fn().mockImplementation((title: string) =>
      Promise.resolve({
        results: [
          title === TABLE_FIXTURE_TITLE
            ? { remId: 'table-1', title: TABLE_FIXTURE_TITLE }
            : title === PROPERTY_FIXTURE_TITLE
              ? { remId: 'tag-1', title: PROPERTY_FIXTURE_TITLE }
              : { remId: 'media-rem-1', title: MEDIA_FIXTURE_TITLE },
        ],
      })
    ),
    readNoteWithMedia: vi.fn().mockResolvedValue({
      media: [
        {
          mediaId: 'media-1',
          field: 'backText',
          source: 'remnote_managed_local',
        },
      ],
    }),
    ...overrides,
  };
}

describe('resolvePersistentIntegrationFixtures', () => {
  it('derives all fixture IDs and the media field from fixed titles', async () => {
    const reader = makeReader();

    await expect(resolvePersistentIntegrationFixtures(reader)).resolves.toEqual({
      fixtures: {
        table: { tableRemId: 'table-1', numericPropertyRemId: 'salary-1' },
        property: { tableRemId: 'tag-1', propertyRemId: 'property-1' },
        media: {
          mediaRemId: 'media-rem-1',
          mediaField: 'backText',
          mediaId: 'media-1',
        },
      },
      issues: [],
    });
    expect(reader.readTableByRemId).toHaveBeenCalledWith('table-1', 150);
    expect(reader.readTableByRemId).toHaveBeenCalledWith('tag-1', 1);
    expect(reader.searchByTitle).toHaveBeenCalledWith(TABLE_FIXTURE_TITLE);
    expect(reader.searchByTitle).toHaveBeenCalledWith(PROPERTY_FIXTURE_TITLE);
    expect(reader.searchByTitle).toHaveBeenCalledWith(MEDIA_FIXTURE_TITLE);
    expect(reader.readNoteWithMedia).toHaveBeenCalledWith('media-rem-1');
  });

  it('resolves the actual table by normalized title while ignoring its wrapper', async () => {
    const reader = makeReader({
      searchByTitle: vi.fn().mockImplementation((title: string) => {
        if (title === TABLE_FIXTURE_TITLE) {
          return Promise.resolve({
            results: [
              { remId: 'wrapper-1', title: 'Automation Bridge Test Advanced Table' },
              { remId: 'table-1', title: `  ${TABLE_FIXTURE_TITLE.toUpperCase()}  ` },
            ],
          });
        }
        if (title === PROPERTY_FIXTURE_TITLE) {
          return Promise.resolve({
            results: [{ remId: 'tag-1', title: PROPERTY_FIXTURE_TITLE }],
          });
        }
        return Promise.resolve({
          results: [{ remId: 'media-rem-1', title: MEDIA_FIXTURE_TITLE }],
        });
      }),
    });

    const result = await resolvePersistentIntegrationFixtures(reader);

    expect(result.fixtures.table?.tableRemId).toBe('table-1');
    expect(result.issues).toEqual([]);
  });

  it('reports a malformed property fixture while preserving media resolution', async () => {
    const reader = makeReader({
      readTableByRemId: vi
        .fn()
        .mockImplementation((remId: string) =>
          Promise.resolve(
            remId === 'table-1' ? makeAdvancedTable() : makePropertyTable({ columns: [] })
          )
        ),
    });

    const result = await resolvePersistentIntegrationFixtures(reader);

    expect(result.fixtures.property).toBeUndefined();
    expect(result.fixtures.table?.tableRemId).toBe('table-1');
    expect(result.fixtures.media?.mediaId).toBe('media-1');
    expect(result.issues).toEqual([
      expect.objectContaining({
        fixture: 'property',
        error: expect.stringContaining('must have a text-compatible "automation-level" property'),
      }),
    ]);
  });

  it('reports a malformed Advanced Table while preserving other fixtures', async () => {
    const reader = makeReader({
      readTableByRemId: vi.fn().mockImplementation((remId: string) =>
        Promise.resolve(
          remId === 'table-1'
            ? makeAdvancedTable({
                columns: [{ name: 'Salary', propertyId: 'salary-1', type: 'text' }],
              })
            : makePropertyTable()
        )
      ),
    });

    const result = await resolvePersistentIntegrationFixtures(reader);

    expect(result.fixtures.table).toBeUndefined();
    expect(result.fixtures.property?.propertyRemId).toBe('property-1');
    expect(result.fixtures.media?.mediaId).toBe('media-1');
    expect(result.issues).toEqual([
      expect.objectContaining({
        fixture: 'table',
        error: expect.stringContaining('must have a numeric "Salary" property'),
      }),
    ]);
  });

  it('requires multiple named Advanced Table rows with finite numeric values', async () => {
    const reader = makeReader({
      readTableByRemId: vi.fn().mockImplementation((remId: string) =>
        Promise.resolve(
          remId === 'table-1'
            ? makeAdvancedTable({
                rows: [{ remId: 'row-1', name: 'Andrea', values: { 'salary-1': 'not-a-number' } }],
                totalRows: 1,
              })
            : makePropertyTable()
        )
      ),
    });

    const result = await resolvePersistentIntegrationFixtures(reader);

    expect(result.fixtures.table).toBeUndefined();
    expect(result.issues[0]).toEqual(
      expect.objectContaining({
        fixture: 'table',
        error: expect.stringContaining(
          'must have at least 2 named rows with finite numeric "Salary" values'
        ),
      })
    );
  });

  it('reports a missing media fixture while preserving property resolution', async () => {
    const reader = makeReader({
      searchByTitle: vi.fn().mockImplementation((title: string) =>
        Promise.resolve({
          results:
            title === TABLE_FIXTURE_TITLE
              ? [{ remId: 'table-1', title: TABLE_FIXTURE_TITLE }]
              : title === PROPERTY_FIXTURE_TITLE
                ? [{ remId: 'tag-1', title: PROPERTY_FIXTURE_TITLE }]
                : [],
        })
      ),
    });

    const result = await resolvePersistentIntegrationFixtures(reader);

    expect(result.fixtures.property?.tableRemId).toBe('tag-1');
    expect(result.fixtures.media).toBeUndefined();
    expect(result.issues).toEqual([
      expect.objectContaining({
        fixture: 'media',
        error: expect.stringContaining(
          `Required integration fixture "${MEDIA_FIXTURE_TITLE}" was not found`
        ),
      }),
    ]);
  });

  it('reports duplicate exact media fixture titles', async () => {
    const reader = makeReader({
      searchByTitle: vi.fn().mockImplementation((title: string) =>
        Promise.resolve({
          results:
            title === TABLE_FIXTURE_TITLE
              ? [{ remId: 'table-1', title: TABLE_FIXTURE_TITLE }]
              : title === PROPERTY_FIXTURE_TITLE
                ? [{ remId: 'tag-1', title: PROPERTY_FIXTURE_TITLE }]
                : [
                    { remId: 'media-rem-1', title: MEDIA_FIXTURE_TITLE },
                    { remId: 'media-rem-2', title: `  ${MEDIA_FIXTURE_TITLE.toUpperCase()}  ` },
                  ],
        })
      ),
    });

    const result = await resolvePersistentIntegrationFixtures(reader);

    expect(result.fixtures.media).toBeUndefined();
    expect(result.issues[0]).toEqual(
      expect.objectContaining({ fixture: 'media', error: expect.stringContaining('media-rem-1') })
    );
    expect(result.issues[0].error).toContain('media-rem-2');
  });

  it('reports a media fixture without managed local image metadata', async () => {
    const reader = makeReader({
      readNoteWithMedia: vi.fn().mockResolvedValue({
        media: [{ mediaId: 'remote-1', field: 'text', source: 'remote' }],
      }),
    });

    const result = await resolvePersistentIntegrationFixtures(reader);

    expect(result.fixtures.media).toBeUndefined();
    expect(result.issues[0]).toEqual(
      expect.objectContaining({
        fixture: 'media',
        error: expect.stringContaining('must contain at least one RemNote-managed local image'),
      })
    );
  });

  it('lists every missing persistent fixture in one resolution', async () => {
    const reader = makeReader({
      searchByTitle: vi.fn().mockResolvedValue({ results: [] }),
    });

    const result = await resolvePersistentIntegrationFixtures(reader);

    expect(result.fixtures).toEqual({});
    expect(result.issues.map((issue) => issue.fixture)).toEqual(['table', 'property', 'media']);
  });
});
