import { QueueInteractionScore } from '@remnote/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import { SdkAgent } from '../../src/bridge/sdk-agent';

describe('SdkAgent', () => {
  it('routes editor insertion through the official editor namespace', async () => {
    const insertMarkdown = vi.fn().mockResolvedValue(undefined);
    const agent = new SdkAgent({ editor: { insertMarkdown } } as never);

    await expect(
      agent.execute('editor_write', { operation: 'insert_markdown', markdown: '**hello**' })
    ).resolves.toEqual({ applied: true });
    expect(insertMarkdown).toHaveBeenCalledWith('**hello**');
  });

  it('keeps destructive editor operations on the destructive action path', async () => {
    const deleteCharacters = vi.fn().mockResolvedValue(undefined);
    const agent = new SdkAgent({ editor: { deleteCharacters } } as never);

    await agent.execute('editor_delete', {
      operation: 'delete_characters',
      characters: 3,
      direction: -1,
    });
    expect(deleteCharacters).toHaveBeenCalledWith(3, -1);
  });

  it('maps human review scores to official queue score values', async () => {
    const rateCurrentCard = vi.fn().mockResolvedValue(undefined);
    const agent = new SdkAgent({ queue: { rateCurrentCard } } as never);

    await agent.execute('queue_write', { operation: 'rate', score: 'good' });
    expect(rateCurrentCard).toHaveBeenCalledWith(QueueInteractionScore.GOOD);
  });

  it('returns JSON-safe Rem state snapshots', async () => {
    const rem = createRem();
    const agent = new SdkAgent({ rem: { findOne: vi.fn().mockResolvedValue(rem) } } as never);

    await expect(
      agent.execute('rem_read', { operation: 'state', remId: 'rem-1' })
    ).resolves.toEqual({
      isDocument: true,
      isListItem: false,
      isCardItem: true,
      isQuote: false,
      isCode: false,
      isTodo: true,
      todoStatus: 'Unfinished',
      fontSize: 'H2',
      highlightColor: 'Yellow',
      isFolder: false,
      enablePractice: true,
      practiceDirection: 'forward',
    });
  });

  it('requires an explicit destructive action before removing a Rem', async () => {
    const rem = createRem();
    const agent = new SdkAgent({ rem: { findOne: vi.fn().mockResolvedValue(rem) } } as never);

    await agent.execute('rem_delete', { operation: 'remove', remId: 'rem-1' });
    expect(rem.remove).toHaveBeenCalled();
  });

  it('caps all-card reads and reports truncation', async () => {
    const cards = [
      { _id: 'card-1', remId: 'rem-1', type: 'forward', createdAt: 1 },
      { _id: 'card-2', remId: 'rem-2', type: 'forward', createdAt: 2 },
    ];
    const agent = new SdkAgent({ card: { getAll: vi.fn().mockResolvedValue(cards) } } as never);

    const result = await agent.execute('card_read', { operation: 'get_all', limit: 1 });
    expect(result).toMatchObject({ total: 2, truncated: true });
    expect((result as { cards: unknown[] }).cards).toHaveLength(1);
  });

  it('opens the RemNote Agent bridge in the right sidebar', async () => {
    const openWidgetInRightSidebar = vi.fn().mockResolvedValue(['pane-rem-1']);
    const agent = new SdkAgent({ window: { openWidgetInRightSidebar } } as never);

    await expect(
      agent.execute('window_write', { operation: 'open_agent_sidebar' })
    ).resolves.toEqual({ applied: true, paneRemIds: ['pane-rem-1'] });
    expect(openWidgetInRightSidebar).toHaveBeenCalledWith('mcp_bridge');
  });

  it('resolves a card back to its Rem and official card type', async () => {
    const card = {
      _id: 'card-1',
      getRem: vi.fn().mockResolvedValue(createRem()),
      getType: vi.fn().mockResolvedValue('forward'),
    };
    const agent = new SdkAgent({ card: { findOne: vi.fn().mockResolvedValue(card) } } as never);

    await expect(
      agent.execute('card_read', { operation: 'get_rem', cardId: 'card-1' })
    ).resolves.toMatchObject({ rem: { remId: 'rem-1' } });
    await expect(
      agent.execute('card_read', { operation: 'get_type', cardId: 'card-1' })
    ).resolves.toEqual({ type: 'forward' });
  });

  it('creates Markdown trees and moves Rems in one SDK call', async () => {
    const createdRem = createRem();
    const createTreeWithMarkdown = vi.fn().mockResolvedValue([createdRem]);
    const moveRems = vi.fn().mockResolvedValue(undefined);
    const agent = new SdkAgent({ rem: { createTreeWithMarkdown, moveRems } } as never);

    await expect(
      agent.execute('rem_write', {
        operation: 'create_tree_markdown',
        markdown: '- Parent\n  - Child',
        parentRemId: 'parent-1',
      })
    ).resolves.toMatchObject({ rems: [{ remId: 'rem-1' }] });
    await expect(
      agent.execute('rem_write', {
        operation: 'move_many',
        remIds: ['rem-1', 'rem-2'],
        targetRemId: 'parent-2',
        position: 0,
        portalId: 'portal-1',
      })
    ).resolves.toEqual({ applied: true, remIds: ['rem-1', 'rem-2'] });
    expect(createTreeWithMarkdown).toHaveBeenCalledWith('- Parent\n  - Child', 'parent-1');
    expect(moveRems).toHaveBeenCalledWith(['rem-1', 'rem-2'], 'parent-2', 0, 'portal-1');
  });

  it('applies advanced Rem formatting, powerup, property, and table controls', async () => {
    const rem = {
      ...createRem(),
      addPowerup: vi.fn().mockResolvedValue(undefined),
      setPowerupProperty: vi.fn().mockResolvedValue(undefined),
      setTagPropertyValue: vi.fn().mockResolvedValue(undefined),
      setTableFilter: vi.fn().mockResolvedValue(undefined),
    };
    const parseAndInsertHtml = vi.fn().mockResolvedValue(undefined);
    const agent = new SdkAgent({
      rem: { findOne: vi.fn().mockResolvedValue(rem) },
      richText: { parseAndInsertHtml },
    } as never);

    await agent.execute('rem_write', {
      operation: 'insert_html',
      remId: 'rem-1',
      html: '<strong>Important</strong>',
    });
    await agent.execute('rem_write', {
      operation: 'add_powerup',
      remId: 'rem-1',
      powerupCode: 'agent_powerup',
    });
    await agent.execute('rem_write', {
      operation: 'set_powerup_property',
      remId: 'rem-1',
      powerupCode: 'agent_powerup',
      powerupSlot: 'status',
      richText: 'Ready',
    });
    await agent.execute('rem_write', {
      operation: 'set_tag_property_value',
      remId: 'rem-1',
      propertyId: 'property-1',
      richText: 'High',
    });
    await agent.execute('rem_write', {
      operation: 'set_table_filter',
      remId: 'rem-1',
      filter: { type: 'group', children: [] },
    });

    expect(parseAndInsertHtml).toHaveBeenCalledWith('<strong>Important</strong>', rem);
    expect(rem.addPowerup).toHaveBeenCalledWith('agent_powerup');
    expect(rem.setPowerupProperty).toHaveBeenCalledWith('agent_powerup', 'status', 'Ready');
    expect(rem.setTagPropertyValue).toHaveBeenCalledWith('property-1', 'High');
    expect(rem.setTableFilter).toHaveBeenCalledWith({ type: 'group', children: [] });
  });

  it('reads focused Rem context and powerup identities without UI automation', async () => {
    const rem = createRem();
    const getFocusedRem = vi.fn().mockResolvedValue(rem);
    const getPowerupByCode = vi.fn().mockResolvedValue(rem);
    const agent = new SdkAgent({
      focus: { getFocusedRem },
      powerup: { getPowerupByCode },
    } as never);

    await expect(
      agent.execute('window_read', { operation: 'get_focused_rem' })
    ).resolves.toMatchObject({ rem: { remId: 'rem-1' } });
    await expect(
      agent.execute('rem_read', { operation: 'get_powerup', powerupCode: 'agent_powerup' })
    ).resolves.toMatchObject({ rem: { remId: 'rem-1' } });
  });

  it('builds and converts official RemNote rich text as read-only transformations', async () => {
    const value = vi.fn().mockResolvedValue([{ text: 'diagram' }]);
    const image = vi.fn().mockReturnValue({ value });
    const toMarkdown = vi.fn().mockResolvedValue('**Important**');
    const agent = new SdkAgent({ richText: { image, toMarkdown } } as never);

    await expect(
      agent.execute('rich_text_read', {
        operation: 'image',
        url: 'https://example.com/diagram.png',
        width: 640,
        height: 480,
      })
    ).resolves.toEqual({ richText: [{ text: 'diagram' }] });
    await expect(
      agent.execute('rich_text_read', { operation: 'to_markdown', richText: 'Important' })
    ).resolves.toEqual({ markdown: '**Important**' });
    expect(image).toHaveBeenCalledWith('https://example.com/diagram.png', 640, 480);
    expect(toMarkdown).toHaveBeenCalledWith('Important');
  });
});

function createRem() {
  return {
    _id: 'rem-1',
    remove: vi.fn().mockResolvedValue(undefined),
    isDocument: vi.fn().mockResolvedValue(true),
    isListItem: vi.fn().mockResolvedValue(false),
    isCardItem: vi.fn().mockResolvedValue(true),
    isQuote: vi.fn().mockResolvedValue(false),
    isCode: vi.fn().mockResolvedValue(false),
    isTodo: vi.fn().mockResolvedValue(true),
    getTodoStatus: vi.fn().mockResolvedValue('Unfinished'),
    getFontSize: vi.fn().mockResolvedValue('H2'),
    getHighlightColor: vi.fn().mockResolvedValue('Yellow'),
    isFolder: vi.fn().mockResolvedValue(false),
    getEnablePractice: vi.fn().mockResolvedValue(true),
    getPracticeDirection: vi.fn().mockResolvedValue('forward'),
  };
}
