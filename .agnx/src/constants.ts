/**
 * 场景：Vibe Kanban 子应用常量。appId / panelId / 端口 / ensure 路径的唯一出处。
 * 端口 8120 为批次台账独占分配（8100–8127 已核对，8120 空且不撞任何已装 app）。
 */
export const VIBE_KANBAN_APP_ID = "vibe-kanban";
export const VIBE_KANBAN_PANEL_ID = "vibe-kanban.main";
export const VIBE_KANBAN_OPEN_COMMAND_ID = "vibe-kanban.open";
export const VIBE_KANBAN_ENSURE_TOOL_REL = ".agnx/tools/ensure-vibe-kanban.mjs";
export const VIBE_KANBAN_DEFAULT_PORT = 8120;
