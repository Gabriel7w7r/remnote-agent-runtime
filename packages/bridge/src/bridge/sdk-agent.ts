import {
  MoveUnit,
  QueueInteractionScore,
  SetRemType,
  type Card,
  type PluginRem,
  type ReactRNPlugin,
  type RemIdWindowTree,
  type RichTextFormatName,
  type RichTextInterface,
  type SearchPortalQuery,
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
  'rich_text_read',
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
      case 'rich_text_read':
        return await this.richTextRead(payload);
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
      case 'get_focused_rem':
        return { rem: serializeRem(await this.plugin.focus.getFocusedRem()) };
      case 'get_focused_portal':
        return { rem: serializeRem(await this.plugin.focus.getFocusedPortal()) };
      default:
        throw new Error('Unsupported window read operation');
    }
  }

  private async windowWrite(payload: Record<string, unknown>): Promise<unknown> {
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
      case 'open_agent_sidebar':
        return {
          applied: true,
          paneRemIds: await this.plugin.window.openWidgetInRightSidebar('mcp_bridge'),
        };
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
    if (operation === 'get_rem') {
      const card = await this.requireCard(requiredString(payload, 'cardId'));
      return { rem: serializeRem(await card.getRem()) };
    }
    if (operation === 'get_type') {
      const card = await this.requireCard(requiredString(payload, 'cardId'));
      return { type: await card.getType() };
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
    const operation = requiredString(payload, 'operation');
    const limit = optionalLimit(payload, 100, 1000);
    if (operation === 'find_by_name') {
      return {
        rem: serializeRem(
          await this.plugin.rem.findByName(
            requiredRichText(payload, 'richText'),
            requiredNullableString(payload, 'parentRemId')
          )
        ),
      };
    }
    if (operation === 'find_many') {
      return serializeRemList(
        (await this.plugin.rem.findMany(requiredStringArray(payload, 'remIds'))) ?? [],
        limit
      );
    }
    if (operation === 'get_all') {
      return serializeRemList(await this.plugin.rem.getAll(), limit);
    }
    if (operation === 'get_powerup') {
      return {
        rem: serializeRem(
          await this.plugin.powerup.getPowerupByCode(requiredString(payload, 'powerupCode'))
        ),
      };
    }
    if (operation === 'get_powerup_slot') {
      return {
        rem: serializeRem(
          await this.plugin.powerup.getPowerupSlotByCode(
            requiredString(payload, 'powerupCode'),
            requiredString(payload, 'powerupSlot')
          )
        ),
      };
    }

    const rem = await this.requireRem(requiredString(payload, 'remId'));
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
      case 'deep_referenced':
        return serializeRemList(await rem.deepRemsBeingReferenced(), limit);
      case 'sources':
        return serializeRemList(await rem.getSources(), limit);
      case 'siblings':
        return serializeRemList(await rem.siblingRem(), limit);
      case 'visible_siblings':
        return serializeRemList(
          await rem.visibleSiblingRem(optionalString(payload, 'portalId')),
          limit
        );
      case 'ancestor_tags':
        return serializeRemList(await rem.ancestorTagRem(), limit);
      case 'descendant_tags':
        return serializeRemList(await rem.descendantTagRem(), limit);
      case 'locations':
        return serializeRemList(await rem.portalsAndDocumentsIn(), limit);
      case 'portal_contents':
        return serializeRemList(await rem.getPortalDirectlyIncludedRem(), limit);
      case 'all_in_context':
        return serializeRemList(await rem.allRemInDocumentOrPortal(), limit);
      case 'folder_queue':
        return serializeRemList(await rem.allRemInFolderQueue(), limit);
      case 'cards':
        return { cards: (await rem.getCards()).slice(0, limit).map(serializeCard) };
      case 'has_powerup':
        return { hasPowerup: await rem.hasPowerup(requiredString(payload, 'powerupCode')) };
      case 'hidden_state':
        return {
          hiddenState: await rem.getHiddenExplicitlyIncludedState(
            optionalString(payload, 'portalId')
          ),
        };
      case 'slot_state':
        return { isSlot: await rem.isSlot() };
      case 'powerup_property': {
        const powerupCode = requiredString(payload, 'powerupCode');
        const powerupSlot = requiredString(payload, 'powerupSlot');
        const [value, richText, propertyRem] = await Promise.all([
          rem.getPowerupProperty(powerupCode, powerupSlot),
          rem.getPowerupPropertyAsRichText(powerupCode, powerupSlot),
          rem.getPowerupPropertyAsRem(powerupCode, powerupSlot),
        ]);
        return { value, richText, propertyRem: serializeRem(propertyRem) };
      }
      case 'tag_property': {
        const propertyId = requiredString(payload, 'propertyId');
        const [value, propertyRem] = await Promise.all([
          rem.getTagPropertyValue(propertyId),
          rem.getTagPropertyAsRem(propertyId),
        ]);
        return { value, propertyRem: serializeRem(propertyRem) };
      }
      case 'metadata': {
        const portalId = optionalString(payload, 'portalId');
        const [
          isTable,
          siblingPosition,
          visibleSiblingPosition,
          lastPracticed,
          lastMovedAt,
          schemaVersion,
          embeddedQueueViewMode,
          timesSelectedInSearch,
          portalType,
          remType,
          isPowerup,
          isPowerupEnum,
          isPowerupPropertyListItem,
          isPowerupSlot,
          isProperty,
          propertyType,
          isCollapsed,
        ] = await Promise.all([
          rem.isTable(),
          rem.positionAmongstSiblings(portalId),
          rem.positionAmongstVisibleSiblings(portalId),
          rem.getLastPracticed(),
          rem.getLastTimeMovedTo(),
          rem.getSchemaVersion(),
          rem.embeddedQueueViewMode(),
          rem.timesSelectedInSearch(),
          rem.getPortalType(),
          rem.getType(),
          rem.isPowerup(),
          rem.isPowerupEnum(),
          rem.isPowerupPropertyListItem(),
          rem.isPowerupSlot(),
          rem.isProperty(),
          rem.getPropertyType(),
          portalId ? rem.isCollapsed(portalId) : Promise.resolve(undefined),
        ]);
        return {
          isTable,
          siblingPosition,
          visibleSiblingPosition,
          lastPracticed,
          lastMovedAt,
          schemaVersion,
          embeddedQueueViewMode,
          timesSelectedInSearch,
          portalType,
          remType,
          isPowerup,
          isPowerupEnum,
          isPowerupPropertyListItem,
          isPowerupSlot,
          isProperty,
          propertyType,
          isCollapsed,
        };
      }
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
    if (operation === 'create_single_markdown') {
      return {
        rem: serializeRem(
          await this.plugin.rem.createSingleRemWithMarkdown(
            requiredString(payload, 'markdown'),
            optionalString(payload, 'parentRemId')
          )
        ),
      };
    }
    if (operation === 'create_tree_markdown') {
      return {
        rems: (
          await this.plugin.rem.createTreeWithMarkdown(
            requiredString(payload, 'markdown'),
            optionalString(payload, 'parentRemId')
          )
        ).map(serializeRem),
      };
    }
    if (operation === 'move_many') {
      await this.plugin.rem.moveRems(
        requiredStringArray(payload, 'remIds'),
        requiredString(payload, 'targetRemId'),
        requiredInteger(payload, 'position'),
        optionalString(payload, 'portalId')
      );
      return { applied: true, remIds: requiredStringArray(payload, 'remIds') };
    }
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
      case 'insert_html':
        await this.plugin.richText.parseAndInsertHtml(requiredString(payload, 'html'), rem);
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
      case 'set_tag_property_value':
        await rem.setTagPropertyValue(
          requiredString(payload, 'propertyId'),
          optionalRichText(payload, 'richText')
        );
        break;
      case 'add_powerup':
        await rem.addPowerup(requiredString(payload, 'powerupCode'));
        break;
      case 'remove_powerup':
        await rem.removePowerup(requiredString(payload, 'powerupCode'));
        break;
      case 'set_powerup_property':
        await rem.setPowerupProperty(
          requiredString(payload, 'powerupCode'),
          requiredString(payload, 'powerupSlot'),
          requiredRichText(payload, 'richText')
        );
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
      case 'set_collapsed':
        await rem.setIsCollapsed(
          requiredBoolean(payload, 'value'),
          requiredString(payload, 'portalId')
        );
        break;
      case 'set_hidden_state':
        await rem.setHiddenExplicitlyIncludedState(
          requiredEnum(payload, 'value', ['hidden', 'included', 'none']),
          optionalString(payload, 'portalId')
        );
        break;
      case 'set_slot':
        await rem.setIsSlot(requiredBoolean(payload, 'value'));
        break;
      case 'set_table_filter':
        await rem.setTableFilter(requiredObject(payload, 'filter') as unknown as SearchPortalQuery);
        break;
      case 'copy_reference':
        await rem.copyReferenceToClipboard();
        break;
      case 'copy_portal_reference':
        await rem.copyPortalReferenceToClipboard();
        break;
      case 'copy_tag_reference':
        await rem.copyTagReferenceToClipboard();
        break;
      case 'scroll_to_reader_highlight':
        await rem.scrollToReaderHighlight();
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

  private async richTextRead(payload: Record<string, unknown>): Promise<unknown> {
    const operation = requiredString(payload, 'operation');
    const richText = () => requiredRichText(payload, 'richText');
    const format = () => requiredString(payload, 'format') as RichTextFormatName;
    switch (operation) {
      case 'text':
        return {
          richText: await this.plugin.richText
            .text(requiredString(payload, 'text'), optionalStringArray(payload, 'formats') as never)
            .value(),
        };
      case 'code':
        return {
          richText: await this.plugin.richText
            .code(requiredString(payload, 'text'), requiredString(payload, 'language'))
            .value(),
        };
      case 'image':
        return {
          richText: await this.plugin.richText
            .image(
              requiredString(payload, 'url'),
              optionalInteger(payload, 'width'),
              optionalInteger(payload, 'height')
            )
            .value(),
        };
      case 'audio':
        return {
          richText: await this.plugin.richText.audio(requiredString(payload, 'url')).value(),
        };
      case 'video':
        return {
          richText: await this.plugin.richText.video(requiredString(payload, 'url')).value(),
        };
      case 'latex':
        return {
          richText: await this.plugin.richText
            .latex(requiredString(payload, 'text'), optionalBoolean(payload, 'block'))
            .value(),
        };
      case 'newline':
        return { richText: await this.plugin.richText.newline().value() };
      case 'rem_reference':
        return {
          richText: await this.plugin.richText.rem(requiredString(payload, 'remId')).value(),
        };
      case 'normalize':
        return { richText: await this.plugin.richText.normalize(richText()) };
      case 'to_html':
        return { html: await this.plugin.richText.toHTML(richText()) };
      case 'to_markdown':
        return { markdown: await this.plugin.richText.toMarkdown(richText()) };
      case 'to_string':
        return { text: await this.plugin.richText.toString(richText()) };
      case 'length':
        return { length: await this.plugin.richText.length(richText()) };
      case 'empty':
        return {
          empty: await this.plugin.richText.empty(
            richText(),
            optionalBoolean(payload, 'allowSpaces')
          ),
        };
      case 'trim':
        return { richText: await this.plugin.richText.trim(richText()) };
      case 'trim_start':
        return { richText: await this.plugin.richText.trimStart(richText()) };
      case 'trim_end':
        return { richText: await this.plugin.richText.trimEnd(richText()) };
      case 'rem_ids':
        return { remIds: await this.plugin.richText.getRemIdsFromRichText(richText()) };
      case 'rem_and_alias_ids':
        return { remIds: await this.plugin.richText.getRemAndAliasIdsFromRichText(richText()) };
      case 'deep_rem_ids':
        return { remIds: await this.plugin.richText.deepGetRemIdsFromRichText(richText()) };
      case 'deep_rem_and_alias_ids':
        return {
          remIds: await this.plugin.richText.deepGetRemAndAliasIdsFromRichText(richText()),
        };
      case 'external_urls':
        return { urls: await this.plugin.richText.findAllExternalURLs(richText()) };
      case 'equals':
        return {
          equal: await this.plugin.richText.equals(
            richText(),
            requiredRichText(payload, 'richText2')
          ),
        };
      case 'substring':
        return {
          richText: await this.plugin.richText.substring(
            richText(),
            requiredInteger(payload, 'start'),
            optionalInteger(payload, 'end')
          ),
        };
      case 'char_at':
        return {
          character: await this.plugin.richText.charAt(
            richText(),
            requiredInteger(payload, 'index')
          ),
        };
      case 'index_of':
        return {
          index: await this.plugin.richText.indexOf(
            richText(),
            requiredString(payload, 'character'),
            optionalInteger(payload, 'startChar')
          ),
        };
      case 'index_of_element':
        return {
          index: await this.plugin.richText.indexOfElementAt(
            richText(),
            requiredInteger(payload, 'position')
          ),
        };
      case 'split':
        return {
          richText: await this.plugin.richText.split(
            richText(),
            requiredString(payload, 'separationCharacter')
          ),
        };
      case 'split_rich_text':
        return {
          richText: await this.plugin.richText.splitRichText(
            richText(),
            requiredRichText(payload, 'richText2')
          ),
        };
      case 'replace_all':
        return {
          richText: await this.plugin.richText.replaceAllRichText(
            richText(),
            requiredRichText(payload, 'findRichText'),
            requiredRichText(payload, 'replacementRichText')
          ),
        };
      case 'apply_format':
        return {
          richText: await this.plugin.richText.applyTextFormatToRange(
            richText(),
            requiredInteger(payload, 'start'),
            requiredInteger(payload, 'end'),
            format()
          ),
        };
      case 'remove_format':
        return {
          richText: await this.plugin.richText.removeTextFormatFromRange(
            richText(),
            requiredInteger(payload, 'start'),
            requiredInteger(payload, 'end'),
            format()
          ),
        };
      case 'toggle_format':
        return {
          richText: await this.plugin.richText.toggleTextFormatOnRange(
            richText(),
            requiredInteger(payload, 'start'),
            requiredInteger(payload, 'end'),
            format()
          ),
        };
      default:
        throw new Error(`Unsupported rich-text operation: ${operation}`);
    }
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
function optionalStringArray(payload: Record<string, unknown>, key: string): string[] | undefined {
  const value = payload[key];
  if (value === undefined) return undefined;
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
function requiredObjectOrString(payload: Record<string, unknown>, key: string): RemIdWindowTree {
  const value = payload[key];
  if (typeof value !== 'string' && (typeof value !== 'object' || value === null))
    throw new Error(`${key} must be a window tree`);
  return value as RemIdWindowTree;
}
function requiredObject(payload: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = payload[key];
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error(`${key} must be an object`);
  return value as Record<string, unknown>;
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
