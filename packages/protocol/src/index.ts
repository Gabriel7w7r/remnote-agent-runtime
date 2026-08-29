export const REMNOTE_AGENT_PROTOCOL_VERSION = 2 as const;
export const REMNOTE_AGENT_RUNTIME_VERSION = "0.20.0";

export const CAPABILITY_SCOPES = [
  "read",
  "write",
  "destructive",
  "review",
  "editor",
  "window",
  "events",
  "media",
] as const;

export type CapabilityScope = (typeof CAPABILITY_SCOPES)[number];

export type CapabilityRisk = "read" | "write" | "destructive" | "review";

export interface ActionPolicy {
  scope: CapabilityScope;
  risk: CapabilityRisk;
}

export const ACTION_POLICIES = {
  create_note: { scope: "write", risk: "write" },
  append_journal: { scope: "write", risk: "write" },
  search: { scope: "read", risk: "read" },
  get_media_locator: { scope: "media", risk: "read" },
  search_by_tag: { scope: "read", risk: "read" },
  read_note: { scope: "read", risk: "read" },
  list_children: { scope: "read", risk: "read" },
  read_table: { scope: "read", risk: "read" },
  update_note: { scope: "write", risk: "write" },
  set_document_status: { scope: "write", risk: "write" },
  insert_children: { scope: "write", risk: "write" },
  move_note: { scope: "write", risk: "write" },
  replace_children: { scope: "destructive", risk: "destructive" },
  update_tags: { scope: "write", risk: "write" },
  set_property: { scope: "write", risk: "write" },
  get_status: { scope: "read", risk: "read" },
  editor_read: { scope: "editor", risk: "read" },
  editor_write: { scope: "editor", risk: "write" },
  editor_delete: { scope: "destructive", risk: "destructive" },
  window_read: { scope: "window", risk: "read" },
  window_write: { scope: "window", risk: "write" },
  queue_read: { scope: "review", risk: "read" },
  queue_write: { scope: "review", risk: "review" },
  card_read: { scope: "review", risk: "read" },
  card_write: { scope: "review", risk: "review" },
  card_delete: { scope: "destructive", risk: "destructive" },
  rem_read: { scope: "read", risk: "read" },
  rem_write: { scope: "write", risk: "write" },
  rem_delete: { scope: "destructive", risk: "destructive" },
  rich_text_read: { scope: "read", risk: "read" },
  kb_read: { scope: "read", risk: "read" },
  daily_document_write: { scope: "write", risk: "write" },
  reader_write: { scope: "write", risk: "write" },
} as const satisfies Record<string, ActionPolicy>;

export type BridgeAction = keyof typeof ACTION_POLICIES;

export interface BridgeCapability {
  id: string;
  scope: CapabilityScope;
  risk: CapabilityRisk;
  available: boolean;
  reason?: string;
}

export interface ServerChallengeMessage {
  type: "server_challenge";
  protocolVersion: typeof REMNOTE_AGENT_PROTOCOL_VERSION;
  serverVersion: string;
  serverInstanceId: string;
  nonce: string;
  pairingRequired: boolean;
  pairedInstallationId?: string;
}

export interface ClientHelloMessage {
  type: "client_hello";
  protocolVersion: typeof REMNOTE_AGENT_PROTOCOL_VERSION;
  bridgeVersion: string;
  sdkVersion: string;
  installationId: string;
  clientNonce: string;
  capabilities: BridgeCapability[];
  proof?: string;
}

export interface PairingRequiredMessage {
  type: "pairing_required";
  pairingId: string;
}

export interface PairingConfirmMessage {
  type: "pairing_confirm";
  pairingId: string;
  pairingCode: string;
  installationId: string;
  bridgeVersion: string;
  sdkVersion: string;
  capabilities: BridgeCapability[];
}

export interface PairingCompleteMessage {
  type: "pairing_complete";
  secret: string;
  grantedScopes: CapabilityScope[];
}

export interface AuthAcceptedMessage {
  type: "auth_accepted";
  grantedScopes: CapabilityScope[];
  serverVersion: string;
  protocolVersion: typeof REMNOTE_AGENT_PROTOCOL_VERSION;
}

export interface AuthRejectedMessage {
  type: "auth_rejected";
  reason: string;
  resetPairing?: boolean;
}

export interface CompanionInfoMessage {
  type: "companion_info";
  kind: "cli" | "mcp-server";
  version: string;
}

export interface HeartbeatPing {
  type: "ping";
}

export interface HeartbeatPong {
  type: "pong";
}

export interface BridgeRequest {
  id: string;
  operationId: string;
  action: string;
  scope: CapabilityScope;
  payload: Record<string, unknown>;
}

export interface BridgeResponse {
  id: string;
  operationId: string;
  result?: unknown;
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export function getActionPolicy(action: string): ActionPolicy | undefined {
  return ACTION_POLICIES[action as BridgeAction];
}

export type BridgeControlMessage =
  | ServerChallengeMessage
  | ClientHelloMessage
  | PairingRequiredMessage
  | PairingConfirmMessage
  | PairingCompleteMessage
  | AuthAcceptedMessage
  | AuthRejectedMessage
  | CompanionInfoMessage
  | HeartbeatPing
  | HeartbeatPong;

export type BridgeMessage =
  BridgeControlMessage | BridgeRequest | BridgeResponse;

export function canonicalAuthMessage(input: {
  serverInstanceId: string;
  serverNonce: string;
  clientNonce: string;
  installationId: string;
  bridgeVersion: string;
  protocolVersion: number;
}): string {
  return [
    "remnote-agent-auth-v2",
    input.serverInstanceId,
    input.serverNonce,
    input.clientNonce,
    input.installationId,
    input.bridgeVersion,
    String(input.protocolVersion),
  ].join("\n");
}

export function isCapabilityScope(value: unknown): value is CapabilityScope {
  return (
    typeof value === "string" &&
    CAPABILITY_SCOPES.includes(value as CapabilityScope)
  );
}
