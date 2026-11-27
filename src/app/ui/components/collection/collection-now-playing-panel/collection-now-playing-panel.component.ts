import { Component, ElementRef, OnDestroy, OnInit, ViewChild, ViewEncapsulation } from '@angular/core';
import { Subscription } from 'rxjs';
import { PromiseUtils } from '../../../../common/utils/promise-utils';
import { StringUtils } from '../../../../common/utils/string-utils';
import { SettingsBase } from '../../../../common/settings/settings.base';
import { TrackModel } from '../../../../services/track/track-model';
import { LyricsModel } from '../../../../services/lyrics/lyrics-model';
import { LyricsServiceBase } from '../../../../services/lyrics/lyrics.service.base';
import { LyricsSourceType } from '../../../../common/api/lyrics/lyrics-source-type';
import { PlaybackInformationService } from '../../../../services/playback-information/playback-information.service';
import { PlaybackInformation } from '../../../../services/playback-information/playback-information';
import { PlaybackService } from '../../../../services/playback/playback.service';
import { PlaybackProgress } from '../../../../services/playback/playback-progress';

import { LrcLyricsGetter } from '../../../../services/lyrics/lrc-lyrics-getter';

import { AppearanceServiceBase } from '../../../../services/appearance/appearance.service.base';

export interface LyricLineItem {
    text: string;
    timestamp: number; // in milliseconds
    duration: number; // in milliseconds
    index: number;
}

@Component({
    selector: 'app-collection-now-playing-panel',
    host: { style: 'display: block; width: 100%; height: 100%;' },
    templateUrl: './collection-now-playing-panel.component.html',
    styleUrls: ['./collection-now-playing-panel.component.scss'],
    encapsulation: ViewEncapsulation.None,
})
export class CollectionNowPlayingPanelComponent implements OnInit, OnDestroy {
    private subscription: Subscription = new Subscription();
    private _lyrics: LyricsModel | undefined;
    private previousTrackPath: string = '';
    public isBusy: boolean = false;
    public track: TrackModel | undefined;
    public coverSize: number = 220;
    public lyricLines: LyricLineItem[] = [];
    public activeLyricIndex: number = -1;
    private highlightTimerId: number | undefined;

    public lyricsSourceTypeEnum: typeof LyricsSourceType = LyricsSourceType;

    // Variables de desplazamiento karaoke tomadas de ScrollUtils.cs
    private currentIndex: number = 0;
    private contador: number = 0;
    private position: number = 0;
    private lastPosition: number = 0;
    private lastPositionLyric: number = 0;
    private lastDuration: number = 0;
    private lastDurationLyrc: number = 0;

    @ViewChild('lyricsScrollContainer')
    public lyricsScrollContainer: ElementRef<HTMLDivElement> | undefined;

    public constructor(
        public settings: SettingsBase,
        public playbackService: PlaybackService,
        private playbackInformationService: PlaybackInformationService,
        private lyricsService: LyricsServiceBase,
        private lrcLyricsGetter: LrcLyricsGetter,
        private appearanceService: AppearanceServiceBase,
    ) {}

    public get hasLyrics(): boolean {
        return this._lyrics != undefined && !StringUtils.isNullOrWhiteSpace(this._lyrics.plainText);
    }

    public get hasRichLyrics(): boolean {
        return this.lyricLines != null && this.lyricLines.length > 0 && this.lyricLines.some(l => l.timestamp >= 0);
    }

    public get showRichLyrics(): boolean {
        return this.settings.showRichLyrics;
    }

    public get lyrics(): LyricsModel | undefined {
        return this._lyrics;
    }

    public get musicColorClass(): string {
        if (!this.track || !this.track.bitRate) {
            return 'music-color-standard';
        }
        if (this.track.bitRate > 2000) {
            return 'music-color-hi-res';
        }
        if (this.track.bitRate > 510) {
            return 'music-color-cd';
        }
        return 'music-color-standard';
    }

    public ngOnDestroy(): void {
        this.stopHighlightTimer();
        this.subscription.unsubscribe();
    }

    public async ngOnInit(): Promise<void> {
        this.initializeSubscriptions();
        this.startHighlightTimer();
        const currentPlaybackInfo: PlaybackInformation = await this.playbackInformationService.getCurrentPlaybackInformationAsync();
        this.track = currentPlaybackInfo.track;
        await this.loadLyricsAsync(this.track);
    }

    private startHighlightTimer(): void {
        if (this.highlightTimerId === undefined) {
            this.highlightTimerId = window.setInterval(() => {
                if (this.playbackService.isPlaying) {
                    const currentMs = this.playbackService.getCurrentProgress().progressSeconds * 1000;
                    this.updateActiveLyricLine(currentMs);
                }
            }, 100);
        }
    }

