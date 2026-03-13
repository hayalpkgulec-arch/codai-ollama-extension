import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ExternalToolRegistry } from '../services/ExternalToolRegistry';
import { ToolRegistry } from '../tools/core/ToolRegistry';

test('ExternalToolRegistry registers read-only workspace aliases', () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'codai-external-tools-'));
    fs.mkdirSync(path.join(workspaceRoot, '.codai'), { recursive: true });
    fs.writeFileSync(
        path.join(workspaceRoot, '.codai', 'external-tools.json'),
        JSON.stringify({
            tools: [{
                name: 'workspace_read_spec',
                description: 'Read the active spec files through a workspace alias',
                targetTool: 'read_file',
                workspaceBoundaryLabel: 'Workspace docs only',
            }],
        }),
        'utf8',
    );

    const registry = new ToolRegistry();
    registry.registerTool({
        definition: {
            name: 'read_file',
            description: 'Read a file',
            manifest: {
                name: 'read_file',
                category: 'read',
                riskLevel: 'low',
                requiresApproval: false,
                supportsAutoApprove: true,
                producesCheckpoint: false,
                idempotent: true,
                sideEffectScope: 'none',
                source: 'builtin',
                readOnly: true,
            },
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string' },
                },
                required: ['path'],
            },
        },
        async execute(args: any) {
            return JSON.stringify({ ok: true, path: args?.path || '' });
        },
    });

    const entries = new ExternalToolRegistry(workspaceRoot).registerBindings(registry);
    const aliasTool = registry.getTool('workspace_read_spec');

    assert.equal(entries.length, 1);
    assert.ok(aliasTool);
    assert.equal(entries[0].manifest.source, 'external');
    assert.equal(entries[0].manifest.readOnly, true);
    assert.equal(entries[0].manifest.workspaceBoundaryLabel, 'Workspace docs only');
});
