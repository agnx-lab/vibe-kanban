/**
 * 场景：Vibe Kanban 子应用入口 —— 注册一个主面板（= 一类 Tab）+ 一个打开命令。
 */
import type { WorkspaceAppHostApi, WorkspaceAppModule } from "@agnx-lab/app-sdk";
import {
  VIBE_KANBAN_APP_ID,
  VIBE_KANBAN_OPEN_COMMAND_ID,
  VIBE_KANBAN_PANEL_ID,
} from "./constants";
import { bindVibeKanbanHost, VibeKanbanPanel } from "./panel";

export const appId = VIBE_KANBAN_APP_ID;

export function activate(host: WorkspaceAppHostApi): () => void {
  bindVibeKanbanHost(host);

  const disposers: Array<() => void> = [];

  disposers.push(
    host.registerMiniApp({
      id: VIBE_KANBAN_PANEL_ID,
      appId: VIBE_KANBAN_APP_ID,
      title: "Vibe Kanban",
      component: VibeKanbanPanel,
      primaryPanel: true,
      iframeShortcutCapture: true,
    }),
  );

  disposers.push(
    host.registerCommand({
      id: VIBE_KANBAN_OPEN_COMMAND_ID,
      appId: VIBE_KANBAN_APP_ID,
      title: "Vibe Kanban",
      keywords: ["vibe", "kanban", "看板", "任务"],
      sidebarAction: { defaultVisible: true, label: "Vibe Kanban", order: 70 },
      run: (context) => {
        host.openSubAppTab({
          appId: VIBE_KANBAN_APP_ID,
          panelId: VIBE_KANBAN_PANEL_ID,
          serverId: context?.serverId,
          workspaceId: context?.workspaceId,
          currentPathname: context?.currentPathname,
        });
      },
    }),
  );

  return () => {
    for (const d of disposers.toReversed()) d();
  };
}

const moduleExport: WorkspaceAppModule = { appId: VIBE_KANBAN_APP_ID, activate };
export default moduleExport;
