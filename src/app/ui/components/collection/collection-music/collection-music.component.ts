import { Component, OnDestroy, OnInit } from '@angular/core';
import { IOutputData } from 'angular-split';
import { Subscription } from 'rxjs';
import { Constants } from '../../../../common/application/constants';
import { Logger } from '../../../../common/logger';
import { PromiseUtils } from '../../../../common/utils/promise-utils';
import { AlbumModel } from '../../../../services/album/album-model';
import { TrackModels } from '../../../../services/track/track-models';
import { FolderModel } from '../../../../services/folder/folder-model';
import { SubfolderModel } from '../../../../services/folder/subfolder-model';
import { FolderServiceBase } from '../../../../services/folder/folder.service.base';
import { SearchServiceBase } from '../../../../services/search/search.service.base';
import { TrackServiceBase } from '../../../../services/track/track.service.base';
import { AlbumServiceBase } from '../../../../services/album/album-service.base';
import { CollectionServiceBase } from '../../../../services/collection/collection.service.base';
import { PlaybackService } from '../../../../services/playback/playback.service';
import { IndexingService } from '../../../../services/indexing/indexing.service';
import { SchedulerBase } from '../../../../common/scheduling/scheduler.base';
import { TrackOrder } from '../track-order';
import { AlbumsAlbumsPersister } from '../collection-albums/albums-albums-persister';
import { MusicTracksPersister } from './music-tracks-persister';
import { AlbumRowsGetter } from '../album-browser/album-rows-getter';
import { TrackModel } from '../../../../services/track/track-model';

export interface FolderItemDisplay {
    name: string;
    path: string;
    initial: string;
}

export interface FolderGroupDisplay {
    letter: string;
    folders: FolderItemDisplay[];
}

@Component({
    selector: 'app-collection-music',
    host: { style: 'display: block; width: 100%; height: 100%;' },
    templateUrl: './collection-music.component.html',
    styleUrls: ['./collection-music.component.scss'],
})
export class CollectionMusicComponent implements OnInit, OnDestroy {
    private subscription: Subscription = new Subscription();

    public folderPaneSize: number = 6;
    public nowPlayingPaneSize: number = 24;
    public albumsPaneSize: number = 52;
    public tracksPaneSize: number = 18;

    public folders: FolderModel[] = [];
    public folderGroups: FolderGroupDisplay[] = [];
    public folderItems: FolderItemDisplay[] = [];
    public selectedFolderItem: FolderItemDisplay | undefined;
    public albums: AlbumModel[] = [];
    public tracks: TrackModels = new TrackModels();
    public centerTracks: TrackModels = new TrackModels();

    public trackOrders: TrackOrder[] = [
        TrackOrder.byDateModifiedDescending,
        TrackOrder.byDateModifiedAscending,
        TrackOrder.byDateCreatedDescending,
        TrackOrder.byDateCreatedAscending,
        TrackOrder.byRating,
        TrackOrder.byTrackTitleAscending,
        TrackOrder.byTrackTitleDescending,
        TrackOrder.byFileNameAscending,
        TrackOrder.byFileNameDescending,
        TrackOrder.byAlbum,
    ];

    public constructor(
        public searchService: SearchServiceBase,
        public albumsPersister: AlbumsAlbumsPersister,
        public tracksPersister: MusicTracksPersister,
        public folderService: FolderServiceBase,
        private indexingService: IndexingService,
        private collectionService: CollectionServiceBase,
        private albumService: AlbumServiceBase,
        private trackService: TrackServiceBase,
        private playbackService: PlaybackService,
        private scheduler: SchedulerBase,
        private albumRowsGetter: AlbumRowsGetter,
        private logger: Logger,
    ) {}

    public ngOnDestroy(): void {
        this.subscription.unsubscribe();
        this.albums = [];
        this.tracks = new TrackModels();
        this.centerTracks = new TrackModels();
    }

