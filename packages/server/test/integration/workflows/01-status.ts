/**
 * Workflow 01: Status Check (gatekeeper)
 *
 * Verifies the MCP server is connected to RemNote via the bridge plugin.
 * If this workflow fails, all subsequent workflows should be skipped.
 */

import { assertTruthy, assertHasField } from '../assertions.js';
import type { WorkflowContext, WorkflowResult, SharedState, StepResult } from '../types.js';

export async function statusWorkflow(
  ctx: WorkflowContext,
  state: SharedState
): Promise<WorkflowResult> {
  const steps: StepResult[] = [];

  // Step 1: remnote_status returns connected: true
  {
    const start = Date.now();
    try {
      const result = await ctx.client.callTool('remnote_status');
      assertTruthy(result.connected, 'connected should be true');
      steps.push({
        label: 'remnote_status returns connected: true',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: 'remnote_status returns connected: true',
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  // Step 2: pluginVersion is present
  {
    const start = Date.now();
    try {
      const result = await ctx.client.callTool('remnote_status');
      assertHasField(result, 'pluginVersion', 'status response');
      assertTruthy(typeof result.pluginVersion === 'string', 'pluginVersion should be a string');
      steps.push({
        label: 'pluginVersion is present',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: 'pluginVersion is present',
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  // Step 3: write/replace gate flags are present
  {
    const start = Date.now();
    try {
      const result = await ctx.client.callTool('remnote_status');
      assertHasField(result, 'acceptWriteOperations', 'status response');
      assertHasField(result, 'acceptReplaceOperation', 'status response');
      assertTruthy(
        typeof result.acceptWriteOperations === 'boolean',
        'acceptWriteOperations should be a boolean'
      );
      assertTruthy(
        typeof result.acceptReplaceOperation === 'boolean',
        'acceptReplaceOperation should be a boolean'
      );
      state.acceptWriteOperations = result.acceptWriteOperations as boolean;
      state.acceptReplaceOperation = result.acceptReplaceOperation as boolean;
      steps.push({
        label: 'Write/replace gate flags are present',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: 'Write/replace gate flags are present',
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  // Step 4: Fail fast on bridge/server version mismatch
  {
    const start = Date.now();
    try {
      const result = await ctx.client.callTool('remnote_status');
      assertHasField(result, 'serverVersion', 'status response serverVersion');
      assertTruthy(typeof result.serverVersion === 'string', 'serverVersion should be a string');
      assertTruthy(
        !('version_warning' in result),
        `version mismatch detected (server=${String(result.serverVersion)}, bridge=${String(
          result.pluginVersion
        )}): ${String(result.version_warning)}`
      );
      steps.push({
        label: 'Server/bridge versions are compatible',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: 'Server/bridge versions are compatible',
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  // Step 5: remnote_get_playbook exposes navigation guidance
  {
    const start = Date.now();
    try {
      const result = await ctx.client.callTool('remnote_get_playbook');
      assertHasField(result, 'playbookVersion', 'playbook response');
      assertHasField(result, 'decisionTree', 'playbook response');
      assertHasField(result, 'navigationPresets', 'playbook response');
      assertTruthy(Array.isArray(result.decisionTree), 'decisionTree should be an array');
      const presets = result.navigationPresets as Record<string, unknown>;
      const orientation = presets.orientation as Record<string, unknown>;
      assertTruthy(
        orientation?.contentMode === 'structured',
        'orientation contentMode should be structured'
      );
      assertTruthy(orientation?.view === 'compact', 'orientation view should be compact');
      assertTruthy(orientation?.depth === 1, 'orientation depth should be 1');
      assertTruthy(orientation?.childLimit === 500, 'orientation childLimit should be 500');
      steps.push({
        label: 'remnote_get_playbook returns traversal guidance',
        passed: true,
        durationMs: Date.now() - start,
      });
    } catch (e) {
      steps.push({
        label: 'remnote_get_playbook returns traversal guidance',
        passed: false,
        durationMs: Date.now() - start,
        error: (e as Error).message,
      });
    }
  }

  return { name: 'Status Check', steps, skipped: false };
}
