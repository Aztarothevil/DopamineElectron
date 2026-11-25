import { AfterViewInit, Component, ElementRef, Input, OnChanges, OnDestroy, OnInit, SimpleChanges, ViewChild } from '@angular/core';
import { CdkVirtualScrollViewport } from '@angular/cdk/scrolling';
import { MatMenuTrigger } from '@angular/material/menu';
import { debounceTime, takeUntil } from 'rxjs/operators';
import { Constants } from '../../../../common/application/constants';
import { Logger } from '../../../../common/logger';
import { NativeElementProxy } from '../../../../common/native-element-proxy';
import { AlbumModel } from '../../../../services/album/album-model';
import { AddToPlaylistMenu } from '../../add-to-playlist-menu';
import { AlbumOrder, albumOrderKey } from '../album-order';
import { BaseAlbumsPersister } from '../base-albums-persister';
import { AlbumRow } from './album-row';
import { AlbumRowsGetter } from './album-rows-getter';
import { ApplicationServiceBase } from '../../../../services/application/application.service.base';
import { SelectionWatcher } from '../../selection-watcher';
import { ContextMenuOpener } from '../../context-menu-opener';
import { Timer } from '../../../../common/scheduling/timer';
import { Subject } from 'rxjs';
import { PlaybackService } from '../../../../services/playback/playback.service';
import { PlaybackStarted } from '../../../../services/playback/playback-started';
import { SettingsBase } from '../../../../common/settings/settings.base';
import { TrackModel } from '../../../../services/track/track-model';
import { TrackModels } from '../../../../services/track/track-models';
import { TrackServiceBase } from '../../../../services/track/track.service.base';
import { DialogServiceBase } from '../../../../services/dialog/dialog.service.base';
import { ScrollPositionService } from '../../../../services/scroll-position/scroll-position.service';
import { SearchServiceBase } from '../../../../services/search/search.service.base';
import { BaseVirtualScrollBrowser } from '../base-virtual-scroll-browser';
import { CollectionServiceBase } from '../../../../services/collection/collection.service.base';
import { TranslatorServiceBase } from '../../../../services/translator/translator.service.base';

@Component({
    selector: 'app-album-browser',
    host: { style: 'display: block' },
    templateUrl: './album-browser.component.html',
    styleUrls: ['./album-browser.component.scss'],
    providers: [SelectionWatcher],
})
export class AlbumBrowserComponent extends BaseVirtualScrollBrowser implements OnInit, AfterViewInit, OnChanges, OnDestroy {
    private _albums: AlbumModel[] = [];
    private _albumsPersister: BaseAlbumsPersister;
    private availableWidthInPixels: number = 0;
    private destroy$ = new Subject<void>();

    public constructor(
        public trackService: TrackServiceBase,
        public playbackService: PlaybackService,
        public dialogService: DialogServiceBase,
        private applicationService: ApplicationServiceBase,
        private albumRowsGetter: AlbumRowsGetter,
        private nativeElementProxy: NativeElementProxy,
        public selectionWatcher: SelectionWatcher,
        public contextMenuOpener: ContextMenuOpener,
        public addToPlaylistMenu: AddToPlaylistMenu,
        private settings: SettingsBase,
        private logger: Logger,
        scrollPositionService: ScrollPositionService,
        searchService: SearchServiceBase,
        private collectionService?: CollectionServiceBase,
        private translatorService?: TranslatorServiceBase,
    ) {
        super(scrollPositionService, searchService);

        this.selectionWatcher.onSelectAll = (): void => {
            this.albumsPersister.setSelectedAlbums(this.selectionWatcher.selectedItems as AlbumModel[]);
        };
    }

    public readonly albumOrders: AlbumOrder[] = Object.values(AlbumOrder).filter((x): x is AlbumOrder => typeof x === 'number');
    public readonly albumOrderKey = albumOrderKey;

    public albumOrderEnum: typeof AlbumOrder = AlbumOrder;
    public useCompactYearView: boolean = false;

    public albumCoverSize: number = 130;

    public setAlbumCoverSize(size: number): void {
        this.albumCoverSize = size;
        this.settings.albumCoverSize = size;
        this.orderAlbums();
    }

    // Cover + 4px padding + 46px title/artist + 16px vertical margin (m-2)
    public get albumRowHeight(): number {
        return this.albumCoverSize + 66;
    }