    public async ngOnInit(): Promise<void> {
        this.subscription.add(
            this.playbackService.playbackStarted$.subscribe(() => {
                // Al reproducir (o restaurar), reflejar la cola de reproducción en la lista lateral derecha (TracksCvs en C#)
                this.updateRightPaneTracks();
            }),
        );

        this.subscription.add(
            this.albumsPersister.selectedAlbumOrderChanged$.subscribe(() => {
                // Cuando el usuario cambia el criterio de ordenamiento de los álbumes en el centro
                this.onAlbumOrderChanged();
            }),
        );

        this.subscription.add(
            this.indexingService.indexingFinished$.subscribe(() => {
                PromiseUtils.noAwait(this.fillListsAsync());
            }),
        );

        this.subscription.add(
            this.collectionService.collectionChanged$.subscribe(() => {
                PromiseUtils.noAwait(this.fillListsAsync());
            }),
        );

        await this.fillListsAsync();
    }

    public splitDragEnd(event: IOutputData): void {
        if (event.sizes && event.sizes.length >= 4) {
            this.folderPaneSize = <number>event.sizes[0];
            this.nowPlayingPaneSize = <number>event.sizes[1];
            this.albumsPaneSize = <number>event.sizes[2];
            this.tracksPaneSize = <number>event.sizes[3];
        }
    }

    public async selectFolderItem(item: FolderItemDisplay): Promise<void> {
        if (this.selectedFolderItem === item) {
            this.selectAllFolders();
            return;
        }

        this.selectedFolderItem = item;
        const tracksForFolder = await this.trackService.getTracksInSubfolderAsync(item.path);
        const albumKeys = Array.from(new Set(tracksForFolder.tracks.map((t) => t.albumKey)));
        this.albums = this.albumService.getAllAlbums().filter((a) => albumKeys.includes(a.albumKey));
        this.centerTracks = this.orderTracksByAlbumOrder(tracksForFolder.tracks, this.albums);
        this.tracks = this.centerTracks;
    }

