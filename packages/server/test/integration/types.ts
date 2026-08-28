/**
 * Shared types for integration test workflows.
 */

import type { IntegrationTestClient } from './mcp-test-client.js';
import type {
  PersistentFixtureIssue,
  PersistentIntegrationFixtures,
} from '../helpers/integration-fixtures.js';

/** Result of a single test step within a workflow. */
export interface StepResult {
  label: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}

/** Result of an entire workflow (collection of steps). */
export interface WorkflowResult {
  name: string;
  steps: StepResult[];
  skipped: boolean;
}

/** Context passed to each workflow function. */
export interface WorkflowContext {
  client: IntegrationTestClient;
  runId: string;
  serverBaseUrl: string;
}

/** Shared state passed between workflows for cross-workflow dependencies. */
export interface SharedState {
  fixtures?: PersistentIntegrationFixtures;
  fixtureIssues?: PersistentFixtureIssue[];
  integrationParentRemId?: string;
  integrationParentTitle?: string;
  searchByTagTag?: string;
  searchByTagTagRemId?: string;
  noteAId?: string;
  noteBId?: string;
  noteCId?: string;
  mdTreeIds?: string[];
  acceptWriteOperations?: boolean;
  acceptReplaceOperation?: boolean;
}

/** A workflow function signature. */
export type WorkflowFn = (ctx: WorkflowContext, state: SharedState) => Promise<WorkflowResult>;