    public ngOnDestroy(): void {
        this.disposeScrollPosition(this.scrollPositionKey);

        this.destroy$.next();
        this.destroy$.complete();
    }

    public toggleYearView(): void {
        this.useCompactYearView = !this.useCompactYearView;
        this.settings.useCompactYearView = this.useCompactYearView;
        this.orderAlbums();
    }

    public ngOnChanges(changes: SimpleChanges): void {
        if (changes['albums'] || changes['albumsPersister']) {
            if (this.albumsPersister) {
                this.orderAlbums();
            }
        }
    }

    @ViewChild('albumContextMenuAnchor', { read: MatMenuTrigger, static: false })
    public albumContextMenu: MatMenuTrigger;

    public albumRows: AlbumRow[] = [];

    public selectedAlbumOrder: AlbumOrder;

    @Input()
    public scrollPositionKey: string = 'albums';

    @ViewChild('albumBrowserElement') public albumBrowserElement: ElementRef;

    @ViewChild(CdkVirtualScrollViewport) public viewPort: CdkVirtualScrollViewport;

    public get albumsPersister(): BaseAlbumsPersister {
        return this._albumsPersister;
    }

    @Input()
    public set albumsPersister(v: BaseAlbumsPersister) {
        this._albumsPersister = v;
        this.selectedAlbumOrder = this.albumsPersister.getSelectedAlbumOrder();
    }

    public get albums(): AlbumModel[] {
        return this._albums;
    }

    @Input()
    public set albums(v: AlbumModel[]) {
        this._albums = v;
        this.selectionWatcher.initialize(this.albums, false);
    }

    public get isSortedByYear(): boolean {
        return this.selectedAlbumOrder === AlbumOrder.byYearAscending || this.selectedAlbumOrder === AlbumOrder.byYearDescending;
    }

    public ngOnInit(): void {
        this.useCompactYearView = this.settings.useCompactYearView;
        this.albumCoverSize = this.settings.albumCoverSize;

        this.updatePlayingAlbum(this.playbackService?.currentTrack);

        if (this.playbackService?.playbackStarted$) {
            this.playbackService.playbackStarted$
                .pipe(takeUntil(this.destroy$))
                .subscribe((playbackStarted: PlaybackStarted) => {
                    this.updatePlayingAlbum(playbackStarted.currentTrack);
                    this.scrollToPlayingAlbum(true);
                });
        }

        if (this.playbackService?.playbackStopped$) {
            this.playbackService.playbackStopped$
                .pipe(takeUntil(this.destroy$))
                .subscribe(() => {
                    this.updatePlayingAlbum(undefined);
                });
        }
    }

    private updatePlayingAlbum(currentTrack: TrackModel | undefined): void {
        const currentAlbumKey = currentTrack?.albumKey;
        const allAlbums = (this.albumRows && this.albumRows.length > 0)
            ? this.albumRows.flatMap((row) => row.albums)
            : this.albums;

        for (const album of allAlbums) {
            album.isPlaying = currentAlbumKey != undefined && currentAlbumKey.length > 0 && album.albumKey === currentAlbumKey;
        }
    }

    public scrollToPlayingAlbum(scrollOnlyIfNotInView: boolean = true): void {
        if (!this.settings.jumpToPlayingSong) {
            return;
        }

        const playingRowIndex = (this.albumRows ?? []).findIndex((row) => row.albums.some((a) => a.isPlaying));
        if (playingRowIndex > -1 && this.viewPort != undefined) {
            setTimeout(() => {
                if (scrollOnlyIfNotInView) {
                    const rowHeight = this.albumRowHeight;
                    const viewportSize = this.viewPort.getViewportSize();
                    const scrollOffset = this.viewPort.measureScrollOffset('top');
                    const itemOffset = playingRowIndex * rowHeight;

                    // Verificar si la fila del álbum ya está visible dentro de la ventana de scroll
                    const isVisible = itemOffset >= scrollOffset && (itemOffset + rowHeight) <= (scrollOffset + viewportSize);
                    if (isVisible) {
                        return;
                    }
                }

                this.viewPort.scrollToIndex(Math.max(playingRowIndex - 1, 0), 'smooth');
            });
        }
    }

