// Intentionally minimal: MV3 may terminate this worker at any time. All long-running
// work belongs in the side panel (see CLAUDE.md, architecture rule 1).
export default defineBackground(() => {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error: unknown) => console.error('DesignLens: failed to set side panel behavior', error));
});
