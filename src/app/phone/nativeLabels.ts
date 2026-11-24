import type { NativeLabels } from "../../features/content/mobileViews";

type Translate = (key: string, params?: Record<string, string>) => string;

/** The texts of what a phone draws natively; `{app}` and `{zone}` are filled in there. */
export function nativeLabels(t: Translate): NativeLabels {
    const names = { app: "{app}", zone: "{zone}" };
    return {
        serviceTitle: t("native.service_title"),
        serviceConnected: t("native.service_connected"),
        serviceWaiting: t("native.service_waiting"),
        serviceSignIn: t("native.service_sign_in"),
        channelService: t("native.channel_service"),
        channelSilent: t("native.channel_silent"),
        channelSound: t("native.channel_sound"),
        channelUrgent: t("native.channel_urgent"),
        channelDownloads: t("native.channel_downloads"),
        channelPlayback: t("native.channel_playback"),
        channelRecording: t("native.channel_recording"),
        playing: t("native.playing"),
        play: t("native.play"),
        pause: t("native.pause"),
        previous: t("native.previous"),
        next: t("native.next"),
        stop: t("native.stop"),
        recording: t("native.recording", names),
        signTitle: t("native.sign_title"),
        signAsk: t("native.sign_ask", names),
        signDevice: t("native.sign_device", names),
        signIdentity: t("native.sign_identity", names),
        signPassword: t("sign.password"),
        signWrong: t("sign.wrong_password"),
        confirm: t("native.confirm"),
        cancel: t("common.actions.cancel"),
        allow: t("native.allow"),
        deny: t("native.deny"),
        micAsk: t("native.mic_ask", names),
    };
}
