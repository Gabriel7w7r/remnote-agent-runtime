import {
  MoveUnit,
  QueueInteractionScore,
  SetRemType,
  type Card,
  type PluginRem,
  type ReactRNPlugin,
  type RichTextInterface,
} from '@remnote/plugin-sdk';

export const SDK_AGENT_ACTIONS = [
  'editor_read',
  'editor_write',
  'editor_delete',
  'window_read',
  'window_write',
  'queue_read',
  'queue_write',
  'card_read',
  'card_write',
  'card_delete',
  'rem_read',
  'rem_write',
  'rem_delete',
  'kb_read',
  'daily_document_write',
  'reader_write',
] as const;

export type SdkAgentAction = (typeof SDK_AGENT_ACTIONS)[number];

export function isSdkAgentAction(action: string): action is SdkAgentAction {
  return SDK_AGENT_ACTIONS.includes(action as SdkAgentAction);
}

export class SdkAgent {
  constructor(private readonly plugin: ReactRNPlugin) {}

  async execute(action: SdkAgentAction, payload: Record<string, unknown>): Promise<unknown> {
    switch (action) {
      case 'editor_read':
        return await this.editorRead(payload);
      case 'editor_write':
        return await this.editorWrite(payload);
      case 'editor_delete':
        return await this.editorDelete(payload);
      case 'window_read':
        return await this.windowRead(payload);
      case 'window_write':
        return await this.windowWrite(payload);
      case 'queue_read':
        return await this.queueRead(payload);
      case 'queue_write':
        return await this.queueWrite(payload);
      case 'card_read':
        return await this.cardRead(payload);
      case 'card_write':
        return await this.cardWrite(payload);
      case 'card_delete':
        return await this.cardDelete(payload);
      case 'rem_read':
        return await this.remRead(payload);
      case 'rem_write':
        return await this.remWrite(payload);
      case 'rem_delete':
        return await this.remDelete(payload);
      case 'kb_read':
        return await this.kbRead(payload);
      case 'daily_document_write':
        return await this.dailyDocument(payload);
      case 'reader_write':
        return await this.readerWrite(payload);
    }
  }

  private async editorRead(payload: Record<string, unknown>): Promise<unknown> {
    switch (requiredString(payload, 'operation')) {
      case 'get_focused_text':
        return { richText: await this.plugin.editor.getFocusedEditorText() };
      case 'get_selection':
        return { selection: await this.plugin.editor.getSelection() };
      case 'get_selected_rem':
        return { selection: await this.plugin.editor.getSelectedRem() };
      case 'get_selected_text':
        return { selection: await this.plugin.editor.getSelectedText() };
      case 'get_caret_position': {
        const rect = await this.plugin.editor.getCaretPosition();
        return {
          caret: rect
            ? {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
                top: rect.top,
                right: rect.right,
                bottom: rect.bottom,
                left: rect.left,
              }
            : undefined,
        };
      }
      case 'copy':
        return { selectionType: await this.plugin.editor.copy() };
      default:
        throw new Error('Unsupported editor read operation');
    }
  }

  private async editorWrite(payload: Record<string, unknown>): Promise<{ applied: true }> {
    const operation = requiredString(payload, 'operation');
    switch (operation) {
      case 'set_text':
        await this.plugin.editor.setText(requiredRichText(payload, 'richText'));
        break;
      case 'insert_plain_text':
        await this.plugin.editor.insertPlainText(requiredString(payload, 'text'));
        break;
      case 'insert_markdown':
        await this.plugin.editor.insertMarkdown(requiredString(payload, 'markdown'));
        break;
      case 'insert_rich_text':
        await this.plugin.editor.insertRichText(requiredRichText(payload, 'richText'));
        break;
      case 'select_rem':
        await this.plugin.editor.selectRem(
          requiredStringArray(payload, 'remIds'),
          optionalString(payload, 'portalId')
        );
        break;
      case 'select_text':
        await this.plugin.editor.selectText({
          start: requiredInteger(payload, 'start'),
          end: requiredInteger(payload, 'end'),
        });
        break;
      case 'collapse_selection':
        await this.plugin.editor.collapseSelection(requiredEnum(payload, 'to', ['start', 'end']));
        break;
      case 'undo':
        await this.plugin.editor.undo();
        break;
      case 'redo':
        await this.plugin.editor.redo();
        break;
      case 'move_caret':
        await this.plugin.editor.moveCaret(
          requiredInteger(payload, 'amount'),
          MOVE_UNITS[requiredEnum(payload, 'unit', Object.keys(MOVE_UNITS))]
        );
        break;
      case 'move_caret_vertical':
        await this.plugin.editor.moveCaretVertical(requiredDirection(payload));
        break;
      default:
        throw new Error(`Unsupported editor write operation: ${operation}`);
    }
    return { applied: true };
  }

