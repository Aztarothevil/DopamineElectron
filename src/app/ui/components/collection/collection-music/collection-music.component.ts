import { Component, OnDestroy, OnInit } from '@angular/core';
import { IOutputData } from 'angular-split';
import { Subscription } from 'rxjs';
import { Constants } from '../../../../common/application/constants';
import { Logger } from '../../../../common/logger';
import { PromiseUtils } from '../../../../common/utils/promise-utils';
import { AlbumModel } from '../../../../services/album/album-model';
import { AlbumData } from '../../../../data/entities/album-data';
import { ApplicationPaths } from '../../../../common/application/application-paths';
import { TranslatorServiceBase } from '../../../../services/translator/translator.service.base';
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
import { TrackModel } from '../../../../services/track/track-model';
import { TrackSorter } from '../../../../common/sorting/track-sorter';
import { MusicOrder } from './music-order';

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

    public musicOrder: MusicOrder = MusicOrder.ReverseByDateModified;
    public musicOrderText: string = '';
    public currentMusicOrderText: string = '';

    public trackOrders: TrackOrder[] = [
        TrackOrder.byTrackTitleAscending,
        TrackOrder.byDateCreatedAscending,
        TrackOrder.byDateCreatedDescending,
        TrackOrder.byDateModifiedAscending,
        TrackOrder.byDateModifiedDescending,
        TrackOrder.byRating,
    ];

    private currentFolderRawTracks: TrackModel[] = [];

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
        private trackSorter: TrackSorter,
        private translatorService: TranslatorServiceBase,
        private applicationPaths: ApplicationPaths,
        private logger: Logger,
    ) {}

    public ngOnDestroy(): void {
        this.subscription.unsubscribe();
        this.albums = [];
        this.tracks = new TrackModels();
        this.centerTracks = new TrackModels();
        this.currentFolderRawTracks = [];
    }

    public async ngOnInit(): Promise<void> {
        this.updateMusicOrderText(this.musicOrder);

        this.subscription.add(
            this.playbackService.playbackStarted$.subscribe(() => {
                this.updateRightPaneTracks();
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
        this.currentFolderRawTracks = tracksForFolder.tracks;
        this.applyCurrentMusicOrder();
    }

    public selectAllFolders(): void {
        this.selectedFolderItem = undefined;
        const allTracks = this.trackService.getVisibleTracks();
        this.currentFolderRawTracks = allTracks.tracks;
        this.applyCurrentMusicOrder();
    }

    public onToggleMusicOrder(): void {
        switch (this.musicOrder) {
            case MusicOrder.Alphabetical:
                this.musicOrder = MusicOrder.ByDateCreated;
                break;
            case MusicOrder.ByDateCreated:
                this.musicOrder = MusicOrder.ReverseByDateCreated;
                break;
            case MusicOrder.ReverseByDateCreated:
                this.musicOrder = MusicOrder.ByDateModified;
                break;
            case MusicOrder.ByDateModified:
                this.musicOrder = MusicOrder.ReverseByDateModified;
                break;
            case MusicOrder.ReverseByDateModified:
                this.musicOrder = MusicOrder.ByRating;
                break;
            case MusicOrder.ByRating:
                this.musicOrder = MusicOrder.Alphabetical;
                break;
            default:
                this.musicOrder = MusicOrder.Alphabetical;
                break;
        }

        this.updateMusicOrderText(this.musicOrder);
        this.applyCurrentMusicOrder();
    }

    protected updateMusicOrderText(musicOrder: MusicOrder): void {
        const clickText = this.translatorService.get('Language_Click_To_Order');
        const oderText = this.translatorService.get('Language_Ordered_By');
        switch (musicOrder) {
            case MusicOrder.Alphabetical:
                this.musicOrderText = clickText + this.translatorService.get('Language_By_Date_Created').toLowerCase();
                this.currentMusicOrderText = oderText + this.translatorService.get('Language_By_Date_Modified').toLowerCase();
                break;
            case MusicOrder.ByDateCreated:
                this.musicOrderText = clickText + this.translatorService.get('Language_By_Reverse_Date_Created').toLowerCase();
                this.currentMusicOrderText = oderText + this.translatorService.get('Language_By_Date_Created').toLowerCase();
                break;
            case MusicOrder.ReverseByDateCreated:
                this.musicOrderText = clickText + this.translatorService.get('Language_By_Date_Modified').toLowerCase();
                this.currentMusicOrderText = oderText + this.translatorService.get('Language_By_Reverse_Date_Created').toLowerCase();
                break;
            case MusicOrder.ByDateModified:
                this.musicOrderText = clickText + this.translatorService.get('Language_By_Reverse_Date_Modified').toLowerCase();
                this.currentMusicOrderText = oderText + this.translatorService.get('Language_By_Date_Modified').toLowerCase();
                break;
            case MusicOrder.ReverseByDateModified:
                this.musicOrderText = clickText + this.translatorService.get('Language_By_Rating').toLowerCase();
                this.currentMusicOrderText = oderText + this.translatorService.get('Language_By_Reverse_Date_Modified').toLowerCase();
                break;
            case MusicOrder.ByRating:
                this.musicOrderText = clickText + this.translatorService.get('Language_By_Date_Modified').toLowerCase();
                this.currentMusicOrderText = oderText + this.translatorService.get('Language_By_Rating').toLowerCase();
                break;
            default:
                this.musicOrderText = clickText + this.translatorService.get('Language_By_Date_Modified').toLowerCase();
                this.currentMusicOrderText = oderText + this.translatorService.get('Language_By_Reverse_Date_Modified').toLowerCase();
                break;
        }
    }

    private applyCurrentMusicOrder(): void {
        if (!this.currentFolderRawTracks) {
            this.currentFolderRawTracks = [];
        }

        let sortedTracks: TrackModel[] = [];
        switch (this.musicOrder) {
            case MusicOrder.Alphabetical:
                sortedTracks = this.trackSorter.sortByTitleAscending(this.currentFolderRawTracks);
                break;
            case MusicOrder.ByDateCreated:
                sortedTracks = this.trackSorter.sortByDateCreatedAscending(this.currentFolderRawTracks);
                break;
            case MusicOrder.ReverseByDateCreated:
                sortedTracks = this.trackSorter.sortByDateCreatedDescending(this.currentFolderRawTracks);
                break;
            case MusicOrder.ByDateModified:
                sortedTracks = this.trackSorter.sortByDateModifiedAscending(this.currentFolderRawTracks);
                break;
            case MusicOrder.ReverseByDateModified:
                sortedTracks = this.trackSorter.sortByDateModifiedDescending(this.currentFolderRawTracks);
                break;
            case MusicOrder.ByRating:
                sortedTracks = this.trackSorter.sortByRatingDescending(this.currentFolderRawTracks);
                break;
            default:
                sortedTracks = this.trackSorter.sortByTitleAscending(this.currentFolderRawTracks);
                break;
        }

        const centerTrackModels = new TrackModels();
        centerTrackModels.tracks = sortedTracks;
        this.centerTracks = centerTrackModels;
        this.tracks = this.centerTracks;

        // Generar un AlbumModel (tarjeta) por cada canción individual, preservando el orden exacto de sortedTracks
        const allAlbumModels = this.albumService.getAllAlbums();
        const albumArtworkByKey = new Map<string, string | undefined>();
        for (const alb of allAlbumModels) {
            albumArtworkByKey.set(alb.albumKey, alb.artworkId);
        }

        const cards: AlbumModel[] = [];
        for (const track of sortedTracks) {
            const data = new AlbumData();
            data.albumKey = track.albumKey;
            data.albumTitle = track.albumTitle;
            data.albumArtists = track.albumArtists;
            data.artists = track.artists;
            data.artworkId = albumArtworkByKey.get(track.albumKey);
            data.year = track.year;
            data.dateFileCreated = track.dateCreated;

            const card = new AlbumModel(data, this.translatorService, this.applicationPaths);
            card.trackTitle = track.title;
            card.trackPath = track.path;
            cards.push(card);
        }

        this.albums = cards;
    }

    public async shuffleAllAsync(): Promise<void> {
        if (!this.centerTracks || this.centerTracks.tracks.length === 0) {
            return;
        }
        this.playbackService.forceShuffled();
        await this.playbackService.enqueueAndPlayTracksAsync(this.centerTracks.tracks);
    }

    private async fillListsAsync(): Promise<void> {
        await this.scheduler.sleepAsync(Constants.longListLoadDelayMilliseconds);
        try {
            await this.scheduler.sleepAsync(Constants.shortListLoadDelayMilliseconds);
            this.folders = this.folderService.getFolders();
            await this.loadFolderItemsAsync();

            await this.scheduler.sleepAsync(Constants.shortListLoadDelayMilliseconds);
            const visibleTracks = this.trackService.getVisibleTracks();
            this.currentFolderRawTracks = visibleTracks.tracks;
            this.applyCurrentMusicOrder();

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

    private updateRightPaneTracks(): void {
        const queueTracks = this.playbackService.playbackQueue;
        if (this.playbackService.isPlaying && queueTracks && queueTracks.numberOfTracks > 0) {
            this.tracks = queueTracks;
            return;
        }

        if (this.centerTracks && this.centerTracks.numberOfTracks > 0) {
            this.tracks = this.centerTracks;
        }
    }
}
