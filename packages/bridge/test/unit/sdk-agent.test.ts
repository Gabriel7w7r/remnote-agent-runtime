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