    public ngAfterViewInit(): void {
        // HACK: avoids a ExpressionChangedAfterItHasBeenCheckedError in DEV mode.
        setTimeout(() => {
            this.initializeScrollPosition(this.viewPort, this.scrollPositionKey);
            this.initializeAvailableWidth();

            if (this.albumRows.length > 0) {
                this.orderAlbums();
            }

            this.applicationService.windowSizeChanged$
                .pipe(debounceTime(Constants.albumsRedrawDelayMilliseconds), takeUntil(this.destroy$))
                .subscribe(() => {
                    if (this.hasAvailableWidthChanged()) {
                        this.orderAlbums();
                    }
                });

            this.applicationService.mouseButtonReleased$
                .pipe(debounceTime(Constants.albumsRedrawDelayMilliseconds), takeUntil(this.destroy$))
                .subscribe(() => {
                    if (this.hasAvailableWidthChanged()) {
                        this.orderAlbums();
                    }
                });
        }, 0);
    }

    public setSelectedAlbums(event: MouseEvent, albumToSelect: AlbumModel): void {
        if (this.songsQueueMode) {
            return;
        }

        this.selectionWatcher.setSelectedItems(event, albumToSelect);
        this.albumsPersister.setSelectedAlbums(this.selectionWatcher.selectedItems as AlbumModel[]);
    }

    public get hasSelectedAlbums(): boolean {
        if (this.albumsPersister == undefined) {
            return false;
        }

        return this.albumsPersister.getSelectedAlbums(this.albums).length > 0;
    }

    public clearSelectedAlbums(): void {
        this.selectionWatcher.initialize(
            this.albumRows.flatMap((row) => row.albums),
            false,
        );
        this.albumsPersister.setSelectedAlbums([]);
    }

    public applyAlbumOrder = (albumOrder: AlbumOrder): void => {
        this.selectedAlbumOrder = albumOrder;
        this.albumsPersister.setSelectedAlbumOrder(this.selectedAlbumOrder);
        this.orderAlbums();
    };

    private applySelectedAlbums(): void {
        if (this.songsQueueMode) {
            for (const album of this.albums) {
                album.isSelected = false;
            }
            return;
        }

        const selectedAlbums: AlbumModel[] = this.albumsPersister.getSelectedAlbums(this.albums);

        if (selectedAlbums == undefined) {
            return;
        }

        for (const selectedAlbum of selectedAlbums) {
            selectedAlbum.isSelected = true;
        }
    }

    private orderAlbums(): void {
        try {
            const timer = new Timer();
            timer.start();

            this.albumRows = this.albumRowsGetter.getAlbumRows(
                this.availableWidthInPixels,
                this.albums,
                this.selectedAlbumOrder,
                this.useCompactYearView,
                this.albumCoverSize + 4,
            );
            this.selectionWatcher.setDisplayedItems((this.albumRows ?? []).flatMap((row) => row.albums));
            this.applySelectedAlbums();
            this.updatePlayingAlbum(this.playbackService.currentTrack);
            this.restoreScrollPosition(this.viewPort, this.scrollPositionKey, this.albumRows.length > 0);

            timer.stop();

            this.logger.info(
                `Finished ordering albums. Time required: ${timer.elapsedMilliseconds} ms`,
                'AlbumBrowserComponent',
                'orderAlbums',
            );
        } catch (e: unknown) {
            this.logger.error(e, 'Could not order albums', 'AlbumBrowserComponent', 'orderAlbums');
        }
    }

    private initializeAvailableWidth(): void {
        this.availableWidthInPixels = this.nativeElementProxy.getElementWidth(this.albumBrowserElement);
    }

    private hasAvailableWidthChanged(): boolean {
        const newAvailableWidthInPixels: number = this.nativeElementProxy.getElementWidth(this.albumBrowserElement);

        if (this.availableWidthInPixels === newAvailableWidthInPixels) {
            return false;
        }

        this.availableWidthInPixels = newAvailableWidthInPixels;

        return true;
    }

    public onAlbumContextMenu(event: MouseEvent, album: AlbumModel): void {
        this.contextMenuOpener.open(this.albumContextMenu, event, album);
    }

    public async onAddToQueueAsync(album: AlbumModel): Promise<void> {
        await this.playbackService.addAlbumToQueueAsync(album);
    }

    @Input()
    public songsQueueMode: boolean = false;

    @Input()
    public contextTracks: TrackModel[] = [];

    @Input()
    public totalTracksCount: number | undefined;

    public get displayedCount(): number {
        if (this.songsQueueMode && this.totalTracksCount !== undefined) {
            return this.totalTracksCount;
        }
        return this.albums.length;
    }