  private async editorDelete(payload: Record<string, unknown>): Promise<unknown> {
    const operation = requiredString(payload, 'operation');
    switch (operation) {
      case 'cut':
        return { selectionType: await this.plugin.editor.cut() };
      case 'delete_selection':
        await this.plugin.editor.delete();
        return { applied: true };
      case 'delete_characters':
        await this.plugin.editor.deleteCharacters(
          requiredPositiveInteger(payload, 'characters'),
          requiredDirection(payload)
        );
        return { applied: true };
      default:
        throw new Error(`Unsupported editor delete operation: ${operation}`);
    }
  }

  private async windowRead(payload: Record<string, unknown>): Promise<unknown> {
    switch (requiredString(payload, 'operation')) {
      case 'get_tree':
        return { tree: await this.plugin.window.getCurrentWindowTree() };
      case 'get_last_focused_pane':
        return { paneId: await this.plugin.window.getLastFocusedPane() };
      case 'get_open_pane_ids':
        return { paneIds: await this.plugin.window.getOpenPaneIds() };
      case 'get_focused_pane_id':
        return { paneId: await this.plugin.window.getFocusedPaneId() };
      case 'get_url':
        return { url: await this.plugin.window.getURL() };
      case 'get_open_pane_rem_ids':
        return { remIds: await this.plugin.window.getOpenPaneRemIds() };
      case 'get_open_pane_rem_id':
        return {
          remId: await this.plugin.window.getOpenPaneRemId(optionalString(payload, 'paneId')),
        };
      default:
        throw new Error('Unsupported window read operation');
    }
  }

  private async windowWrite(payload: Record<string, unknown>): Promise<{ applied: true }> {
    const operation = requiredString(payload, 'operation');
    switch (operation) {
      case 'set_tree':
        await this.plugin.window.setRemWindowTree(requiredObjectOrString(payload, 'tree'));
        break;
      case 'set_tree_string':
        await this.plugin.window.setCurrentWindowTreeFromString(
          requiredString(payload, 'treeString')
        );
        break;
      case 'focus_pane':
        await this.plugin.window.setFocusedPaneId(requiredString(payload, 'paneId'));
        break;
      case 'set_url':
        await this.plugin.window.setURL(requiredString(payload, 'url'));
        break;
      case 'open_rem':
        await this.plugin.window.openRem(await this.requireRem(requiredString(payload, 'remId')));
        break;
      default:
        throw new Error(`Unsupported window write operation: ${operation}`);
    }
    return { applied: true };
  }

  private async queueRead(payload: Record<string, unknown>): Promise<unknown> {
    const operation = requiredString(payload, 'operation');
    if (operation === 'current_card') {
      return { card: serializeCard(await this.plugin.queue.getCurrentCard()) };
    }
    if (operation !== 'status') {
      throw new Error(`Unsupported queue read operation: ${operation}`);
    }
    const [
      averageTimePerCard,
      screenType,
      answerRevealed,
      typeAnswerEnabled,
      remaining,
      streak,
      lookback,
    ] = await Promise.all([
      this.plugin.queue.getAverageTimePerCard(),
      this.plugin.queue.getCurrentQueueScreenType(),
      this.plugin.queue.hasRevealedAnswer(),
      this.plugin.queue.isTypeAnswerEnabled(),
      this.plugin.queue.getNumRemainingCards(),
      this.plugin.queue.getCurrentStreak(),
      this.plugin.queue.inLookbackMode(),
    ]);
    return {
      averageTimePerCard,
      screenType,
      answerRevealed,
      typeAnswerEnabled,
      remaining,
      streak,
      lookback,
    };
  }

