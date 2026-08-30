import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';

// Grouped tools inherit their riskiest operation. Content writes may affect
// shared/published RemNote documents; the runtime cannot prove they are private.
const effects: Record<string, { destructive: boolean; openWorld: boolean }> = {
  remnote_create_note: { destructive: false, openWorld: true },
  remnote_search: { destructive: false, openWorld: false },
  remnote_search_by_tag: { destructive: false, openWorld: false },
  remnote_read_note: { destructive: false, openWorld: false },
  remnote_get_media: { destructive: false, openWorld: false },
  remnote_list_children: { destructive: false, openWorld: false },
  remnote_update_note: { destructive: true, openWorld: true },
  remnote_set_document_status: { destructive: true, openWorld: true },
  remnote_move_note: { destructive: true, openWorld: true },
  remnote_insert_children: { destructive: false, openWorld: true },
  remnote_replace_children: { destructive: true, openWorld: true },
  remnote_update_tags: { destructive: true, openWorld: true },
  remnote_set_property: { destructive: true, openWorld: true },
  remnote_append_journal: { destructive: false, openWorld: true },
  remnote_get_playbook: { destructive: false, openWorld: false },
  remnote_status: { destructive: false, openWorld: false },
  remnote_pairing_status: { destructive: false, openWorld: false },
  remnote_reset_pairing: { destructive: true, openWorld: false },
  remnote_capabilities: { destructive: false, openWorld: false },
  remnote_editor: { destructive: true, openWorld: true },
  remnote_window: { destructive: true, openWorld: true },
  remnote_queue: { destructive: true, openWorld: false },
  remnote_card: { destructive: true, openWorld: true },
  remnote_rem: { destructive: true, openWorld: true },
  remnote_rich_text: { destructive: false, openWorld: false },
  remnote_knowledge_base: { destructive: false, openWorld: false },
  remnote_daily_document: { destructive: false, openWorld: true },
  remnote_reader: { destructive: false, openWorld: true },
  remnote_audit_log: { destructive: false, openWorld: false },
  remnote_read_table: { destructive: false, openWorld: false },
};

export function getToolAnnotations(name: string): ToolAnnotations {
  const effect = effects[name];
  if (!effect) throw new Error(`Missing safety annotations for tool: ${name}`);
  return {
    // Even KB reads can persist audit/diagnostic metadata. Read scopes still
    // prevent KB mutations; this hint conservatively includes local log writes.
    readOnlyHint: false,
    destructiveHint: effect.destructive,
    openWorldHint: effect.openWorld,
  };
}
