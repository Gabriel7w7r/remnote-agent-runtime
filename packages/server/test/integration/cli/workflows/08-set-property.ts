/**
 * Workflow 08: Set Property
 *
 * Validates remnote-cli set-property through the shared Automation Bridge Test
 * Tag fixture. The fixture must be a property-bearing tag/table with an
 * automation-level property.
 */

import { assertEqual, assertIsArray, assertTruthy } from '../assertions.js';
import { PROPERTY_FIXTURE_NAME } from '../../../helpers/integration-fixtures.js';
import type { WorkflowContext, WorkflowResult, SharedState, StepResult } from '../types.js';

const READ_TABLE_PAGE_SIZE = 150;

interface ReadTableColumn {
  name: string;
  propertyId: string;
  type: string;
}

interface ReadTableRow {
  name: string;
  remId: string;
  values: Record<string, string>;
}

interface ReadTableResponse {
  columns: ReadTableColumn[];
  rows: ReadTableRow[];
  tableId: string;
  tableName: string;
  totalRows: number;
  rowsReturned: number;
}

function makePropertyValue(runId: string): string {
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  return `cli-set-property-${runId}-${randomSuffix}`;
}

async function findVerifiedPropertyRow(
  ctx: WorkflowContext,
  tableRemId: string,
  propertyName: string,
  propertyRemId: string,
  targetRemId: string,
  expectedValue: string
): Promise<void> {
  let offset = 0;
  let totalRows: number | undefined;

  do {
    const page = (await ctx.cli.runExpectSuccess([
      'read-table',
      '--rem-id',
      tableRemId,
      '--properties',
      propertyName,
      '--limit',
      String(READ_TABLE_PAGE_SIZE),
      '--offset',
      String(offset),
    ])) as ReadTableResponse;

    assertEqual(page.tableId, tableRemId, 'verification tableId');
    assertEqual(page.columns.length, 1, 'verification should return one filtered column');
    assertEqual(page.columns[0].propertyId, propertyRemId, 'verification propertyId');
    assertIsArray(page.rows, 'verification rows');

    const row = page.rows.find((candidate) => candidate.remId === targetRemId);
    if (row) {
      assertEqual(row.values[propertyRemId], expectedValue, 'property value readback');
      return;
    }

    totalRows = page.totalRows;
    offset += page.rowsReturned;
  } while (totalRows !== undefined && offset < totalRows && offset > 0);

  throw new Error(
    `Could not find row ${targetRemId} with ${propertyName}=${JSON.stringify(expectedValue)}`
  );
}

export async function setPropertyWorkflow(
  ctx: WorkflowContext,
  state: SharedState
): Promise<WorkflowResult> {
  const steps: StepResult[] = [];

  if (!state.noteAId) {
    return {
      name: 'Set Property',
      steps: [
        {
          label: 'Skipped — simple note not initialized',
          passed: false,
          durationMs: 0,
          error: 'No noteAId in shared state',
        },
      ],
      skipped: true,
    };
  }

  const fixture = state.fixtures?.property;
  if (!fixture) {
    return {
      name: 'Set Property',
      steps: [
        {
          label: 'Skipped — property fixture unavailable',
          passed: false,
          durationMs: 0,
          error:
            state.fixtureIssues?.find((issue) => issue.fixture === 'property')?.error ??
            'Property integration fixture was not initialized',
        },
      ],
      skipped: true,
    };
  }

  const targetRemId = state.noteAId;
  const propertyFixtureTagRemId = fixture.tableRemId;
  const automationLevelPropertyRemId = fixture.propertyRemId;
  let automationLevelValue: string | undefined;
  let automationLevelRenderedValue: string | undefined;

  // Step 1: Set a unique text property value on the test note.
  {
    const start = Date.now();
    try {
      assertTruthy(propertyFixtureTagRemId, 'property fixture tag remId');
      assertTruthy(automationLevelPropertyRemId, 'automation-level property remId');
      assertTruthy(
        typeof state.integrationParentRemId === 'string',
        'property exact reference target remId'
      );
      assertTruthy(
        typeof state.integrationParentTitle === 'string',
        'property exact reference target title'
      );
      const propertyValuePrefix = makePropertyValue(ctx.runId);
      automationLevelValue = `${propertyValuePrefix} [[id:${state.integrationParentRemId}]]`;
      automationLevelRenderedValue = `${propertyValuePrefix} [[${state.integrationParentTitle}]]`;

      const result = (await ctx.cli.runExpectSuccess([
        'set-property',
        targetRemId,
        '--tag-id',
        propertyFixtureTagRemId,
        '--property-id',
        automationLevelPropertyRemId,
        '--value',
        automationLevelValue,
      ])) as Record<string, unknown>;

      assertEqual(result.remId, targetRemId, 'set-property remId');
      assertEqual(result.tagRemId, propertyFixtureTagRemId, 'set-property tagRemId');
      assertEqual(result.propertyRemId, automationLevelPropertyRemId, 'set-property propertyRemId');
      assertEqual(result.valueKind, 'text', 'set-property valueKind');

      steps.push({
        label: `Set ${PROPERTY_FIXTURE_NAME}=${automationLevelValue}`,
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: `Set ${PROPERTY_FIXTURE_NAME}`,
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
      return { name: 'Set Property', steps, skipped: false };
    }
  }

  // Step 2: Verify the value through the tag/table read surface and keep it for manual inspection.
  {
    const start = Date.now();
    try {
      assertTruthy(propertyFixtureTagRemId, 'property fixture tag remId');
      assertTruthy(automationLevelPropertyRemId, 'automation-level property remId');
      assertTruthy(automationLevelValue, 'automation-level value');
      assertTruthy(automationLevelRenderedValue, 'automation-level rendered value');

      await findVerifiedPropertyRow(
        ctx,
        propertyFixtureTagRemId,
        PROPERTY_FIXTURE_NAME,
        automationLevelPropertyRemId,
        targetRemId,
        automationLevelRenderedValue
      );

      steps.push({
        label: `Verify kept ${PROPERTY_FIXTURE_NAME} exact reference value via read-table`,
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: `Verify ${PROPERTY_FIXTURE_NAME} value via read-table`,
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  return { name: 'Set Property', steps, skipped: false };
}
