import React from "react";
import { FolderOpen, Music, Pause, Play, Shuffle, SkipBack, SkipForward, X } from "lucide-react";
import { folderName, formatTime, trackAlbum, trackTitle } from "@buckyos-desktop/music/playlist.ts";
import { Button, IconButton } from "../../components/ui/Button";
import { Menu } from "../../components/ui/Menu";
import { Spinner, StateText } from "../../components/ui/States";
import { useI18n } from "../../i18n";
import { sessionLabelKey, sessionTone } from "../zone/sessionView";
import type { ZoneView } from "../zone/types";
import { FolderDialog } from "./FolderDialog";
import { musicPlayer, type MusicSnapshot } from "./player";
import { useMusic, useMusicValue } from "./useMusic";
import "./music.css";

/** Chooses the folder to play; music of another Zone is not touched by a dialog that stayed open. */
export const MusicFolderDialog: React.FC<{ zone: ZoneView; onClose: () => void }> = ({ zone, onClose }) => {
    const folder = useMusicValue((music) => music.folder);
    return (
        <FolderDialog
            zone={zone}
            folder={folder}
            onClose={onClose}
            onChoose={(chosen) => {
                onClose();
                if (musicPlayer.getSnapshot().zone === zone.did) musicPlayer.choose(chosen);
            }}
        />
    );
};

/** Plays a folder of the Zone. `optional`: nothing at all until a folder was chosen. */
export const MusicCard: React.FC<{ zone: ZoneView; optional?: boolean }> = ({ zone, optional = false }) => {
    const { t } = useI18n();
    const music = useMusic();
    const [choosing, setChoosing] = React.useState(false);
    const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null);
    const signedIn = zone.session.state === "signed_in";

    if (music.zone !== zone.did || (!music.folder && (optional || !signedIn))) return null;
    const playable = music.library === "ready" && music.count > 0 && !music.failed;

    return (
        <section className="ui-section" data-testid="music-card">
            <div className="home-heading">
                <h2 className="ui-section-title">{t("music.title")}</h2>
                {music.folder ? (
                    <>
                        <button
                            type="button"
                            className="music-tool"
                            aria-label={t("music.shuffle")}
                            aria-pressed={music.order === "shuffle"}
                            title={t(music.order === "shuffle" ? "music.shuffle_on" : "music.shuffle_off")}
                            onClick={() => musicPlayer.toggleOrder()}
                            data-testid="music-shuffle"
                        >
                            <Shuffle size={15} aria-hidden="true" />
                        </button>
                        <button
                            type="button"
                            className="music-tool"
                            aria-label={t("music.folder")}
                            aria-haspopup="menu"
                            title={t("music.folder")}
                            onClick={(event) => {
                                const box = event.currentTarget.getBoundingClientRect();
                                setMenu({ x: box.right - 180, y: box.bottom + 4 });
                            }}
                            data-testid="music-folder"
                        >
                            <FolderOpen size={15} aria-hidden="true" />
                        </button>
                    </>
                ) : null}
            </div>
            <div className="ui-card music-card">
                {playable ? (
                    <Playing zone={zone} music={music} />
                ) : (
                    <div className="music-message">
                        {music.library === "loading" ? <Spinner /> : <Music size={18} aria-hidden="true" />}
                        <p data-testid="music-status">
                            {music.folder ? <strong>{folderName(music.folder)}</strong> : null}
                            <span>{signedIn || !music.folder ? t(messageKey(music)) : t(sessionLabelKey(zone))}</span>
                        </p>
                        {!signedIn || music.library === "loading" ? null : music.library === "unavailable" || music.failed ? (
                            <Button size="sm" onClick={() => void musicPlayer.load()}>
                                {t("ui.retry")}
                            </Button>
                        ) : (
                            <Button size="sm" onClick={() => setChoosing(true)} data-testid="music-choose">
                                {t(music.folder ? "music.other" : "music.choose")}
                            </Button>
                        )}
                    </div>
                )}
            </div>
            <Menu
                at={menu}
                label={t("music.folder")}
                onClose={() => setMenu(null)}
                items={[
                    { id: "choose", label: t("music.other"), icon: <FolderOpen size={16} aria-hidden="true" />, disabled: !signedIn, onSelect: () => setChoosing(true) },
                    { id: "clear", label: t("music.clear"), icon: <X size={16} aria-hidden="true" />, onSelect: () => musicPlayer.choose("") },
                ]}
            />
            {choosing ? <MusicFolderDialog zone={zone} onClose={() => setChoosing(false)} /> : null}
        </section>
    );
};

