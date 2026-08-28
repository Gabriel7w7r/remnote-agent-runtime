/**
 * Workflow 07: Read Table
 *
 * Tests read-table against the standalone Advanced Table fixture. The fixture
 * preflight derives its Rem ID from the conventional exact title.
 */

import { assertContains, assertEqual, assertTruthy } from '../assertions.js';
import {
  TABLE_FIXTURE_MIN_ROWS,
  TABLE_FIXTURE_NUMERIC_PROPERTY,
  TABLE_FIXTURE_TITLE,
} from '../../../helpers/integration-fixtures.js';
import type { CliTestClient } from '../cli-test-client.js';
import type { WorkflowResult, SharedState, StepResult } from '../types';

interface CliContext {
  cli: CliTestClient;
  runId: string;
}

/** Expected structure of read-table JSON output */
interface ReadTableResponse {
  columns: Array<{ name: string; propertyId: string; type: string }>;
  rows: Array<{ name: string; remId: string; values: Record<string, string> }>;
  tableId: string;
  tableName: string;
  totalRows: number;
  rowsReturned: number;
}

export async function readTableWorkflow(
  ctx: CliContext,
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

  // Step 1: Basic read-table command
  {
    const start = Date.now();
    try {
      const result = await ctx.cli.run(['read-table', '--title', tableName]);

      if (result.exitCode !== 0) {
        throw new Error(
          `CLI exited with code ${result.exitCode}: ${result.stderr || result.stdout}`
        );
      }

      const data = result.json as ReadTableResponse;
      if (!data || typeof data !== 'object') {
        throw new Error(`Expected JSON object, got: ${result.stdout}`);
      }
      if (!('columns' in data)) {
        throw new Error('Response missing columns field');
      }
      if (!('rows' in data)) {
        throw new Error('Response missing rows field');
      }
      if (!('tableId' in data) || !('tableName' in data)) {
        throw new Error('Response missing table identity fields');
      }
      if (!('totalRows' in data) || !('rowsReturned' in data)) {
        throw new Error('Response missing pagination fields');
      }

      if (!Array.isArray(data.columns)) {
        throw new Error('columns should be an array');
      }
      if (!Array.isArray(data.rows)) {
        throw new Error('rows should be an array');
      }
      assertEqual(data.rowsReturned, data.rows.length, 'rowsReturned should match rows length');
      assertTruthy(data.tableId, 'tableId should not be empty');
      assertTruthy(data.tableName, 'tableName should not be empty');
      assertEqual(data.tableId, tableRemId, 'title lookup should resolve preflight table ID');
      assertTruthy(
        data.totalRows >= TABLE_FIXTURE_MIN_ROWS,
        `table should contain at least ${TABLE_FIXTURE_MIN_ROWS} rows`
      );

      const numericColumn = data.columns.find(
        (column) => column.name === TABLE_FIXTURE_NUMERIC_PROPERTY
      );
      assertTruthy(numericColumn, `table should contain ${TABLE_FIXTURE_NUMERIC_PROPERTY}`);
      assertEqual(numericColumn?.type, 'number', 'fixture property type');
      assertEqual(
        numericColumn?.propertyId,
        fixture.numericPropertyRemId,
        'fixture numeric property ID'
      );
      const validRows = data.rows.filter((row) => {
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

      baseline = data;
      steps.push({
        label: `Read table (${data.columns.length} columns, ${data.rows.length} rows)`,
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

  // Step 2: read-table by the Rem ID derived during preflight.
  {
    const start = Date.now();
    try {
      const result = await ctx.cli.run(['read-table', '--rem-id', tableRemId]);

      if (result.exitCode !== 0) {
        throw new Error(
          `CLI exited with code ${result.exitCode}: ${result.stderr || result.stdout}`
        );
      }

      const data = result.json as ReadTableResponse;
      if (!('tableId' in data) || !('tableName' in data)) {
        throw new Error('Response missing table identity fields');
      }
      if (!('columns' in data) || !('rows' in data)) {
        throw new Error('Response missing table payload fields');
      }
      assertEqual(data.tableId, tableRemId, 'Rem-ID lookup should resolve the requested table ID');
      assertTruthy(data.tableName, 'tableName should not be empty');

      if (baseline) {
        assertEqual(data.tableId, baseline.tableId, 'Rem-ID lookup should resolve the same table');
        assertEqual(data.tableName, baseline.tableName, 'Rem-ID lookup should preserve table name');
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

  // Step 3: read-table with --properties filter
  if (baseline && baseline.columns.length > 0) {
    const start = Date.now();
    try {
      const selectedColumn = baseline.columns.find(
        (column) => column.propertyId === fixture.numericPropertyRemId
      )!;
      const result = await ctx.cli.run([
        'read-table',
        '--title',
        tableName,
        '--properties',
        selectedColumn.name,
      ]);

      if (result.exitCode !== 0) {
        throw new Error(
          `CLI exited with code ${result.exitCode}: ${result.stderr || result.stdout}`
        );
      }

      const data = result.json as ReadTableResponse;
      assertEqual(data.columns.length, 1, '--properties should return exactly one column');
      assertEqual(
        data.columns[0].name,
        selectedColumn.name,
        '--properties should preserve the requested column'
      );
      for (const row of data.rows) {
        const keys = Object.keys(row.values);
        assertTruthy(
          keys.length <= 1 && (keys.length === 0 || keys[0] === data.columns[0].propertyId),
          'filtered row values should only contain the requested column'
        );
      }

      steps.push({
        label: `Read table with --properties ${selectedColumn.name}`,
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: 'Read table with --properties',
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  // Step 4: read-table with --limit option
  {
    const start = Date.now();
    try {
      const result = await ctx.cli.run(['read-table', '--title', tableName, '--limit', '1']);

      if (result.exitCode !== 0) {
        throw new Error(
          `CLI exited with code ${result.exitCode}: ${result.stderr || result.stdout}`
        );
      }

      const data = result.json as ReadTableResponse;
      if (!Array.isArray(data.rows)) {
        throw new Error('rows should be an array');
      }
      assertTruthy(data.rows.length <= 1, 'limit=1 should return at most 1 row');
      if (baseline && baseline.totalRows > 0) {
        assertEqual(data.rowsReturned, 1, 'limit=1 should report one returned row');
      }

      steps.push({
        label: 'Read table with --limit 1',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: 'Read table with --limit 1',
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  // Step 5: read-table with --offset option
  {
    const start = Date.now();
    try {
      const result = await ctx.cli.run(['read-table', '--title', tableName, '--offset', '1']);

      if (result.exitCode !== 0) {
        throw new Error(
          `CLI exited with code ${result.exitCode}: ${result.stderr || result.stdout}`
        );
      }

      const data = result.json as ReadTableResponse;
      if (!Array.isArray(data.rows)) {
        throw new Error('rows should be an array');
      }
      if (baseline && baseline.totalRows > 1 && baseline.rows.length > 1 && data.rows.length > 0) {
        assertTruthy(
          data.rows[0].remId !== baseline.rows[0].remId,
          'offset=1 should advance to a different first row when multiple rows exist'
        );
      }

      steps.push({
        label: 'Read table with --offset 1',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: 'Read table with --offset 1',
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  // Step 6: read-table with non-existent table
  {
    const start = Date.now();
    try {
      const result = await ctx.cli.runExpectError([
        'read-table',
        '--title',
        'Non-Existent-Table-xyz-123',
      ]);
      assertContains(
        `${result.stderr}\n${result.stdout}`,
        'Table not found',
        'invalid table lookup should return a not-found error'
      );

      steps.push({
        label: 'Read non-existent table',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: 'Read non-existent table',
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  return { name: 'Read Table', steps, skipped: false };
}