  private async queueWrite(payload: Record<string, unknown>): Promise<{ applied: true }> {
    const operation = requiredString(payload, 'operation');
    switch (operation) {
      case 'show_answer':
        await this.plugin.queue.showAnswer();
        break;
      case 'rate':
        await this.plugin.queue.rateCurrentCard(
          QUEUE_SCORES[requiredEnum(payload, 'score', Object.keys(QUEUE_SCORES))]
        );
        break;
      case 'previous':
        await this.plugin.queue.goBackToPreviousCard();
        break;
      case 'remove_current':
        await this.plugin.queue.removeCurrentCardFromQueue(
          optionalBoolean(payload, 'addToBackStack')
        );
        break;
      default:
        throw new Error(`Unsupported queue write operation: ${operation}`);
    }
    return { applied: true };
  }

  private async cardRead(payload: Record<string, unknown>): Promise<unknown> {
    const operation = requiredString(payload, 'operation');
    if (operation === 'get') {
      return {
        card: serializeCard(await this.plugin.card.findOne(requiredString(payload, 'cardId'))),
      };
    }
    if (operation === 'find_many') {
      return {
        cards: (await this.plugin.card.findMany(requiredStringArray(payload, 'cardIds'))).map(
          serializeCard
        ),
      };
    }
    if (operation === 'get_all') {
      const limit = optionalLimit(payload, 100, 1000);
      const cards = await this.plugin.card.getAll();
      return {
        cards: cards.slice(0, limit).map(serializeCard),
        total: cards.length,
        truncated: cards.length > limit,
      };
    }
    throw new Error(`Unsupported card read operation: ${operation}`);
  }

  private async cardWrite(payload: Record<string, unknown>): Promise<{ applied: true }> {
    const card = await this.requireCard(requiredString(payload, 'cardId'));
    await card.updateCardRepetitionStatus(
      QUEUE_SCORES[requiredEnum(payload, 'score', Object.keys(QUEUE_SCORES))]
    );
    return { applied: true };
  }

  private async cardDelete(payload: Record<string, unknown>): Promise<{ removed: true }> {
    const card = await this.requireCard(requiredString(payload, 'cardId'));
    await card.remove();
    return { removed: true };
  }

  private async remRead(payload: Record<string, unknown>): Promise<unknown> {
    const rem = await this.requireRem(requiredString(payload, 'remId'));
    const operation = requiredString(payload, 'operation');
    const limit = optionalLimit(payload, 100, 1000);
    switch (operation) {
      case 'get':
        return { rem: serializeRem(rem) };
      case 'children':
        return serializeRemList(await rem.getChildrenRem(), limit);
      case 'tags':
        return serializeRemList(await rem.getTagRems(), limit);
      case 'aliases':
        return serializeRemList(await rem.getAliases(), limit);
      case 'parent':
        return { rem: serializeRem(await rem.getParentRem()) };
      case 'descendants':
        return serializeRemList(await rem.getDescendants(), limit);
      case 'referencing':
        return serializeRemList(await rem.remsReferencingThis(), limit);
      case 'referenced':
        return serializeRemList(await rem.remsBeingReferenced(), limit);
      case 'sources':
        return serializeRemList(await rem.getSources(), limit);
      case 'cards':
        return { cards: (await rem.getCards()).slice(0, limit).map(serializeCard) };
      case 'state': {
        const [
          isDocument,
          isListItem,
          isCardItem,
          isQuote,
          isCode,
          isTodo,
          todoStatus,
          fontSize,
          highlightColor,
          isFolder,
          enablePractice,
          practiceDirection,
        ] = await Promise.all([
          rem.isDocument(),
          rem.isListItem(),
          rem.isCardItem(),
          rem.isQuote(),
          rem.isCode(),
          rem.isTodo(),
          rem.getTodoStatus(),
          rem.getFontSize(),
          rem.getHighlightColor(),
          rem.isFolder(),
          rem.getEnablePractice(),
          rem.getPracticeDirection(),
        ]);
        return {
          isDocument,
          isListItem,
          isCardItem,
          isQuote,
          isCode,
          isTodo,
          todoStatus,
          fontSize,
          highlightColor,
          isFolder,
          enablePractice,
          practiceDirection,
        };
      }
      default:
        throw new Error(`Unsupported Rem read operation: ${operation}`);
    }
  }