    public selectAllFolders(): void {
        this.selectedFolderItem = undefined;
        this.albums = this.albumService.getAllAlbums();
        const allTracks = this.trackService.getVisibleTracks();
        this.centerTracks = this.orderTracksByAlbumOrder(allTracks.tracks, this.albums);
        this.tracks = this.centerTracks;
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

    private async fillListsAsync(): Promise<void> {
        await this.scheduler.sleepAsync(Constants.longListLoadDelayMilliseconds);
        try {
            await this.scheduler.sleepAsync(Constants.shortListLoadDelayMilliseconds);
            this.folders = this.folderService.getFolders();
            await this.loadFolderItemsAsync();

            await this.scheduler.sleepAsync(Constants.shortListLoadDelayMilliseconds);
            this.getAlbums();
            const visibleTracks = this.trackService.getVisibleTracks();
            this.centerTracks = this.orderTracksByAlbumOrder(visibleTracks.tracks, this.albums);

            await this.scheduler.sleepAsync(Constants.shortListLoadDelayMilliseconds);
            this.updateRightPaneTracks();
        } catch (e: unknown) {
            this.logger.error(e, 'Could not fill lists', 'CollectionMusicComponent', 'fillListsAsync');
        }
    }

    private async loadFolderItemsAsync(): Promise<void> {
        const rawItems: FolderItemDisplay[] = [];
        for (const rootFolder of this.folders) {
            try {
                const subfolders: SubfolderModel[] = await this.folderService.getSubfoldersAsync(rootFolder, undefined);
                for (const sf of subfolders) {
                    if (!sf.isGoToParent) {
                        const name = this.extractBaseName(sf.path);
                        rawItems.push({
                            name,
                            path: sf.path,
                            initial: name.length > 0 ? name[0].toLowerCase() : '?',
                        });
                    }
                }
            } catch {
                // Ignore folder read error
            }

            if (rawItems.length === 0) {
                const name = this.extractBaseName(rootFolder.path);
                rawItems.push({
                    name,
                    path: rootFolder.path,
                    initial: name.length > 0 ? name[0].toLowerCase() : '?',
                });
            }
        }

        // Filtrar carpetas que realmente contengan canciones (descartar vacías como Dopamine)
        const validItems: FolderItemDisplay[] = [];
        for (const item of rawItems) {
            try {
                const folderTracks = await this.trackService.getTracksInSubfolderAsync(item.path);
                if (folderTracks && folderTracks.numberOfTracks > 0) {
                    validItems.push(item);
                }
            } catch {
                // Si falla al consultar pistas, omitir
            }
        }

        // Ordenar alfabéticamente por nombre
        validItems.sort((a, b) => a.name.localeCompare(b.name));
        this.folderItems = validItems;

        // Agrupar por letra inicial para el diseño de lista con badges estilo WPF
        const groupsMap = new Map<string, FolderItemDisplay[]>();
        for (const item of validItems) {
            const letter = item.initial;
            if (!groupsMap.has(letter)) {
                groupsMap.set(letter, []);
            }
            groupsMap.get(letter)!.push(item);
        }

        this.folderGroups = Array.from(groupsMap.entries()).map(([letter, folders]) => ({
            letter,
            folders,
        }));
    }

    private extractBaseName(p: string): string {
        const normalized = p.replace(/\\/g, '/');
        const parts = normalized.split('/').filter((x) => x.length > 0);
        return parts.length > 0 ? parts[parts.length - 1] : p;
    }

    private getAlbums(): void {
        this.albums = this.albumService.getAllAlbums();
    }

    private orderTracksByAlbumOrder(tracks: TrackModel[], albums: AlbumModel[]): TrackModels {
        const sortedAlbums = this.albumRowsGetter.getSortedAlbums(
            albums,
            this.albumsPersister.getSelectedAlbumOrder(),
        );

        const tracksByAlbum = new Map<string, TrackModel[]>();
        for (const track of tracks) {
            if (!tracksByAlbum.has(track.albumKey)) {
                tracksByAlbum.set(track.albumKey, []);
            }
            tracksByAlbum.get(track.albumKey)!.push(track);
        }

        for (const [_, albumTracks] of tracksByAlbum) {
            albumTracks.sort((a, b) => {
                if (a.discNumber !== b.discNumber) {
                    return a.discNumber - b.discNumber;
                }
                return a.number - b.number;
            });
        }

        const ordered: TrackModel[] = [];
        for (const alb of sortedAlbums) {
            const albTracks = tracksByAlbum.get(alb.albumKey);
            if (albTracks) {
                ordered.push(...albTracks);
            }
        }

        // Si hubiera alguna canción cuyo albumKey no coincidió con sortedAlbums, agregarla al final
        const orderedPaths = new Set(ordered.map((t) => t.path));
        for (const track of tracks) {
            if (!orderedPaths.has(track.path)) {
                ordered.push(track);
            }
        }

        const result = new TrackModels();
        result.tracks = ordered;
        return result;
    }

    private updateRightPaneTracks(): void {
        const queueTracks = this.playbackService.playbackQueue;
        // Si hay una reproducción activa (o pistas en cola en reproducción), reflejamos la cola
        if (this.playbackService.isPlaying && queueTracks && queueTracks.numberOfTracks > 0) {
            this.tracks = queueTracks;
            return;
        }

        // Si no se está reproduciendo activamente, la lista derecha muestra las canciones en el mismo orden que el panel central
        if (this.centerTracks && this.centerTracks.numberOfTracks > 0) {
            this.tracks = this.centerTracks;
        } else {
            this.loadDefaultTracks();
        }
    }

    private onAlbumOrderChanged(): void {
        if (this.centerTracks && this.centerTracks.tracks.length > 0) {
            this.centerTracks = this.orderTracksByAlbumOrder(this.centerTracks.tracks, this.albums);
            if (!this.playbackService.isPlaying) {
                this.tracks = this.centerTracks;
            }
        }
    }

    private loadDefaultTracks(): void {
        const visibleTracks = this.trackService.getVisibleTracks();
        this.centerTracks = this.orderTracksByAlbumOrder(visibleTracks.tracks, this.albums);
        this.tracks = this.centerTracks;
    }

    private getTracksForAlbumKeys(albumKeys: string[]): void {
        if (albumKeys.length > 0) {
            this.tracks = this.trackService.getTracksForAlbums(albumKeys);
        } else {
            this.tracks = this.trackService.getVisibleTracks();
        }
    }
}

