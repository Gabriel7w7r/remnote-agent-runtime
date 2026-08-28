/**
 * Workflow 06: Read Table
 *
 * Tests read_table against the standalone Advanced Table fixture. The fixture
 * preflight derives its Rem ID from the conventional exact title.
 */

import {
  assertContains,
  assertEqual,
  assertHasField,
  assertIsArray,
  assertTruthy,
} from '../assertions.js';
import {
  TABLE_FIXTURE_MIN_ROWS,
  TABLE_FIXTURE_NUMERIC_PROPERTY,
  TABLE_FIXTURE_TITLE,
} from '../../helpers/integration-fixtures.js';
import type { WorkflowContext, WorkflowResult, SharedState, StepResult } from '../types';

/** Expected structure of read_table response */
interface ReadTableResponse {
  columns: Array<{ name: string; propertyId: string; type: string }>;
  rows: Array<{ name: string; remId: string; values: Record<string, string> }>;
  tableId: string;
  tableName: string;
  totalRows: number;
  rowsReturned: number;
}

export async function readTableWorkflow(
  ctx: WorkflowContext,
  state: SharedState
): Promise<WorkflowResult> {
  const steps: StepResult[] = [];

  const fixture = state.fixtures?.table;
  if (!fixture) {
    return {
      name: 'Read Table',
      steps: [
        {
          label: `Skipped — fixture "${TABLE_FIXTURE_TITLE}" unavailable`,
          passed: false,
          durationMs: 0,
          error:
            state.fixtureIssues?.find((issue) => issue.fixture === 'table')?.error ??
            'Advanced Table integration fixture was not initialized',
        },
      ],
      skipped: true,
    };
  }
  const tableName = TABLE_FIXTURE_TITLE;
  const tableRemId = fixture.tableRemId;

  let baseline: ReadTableResponse | null = null;

  // Step 1: Call remnote_read_table with the preferred identifier
  {
    const start = Date.now();
    try {
      const result = (await ctx.client.callTool('remnote_read_table', {
        tableTitle: tableName,
      })) as ReadTableResponse;

      assertHasField(result, 'columns', 'read_table response');
      assertHasField(result, 'rows', 'read_table response');
      assertHasField(result, 'tableId', 'read_table response');
      assertHasField(result, 'tableName', 'read_table response');
      assertHasField(result, 'totalRows', 'read_table response');
      assertHasField(result, 'rowsReturned', 'read_table response');

      assertIsArray(result.columns, 'columns should be an array');
      assertIsArray(result.rows, 'rows should be an array');
      assertEqual(result.rowsReturned, result.rows.length, 'rowsReturned should match rows length');
      assertTruthy(result.tableId, 'tableId should not be empty');
      assertTruthy(result.tableName, 'tableName should not be empty');
      assertEqual(result.tableId, tableRemId, 'title lookup should resolve preflight table ID');
      assertTruthy(
        result.totalRows >= TABLE_FIXTURE_MIN_ROWS,
        `table should contain at least ${TABLE_FIXTURE_MIN_ROWS} rows`
      );

      const numericColumn = result.columns.find(
        (column) => column.name === TABLE_FIXTURE_NUMERIC_PROPERTY
      );
      assertTruthy(numericColumn, `table should contain ${TABLE_FIXTURE_NUMERIC_PROPERTY}`);
      assertEqual(numericColumn?.type, 'number', 'fixture property type');
      assertEqual(
        numericColumn?.propertyId,
        fixture.numericPropertyRemId,
        'fixture numeric property ID'
      );
      const validRows = result.rows.filter((row) => {
        const value = row.values[fixture.numericPropertyRemId];
        return (
          typeof row.name === 'string' &&
          row.name.trim() !== '' &&
          typeof value === 'string' &&
          value.trim() !== '' &&
          Number.isFinite(Number(value))
        );
      });
      assertTruthy(
        validRows.length >= TABLE_FIXTURE_MIN_ROWS,
        `table should contain at least ${TABLE_FIXTURE_MIN_ROWS} named rows with finite numeric ${TABLE_FIXTURE_NUMERIC_PROPERTY} values`
      );

      if (result.columns.length > 0) {
        const firstCol = result.columns[0] as unknown as Record<string, unknown>;
        assertHasField(firstCol, 'name', 'column should have name');
        assertHasField(firstCol, 'propertyId', 'column should have propertyId');
        assertHasField(firstCol, 'type', 'column should have type');
      }

      if (result.rows.length > 0) {
        const firstRow = result.rows[0] as unknown as Record<string, unknown>;
        assertHasField(firstRow, 'name', 'row should have name');
        assertHasField(firstRow, 'remId', 'row should have remId');
        assertHasField(firstRow, 'values', 'row should have values');
      }

      baseline = result;
      steps.push({
        label: `Read table (${result.columns.length} columns, ${result.rows.length} rows)`,
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: 'Read table',
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  // Step 2: Validate alternate lookup by the ID derived during preflight.
  {
    const start = Date.now();
    try {
      const result = (await ctx.client.callTool('remnote_read_table', {
        tableRemId,
      })) as ReadTableResponse;

      assertHasField(result, 'tableId', 'read_table ID lookup response');
      assertHasField(result, 'tableName', 'read_table ID lookup response');
      assertHasField(result, 'columns', 'read_table ID lookup response');
      assertHasField(result, 'rows', 'read_table ID lookup response');
      assertEqual(result.tableId, tableRemId, 'ID lookup should resolve the requested table ID');
      assertTruthy(result.tableName, 'tableName should not be empty for ID lookup');

      if (baseline) {
        assertEqual(result.tableId, baseline.tableId, 'ID lookup should resolve the same table');
        assertEqual(result.tableName, baseline.tableName, 'ID lookup should preserve table name');
      }

      steps.push({
        label: 'Read table by remId',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: 'Read table by remId',
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  // Step 3: Validate propertyFilter against a known returned column
  if (baseline && baseline.columns.length > 0) {
    const start = Date.now();
    try {
      const selectedColumn = baseline.columns.find(
        (column) => column.propertyId === fixture.numericPropertyRemId
      )!;
      const result = (await ctx.client.callTool('remnote_read_table', {
        tableTitle: tableName,
        propertyFilter: [selectedColumn.name],
      })) as ReadTableResponse;

      assertEqual(result.columns.length, 1, 'propertyFilter should return exactly one column');
      assertEqual(
        result.columns[0].name,
        selectedColumn.name,
        'propertyFilter should preserve requested column'
      );
      for (const row of result.rows) {
        const keys = Object.keys(row.values);
        assertTruthy(
          keys.length <= 1 && (keys.length === 0 || keys[0] === result.columns[0].propertyId),
          'filtered row values should only contain the requested column'
        );
      }

      steps.push({
        label: `Read table with propertyFilter (${selectedColumn.name})`,
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: 'Read table with propertyFilter',
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  // Step 4: Call remnote_read_table with limit
  {
    const start = Date.now();
    try {
      const result = (await ctx.client.callTool('remnote_read_table', {
        tableTitle: tableName,
        limit: 1,
      })) as ReadTableResponse;

      assertIsArray(result.rows, 'rows should be an array');
      assertTruthy(result.rows.length <= 1, 'limit=1 should return at most 1 row');
      if (baseline && baseline.totalRows > 0) {
        assertEqual(result.rowsReturned, 1, 'limit=1 should report one returned row');
      }

      steps.push({
        label: 'Read table with limit=1',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: 'Read table with limit=1',
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  // Step 5: Call remnote_read_table with offset
  {
    const start = Date.now();
    try {
      const result = (await ctx.client.callTool('remnote_read_table', {
        tableTitle: tableName,
        offset: 1,
      })) as ReadTableResponse;

      assertIsArray(result.rows, 'rows should be an array');
      if (
        baseline &&
        baseline.totalRows > 1 &&
        baseline.rows.length > 1 &&
        result.rows.length > 0
      ) {
        assertTruthy(
          result.rows[0].remId !== baseline.rows[0].remId,
          'offset=1 should advance to a different first row when multiple rows exist'
        );
      }

      steps.push({
        label: 'Read table with offset=1',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: 'Read table with offset=1',
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  // Step 6: Call remnote_read_table with invalid table name (error case)
  {
    const start = Date.now();
    try {
      const errorText = await ctx.client.callToolExpectError('remnote_read_table', {
        tableTitle: 'invalid-table-name-xyz-12345',
      });
      assertContains(
        errorText,
        'Table not found',
        'invalid table lookup should return a not-found error'
      );

      steps.push({
        label: 'Read table with invalid name',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: 'Read table with invalid name',
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  return { name: 'Read Table', steps, skipped: false };
}