  private async remWrite(payload: Record<string, unknown>): Promise<unknown> {
    const operation = requiredString(payload, 'operation');
    if (operation === 'create_rem') {
      return { rem: serializeRem(await this.plugin.rem.createRem()) };
    }
    if (operation === 'create_portal') {
      return { rem: serializeRem(await this.plugin.rem.createPortal()) };
    }
    if (operation === 'create_link') {
      return {
        rem: serializeRem(
          await this.plugin.rem.createLinkRem(
            requiredString(payload, 'url'),
            optionalBoolean(payload, 'addTitle')
          )
        ),
      };
    }
    if (operation === 'create_table') {
      return {
        rem: serializeRem(await this.plugin.rem.createTable(optionalString(payload, 'tagRemId'))),
      };
    }

    const rem = await this.requireRem(requiredString(payload, 'remId'));
    switch (operation) {
      case 'set_text':
        await rem.setText(requiredRichText(payload, 'richText'));
        break;
      case 'set_back_text':
        await rem.setBackText(optionalRichText(payload, 'richText'));
        break;
      case 'add_tag':
        await rem.addTag(requiredString(payload, 'targetRemId'));
        break;
      case 'remove_tag':
        await rem.removeTag(
          requiredString(payload, 'targetRemId'),
          optionalBoolean(payload, 'removeProperties')
        );
        break;
      case 'add_to_portal':
        await rem.addToPortal(requiredString(payload, 'targetRemId'));
        break;
      case 'remove_from_portal':
        await rem.removeFromPortal(requiredString(payload, 'targetRemId'));
        break;
      case 'set_parent':
        await rem.setParent(
          requiredNullableString(payload, 'targetRemId'),
          optionalInteger(payload, 'position')
        );
        break;
      case 'create_alias':
        return {
          rem: serializeRem(
            await rem.getOrCreateAliasWithText(requiredRichText(payload, 'richText'))
          ),
        };
      case 'indent':
        await rem.indent(optionalString(payload, 'portalId'));
        break;
      case 'outdent':
        await rem.outdent(optionalString(payload, 'portalId'));
        break;
      case 'set_type':
        await rem.setType(REM_TYPES[requiredEnum(payload, 'value', Object.keys(REM_TYPES))]);
        break;
      case 'add_source':
        await rem.addSource(requiredString(payload, 'targetRemId'));
        break;
      case 'remove_source':
        await rem.removeSource(requiredString(payload, 'targetRemId'));
        break;
      case 'set_document':
        await rem.setIsDocument(requiredBoolean(payload, 'value'));
        break;
      case 'set_list_item':
        await rem.setIsListItem(requiredBoolean(payload, 'value'));
        break;
      case 'set_card_item':
        await rem.setIsCardItem(requiredBoolean(payload, 'value'));
        break;
      case 'set_quote':
        await rem.setIsQuote(requiredBoolean(payload, 'value'));
        break;
      case 'set_code':
        await rem.setIsCode(requiredBoolean(payload, 'value'));
        break;
      case 'set_todo':
        await rem.setIsTodo(requiredBoolean(payload, 'value'));
        break;
      case 'set_todo_status':
        await rem.setTodoStatus(requiredEnum(payload, 'value', ['Finished', 'Unfinished']));
        break;
      case 'set_font_size':
        await rem.setFontSize(optionalEnum(payload, 'value', ['H1', 'H2', 'H3']));
        break;
      case 'set_highlight':
        await rem.setHighlightColor(
          requiredEnum(payload, 'value', ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple'])
        );
        break;
      case 'set_property':
        await rem.setIsProperty(requiredBoolean(payload, 'value'));
        break;
      case 'set_folder':
        await rem.setIsFolder(requiredBoolean(payload, 'value'));
        break;
      case 'set_practice':
        await rem.setEnablePractice(requiredBoolean(payload, 'value'));
        break;
      case 'set_practice_direction':
        await rem.setPracticeDirection(
          requiredEnum(payload, 'value', ['forward', 'backward', 'none', 'both'])
        );
        break;
      case 'open_context':
        await rem.openRemInContext(optionalString(payload, 'portalId'));
        break;
      case 'open_page':
        await rem.openRemAsPage();
        break;
      case 'expand':
        await rem.expand(
          optionalString(payload, 'portalId'),
          optionalBoolean(payload, 'recurse') ?? false
        );
        break;
      case 'collapse':
        await rem.collapse(optionalString(payload, 'portalId'));
        break;
      default:
        throw new Error(`Unsupported Rem write operation: ${operation}`);
    }
    return { applied: true, remId: rem._id };
  }

  private async remDelete(payload: Record<string, unknown>): Promise<{ applied: true }> {
    const rem = await this.requireRem(requiredString(payload, 'remId'));
    const operation = requiredString(payload, 'operation');
    if (operation === 'remove') {
      await rem.remove();
    } else if (operation === 'merge') {
      await rem.merge(requiredString(payload, 'targetRemId'));
    } else if (operation === 'merge_alias') {
      await rem.mergeAndSetAlias(requiredString(payload, 'targetRemId'));
    } else {
      throw new Error(`Unsupported Rem destructive operation: ${operation}`);
    }
    return { applied: true };
  }

  private async kbRead(payload: Record<string, unknown>): Promise<unknown> {
    const operation = requiredString(payload, 'operation');
    if (operation === 'current') {
      return await this.plugin.kb.getCurrentKnowledgeBaseData();
    }
    if (operation === 'is_primary') {
      return { isPrimary: await this.plugin.kb.isPrimaryKnowledgeBase() };
    }
    throw new Error(`Unsupported knowledge-base operation: ${operation}`);
  }

  private async dailyDocument(payload: Record<string, unknown>): Promise<unknown> {
    const operation = requiredString(payload, 'operation');
    const rem =
      operation === 'today'
        ? await this.plugin.date.getTodaysDoc()
        : operation === 'date'
          ? await this.plugin.date.getDailyDoc(requiredDate(payload, 'date'))
          : undefined;
    if (!rem && operation !== 'today' && operation !== 'date') {
      throw new Error(`Unsupported daily document operation: ${operation}`);
    }
    return { rem: serializeRem(rem) };
  }

  private async readerWrite(payload: Record<string, unknown>): Promise<unknown> {
    if (requiredString(payload, 'operation') !== 'add_highlight') {
      throw new Error('Unsupported reader operation');
    }
    return { rem: serializeRem(await this.plugin.reader.addHighlight()) };
  }

  private async requireRem(remId: string): Promise<PluginRem> {
    const rem = await this.plugin.rem.findOne(remId);
    if (!rem) throw new Error(`Rem not found or inaccessible: ${remId}`);
    return rem;
  }

  private async requireCard(cardId: string): Promise<Card> {
    const card = await this.plugin.card.findOne(cardId);
    if (!card) throw new Error(`Card not found: ${cardId}`);
    return card;
  }
}

const MOVE_UNITS: Record<string, MoveUnit> = {
  offset: MoveUnit.OFFSET,
  unit: MoveUnit.UNIT,
  character: MoveUnit.CHARACTER,
  word: MoveUnit.WORD,
  word_start: MoveUnit.WORD_START,
  word_end: MoveUnit.WORD_END,
  line: MoveUnit.LINE,
};
const QUEUE_SCORES: Record<string, QueueInteractionScore> = {
  again: QueueInteractionScore.AGAIN,
  hard: QueueInteractionScore.HARD,
  good: QueueInteractionScore.GOOD,
  easy: QueueInteractionScore.EASY,
};
const REM_TYPES: Record<string, SetRemType> = {
  default: SetRemType.DEFAULT_TYPE,
  concept: SetRemType.CONCEPT,
  descriptor: SetRemType.DESCRIPTOR,
};

function serializeRem(rem: PluginRem | undefined): Record<string, unknown> | undefined {
  return rem
    ? {
        remId: rem._id,
        parentRemId: rem.parent,
        children: rem.children,
        type: rem.type,
        text: rem.text,
        backText: rem.backText,
        createdAt: rem.createdAt,
        updatedAt: rem.updatedAt,
        localUpdatedAt: rem.localUpdatedAt,
      }
    : undefined;
}
function serializeRemList(rems: PluginRem[], limit: number) {
  return {
    rems: rems.slice(0, limit).map(serializeRem),
    total: rems.length,
    truncated: rems.length > limit,
  };
}
function serializeCard(card: Card | undefined): Record<string, unknown> | undefined {
  return card
    ? {
        cardId: card._id,
        remId: card.remId,
        type: card.type,
        createdAt: card.createdAt,
        nextRepetitionTime: card.nextRepetitionTime,
        lastRepetitionTime: card.lastRepetitionTime,
        timesWrongInRow: card.timesWrongInRow,
        repetitionHistory: card.repetitionHistory,
      }
    : undefined;
}
function requiredString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.length === 0)
    throw new Error(`${key} must be a non-empty string`);
  return value;
}
function optionalString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new Error(`${key} must be a string`);
  return value;
}
function optionalNullableString(
  payload: Record<string, unknown>,
  key: string
): string | null | undefined {
  const value = payload[key];
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string') throw new Error(`${key} must be a string or null`);
  return value;
}
function requiredNullableString(payload: Record<string, unknown>, key: string): string | null {
  const value = optionalNullableString(payload, key);
  if (value === undefined) throw new Error(`${key} is required`);
  return value;
}
function requiredBoolean(payload: Record<string, unknown>, key: string): boolean {
  const value = payload[key];
  if (typeof value !== 'boolean') throw new Error(`${key} must be a boolean`);
  return value;
}
function optionalBoolean(payload: Record<string, unknown>, key: string): boolean | undefined {
  const value = payload[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`${key} must be a boolean`);
  return value;
}
function requiredInteger(payload: Record<string, unknown>, key: string): number {
  const value = payload[key];
  if (!Number.isInteger(value)) throw new Error(`${key} must be an integer`);
  return value as number;
}
function optionalInteger(payload: Record<string, unknown>, key: string): number | undefined {
  const value = payload[key];
  return value === undefined ? undefined : requiredInteger(payload, key);
}
function requiredPositiveInteger(payload: Record<string, unknown>, key: string): number {
  const value = requiredInteger(payload, key);
  if (value < 1) throw new Error(`${key} must be positive`);
  return value;
}
function requiredDirection(payload: Record<string, unknown>): -1 | 1 {
  const value = requiredInteger(payload, 'direction');
  if (value !== -1 && value !== 1) throw new Error('direction must be -1 or 1');
  return value;
}
function requiredStringArray(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))
    throw new Error(`${key} must be an array of strings`);
  return value as string[];
}
function requiredRichText(payload: Record<string, unknown>, key: string): RichTextInterface {
  const value = payload[key];
  if (typeof value !== 'string' && !Array.isArray(value))
    throw new Error(`${key} must be a string or rich-text array`);
  return value as RichTextInterface;
}
function optionalRichText(
  payload: Record<string, unknown>,
  key: string
): RichTextInterface | undefined {
  return payload[key] === undefined ? undefined : requiredRichText(payload, key);
}
function requiredObjectOrString(payload: Record<string, unknown>, key: string): any {
  const value = payload[key];
  if (typeof value !== 'string' && (typeof value !== 'object' || value === null))
    throw new Error(`${key} must be a window tree`);
  return value;
}
function requiredEnum<T extends string>(
  payload: Record<string, unknown>,
  key: string,
  values: readonly T[]
): T {
  const value = requiredString(payload, key);
  if (!values.includes(value as T)) throw new Error(`${key} must be one of: ${values.join(', ')}`);
  return value as T;
}
function optionalEnum<T extends string>(
  payload: Record<string, unknown>,
  key: string,
  values: readonly T[]
): T | undefined {
  return payload[key] === undefined || payload[key] === null
    ? undefined
    : requiredEnum(payload, key, values);
}
function optionalLimit(payload: Record<string, unknown>, fallback: number, max: number): number {
  if (payload.limit === undefined) return fallback;
  const value = requiredPositiveInteger(payload, 'limit');
  if (value > max) throw new Error(`limit must be at most ${max}`);
  return value;
}
function requiredDate(payload: Record<string, unknown>, key: string): Date {
  const value = requiredString(payload, key);
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) throw new Error(`${key} must be an ISO date`);
  return date;
}
