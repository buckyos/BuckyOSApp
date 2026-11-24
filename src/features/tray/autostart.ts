import { invoke } from "@tauri-apps/api/core";

// The client itself at login, hidden in the tray (tauri-plugin-autostart).
export const autostartEnabled = () => invoke<boolean>("plugin:autostart|is_enabled");
export const setAutostart = (enabled: boolean) => invoke<void>(enabled ? "plugin:autostart|enable" : "plugin:autostart|disable");
