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
import { FileMetadataFactoryBase } from '../../../../common/metadata/file-metadata.factory.base';
import { IndexingService } from '../../../../services/indexing/indexing.service';
import { IFileMetadata } from '../../../../common/metadata/i-file-metadata';

export interface LyricLineItem {
    text: string;
    timestamp: number; // in milliseconds
    duration: number; // in milliseconds
    index: number;
    isHighlighted?: boolean;
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
    private animationFrameId: number | undefined;
    private currentScrollTop: number = 0;
    private targetScrollTop: number = 0;

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

    @ViewChild('lyricsEditor')
    public lyricsEditor: ElementRef<HTMLTextAreaElement> | undefined;

    public isEditingLyrics: boolean = false;
    public editingLyricsText: string = '';
    public isSavingLyrics: boolean = false;

    public constructor(
        public settings: SettingsBase,
        public playbackService: PlaybackService,
        private playbackInformationService: PlaybackInformationService,
        private lyricsService: LyricsServiceBase,
        private lrcLyricsGetter: LrcLyricsGetter,
        private appearanceService: AppearanceServiceBase,
        private fileMetadataFactory: FileMetadataFactoryBase,
        private indexingService: IndexingService,
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
        this.stopScrollAnimation();
        this.subscription.unsubscribe();
    }