    private stopHighlightTimer(): void {
        if (this.highlightTimerId !== undefined) {
            window.clearInterval(this.highlightTimerId);
            this.highlightTimerId = undefined;
        }
    }

    private initializeSubscriptions(): void {
        this.subscription.add(
            this.playbackInformationService.playingNextTrack$.subscribe((info: PlaybackInformation) => {
                this.track = info.track;
                PromiseUtils.noAwait(this.loadLyricsAsync(info.track));
            }),
        );

        this.subscription.add(
            this.playbackInformationService.playingPreviousTrack$.subscribe((info: PlaybackInformation) => {
                this.track = info.track;
                PromiseUtils.noAwait(this.loadLyricsAsync(info.track));
            }),
        );

        this.subscription.add(
            this.playbackInformationService.playingNoTrack$.subscribe(() => {
                this.track = undefined;
                this._lyrics = undefined;
                this.lyricLines = [];
                this.activeLyricIndex = -1;
                this.previousTrackPath = '';
            }),
        );

        this.subscription.add(
            this.playbackService.progressChanged$.subscribe((progress: PlaybackProgress) => {
                this.updateActiveLyricLine(progress.progressSeconds * 1000);
            }),
        );
    }

    private async loadLyricsAsync(track: TrackModel | undefined): Promise<void> {
        if (track == undefined) {
            this._lyrics = undefined;
            return;
        }

        if (track.bitRate) {
            this.appearanceService.updateMusicColor(track.bitRate);
        }

        if (this.previousTrackPath === track.path && this._lyrics != undefined) {
            return;
        }

        this.isBusy = true;
        try {
            // First check local LRC file directly if available (just like C# does before online)
            let lyricsResult = await this.lrcLyricsGetter.getLyricsAsync(track);
            if (!lyricsResult || StringUtils.isNullOrWhiteSpace(lyricsResult.plainText)) {
                lyricsResult = await this.lyricsService.getLyricsAsync(track);
            }
            this._lyrics = lyricsResult;
            this.buildLyricLines();
        } catch {
            this._lyrics = undefined;
            this.lyricLines = [];
        } finally {
            this.isBusy = false;
        }

        this.previousTrackPath = track.path;
    }

    private buildLyricLines(): void {
        this.lyricLines = [];
        this.activeLyricIndex = -1;
        this.currentIndex = 0;
        this.contador = 0;
        this.position = 0;
        this.lastPosition = 0;
        this.lastPositionLyric = 0;
        this.lastDuration = 0;
        this.lastDurationLyrc = 0;

        if (!this._lyrics) {
            return;
        }

        const rawLines: LyricLineItem[] = [];

        // 1. If lyrics already has textLines and startTimeStamps
        if (
            this._lyrics.textLines &&
            this._lyrics.startTimeStamps &&
            this._lyrics.textLines.length > 0 &&
            this._lyrics.startTimeStamps.length === this._lyrics.textLines.length
        ) {
            for (let i = 0; i < this._lyrics.textLines.length; i++) {
                rawLines.push({
                    text: this._lyrics.textLines[i],
                    timestamp: Math.round(this._lyrics.startTimeStamps[i] * 1000),
                    duration: 0,
                    index: i,
                });
            }
        } else if (!StringUtils.isNullOrWhiteSpace(this._lyrics.plainText)) {
            // 2. Parse plainText if it contains LRC timestamps or lines (like C# ParseLyrics)
            const lines = this._lyrics.plainText.split(/\r?\n/);
            const timestampRegex = /\[(\d{1,3}):(\d{2})[.:](\d{2,3})\]/g;
            let index = 0;

            for (const line of lines) {
                if (line.trim().length === 0) {
                    continue;
                }

                // Ignore metadata tags e.g. [ar:...], [ti:...]
                if (/^\[[a-zA-Z]+?:.*?\]/.test(line)) {
                    continue;
                }

                const matches: RegExpExecArray[] = [];
                let match: RegExpExecArray | null;
                timestampRegex.lastIndex = 0;
                while ((match = timestampRegex.exec(line)) !== null) {
                    matches.push(match);
                }

                if (matches.length > 0) {
                    const text = line.replace(timestampRegex, '').trim();
                    for (const m of matches) {
                        const mins = parseInt(m[1], 10);
                        const secs = parseInt(m[2], 10);
                        const frac = m[3];
                        const ms = Math.round((mins * 60 + secs + parseInt(frac, 10) / Math.pow(10, frac.length)) * 1000);
                        rawLines.push({
                            text: text,
                            timestamp: ms,
                            duration: 0,
                            index: index++,
                        });
                    }
                }
            }

            // Sort by timestamp
            rawLines.sort((a, b) => a.timestamp - b.timestamp);
            rawLines.forEach((item, idx) => (item.index = idx));
        }

        if (rawLines.length === 0) {
            return;
        }

        // Calculate line durations as in C# LyricsService
        for (let a = 0; a < rawLines.length - 1; a++) {
            rawLines[a].duration = Math.max(0, rawLines[a + 1].timestamp - rawLines[a].timestamp);
        }

        this.lyricLines = [...rawLines];

        // Add padding lines at the end if lines > 5 (matching C# linesWithoutTimestamps.Add(""))
        if (this.lyricLines.length > 5) {
            for (let i = 0; i < 30; i++) {
                this.lyricLines.push({
                    text: '',
                    timestamp: -1,
                    duration: 0,
                    index: this.lyricLines.length,
                });
            }
        }
    }

