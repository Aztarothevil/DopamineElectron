import { Component, ElementRef, OnDestroy, OnInit, ViewChild, ViewEncapsulation } from '@angular/core';
import { Subscription } from 'rxjs';
import { PromiseUtils } from '../../../../common/utils/promise-utils';
import { StringUtils } from '../../../../common/utils/string-utils';
import { SettingsBase } from '../../../../common/settings/settings.base';
import { TrackModel } from '../../../../services/track/track-model';
import { LyricsModel } from '../../../../services/lyrics/lyrics-model';
import { LyricsServiceBase } from '../../../../services/lyrics/lyrics.service.base';
import { PlaybackInformationService } from '../../../../services/playback-information/playback-information.service';
import { PlaybackInformation } from '../../../../services/playback-information/playback-information';
import { PlaybackService } from '../../../../services/playback/playback.service';
import { PlaybackProgress } from '../../../../services/playback/playback-progress';

export interface LyricLineItem {
    text: string;
    timestamp: number;
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
    public coverSize: number = 190;
    public lyricLines: LyricLineItem[] = [];
    public activeLyricIndex: number = -1;

    @ViewChild('lyricsScrollContainer')
    public lyricsScrollContainer: ElementRef<HTMLDivElement> | undefined;

    public constructor(
        public settings: SettingsBase,
        private playbackInformationService: PlaybackInformationService,
        private playbackService: PlaybackService,
        private lyricsService: LyricsServiceBase,
    ) {}

    public get hasLyrics(): boolean {
        return this._lyrics != undefined && !StringUtils.isNullOrWhiteSpace(this._lyrics.plainText);
    }

    public get hasRichLyrics(): boolean {
        return (
            this._lyrics != null &&
            this._lyrics.textLines != undefined &&
            this._lyrics.textLines.length > 0 &&
            this._lyrics.startTimeStamps != undefined &&
            this._lyrics.startTimeStamps.length === this._lyrics.textLines.length
        );
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
        this.subscription.unsubscribe();
    }

    public async ngOnInit(): Promise<void> {
        this.initializeSubscriptions();
        const currentPlaybackInfo: PlaybackInformation = await this.playbackInformationService.getCurrentPlaybackInformationAsync();
        this.track = currentPlaybackInfo.track;
        await this.loadLyricsAsync(this.track);
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

        if (this.previousTrackPath === track.path && this._lyrics != undefined) {
            return;
        }

        this.isBusy = true;
        try {
            this._lyrics = await this.lyricsService.getLyricsAsync(track);
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
        if (!this._lyrics || !this._lyrics.textLines || !this._lyrics.startTimeStamps) {
            return;
        }
        for (let i = 0; i < this._lyrics.textLines.length; i++) {
            this.lyricLines.push({
                text: this._lyrics.textLines[i],
                timestamp: this._lyrics.startTimeStamps[i],
            });
        }
    }

    private updateActiveLyricLine(currentMs: number): void {
        if (!this.lyricLines || this.lyricLines.length === 0) {
            return;
        }
        let foundIdx = -1;
        for (let i = 0; i < this.lyricLines.length; i++) {
            if (currentMs >= this.lyricLines[i].timestamp) {
                foundIdx = i;
            } else {
                break;
            }
        }
        if (foundIdx !== this.activeLyricIndex) {
            this.activeLyricIndex = foundIdx;
            if (foundIdx >= 0) {
                this.scrollToActiveLyric(foundIdx);
            }
        }
    }

    private scrollToActiveLyric(idx: number): void {
        const el = document.getElementById('lyric-line-' + idx);
        if (el && this.lyricsScrollContainer && this.lyricsScrollContainer.nativeElement) {
            const container = this.lyricsScrollContainer.nativeElement;
            const targetTop = el.offsetTop - container.offsetTop - container.clientHeight / 2 + el.clientHeight / 2;
            container.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
        }
    }
}