function messageKey(music: MusicSnapshot): string {
    if (music.library === "none") return "music.empty";
    if (music.library === "loading") return "music.loading";
    if (music.library === "unavailable") return "music.unavailable";
    return music.failed ? "music.failed" : "music.no_tracks";
}

const Playing: React.FC<{ zone: ZoneView; music: MusicSnapshot }> = ({ zone, music }) => {
    const { t } = useI18n();
    const [scrub, setScrub] = React.useState<number | null>(null);
    const title = music.track ? trackTitle(music.track) : "";
    const album = music.track ? trackAlbum(music.track, music.folder) : "";
    const shown = scrub ?? music.position;
    const commit = () => {
        if (scrub === null) return;
        musicPlayer.seek(scrub);
        setScrub(null);
    };
    // Another track came in while the thumb was held.
    React.useEffect(() => setScrub(null), [music.track]);
    return (
        <>
            <div className="music-now">
                <button
                    type="button"
                    className="music-play"
                    aria-label={t(music.playing ? "music.pause" : "music.play")}
                    title={t(music.playing ? "music.pause" : "music.play")}
                    disabled={!music.ready}
                    onClick={() => musicPlayer.toggle()}
                    data-playing={music.playing}
                    data-testid="music-play"
                >
                    {music.playing ? <Pause size={17} fill="currentColor" strokeWidth={0} /> : <Play size={17} fill="currentColor" strokeWidth={0} />}
                </button>
                <div className="music-text">
                    <span className="music-title" title={title} data-testid="music-title">
                        {title}
                    </span>
                    {!music.ready ? (
                        <StateText tone={sessionTone(zone)}>{t(sessionLabelKey(zone))}</StateText>
                    ) : music.unreachable ? (
                        <StateText tone="bad">{t("music.unreachable")}</StateText>
                    ) : (
                        <span className="music-album" data-testid="music-album">
                            <span>{album}</span>
                            <span>{`${music.index + 1} / ${music.count}`}</span>
                        </span>
                    )}
                </div>
                <IconButton label={t("music.previous")} disabled={!music.ready} onClick={() => musicPlayer.previous()} data-testid="music-previous">
                    <SkipBack size={16} />
                </IconButton>
                <IconButton label={t("music.next")} disabled={!music.ready} onClick={() => musicPlayer.next()} data-testid="music-next">
                    <SkipForward size={16} />
                </IconButton>
            </div>
            <div className="music-progress">
                <span>{formatTime(shown)}</span>
                <input
                    type="range"
                    aria-label={t("music.position")}
                    aria-valuetext={`${formatTime(shown)} / ${formatTime(music.duration)}`}
                    min={0}
                    max={Math.max(1, Math.floor(music.duration))}
                    step={1}
                    value={Math.min(Math.floor(shown), Math.max(1, Math.floor(music.duration)))}
                    disabled={!music.duration}
                    style={{ "--music-played": music.duration ? `${Math.min(100, (shown / music.duration) * 100)}%` : "0%" } as React.CSSProperties}
                    onChange={(event) => setScrub(Number(event.target.value))}
                    onPointerUp={commit}
                    onKeyUp={commit}
                    onBlur={commit}
                    data-testid="music-progress"
                />
                <span>{formatTime(music.duration)}</span>
            </div>
        </>
    );
};