    private updateActiveLyricLine(currentMs: number): void {
        if (!this.playbackService.isPlaying) {
            return;
        }

        if (!this.lyricLines || this.lyricLines.length === 0) {
            return;
        }

        let foundIdx = -1;
        for (let i = 0; i < this.lyricLines.length; i++) {
            if (this.lyricLines[i].timestamp >= 0 && currentMs >= this.lyricLines[i].timestamp) {
                foundIdx = i;
            } else if (this.lyricLines[i].timestamp >= 0 && this.lyricLines[i].timestamp > currentMs) {
                break;
            }
        }

        this.activeLyricIndex = foundIdx;

        if (foundIdx >= 0) {
            this.scrollToTextListItem(foundIdx, true);
        }
    }

    /**
     * Implementación exacta de ScrollToTextListItem de ScrollUtils.cs para seguimiento tipo Karaoke
     */
    public scrollToTextListItem(itemIndex: number, scrollOnlyIfNotInView: boolean): void {
        if (!this.lyricsScrollContainer || !this.lyricsScrollContainer.nativeElement) {
            return;
        }
        const container = this.lyricsScrollContainer.nativeElement;
        const item = this.lyricLines[itemIndex];
        if (!item) {
            return;
        }

        // Si item.Index == 0 o item.Index < 10
        if (scrollOnlyIfNotInView && (item.index === 0 || item.index < 10)) {
            if (container.scrollTop !== 0) {
                const el = document.getElementById('lyric-line-' + itemIndex);
                if (el) {
                    const elTop = el.offsetTop - container.offsetTop;
                    const elBottom = elTop + el.clientHeight;
                    // Solo si no está visible o al inicio
                    if (item.index === 0 || elTop < container.scrollTop || elBottom > container.scrollTop + container.clientHeight) {
                        const targetTop = item.index === 0 ? 0 : Math.max(0, elTop - container.clientHeight / 2 + el.clientHeight / 2);
                        container.scrollTo({ top: targetTop, behavior: 'smooth' });
                    }
                } else if (item.index === 0) {
                    container.scrollTo({ top: 0, behavior: 'smooth' });
                }
            }
            this.lastPosition = 0;
            this.position = 0;
            this.contador = 0;
            return;
        }

        if (item.duration === 0) {
            return;
        }

        const lineHeight = 28; // 28px por item como en C#

        if (this.currentIndex !== item.index) {
            this.lastPositionLyric = ((item.index - 10) * lineHeight) + lineHeight;
            this.lastDurationLyrc = item.duration;

            if ((this.currentIndex < item.index - 1 || this.currentIndex > item.index + 1) && item.index > 11) {
                this.lastPosition = this.lastPositionLyric;
                this.position = this.lastPositionLyric;
                container.scrollTop = this.position;
            }

            this.currentIndex = item.index;
            this.contador = 0;
        }

        if (this.lastPosition === this.position) {
            this.lastPosition = this.lastPositionLyric;
            this.lastDuration = this.lastDurationLyrc;
            this.contador = 0;
        }

        this.contador++;

        const modulo = Math.max(1, Math.floor((this.lastDuration * 40) / 9200));

        if (this.contador % modulo === 0) {
            if (this.position <= this.lastPosition) {
                this.position += 1;
                container.scrollTop = this.position;
            }
        }
    }

    public async onLyricLineClick(line: LyricLineItem): Promise<void> {
        if (line && line.timestamp >= 0) {
            await this.playbackService.jumpToSecondAsync(line.timestamp / 1000);
        }
    }
}
