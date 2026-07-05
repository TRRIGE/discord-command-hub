/** Discord interaction constants + minimal typings we rely on. */

export const InteractionType = {
  PING: 1,
  APPLICATION_COMMAND: 2,
  MESSAGE_COMPONENT: 3,
  APPLICATION_COMMAND_AUTOCOMPLETE: 4,
  MODAL_SUBMIT: 5,
} as const;

export const InteractionResponseType = {
  PONG: 1,
  CHANNEL_MESSAGE_WITH_SOURCE: 4, // immediate reply
  DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5, // "thinking…", follow up later
  DEFERRED_UPDATE_MESSAGE: 6,
  UPDATE_MESSAGE: 7, // edit the message the component was on
  MODAL: 9, // open a modal
} as const;

// Message flags
export const MessageFlags = {
  EPHEMERAL: 1 << 6, // 64 — only the invoking user sees it
} as const;

export const ComponentType = {
  ACTION_ROW: 1,
  BUTTON: 2,
  TEXT_INPUT: 4,
} as const;

export const ButtonStyle = {
  PRIMARY: 1,
  SECONDARY: 2,
  SUCCESS: 3,
  DANGER: 4,
  LINK: 5,
} as const;

export const TextInputStyle = {
  SHORT: 1,
  PARAGRAPH: 2,
} as const;

export interface DiscordInteraction {
  id: string;
  application_id: string;
  type: number;
  token: string;
  guild_id?: string;
  channel_id?: string;
  data?: {
    id?: string;
    name?: string; // command name
    custom_id?: string; // component / modal id
    options?: Array<{ name: string; type: number; value?: string | number | boolean }>;
    components?: Array<{
      type: number;
      components: Array<{ type: number; custom_id: string; value?: string }>;
    }>;
  };
  member?: { user?: { id: string; username: string; global_name?: string } };
  user?: { id: string; username: string; global_name?: string };
  message?: { id: string; content?: string };
}