    public async onAlbumDoubleClickAsync(album: AlbumModel): Promise<void> {
        if (this.songsQueueMode && this.contextTracks && this.contextTracks.length > 0) {
            // Estilo WPF CollectionMusic: Ordenar las pistas según el orden exacto de los álbumes en el panel central
            let tracksToEnqueue: TrackModel[] = this.contextTracks;
            const displayedAlbums = (this.albumRows ?? []).flatMap((row) => row.albums);
            if (displayedAlbums.length > 0) {
                const tracksByAlbumKey = new Map<string, TrackModel[]>();
                for (const t of this.contextTracks) {
                    if (!tracksByAlbumKey.has(t.albumKey)) {
                        tracksByAlbumKey.set(t.albumKey, []);
                    }
                    tracksByAlbumKey.get(t.albumKey)!.push(t);
                }

                // Asegurar que dentro de cada álbum las canciones estén ordenadas por discNumber y trackNumber
                for (const [_, albumTracks] of tracksByAlbumKey) {
                    albumTracks.sort((a, b) => {
                        if (a.discNumber !== b.discNumber) {
                            return a.discNumber - b.discNumber;
                        }
                        return a.number - b.number;
                    });
                }

                const ordered: TrackModel[] = [];
                for (const alb of displayedAlbums) {
                    const albTracks = tracksByAlbumKey.get(alb.albumKey);
                    if (albTracks) {
                        ordered.push(...albTracks);
                    }
                }

                if (ordered.length > 0) {
                    tracksToEnqueue = ordered;
                }
            }

            // Buscar la primera pista de este álbum
            const albumTrack = tracksToEnqueue.find((t) => t.albumKey === album.albumKey) || tracksToEnqueue[0];
            await this.playbackService.enqueueAndPlayTracksStartingFromGivenTrackAsync(tracksToEnqueue, albumTrack);
        } else {
            await this.playbackService.enqueueAndPlayAlbumAsync(album);
        }
    }
    public async onShuffleAndPlayAsync(album: AlbumModel): Promise<void> {
        if (album == undefined) {
            return;
        }

        this.playbackService.forceShuffled();
        await this.playbackService.enqueueAndPlayAlbumAsync(album);
    }

    public async onEditAsync(album: AlbumModel): Promise<void> {
        const selectedAlbums: AlbumModel[] = this.selectionWatcher.selectedItems as AlbumModel[];
        const albumsToEdit: AlbumModel[] = selectedAlbums.length > 0 ? selectedAlbums : [album];

        await this.dialogService.showEditAlbumsAsync(albumsToEdit);
    }

    public async onDeleteAlbumAsync(album: AlbumModel): Promise<void> {
        if (!this.collectionService || !this.translatorService) {
            return;
        }

        const selectedAlbums: AlbumModel[] = this.selectionWatcher.selectedItems as AlbumModel[];
        const albumsToDelete: AlbumModel[] = selectedAlbums.length > 0 ? selectedAlbums : [album];

        let dialogTitle: string = await this.translatorService.getAsync('delete-songs');
        let dialogText: string = await this.translatorService.getAsync('confirm-delete-songs');

        const userHasConfirmed: boolean = await this.dialogService.showConfirmationDialogAsync(dialogTitle, dialogText);

        if (userHasConfirmed) {
            const albumKeys = albumsToDelete.map((a) => a.albumKey);
            const tracks: TrackModels = this.trackService.getTracksForAlbums(albumKeys);

            try {
                if (!(await this.collectionService.deleteTracksAsync(tracks.tracks))) {
                    throw new Error('deleteTracksAsync returned false');
                }
            } catch (e: unknown) {
                this.logger.error(e, 'Could not delete album tracks', 'AlbumBrowserComponent', 'onDeleteAlbumAsync');
                const errorText: string = await this.translatorService.getAsync('delete-songs-error');
                this.dialogService.showErrorDialog(errorText);
            }
        }
    }

    public async shuffleAllAsync(): Promise<void> {
        if (!this.albums || this.albums.length === 0) {
            return;
        }

        const albumKeys = this.albums.map((album) => album.albumKey);
        const tracks: TrackModels = this.trackService.getTracksForAlbums(albumKeys);

        this.playbackService.forceShuffled();
        await this.playbackService.enqueueAndPlayTracksAsync(tracks.tracks);
    }
}