    public async ngOnInit(): Promise<void> {
        this.initializeSubscriptions();
        this.startHighlightTimer();
        this.startScrollAnimation();
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
            }, 30);
        }
    }

    private stopHighlightTimer(): void {
        if (this.highlightTimerId !== undefined) {
            window.clearInterval(this.highlightTimerId);
            this.highlightTimerId = undefined;
        }
    }

    private startScrollAnimation(): void {
        const animate = (): void => {
            if (this.lyricsScrollContainer && this.lyricsScrollContainer.nativeElement) {
                const container = this.lyricsScrollContainer.nativeElement;

                // Si la música está reproduciéndose, calcular de forma continua la posición en base al tiempo exacto
                if (this.playbackService.isPlaying && this.lyricLines.length > 0) {
                    const currentMs = this.playbackService.getCurrentProgress().progressSeconds * 1000;
                    const computed = this.calculateContinuousScrollTarget(container, currentMs);
                    if (computed !== undefined) {
                        this.targetScrollTop = computed;
                    }
                }

                const diff = this.targetScrollTop - this.currentScrollTop;

                if (Math.abs(diff) > 0.1) {
                    // Si el salto es brusco (por ejemplo el usuario adelantó o retrocedió mucho)
                    if (Math.abs(diff) > 200) {
                        this.currentScrollTop = this.targetScrollTop;
                    } else {
                        // Interpolación continua adaptativa
                        const step = diff * 0.1;
                        this.currentScrollTop += Math.abs(step) < 0.15 ? diff : step;
                    }
                    container.scrollTop = this.currentScrollTop;
                }
            }
            this.animationFrameId = requestAnimationFrame(animate);
        };
        this.animationFrameId = requestAnimationFrame(animate);
    }

    private stopScrollAnimation(): void {
        if (this.animationFrameId !== undefined) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = undefined;
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
        this.currentScrollTop = 0;
        this.targetScrollTop = 0;
        if (this.lyricsScrollContainer && this.lyricsScrollContainer.nativeElement) {
            this.lyricsScrollContainer.nativeElement.scrollTop = 0;
        }

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
                            isHighlighted: false,
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
                    isHighlighted: false,
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

        let firstActiveIdx = -1;

        // Implementación idéntica a LyricsControlViewModel.cs en C#:
        // double progressTime = this.playbackService.GetCurrentTime.TotalMilliseconds;
        // double lyricsLineTime = this.LyricsViewModel.LyricsLines[i].Time.TotalMilliseconds;
        // double nextLyricsLineTime = 0;
        // while (i + j < this.LyricsViewModel.LyricsLines.Count && nextLyricsLineTime <= lyricsLineTime) {
        //     nextLyricsLineTime = this.LyricsViewModel.LyricsLines[i + j].Time.TotalMilliseconds;
        //     j++;
        // }
        // if (progressTime >= lyricsLineTime & (nextLyricsLineTime >= progressTime | nextLyricsLineTime == 0)) {
        //     this.LyricsViewModel.LyricsLines[i].IsHighlighted = true;
        // }
        for (let i = 0; i < this.lyricLines.length; i++) {
            const line = this.lyricLines[i];
            if (line.timestamp < 0) {
                line.isHighlighted = false;
                continue;
            }

            let nextTime = 0;
            for (let j = i + 1; j < this.lyricLines.length; j++) {
                if (this.lyricLines[j].timestamp > line.timestamp) {
                    nextTime = this.lyricLines[j].timestamp;
                    break;
                }
            }

            const isHighlighted = currentMs >= line.timestamp && (nextTime === 0 || nextTime > currentMs);
            line.isHighlighted = isHighlighted;

            if (isHighlighted && firstActiveIdx === -1) {
                firstActiveIdx = i;
            }
        }

        this.activeLyricIndex = firstActiveIdx;

        if (firstActiveIdx >= 0) {
            this.scrollToTextListItem(firstActiveIdx, true);
        }
    }

    /**
     * Calcula de forma continua y proporcional al tiempo la posición de scroll.
     * La velocidad del scroll acelera o desacelera suavemente según la duración entre versos,
     * avanzando de forma continua sin pausas bruscas.
     */
    private calculateContinuousScrollTarget(container: HTMLElement, currentMs: number): number | undefined {
        const targetViewportAnchor = container.clientHeight * 0.30; // 20% arriba del centro (30% del viewport)

        // Encontrar la línea actual y la siguiente línea con timestamp mayor
        let currentIdx = -1;
        for (let i = 0; i < this.lyricLines.length; i++) {
            if (this.lyricLines[i].timestamp >= 0 && currentMs >= this.lyricLines[i].timestamp) {
                currentIdx = i;
            } else if (this.lyricLines[i].timestamp > currentMs) {
                break;
            }
        }

        if (currentIdx === -1) {
            return 0;
        }

        const currentEl = document.getElementById('lyric-line-' + currentIdx);
        if (!currentEl) {
            return undefined;
        }

        const currentPos = Math.max(0, (currentEl.offsetTop - container.offsetTop + currentEl.clientHeight / 2) - targetViewportAnchor);

        // Buscar la siguiente línea con timestamp distinto para interpolar entre ambas
        let nextIdx = -1;
        for (let j = currentIdx + 1; j < this.lyricLines.length; j++) {
            if (this.lyricLines[j].timestamp > this.lyricLines[currentIdx].timestamp) {
                nextIdx = j;
                break;
            }
        }

        if (nextIdx === -1) {
            return currentPos;
        }

        const nextEl = document.getElementById('lyric-line-' + nextIdx);
        if (!nextEl) {
            return currentPos;
        }

        const nextPos = Math.max(0, (nextEl.offsetTop - container.offsetTop + nextEl.clientHeight / 2) - targetViewportAnchor);

        // Si aún no hemos alcanzado el punto de anclaje inicial (30% superior), mantener en 0
        if (currentPos === 0 && nextPos === 0) {
            return 0;
        }

        const tStart = this.lyricLines[currentIdx].timestamp;
        const tEnd = this.lyricLines[nextIdx].timestamp;
        const duration = tEnd - tStart;

        if (duration <= 0) {
            return currentPos;
        }

        // Progreso continuo fraccional [0 .. 1] a lo largo del verso actual
        const progress = Math.min(1, Math.max(0, (currentMs - tStart) / duration));

        // Interpolar continuamente entre la posición de la línea actual y la siguiente
        return currentPos + (nextPos - currentPos) * progress;
    }

    public scrollToTextListItem(itemIndex: number, _scrollOnlyIfNotInView: boolean): void {
        // El scroll continuo y variable se procesa en el bucle calculateContinuousScrollTarget
    }

    public async onLyricLineClick(line: LyricLineItem): Promise<void> {
        if (line && line.timestamp >= 0) {
            await this.playbackService.jumpToSecondAsync(line.timestamp / 1000);
        }
    }

    public startEditingLyrics(): void {
        this.isEditingLyrics = true;
        let text = this._lyrics?.plainText || '';

        // Si el texto actual no contiene las líneas iniciales de metadatos [00:00.000], agregarlas al inicio
        const artist = this.track?.artists || '';
        const title = this.track?.title || '';
        const headerLines = `[00:00.000]Artist: ${artist}\n[00:00.000]Title: ${title}\n\n`;

        if (!text.toLowerCase().includes('[00:00.000]artist:') && !text.toLowerCase().includes('[00:00.000]title:')) {
            text = headerLines + text;
        }

        this.editingLyricsText = text;
        setTimeout(() => {
            if (this.lyricsEditor && this.lyricsEditor.nativeElement) {
                this.lyricsEditor.nativeElement.focus();
            }
        }, 50);
    }

    public cancelEditingLyrics(): void {
        this.isEditingLyrics = false;
        this.editingLyricsText = '';
    }

    public async saveLyricsToAudioFileAsync(): Promise<void> {
        if (!this.track || !this.track.path) {
            return;
        }

        this.isSavingLyrics = true;
        try {
            const fileMetadata: IFileMetadata = await this.fileMetadataFactory.createAsync(this.track.path);
            fileMetadata.lyrics = this.editingLyricsText;
            fileMetadata.save();

            // Actualizar la base de datos y la interfaz mediante indexingService
            await this.indexingService.indexAfterTagChangeAsync([fileMetadata]);

            // Cargar y mostrar de inmediato las nuevas letras guardadas
            this.isEditingLyrics = false;
            this.previousTrackPath = '';
            await this.loadLyricsAsync(this.track);
        } catch (error) {
            console.error('Error saving lyrics into audio file:', error);
        } finally {
            this.isSavingLyrics = false;
        }
    }

    public onLyricsEditorKeyDown(event: KeyboardEvent): void {
        if (!event.ctrlKey) {
            return;
        }

        const key = event.key ? event.key.toLowerCase() : '';
        if (key === 't') {
            event.preventDefault();
            this.addTimeStampToSelectedLyricsLine();
        } else if (key === 'f') {
            event.preventDefault();
            this.jumpToCurrentLine();
        } else if (key === 'r') {
            event.preventDefault();
            this.reduceTimeStampToSelectedLyricsLine();
        }
    }

    private formatTimestamp(totalMilliseconds: number): string {
        const msClamped = Math.max(0, Math.floor(totalMilliseconds));
        const totalSeconds = Math.floor(msClamped / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        const millis = msClamped % 1000;
        const mm = minutes.toString().padStart(2, '0');
        const ss = seconds.toString().padStart(2, '0');
        const mmm = millis.toString().padStart(3, '0');
        return `[${mm}:${ss}.${mmm}]`;
    }

    /**
     * Implementación exacta de AddTimeStampToSelectedLyricsLine de Dopamine C# (WPF):
     * Inserta o actualiza la marca de tiempo al inicio de la línea actual y pasa el cursor a la siguiente línea.
     */
    private addTimeStampToSelectedLyricsLine(): void {
        if (!this.lyricsEditor || !this.lyricsEditor.nativeElement) {
            return;
        }

        const textarea = this.lyricsEditor.nativeElement;
        const text = textarea.value;
        const caretIndex = textarea.selectionStart;

        // Determinar inicio y fin de la línea actual
        const lineStart = text.lastIndexOf('\n', caretIndex - 1) + 1;
        let lineEnd = text.indexOf('\n', caretIndex);
        if (lineEnd === -1) {
            lineEnd = text.length;
        }

        const line = text.substring(lineStart, lineEnd);
        const currentMs = this.playbackService.getCurrentProgress().progressSeconds * 1000;
        const timeStamp = this.formatTimestamp(currentMs);

        // Extraer el texto de la línea descartando cualquier timestamp previo si ya existía
        let content = line;
        if (line.trim().startsWith('[')) {
            const closingBracketIdx = line.indexOf(']');
            if (closingBracketIdx !== -1) {
                content = line.substring(closingBracketIdx + 1);
            }
        }

        // Quitar espacios en blanco al principio y hacer mayúscula la primera letra
        const trimmedContent = content.trimStart();
        let formattedContent = trimmedContent;
        if (formattedContent.length > 0) {
            formattedContent = formattedContent.charAt(0).toUpperCase() + formattedContent.slice(1);
        }

        const newLine = timeStamp + formattedContent;

        // Actualizar texto
        const newText = text.substring(0, lineStart) + newLine + text.substring(lineEnd);
        this.editingLyricsText = newText;
        textarea.value = newText;

        // Posicionar cursor al inicio de la siguiente línea (como en C# WPF)
        const nextLinePos = lineStart + newLine.length + 1;
        const newCaret = Math.min(newText.length, nextLinePos);
        textarea.setSelectionRange(newCaret, newCaret);
    }

    /**
     * Implementación exacta de JumpToCurrentLine de Dopamine C# (WPF):
     * Salta la reproducción al timestamp de la línea actual del cursor.
     */
    private jumpToCurrentLine(): void {
        if (!this.lyricsEditor || !this.lyricsEditor.nativeElement) {
            return;
        }

        const textarea = this.lyricsEditor.nativeElement;
        const text = textarea.value;
        const caretIndex = textarea.selectionStart;

        const lineStart = text.lastIndexOf('\n', caretIndex - 1) + 1;
        let lineEnd = text.indexOf('\n', caretIndex);
        if (lineEnd === -1) {
            lineEnd = text.length;
        }

        const line = text.substring(lineStart, lineEnd).trim();
        if (!line.startsWith('[')) {
            return;
        }

        const closingBracketIdx = line.indexOf(']');
        if (closingBracketIdx === -1) {
            return;
        }

        const rawStamp = line.substring(1, closingBracketIdx);
        const parts = rawStamp.split(':');
        if (parts.length === 2) {
            const minutes = parseInt(parts[0], 10);
            const seconds = parseFloat(parts[1]);
            if (!isNaN(minutes) && !isNaN(seconds)) {
                const totalSeconds = minutes * 60 + seconds;
                this.playbackService.jumpToSecondAsync(totalSeconds);
            }
        }
    }

    /**
     * Implementación exacta de ReduceTimeStampToSelectedLyricsLine de Dopamine C# (WPF):
     * Resta 500 ms al timestamp de la línea actual.
     */
    private reduceTimeStampToSelectedLyricsLine(): void {
        if (!this.lyricsEditor || !this.lyricsEditor.nativeElement) {
            return;
        }

        const textarea = this.lyricsEditor.nativeElement;
        const text = textarea.value;
        const caretIndex = textarea.selectionStart;

        const lineStart = text.lastIndexOf('\n', caretIndex - 1) + 1;
        let lineEnd = text.indexOf('\n', caretIndex);
        if (lineEnd === -1) {
            lineEnd = text.length;
        }

        const line = text.substring(lineStart, lineEnd);
        const trimmed = line.trim();
        if (!trimmed.startsWith('[')) {
            return;
        }

        const closingBracketIdx = line.indexOf(']');
        if (closingBracketIdx === -1) {
            return;
        }

        const rawStamp = line.substring(line.indexOf('[') + 1, closingBracketIdx);
        const parts = rawStamp.split(':');
        if (parts.length === 2) {
            const minutes = parseInt(parts[0], 10);
            const seconds = parseFloat(parts[1]);
            if (!isNaN(minutes) && !isNaN(seconds)) {
                let totalMs = (minutes * 60 + seconds) * 1000;
                totalMs = Math.max(0, totalMs - 500);

                const newTimeStamp = this.formatTimestamp(totalMs);
                const restOfLine = line.substring(closingBracketIdx + 1);
                const newLine = line.substring(0, line.indexOf('[')) + newTimeStamp + restOfLine;

                const newText = text.substring(0, lineStart) + newLine + text.substring(lineEnd);
                this.editingLyricsText = newText;
                textarea.value = newText;

                // Mantener el cursor dentro de la línea
                textarea.setSelectionRange(caretIndex, caretIndex);
            }
        }
    }
}
